const crypto = require('crypto');
const { query, transaction } = require('./db');
const { appUrl } = require('./config');
const { encryptText, decryptText } = require('./crypto-box');
const { normalizeInternationalPhone, isValidInternationalPhone, phoneValidationMessage } = require('./phone');

const FULL_VERSION = 'FULL';
const DEFAULT_EXPIRY_DAYS = 30;
let schemaPromise;

function normalizeProject(value) {
  return String(value || 'LO').trim().toUpperCase() || 'LO';
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePhone(value, countryCode = '') {
  return normalizeInternationalPhone(value, countryCode);
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function validToken(token) {
  return /^[0-9a-f-]{36}$/i.test(String(token || ''));
}

function entitlementUrl(token) {
  return `${appUrl()}/quiz?tenant=lifeorder&p=LO&version=FULL&grant=${encodeURIComponent(token)}`;
}

function toPublicRow(row, includeLink = false) {
  if (!row) return null;
  let grantUrl = '';
  if (includeLink && row.token_ciphertext) {
    try { grantUrl = entitlementUrl(decryptText(row.token_ciphertext)); } catch (_error) { grantUrl = ''; }
  }
  return {
    id: Number(row.id || 0),
    projectCode: row.project_code || 'LO',
    versionCode: row.version_code || FULL_VERSION,
    source: row.source || '',
    status: row.status || '',
    clientName: row.client_name || '',
    clientEmail: row.client_email || '',
    clientPhone: row.client_phone || '',
    expiresAt: row.expires_at || null,
    firstOpenedAt: row.first_opened_at || null,
    verifiedAt: row.verified_at || null,
    completedAt: row.completed_at || null,
    createdAt: row.created_at || null,
    quizResultId: row.quiz_result_public_id || row.quiz_result_id || '',
    paymentOrderId: Number(row.payment_order_id || 0) || null,
    grantUrl
  };
}

async function ensureQuizEntitlementSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await query(`create table if not exists quiz_entitlements (
        id bigserial primary key,
        tenant_slug text not null references tenants(slug) on delete cascade,
        project_code text not null,
        version_code text not null default 'FULL',
        crm_contact_id bigint references crm_contacts(id) on delete set null,
        payment_order_id bigint unique,
        quiz_response_id bigint unique,
        source text not null check (source in ('payment', 'invite')),
        status text not null default 'issued' check (status in ('issued', 'started', 'completed', 'revoked', 'expired')),
        token_hash text not null unique,
        token_ciphertext text not null,
        client_name text not null default '',
        client_email text not null,
        client_phone text not null,
        expires_at timestamptz not null,
        first_opened_at timestamptz,
        verified_at timestamptz,
        completed_at timestamptz,
        revoked_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`);
      await query('create index if not exists idx_quiz_entitlements_contact on quiz_entitlements(tenant_slug, crm_contact_id, created_at desc)');
      await query('create index if not exists idx_quiz_entitlements_status on quiz_entitlements(tenant_slug, project_code, version_code, status, expires_at)');
      await query(`do $$ begin
        if to_regclass('public.payment_orders') is not null then
          alter table payment_orders add column if not exists quiz_entitlement_id bigint;
          alter table payment_orders add column if not exists quiz_response_id bigint;
        end if;
      end $$`);
    })().catch(error => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

function requireIdentity({ email, phone, phoneCountryCode }) {
  const normalized = normalizePhone(phone, phoneCountryCode);
  if (!email || !String(email).includes('@')) throw new Error('請輸入正確的 Email。');
  if (!isValidInternationalPhone(phone, phoneCountryCode)) throw new Error(phoneValidationMessage(phoneCountryCode));
  return { email: normalizeEmail(email), phone: normalized };
}

async function createFullQuizEntitlement({ tenant, projectCode = 'LO', crmContactId = null, paymentOrderId = null, source = 'invite', clientName = '', clientEmail, clientPhone, expiresAt = null }) {
  await ensureQuizEntitlementSchema();
  const email = normalizeEmail(clientEmail);
  const phone = normalizePhone(clientPhone);
  if (!email || !email.includes('@')) throw new Error('邀請對象需要有效 Email。');
  if (!phone) throw new Error('邀請對象需要有效電話。');
  const token = crypto.randomUUID();
  const expiry = expiresAt ? new Date(expiresAt) : new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  if (Number.isNaN(expiry.getTime()) || expiry.getTime() <= Date.now()) throw new Error('授權期限必須是未來時間。');
  const result = await query(
    `insert into quiz_entitlements(
       tenant_slug, project_code, version_code, crm_contact_id, payment_order_id, source,
       token_hash, token_ciphertext, client_name, client_email, client_phone, expires_at
     ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     returning *`,
    [tenant, normalizeProject(projectCode), FULL_VERSION, crmContactId || null, paymentOrderId || null, source === 'payment' ? 'payment' : 'invite', tokenHash(token), encryptText(token), String(clientName || '').slice(0, 120), email, phone, expiry.toISOString()]
  );
  const row = result.rows[0];
  if (paymentOrderId) await query('update payment_orders set quiz_entitlement_id = $2, updated_at = now() where id = $1', [paymentOrderId, row.id]);
  return toPublicRow(row, true);
}

async function fullQuizEntitlementForPayment(paymentOrderId, tenant) {
  await ensureQuizEntitlementSchema();
  const result = await query(
    `select * from quiz_entitlements
      where tenant_slug = $1 and payment_order_id = $2 and version_code = 'FULL'
      limit 1`,
    [tenant, Number(paymentOrderId || 0)]
  );
  return toPublicRow(result.rows[0], true);
}

async function publicFullQuizEntitlement(payload, tenant) {
  await ensureQuizEntitlementSchema();
  const token = String(payload.grant || payload.token || '').trim();
  if (!validToken(token)) return { success: false, message: '這份完整版授權連結無效。' };
  const result = await query(
    `select * from quiz_entitlements where tenant_slug = $1 and token_hash = $2 limit 1`,
    [tenant, tokenHash(token)]
  );
  const row = result.rows[0];
  if (!row) return { success: false, message: '這份完整版授權連結無效。' };
  if (row.status === 'revoked') return { success: false, message: '這份完整版授權已被撤銷。' };
  if (row.status === 'completed') return { success: false, code: 'ENTITLEMENT_COMPLETED', message: '這份完整版授權已完成測驗。' };
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await query("update quiz_entitlements set status = 'expired', updated_at = now() where id = $1 and status in ('issued', 'started')", [row.id]);
    return { success: false, message: '這份完整版授權已過期。' };
  }
  return { success: true, expiresAt: row.expires_at, status: row.status, source: row.source };
}

async function verifyFullQuizEntitlement(payload, tenant) {
  await ensureQuizEntitlementSchema();
  const token = String(payload.grant || payload.token || '').trim();
  if (!validToken(token)) throw new Error('這份完整版授權連結無效。');
  const identity = requireIdentity(payload);
  const result = await transaction(async client => {
    const selected = await client.query(
      `select * from quiz_entitlements
        where tenant_slug = $1 and token_hash = $2
        for update`,
      [tenant, tokenHash(token)]
    );
    const row = selected.rows[0];
    if (!row || row.status === 'revoked' || row.status === 'completed' || new Date(row.expires_at).getTime() < Date.now()) {
      throw new Error('這份完整版授權目前無法使用。');
    }
    if (normalizeEmail(row.client_email) !== identity.email || normalizePhone(row.client_phone) !== identity.phone) {
      throw new Error('Email 或電話與這份授權資料不符。');
    }
    const updated = await client.query(
      `update quiz_entitlements
          set status = 'started', first_opened_at = coalesce(first_opened_at, now()), verified_at = now(), updated_at = now()
        where id = $1
        returning *`,
      [row.id]
    );
    return updated.rows[0];
  });
  return { success: true, entitlement: toPublicRow(result, false) };
}

async function authorizeFullQuizSubmission({ tenant, grant, email, phone, phoneCountryCode }) {
  await ensureQuizEntitlementSchema();
  const token = String(grant || '').trim();
  if (!validToken(token)) throw new Error('請使用專屬完整版授權連結，或輸入有效優惠碼。');
  const identity = requireIdentity({ email, phone, phoneCountryCode });
  return transaction(async client => {
    const selected = await client.query(
      `select * from quiz_entitlements
        where tenant_slug = $1 and token_hash = $2
        for update`,
      [tenant, tokenHash(token)]
    );
    const row = selected.rows[0];
    if (!row || row.status === 'revoked' || row.status === 'completed' || new Date(row.expires_at).getTime() < Date.now()) {
      throw new Error('這份完整版授權目前無法使用。');
    }
    if (normalizeEmail(row.client_email) !== identity.email || normalizePhone(row.client_phone) !== identity.phone) {
      throw new Error('本次填寫的 Email 或電話與授權資料不符。');
    }
    await client.query(
      `update quiz_entitlements
          set status = 'started', first_opened_at = coalesce(first_opened_at, now()), verified_at = coalesce(verified_at, now()), updated_at = now()
        where id = $1`,
      [row.id]
    );
    return row;
  });
}

async function completeFullQuizEntitlement({ tenant, entitlementId, quizResponseId, quizResultId }) {
  if (!entitlementId) return null;
  await ensureQuizEntitlementSchema();
  const result = await query(
    `update quiz_entitlements
        set status = 'completed', quiz_response_id = $3, completed_at = now(), updated_at = now()
      where tenant_slug = $1 and id = $2
      returning *`,
    [tenant, Number(entitlementId), Number(quizResponseId)]
  );
  const row = result.rows[0];
  if (row?.payment_order_id) await query('update payment_orders set quiz_response_id = $2, updated_at = now() where id = $1', [row.payment_order_id, Number(quizResponseId)]);
  return toPublicRow(Object.assign({}, row || {}, { quiz_result_public_id: quizResultId || '' }), false);
}

async function listFullQuizEntitlements({ tenant, crmContactId }) {
  await ensureQuizEntitlementSchema();
  const result = await query(
    `select e.*, r.public_id as quiz_result_public_id
       from quiz_entitlements e
       left join quiz_responses r on r.id = e.quiz_response_id
      where e.tenant_slug = $1 and e.crm_contact_id = $2
      order by e.created_at desc, e.id desc`,
    [tenant, Number(crmContactId || 0)]
  );
  return result.rows.map(row => toPublicRow(row, true));
}

async function listFullQuizEntitlementMonitoring({ tenant, projectCode = null }) {
  await ensureQuizEntitlementSchema();
  const normalizedProject = projectCode ? normalizeProject(projectCode) : null;
  const result = await query(
    `select e.*, r.public_id as quiz_result_public_id,
            coalesce(c.name, e.client_name, '') as contact_name,
            coalesce(c.email, e.client_email, '') as contact_email,
            coalesce(c.phone, e.client_phone, '') as contact_phone,
            coalesce((
              select count(*)::int
                from crm_timeline_events t
               where t.tenant_slug = e.tenant_slug
                 and t.quiz_response_id = e.quiz_response_id
                 and t.event_type = 'quiz_report_viewed'
            ), 0) as report_view_count
       from quiz_entitlements e
       left join quiz_responses r on r.id = e.quiz_response_id
       left join crm_contacts c on c.id = e.crm_contact_id and c.tenant_slug = e.tenant_slug
      where e.tenant_slug = $1
        and ($2::text is null or e.project_code = $2)
      order by e.created_at desc, e.id desc
      limit 1000`,
    [tenant, normalizedProject]
  );
  return result.rows.map(row => Object.assign(toPublicRow(row, true), {
    contactName: row.contact_name || '',
    contactEmail: row.contact_email || '',
    contactPhone: row.contact_phone || '',
    reportViewCount: Number(row.report_view_count || 0)
  }));
}

async function revokeFullQuizEntitlement({ tenant, entitlementId, crmContactId = null }) {
  await ensureQuizEntitlementSchema();
  const result = await query(
    `update quiz_entitlements
        set status = 'revoked', revoked_at = now(), updated_at = now()
      where tenant_slug = $1 and id = $2
        and ($3::bigint is null or crm_contact_id = $3)
        and status in ('issued', 'started')
      returning *`,
    [tenant, Number(entitlementId || 0), crmContactId ? Number(crmContactId) : null]
  );
  if (!result.rows[0]) throw new Error('找不到可撤銷的完整版授權。');
  return toPublicRow(result.rows[0], false);
}

module.exports = {
  authorizeFullQuizSubmission,
  completeFullQuizEntitlement,
  createFullQuizEntitlement,
  ensureQuizEntitlementSchema,
  fullQuizEntitlementForPayment,
  listFullQuizEntitlements,
  listFullQuizEntitlementMonitoring,
  publicFullQuizEntitlement,
  revokeFullQuizEntitlement,
  verifyFullQuizEntitlement
};

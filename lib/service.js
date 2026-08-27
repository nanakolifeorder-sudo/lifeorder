const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { query, transaction } = require('./db');
const {
  ROLE_TENANT_ADMIN,
  ROLE_CONSULTANT,
  hashPassword,
  login,
  signSession,
  requireUser,
  isAdmin,
  isSystemOwner,
  isTenantAdmin,
  hasPermission,
  roleOf
} = require('./auth');
const {
  googleAuthUrl,
  calendarEvents,
  createCalendarEvent,
  deleteCalendarEvent,
  sendGmailMessage
} = require('./google');
const {
  microsoftEnabled,
  microsoftAuthUrl,
  microsoftCalendarEvents,
  createMicrosoftCalendarEvent,
  deleteMicrosoftCalendarEvent
} = require('./microsoft');
const {
  zonedDateString,
  zonedTimeToUtc,
  addDaysToDateString,
  dayOfWeek,
  minutesToTime,
  timeToMinutes,
  formatSlot
} = require('./time');
const { appUrl, ownerName, ownerEmail, ownerPassword } = require('./config');
const { importLegacyData } = require('./legacy-import');
const { encryptText, decryptText } = require('./crypto-box');
const {
  getCRMContactDetail,
  getQuizAdminEditor,
  getQuizConfig,
  getQuizResult,
  getQuizReportEditor,
  recordTimelineEvent,
  resolveQuizResponseId,
  saveQuizAdminEditor,
  saveQuizReportEditor,
  submitQuiz,
  syncAppointmentBooked,
  syncClientStatus,
  syncLead,
  trackReportClick
} = require('./quiz-crm');

function normalizeTenant(slug) {
  const value = String(slug || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(value)) {
    throw new Error('使用者代碼只能使用小寫英文、數字、連字號，長度 2-49。');
  }
  const legacyAliases = {
    'nicolle-demo': 'dm-test'
  };
  return legacyAliases[value] || value;
}

function normalizeProject(code) {
  return String(code || 'P01').trim().toUpperCase();
}

function normalizeBookingBaseUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  let parsed;
  try {
    parsed = new URL(text.includes('://') ? text : `https://${text}`);
  } catch (_error) {
    throw new Error('Booking 網址格式不正確。');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Booking 網址必須使用 http 或 https。');
  return parsed.origin;
}

function bookingBaseOptions(tenantRow) {
  const systemBase = normalizeBookingBaseUrl(appUrl());
  const stored = Array.isArray(tenantRow?.booking_base_urls) ? tenantRow.booking_base_urls : [];
  const primary = normalizeBookingBaseUrl(tenantRow?.app_base_url || systemBase);
  const urls = Array.from(new Set(
    [systemBase, primary].concat(stored).map(normalizeBookingBaseUrl).filter(Boolean)
  ));
  return { systemBase, primary, urls };
}

async function bookingBaseForTenant(tenant) {
  const tenantRow = await tenantBySlug(tenant);
  return bookingBaseOptions(tenantRow).primary;
}

function jwtSecret() {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set.');
  return process.env.JWT_SECRET;
}

function requestIp(req) {
  const forwarded = req?.headers?.['x-forwarded-for'] || req?.headers?.['X-Forwarded-For'] || '';
  return String(forwarded).split(',')[0].trim() || req?.socket?.remoteAddress || '';
}

async function safeQuery(text, params = []) {
  try {
    return await query(text, params);
  } catch (error) {
    if (String(error.message || '').includes('does not exist')) return { rows: [] };
    throw error;
  }
}

async function isLoginBlocked(tenant, email, ipAddress) {
  const result = await safeQuery(
    `select count(*)::int as failures
       from login_attempts
      where tenant_slug = $1
        and lower(email) = lower($2)
        and (ip_address = $3 or $3 = '')
        and success = false
        and created_at > now() - interval '15 minutes'`,
    [tenant, email, ipAddress]
  );
  return Number(result.rows[0]?.failures || 0) >= 8;
}

async function recordLoginAttempt({ tenant, email, ipAddress, success }) {
  await safeQuery(
    `insert into login_attempts(tenant_slug, email, ip_address, success)
     values($1,$2,$3,$4)`,
    [tenant, normalizeEmail(email), ipAddress || '', Boolean(success)]
  );
}

function safeCompare(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function webhookSecretForTenant(tenantRow) {
  return String(tenantRow?.webhook_secret || process.env.WEBHOOK_SECRET || '').trim();
}

function verifyWebhookRequest(req, payload, tenantRow) {
  const secret = webhookSecretForTenant(tenantRow);
  if (!secret) throw new Error('Webhook secret 尚未設定，拒絕接收外部同步。');
  const plainSecret = req?.headers?.['x-dm-webhook-secret'] || payload.webhookSecret || payload.secret || '';
  if (plainSecret && safeCompare(plainSecret, secret)) return true;
  const signature = String(req?.headers?.['x-dm-signature'] || '').replace(/^sha256=/i, '');
  if (signature && req?.rawBody) {
    const digest = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
    if (safeCompare(signature, digest)) return true;
  }
  throw new Error('Webhook 驗證失敗。');
}

function createEmailPreferenceToken(tenant, email) {
  return jwt.sign(
    { type: 'email_preferences', tenant, email: normalizeEmail(email) },
    jwtSecret(),
    { expiresIn: '365d' }
  );
}

function readEmailPreferenceToken(token, tenant) {
  let decoded;
  try {
    decoded = jwt.verify(String(token || ''), jwtSecret());
  } catch (_error) {
    throw new Error('退訂連結已失效，請聯繫管理員處理。');
  }
  if (decoded.type !== 'email_preferences' || decoded.tenant !== tenant || !decoded.email) {
    throw new Error('退訂連結不正確。');
  }
  return decoded;
}

function unsubscribeUrl(tenant, email) {
  const token = createEmailPreferenceToken(tenant, email);
  return `${appUrl()}/unsubscribe?tenant=${encodeURIComponent(tenant)}&token=${encodeURIComponent(token)}`;
}

function appendEmailFooter(body, link) {
  const safeLink = escapeEmailHtml(link || '');
  if (!safeLink || String(body || '').includes('data-dm-unsubscribe')) return body;
  return `${body || ''}<hr style="border:none;border-top:1px solid #e0e0e0;margin:24px 0"><p style="font-size:12px;color:#666;line-height:1.6" data-dm-unsubscribe="1">如果你不想再收到這個預約系統的後續提醒，可以 <a href="${safeLink}">點此退訂</a>。已預約的必要通知可能仍會依服務需求寄出。</p>`;
}

async function isEmailSuppressed(tenant, email) {
  const result = await safeQuery(
    `select id from email_suppressions where tenant_slug = $1 and lower(client_email) = lower($2) limit 1`,
    [tenant, normalizeEmail(email)]
  );
  return Boolean(result.rows[0]);
}

async function addEmailSuppression({ tenant, email, reason = 'unsubscribe', source = 'system' }) {
  await safeQuery(
    `insert into email_suppressions(tenant_slug, client_email, reason, source)
     values($1,$2,$3,$4)
     on conflict(tenant_slug, client_email) do update
     set reason = excluded.reason,
         source = excluded.source,
         created_at = now()`,
    [tenant, normalizeEmail(email), reason, source]
  );
}

async function createAdminAlert({ tenant, level = 'warning', title, message = '', context = {} }) {
  await safeQuery(
    `insert into admin_alerts(tenant_slug, level, title, message, context)
     values($1,$2,$3,$4,$5::jsonb)`,
    [tenant, level, title, message, JSON.stringify(context || {})]
  );
}

function retryDelayMinutes(retryCount) {
  const steps = [10, 30, 120];
  return steps[Math.min(Math.max(Number(retryCount || 1) - 1, 0), steps.length - 1)];
}

async function updateEmailQueueCompat(sqlNew, paramsNew, sqlFallback, paramsFallback) {
  try {
    return await query(sqlNew, paramsNew);
  } catch (error) {
    if (error.code === '42703' || String(error.message || '').includes('does not exist')) {
      return query(sqlFallback, paramsFallback);
    }
    throw error;
  }
}

function createRescheduleToken(tenant, appointmentId) {
  return jwt.sign(
    { type: 'reschedule', tenant, appointmentId: Number(appointmentId) },
    jwtSecret(),
    { expiresIn: '14d' }
  );
}

function createBookingInviteToken(payload) {
  return jwt.sign(
    {
      type: 'booking_invite',
      tenant: payload.tenant,
      data: encryptText(JSON.stringify(payload))
    },
    jwtSecret(),
    { expiresIn: '30d' }
  );
}

function readBookingInviteToken(token, tenant) {
  let decoded;
  try {
    decoded = jwt.verify(String(token || ''), jwtSecret());
  } catch (_error) {
    throw new Error('預約邀請連結已失效，請聯繫顧問重新發送。');
  }
  if (decoded.type !== 'booking_invite' || decoded.tenant !== tenant || !decoded.data) {
    throw new Error('這不是有效的預約邀請連結。');
  }
  try {
    const data = JSON.parse(decryptText(decoded.data));
    if (data.tenant !== tenant || !data.projectCode) throw new Error('invalid invitation');
    return data;
  } catch (_error) {
    throw new Error('這不是有效的預約邀請連結。');
  }
}

function readRescheduleToken(token, tenant) {
  let decoded;
  try {
    decoded = jwt.verify(String(token || ''), jwtSecret());
  } catch (_error) {
    throw new Error('改期連結已失效，請聯繫顧問重新發送。');
  }
  if (decoded.type !== 'reschedule' || decoded.tenant !== tenant || !decoded.appointmentId) {
    throw new Error('這不是有效的改期連結。');
  }
  return decoded;
}

function parseProjectCodes(value) {
  if (Array.isArray(value)) return value.map(v => String(v).trim().toUpperCase()).filter(Boolean);
  const text = String(value || 'ALL').trim();
  if (!text) return ['ALL'];
  if (text.toUpperCase() === 'ALL') return ['ALL'];
  return text.split(',').map(v => v.trim().toUpperCase()).filter(Boolean);
}

function boolFromChinese(value, fallback = true) {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  return !['否', '停用', 'false', '0', 'no'].includes(text.toLowerCase());
}

function publicRole(role) {
  const value = String(role || '').toUpperCase();
  if (value === 'SYSTEM_OWNER') return 'system_owner';
  if (value === 'TENANT_ADMIN' || value === 'ALL') return 'tenant_admin';
  return 'consultant';
}

function visibleProjectCodes(user) {
  if (isTenantAdmin(user)) return ['ALL'];
  const codes = Array.isArray(user.project_codes)
    ? user.project_codes
    : String(user.project_codes || 'ALL').split(',');
  const clean = codes.map(code => String(code).trim().toUpperCase()).filter(Boolean);
  return clean.length ? clean : ['ALL'];
}

function canSeeTenantWide(user) {
  return isTenantAdmin(user) || hasPermission(user, 'CRM_ALL');
}

function normalizePermissions(value, fallback = ROLE_CONSULTANT) {
  const text = String(value || '').trim();
  if (!text) return fallback;
  const upper = text.toUpperCase();
  if (upper === 'ALL') return ROLE_TENANT_ADMIN;
  if (upper === 'ADMIN') return ROLE_TENANT_ADMIN;
  if (upper === 'TENANT_ADMIN') return ROLE_TENANT_ADMIN;
  if (upper === 'CONSULTANT') return ROLE_CONSULTANT;
  return text;
}

function isActiveStatus(value) {
  const text = String(value || '').trim().toLowerCase();
  return !text || ['active', 'enabled', '啟用', '?'].includes(text);
}

async function projectByCode(tenant, projectCode) {
  const result = await query(
    `select * from projects where tenant_slug = $1 and code = $2 limit 1`,
    [tenant, normalizeProject(projectCode)]
  );
  return result.rows[0];
}

async function tenantBySlug(tenant) {
  try {
    const result = await query(
      `select slug, name, owner_name, owner_email, app_base_url, booking_base_urls, webhook_secret
         from tenants where slug = $1 limit 1`,
      [tenant]
    );
    return result.rows[0] || null;
  } catch (error) {
    if (error.code !== '42703' && !String(error.message || '').includes('webhook_secret')) throw error;
    const fallback = await query(
      `select slug, name, owner_name, owner_email, app_base_url, booking_base_urls
         from tenants where slug = $1 limit 1`,
      [tenant]
    );
    return fallback.rows[0] ? Object.assign({ webhook_secret: '' }, fallback.rows[0]) : null;
  }
}

async function initializeTenant(payload, options = {}) {
  const installerSecret = process.env.INSTALLER_SECRET || '';
  if (!options.skipInstallerSecret && installerSecret && payload.installerSecret !== installerSecret) {
    throw new Error('安裝密鑰不正確。');
  }

  const tenant = normalizeTenant(payload.tenant || payload.tenantSlug);
  const password = payload.adminPwd || payload.password || ownerPassword();
  if (!password) throw new Error('請設定管理員密碼。');

  const adminEmail = payload.adminEmail || ownerEmail();
  if (!adminEmail) throw new Error('請提供管理員 Email。');

  const adminName = payload.adminName || ownerName();
  const passwordHash = await hashPassword(password);
  const projectName = payload.projectName || '預約諮詢';

  await transaction(async client => {
    await client.query(
      `insert into tenants(slug, name, owner_name, owner_email, owner_password_hash, app_base_url)
       values($1, $2, $3, $4, $5, $6)
       on conflict(slug) do update
       set name = excluded.name,
           owner_name = excluded.owner_name,
           owner_email = excluded.owner_email,
           owner_password_hash = excluded.owner_password_hash,
           app_base_url = excluded.app_base_url`,
      [tenant, payload.tenantName || projectName, adminName, adminEmail, passwordHash, appUrl()]
    );

    await client.query(
      `insert into projects(tenant_slug, code, name, status)
       values($1, 'P01', $2, '啟用')
       on conflict(tenant_slug, code) do nothing`,
      [tenant, projectName]
    );

    await client.query(
      `insert into consultants(
         tenant_slug, name, login_email, password_hash, calendar_id,
         accepting, weight, permissions, project_codes, meet_tool, time_zone
       )
       values($1, $2, $3, $4, 'primary', false, 1, $5, array['ALL']::text[], 'Google Meet', 'Asia/Taipei')
       on conflict(tenant_slug, login_email) do update
       set name = excluded.name,
           password_hash = excluded.password_hash,
           permissions = $5,
           project_codes = array['ALL']::text[]`,
      [tenant, adminName, adminEmail, passwordHash, ROLE_TENANT_ADMIN]
    );
  });

  await seedDemoAccounts(tenant);

  return {
    success: true,
    tenant,
    adminUrl: `${appUrl()}/admin?tenant=${tenant}`,
    bookingUrl: `${appUrl()}/booking?tenant=${tenant}&p=P01`
  };
}

async function seedDemoAccounts(tenant) {
  const adminHash = await hashPassword('1111');
  const consultantHash = await hashPassword('1111');
  await transaction(async client => {
    await client.query(
      `insert into consultants(
         tenant_slug, name, login_email, password_hash, calendar_id,
         accepting, weight, permissions, project_codes, meet_tool, time_zone
       )
       values($1, 'DMtest 使用者管理員', 'tenant-admin@dmtest.test', $2, 'primary',
              false, 1, $3, array['ALL']::text[], 'Google Meet', 'Asia/Taipei')
       on conflict(tenant_slug, login_email) do update
       set name = excluded.name,
           password_hash = excluded.password_hash,
           accepting = false,
           permissions = $3,
           project_codes = array['ALL']::text[]`,
      [tenant, adminHash, ROLE_TENANT_ADMIN]
    );

    await client.query(
      `insert into consultants(
         tenant_slug, name, login_email, password_hash, calendar_id,
         accepting, weight, permissions, project_codes, meet_tool, time_zone
       )
       values($1, 'DMtest 顧問', 'consultant@dmtest.test', $2, 'primary',
              true, 50, $3, array['ALL']::text[], 'Google Meet', 'Asia/Taipei')
       on conflict(tenant_slug, login_email) do update
       set name = excluded.name,
           password_hash = excluded.password_hash,
           accepting = true,
           permissions = $3,
           project_codes = array['ALL']::text[]`,
      [tenant, consultantHash, ROLE_CONSULTANT]
    );
  });
  return {
    success: true,
    accounts: [
      { role: 'tenant_admin', name: 'DMtest 使用者管理員', email: 'tenant-admin@dmtest.test', password: '1111' },
      { role: 'consultant', name: 'DMtest 顧問', email: 'consultant@dmtest.test', password: '1111' }
    ]
  };
}

async function verifyLogin(payload, tenant, req) {
  const email = normalizeEmail(payload.email);
  const ipAddress = requestIp(req);
  if (await isLoginBlocked(tenant, email, ipAddress)) {
    return { success: false, message: '登入失敗次數過多，請 15 分鐘後再試。' };
  }

  const user = await login(tenant, email, payload.password);
  await recordLoginAttempt({ tenant, email, ipAddress, success: Boolean(user) });
  const role = user ? roleOf(user) : '';
  const tenantInfo = user ? await tenantBySlug(tenant) : null;
  if (!user) return { success: false, message: '帳號或密碼不正確。' };
  if (isSystemOwner(user)) {
    user.name = ownerName();
    user.permissions = 'SYSTEM_OWNER';
  }
  return {
    success: true,
    id: user.id,
    name: user.name,
    email: user.login_email,
    tenantName: tenantInfo?.name || tenant,
    role: publicRole(role),
    isAdmin: isTenantAdmin(user),
    isSystemOwner: isSystemOwner(user),
    permissions: user.permissions || '',
    authToken: signSession(user)
  };
}
async function getQuestions(payload, tenant) {
  const projectCode = normalizeProject(payload.projectCode);
  const project = await projectByCode(tenant, projectCode);
  if (!project || !isActiveStatus(project.status)) {
    return { error: '這個預約頁目前未啟用。' };
  }
  const result = await query(
    `select title, type, options, reject_word, is_required
       from questions
      where tenant_slug = $1 and project_code = $2
      order by sort_order asc, id asc`,
    [tenant, projectCode]
  );
  return {
    success: true,
    projectName: project.name,
    mainUrl: project.main_url || '',
    bookingNotice: project.booking_notice || '',
    rejectType: project.reject_type || 'text',
    rejectValue: project.reject_value || '',
    questions: result.rows.map(row => ({
      title: row.title,
      type: row.type,
      options: Array.isArray(row.options) ? row.options : [],
      rejectWord: row.reject_word || '',
      isRequired: row.is_required ? '是' : '否'
    }))
  };
}

async function getAdminQuestions(payload, tenant) {
  const result = await query(
    `select id, title, type, options, reject_word, is_required
       from questions
      where tenant_slug = $1 and project_code = $2
      order by sort_order asc, id asc`,
    [tenant, normalizeProject(payload.projectCode)]
  );
  return result.rows.map(row => ({
    rowId: row.id,
    title: row.title,
    type: row.type,
    options: Array.isArray(row.options) ? row.options.join('\n') : '',
    rejectWord: row.reject_word || '',
    isRequired: row.is_required ? '是' : '否'
  }));
}

async function saveAdminQuestions(payload, tenant) {
  const projectCode = normalizeProject(payload.projectCode);
  const questions = Array.isArray(payload.questions) ? payload.questions : [];
  await transaction(async client => {
    await client.query(`delete from questions where tenant_slug = $1 and project_code = $2`, [tenant, projectCode]);
    for (let index = 0; index < questions.length; index += 1) {
      const q = questions[index];
      const options = Array.isArray(q.options)
        ? q.options
        : String(q.options || '').split(/\n|,/).map(v => v.trim()).filter(Boolean);
      await client.query(
        `insert into questions(tenant_slug, project_code, sort_order, title, type, options, reject_word, is_required)
         values($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
        [
          tenant,
          projectCode,
          index,
          q.title || `題目 ${index + 1}`,
          q.type || '簡答',
          JSON.stringify(options),
          q.rejectWord || q.reject_word || '',
          q.isRequired === false || q.isRequired === '否' ? false : true
        ]
      );
    }
  });
  return { success: true };
}

async function getAdminProjectData(_payload, tenant) {
  const [result, tenantRow] = await Promise.all([
    query(
      `select id, code, name, status, main_url, fallback_url, booking_notice, reject_type, reject_value
         from projects
        where tenant_slug = $1
        order by id asc`,
      [tenant]
    ),
    tenantBySlug(tenant)
  ]);
  const bookingBases = bookingBaseOptions(tenantRow);
  return {
    success: true,
    systemBaseUrl: `${bookingBases.systemBase}/booking?tenant=${tenant}`,
    primaryBookingBaseUrl: bookingBases.primary,
    bookingBaseUrls: bookingBases.urls,
    projects: result.rows.map(row => ({
      rowId: row.id,
      code: row.code,
      name: row.name,
      status: row.status,
      mainUrl: row.main_url || '',
      fallbackUrl: row.fallback_url || '',
      bookingNotice: row.booking_notice || '',
      rejectType: row.reject_type || 'text',
      rejectValue: row.reject_value || '',
      bookingUrl: `${bookingBases.primary}/booking?tenant=${tenant}&p=${row.code}`
    }))
  };
}

async function saveBookingBaseUrls(payload, tenant) {
  const tenantRow = await tenantBySlug(tenant);
  if (!tenantRow) throw new Error('找不到使用者。');
  const systemBase = normalizeBookingBaseUrl(appUrl());
  const inputUrls = Array.isArray(payload.urls) ? payload.urls : [];
  const urls = Array.from(new Set([systemBase].concat(inputUrls).map(normalizeBookingBaseUrl).filter(Boolean)));
  if (urls.length > 10) throw new Error('最多可保存 10 個 Booking 網址。');
  const primary = normalizeBookingBaseUrl(payload.primary || systemBase);
  if (!urls.includes(primary)) urls.push(primary);
  await query(
    `update tenants
        set app_base_url = $2,
            booking_base_urls = $3::jsonb
      where slug = $1`,
    [tenant, primary, JSON.stringify(urls)]
  );
  return { success: true, primary, urls };
}

async function saveProjectData(payload, tenant) {
  const code = normalizeProject(payload.code || payload.projectCode);
  if (payload.rowId) {
    await query(
      `update projects
          set code = $3, name = $4, status = $5, main_url = $6, fallback_url = $7,
              booking_notice = $8, reject_type = $9, reject_value = $10
        where tenant_slug = $1 and id = $2`,
      [
        tenant,
        payload.rowId,
        code,
        payload.name || code,
        payload.status || '啟用',
        payload.mainUrl || '',
        payload.fallbackUrl || '',
        payload.bookingNotice || '',
        payload.rejectType || 'text',
        payload.rejectValue || ''
      ]
    );
  } else {
    await query(
      `insert into projects(tenant_slug, code, name, status, main_url, fallback_url, booking_notice, reject_type, reject_value)
       values($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict(tenant_slug, code) do update
       set name = excluded.name,
           status = excluded.status,
           main_url = excluded.main_url,
           fallback_url = excluded.fallback_url,
           booking_notice = excluded.booking_notice,
           reject_type = excluded.reject_type,
           reject_value = excluded.reject_value`,
      [tenant, code, payload.name || code, payload.status || '啟用', payload.mainUrl || '', payload.fallbackUrl || '', payload.bookingNotice || '', payload.rejectType || 'text', payload.rejectValue || '']
    );
  }
  return { success: true };
}

async function getAdminConsultantData(_payload, tenant) {
  const [consultants, projects] = await Promise.all([
    query(
      `select id, name, login_email, calendar_id, google_email, microsoft_email, accepting, weight, permissions,
               project_codes, meet_tool, time_zone, interval_minutes, buffer_before, buffer_after,
               min_days, max_days, google_refresh_token, microsoft_refresh_token
         from consultants
        where tenant_slug = $1
        order by id asc`,
      [tenant]
    ),
    query(`select code, name from projects where tenant_slug = $1 order by id asc`, [tenant])
  ]);
  return {
    success: true,
    projects: projects.rows,
    consultants: consultants.rows.map(row => ({
      rowId: row.id,
      id: row.id,
      name: row.name,
      loginEmail: row.login_email,
      calId: row.calendar_id || 'primary',
      googleEmail: row.google_email || '',
      googleConnected: Boolean(row.google_refresh_token),
      microsoftEmail: row.microsoft_email || '',
      microsoftConnected: Boolean(row.microsoft_refresh_token),
      microsoftEnabled: microsoftEnabled(),
      isAccepting: row.accepting ? '是' : '否',
      weight: row.weight,
      role: publicRole(roleOf(row)),
      sysRole: row.permissions || '',
      projects: (row.project_codes || []).join(','),
      meetTool: row.meet_tool,
      shiftTZ: row.time_zone,
      interval: row.interval_minutes,
      bufferBefore: row.buffer_before,
      bufferAfter: row.buffer_after,
      minDays: row.min_days,
      maxDays: row.max_days
    }))
  };
}

async function saveConsultantData(payload, tenant, user) {
  const passwordHash = payload.password ? await hashPassword(payload.password) : null;
  const projectCodes = parseProjectCodes(payload.projects || payload.projectCodes);
  const requestedEmail = normalizeEmail(payload.loginEmail || payload.email);
  if (!isSystemOwner(user) && requestedEmail === normalizeEmail(ownerEmail())) {
    throw new Error('最高權限系統管理員帳號只能由最高權限本人修改。');
  }
  if (payload.rowId || payload.id) {
    const id = payload.rowId || payload.id;
    const currentResult = await query(
      `select login_email, permissions from consultants where tenant_slug = $1 and id = $2 limit 1`,
      [tenant, id]
    );
    const current = currentResult.rows[0];
    if (!isSystemOwner(user) && normalizeEmail(current?.login_email) === normalizeEmail(ownerEmail())) {
      throw new Error('最高權限系統管理員帳號只能由最高權限本人修改。');
    }
    const currentIsAdmin = String(current?.permissions || '').toUpperCase().includes(ROLE_TENANT_ADMIN) ||
      String(current?.permissions || '').trim().toUpperCase() === 'ALL';
    const requestedPermissions = normalizePermissions(payload.sysRole || payload.permissions);
    const requestedIsAdmin = String(requestedPermissions).toUpperCase().includes(ROLE_TENANT_ADMIN) ||
      String(requestedPermissions).trim().toUpperCase() === 'ALL';
    if (currentIsAdmin && !requestedIsAdmin && !isSystemOwner(user)) {
      const otherAdmins = await query(
        `select count(*)::int as count
           from consultants
          where tenant_slug = $1
            and id <> $2
            and (
              upper(permissions) like '%TENANT_ADMIN%'
              or upper(trim(permissions)) = 'ALL'
            )`,
        [tenant, id]
      );
      if (Number(otherAdmins.rows[0]?.count || 0) < 1) {
        throw new Error('每個使用者至少要保留一位使用者管理員。');
      }
    }
    if (passwordHash) {
      await query(
        `update consultants
            set name = $3, login_email = $4, password_hash = $5, calendar_id = $6,
                accepting = $7, weight = $8, permissions = $9, project_codes = $10,
                meet_tool = $11, time_zone = $12
          where tenant_slug = $1 and id = $2`,
        [
          tenant, id, payload.name, payload.loginEmail || payload.email, passwordHash,
          payload.calId || payload.calendarId || 'primary', boolFromChinese(payload.isAccepting),
          Number(payload.weight || 50), normalizePermissions(payload.sysRole || payload.permissions),
          projectCodes, supportedMeetTool(payload.meetTool || 'Google Meet'), payload.shiftTZ || payload.timeZone || 'Asia/Taipei'
        ]
      );
    } else {
      await query(
        `update consultants
            set name = $3, login_email = $4, calendar_id = $5, accepting = $6,
                weight = $7, permissions = $8, project_codes = $9, meet_tool = $10, time_zone = $11
          where tenant_slug = $1 and id = $2`,
        [
          tenant, id, payload.name, payload.loginEmail || payload.email,
          payload.calId || payload.calendarId || 'primary', boolFromChinese(payload.isAccepting),
          Number(payload.weight || 50), normalizePermissions(payload.sysRole || payload.permissions),
          projectCodes, supportedMeetTool(payload.meetTool || 'Google Meet'), payload.shiftTZ || payload.timeZone || 'Asia/Taipei'
        ]
      );
    }
  } else {
    if (!passwordHash) throw new Error('新增顧問時請提供登入密碼。');
    await query(
      `insert into consultants(
         tenant_slug, name, login_email, password_hash, calendar_id, accepting,
         weight, permissions, project_codes, meet_tool, time_zone
       )
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        tenant, payload.name, payload.loginEmail || payload.email, passwordHash,
        payload.calId || payload.calendarId || 'primary', boolFromChinese(payload.isAccepting),
        Number(payload.weight || 50), normalizePermissions(payload.sysRole || payload.permissions),
        projectCodes, supportedMeetTool(payload.meetTool || 'Google Meet'), payload.shiftTZ || payload.timeZone || 'Asia/Taipei'
      ]
    );
  }
  return { success: true };
}

async function deleteConsultantData(payload, tenant, user) {
  const consultantId = Number(payload.rowId || payload.id);
  if (!consultantId) throw new Error('缺少團隊顧問資料。');
  if (Number(user.id) === consultantId) throw new Error('不能刪除目前正在登入的帳號。');

  return transaction(async client => {
    const targetResult = await client.query(
      `select id, name, login_email, permissions
         from consultants
        where tenant_slug = $1 and id = $2
        limit 1`,
      [tenant, consultantId]
    );
    const target = targetResult.rows[0];
    if (!target) throw new Error('找不到這位團隊顧問。');
    if (normalizeEmail(target.login_email) === normalizeEmail(ownerEmail())) {
      throw new Error('最高權限系統管理員帳號不能刪除。');
    }

    const upcomingResult = await client.query(
      `select count(*)::int as count
         from appointments
        where tenant_slug = $1
          and consultant_id = $2
          and start_at >= now()
          and lower(status) not in ('已取消', 'cancelled', 'canceled')`,
      [tenant, consultantId]
    );
    if (Number(upcomingResult.rows[0]?.count || 0) > 0) {
      throw new Error('這位團隊顧問仍有即將到來的預約，請先轉派或取消後再刪除。');
    }

    if (
      String(target.permissions || '').toUpperCase().includes(ROLE_TENANT_ADMIN) ||
      String(target.permissions || '').trim().toUpperCase() === 'ALL'
    ) {
      const adminResult = await client.query(
        `select count(*)::int as count
           from consultants
          where tenant_slug = $1
            and id <> $2
            and (
              upper(permissions) like '%TENANT_ADMIN%'
              or upper(trim(permissions)) = 'ALL'
            )`,
        [tenant, consultantId]
      );
      if (Number(adminResult.rows[0]?.count || 0) < 1) {
        throw new Error('每個使用者至少要保留一位使用者管理員。');
      }
    }

    await client.query(
      `delete from consultants where tenant_slug = $1 and id = $2`,
      [tenant, consultantId]
    );
    return { success: true, message: `已刪除 ${target.name} 的登入與排班資料。` };
  });
}

async function getGoogleConnectUrl(payload, tenant) {
  const consultantId = payload.consultantId || payload.rowId;
  if (!consultantId) throw new Error('缺少 consultantId。');
  const returnTo = payload.returnTo || `${appUrl()}/admin?tenant=${tenant}`;
  return { success: true, url: googleAuthUrl({ tenant, consultantId, returnTo }) };
}

async function getMicrosoftConnectUrl(payload, tenant) {
  const consultantId = payload.consultantId || payload.rowId;
  if (!consultantId) throw new Error('缺少 consultantId。');
  const returnTo = payload.returnTo || `${appUrl()}/admin?tenant=${tenant}`;
  return { success: true, url: microsoftAuthUrl({ tenant, consultantId, returnTo }) };
}

async function getConsultantScheduleData(payload, tenant, user) {
  const consultantId = payload.consultantId || payload.rowId || (isAdmin(user) ? null : user.id);
  if (!isAdmin(user) && Number(consultantId) !== Number(user.id)) {
    throw new Error('你只能管理自己的開放時段。');
  }
  let consultant;
  if (consultantId) {
    const c = await query(`select * from consultants where tenant_slug = $1 and id = $2`, [tenant, consultantId]);
    consultant = c.rows[0];
  } else if (payload.consultantName) {
    const c = await query(`select * from consultants where tenant_slug = $1 and name = $2`, [tenant, payload.consultantName]);
    consultant = c.rows[0];
  }
  if (!consultant) throw new Error('找不到顧問。');

  const rules = await query(
    `select id, kind, day_of_week, date_value, start_time, end_time, start_time2, end_time2
       from availability_rules
      where tenant_slug = $1 and consultant_id = $2
      order by kind, day_of_week, date_value`,
    [tenant, consultant.id]
  );

  return {
    success: true,
    consultantId: consultant.id,
    consultantName: consultant.name,
    shiftTZ: consultant.time_zone,
    accepting: Boolean(consultant.accepting),
    meetTool: consultant.meet_tool || 'Google Meet',
    googleConnected: Boolean(consultant.google_refresh_token),
    googleEmail: consultant.google_email || '',
    microsoftConnected: Boolean(consultant.microsoft_refresh_token),
    microsoftEmail: consultant.microsoft_email || '',
    microsoftEnabled: microsoftEnabled(),
    settings: {
      interval: consultant.interval_minutes,
      bufferBefore: consultant.buffer_before,
      bufferAfter: consultant.buffer_after,
      minDays: consultant.min_days,
      maxDays: consultant.max_days
    },
    video: { tool: consultant.meet_tool },
    weekly: rules.rows.filter(r => r.kind === 'weekly').map(r => ({
      rowId: r.id,
      dayOfWeek: r.day_of_week,
      start: r.start_time,
      end: r.end_time,
      start2: r.start_time2 || '',
      end2: r.end_time2 || ''
    })),
    specific: rules.rows.filter(r => r.kind === 'specific').map(r => ({
      rowId: r.id,
      date: r.date_value,
      start: r.start_time,
      end: r.end_time
    }))
  };
}

async function saveConsultantWeeklyAndSettings(payload, tenant, user) {
  const consultantId = payload.consultantId || payload.rowId || (isAdmin(user) ? null : user.id);
  if (!consultantId) throw new Error('缺少 consultantId。');
  if (!isAdmin(user) && Number(consultantId) !== Number(user.id)) {
    throw new Error('你只能管理自己的開放時段。');
  }
  const settings = payload.settings || {};
  const requestedMinDays = Number(settings.minDays);
  const requestedMaxDays = Number(settings.maxDays);
  const minDays = Math.min(Math.max(Number.isFinite(requestedMinDays) ? requestedMinDays : 1, 0), 365);
  const maxDays = Math.min(Math.max(Number.isFinite(requestedMaxDays) ? requestedMaxDays : 14, minDays), 365);
  const weeklyRules = Array.isArray(payload.weeklyRules) ? payload.weeklyRules : [];
  const specificRules = Array.isArray(payload.specificRules) ? payload.specificRules : [];

  await transaction(async client => {
    await client.query(
      `update consultants
          set interval_minutes = $3,
              buffer_before = $4,
              buffer_after = $5,
              min_days = $6,
              max_days = $7,
              time_zone = $8,
              accepting = $9,
              meet_tool = $10
        where tenant_slug = $1 and id = $2`,
      [
        tenant,
        consultantId,
        Number(settings.interval || 60),
        Number(settings.bufferBefore || 0),
        Number(settings.bufferAfter || 0),
        minDays,
        maxDays,
        payload.shiftTZ || payload.timeZone || 'Asia/Taipei',
        boolFromChinese(payload.accepting),
        supportedMeetTool(payload.meetTool || 'Google Meet')
      ]
    );
    await client.query(`delete from availability_rules where tenant_slug = $1 and consultant_id = $2`, [tenant, consultantId]);
    for (const rule of weeklyRules) {
      if (!rule.start || !rule.end) continue;
      await client.query(
        `insert into availability_rules(tenant_slug, consultant_id, kind, day_of_week, start_time, end_time, start_time2, end_time2)
         values($1,$2,'weekly',$3,$4,$5,$6,$7)`,
        [tenant, consultantId, Number(rule.dayOfWeek), rule.start, rule.end, rule.start2 || '', rule.end2 || '']
      );
    }
    for (const rule of specificRules) {
      if (!rule.date || !rule.start || !rule.end) continue;
      await client.query(
        `insert into availability_rules(tenant_slug, consultant_id, kind, date_value, start_time, end_time)
         values($1,$2,'specific',$3,$4,$5)`,
        [tenant, consultantId, rule.date, rule.start, rule.end]
      );
    }
  });
  return { success: true };
}

function projectMatches(consultant, projectCode) {
  const codes = consultant.project_codes || [];
  return codes.includes('ALL') || codes.includes(projectCode);
}

function consultantCalendarProvider(consultant) {
  if (String(consultant.meet_tool || '').toLowerCase().includes('microsoft')) return 'microsoft';
  if (String(consultant.meet_tool || '').toLowerCase().includes('zoom')) return 'zoom';
  return 'google';
}

function supportedMeetTool(value) {
  const text = String(value || 'Google Meet').trim();
  if (text === 'Microsoft Teams' && microsoftEnabled()) return text;
  return 'Google Meet';
}

async function getAvailableTimes(payload, tenant) {
  const projectCode = normalizeProject(payload.projectCode);
  const project = await projectByCode(tenant, projectCode);
  if (!project || !isActiveStatus(project.status)) return [];

  const consultants = await query(
    `select * from consultants
      where tenant_slug = $1
        and accepting = true
        and (google_refresh_token is not null or microsoft_refresh_token is not null)`,
    [tenant]
  );
  const eligible = consultants.rows.filter(c => projectMatches(c, projectCode));
  if (!eligible.length) return [];

  const available = new Map();
  const now = new Date();

  for (const consultant of eligible) {
    const provider = consultantCalendarProvider(consultant);
    if (provider === 'zoom') continue;
    if (provider === 'google' && !consultant.google_refresh_token) continue;
    if (provider === 'microsoft' && !consultant.microsoft_refresh_token) continue;
    const tz = consultant.time_zone || 'Asia/Taipei';
    const today = zonedDateString(now, tz);
    const startDate = addDaysToDateString(today, Number(consultant.min_days || 1));
    const endDate = addDaysToDateString(today, Number(consultant.max_days || 14) + 1);
    const rangeStart = zonedTimeToUtc(startDate, '00:00', tz);
    const rangeEnd = zonedTimeToUtc(endDate, '23:59', tz);

    const rulesResult = await query(
      `select * from availability_rules where tenant_slug = $1 and consultant_id = $2`,
      [tenant, consultant.id]
    );
    const rules = rulesResult.rows;
    if (!rules.length) continue;

    let busyEvents = [];
    try {
      busyEvents = provider === 'microsoft'
        ? await microsoftCalendarEvents({
            encryptedRefreshToken: consultant.microsoft_refresh_token,
            calendarId: consultant.calendar_id || 'primary',
            timeMin: rangeStart,
            timeMax: rangeEnd
          })
        : await calendarEvents({
            encryptedRefreshToken: consultant.google_refresh_token,
            calendarId: consultant.calendar_id || 'primary',
            timeMin: rangeStart,
            timeMax: rangeEnd
          });
    } catch (_error) {
      continue;
    }

    for (let offset = Number(consultant.min_days || 1); offset <= Number(consultant.max_days || 14); offset += 1) {
      const dateString = addDaysToDateString(today, offset);
      const specific = rules.find(r => r.kind === 'specific' && String(r.date_value).slice(0, 10) === dateString);
      const weekly = rules.find(r => r.kind === 'weekly' && Number(r.day_of_week) === dayOfWeek(dateString));
      const rule = specific || weekly;
      if (!rule) continue;

      const blocks = [{ start: rule.start_time, end: rule.end_time }];
      if (rule.start_time2 && rule.end_time2) blocks.push({ start: rule.start_time2, end: rule.end_time2 });

      for (const block of blocks) {
        const startMinute = timeToMinutes(block.start);
        const endMinute = timeToMinutes(block.end);
        for (let minute = startMinute; minute + 60 <= endMinute; minute += Number(consultant.interval_minutes || 60)) {
          const slotStart = zonedTimeToUtc(dateString, minutesToTime(minute), tz);
          const slotEnd = new Date(slotStart.getTime() + 60 * 60000);
          if (slotStart.getTime() < now.getTime()) continue;

          const conflict = busyEvents.some(event => {
            if (event.status === 'cancelled' || event.transparency === 'transparent') return false;
            const evStart = new Date(event.start?.dateTime || event.start?.date);
            const evEnd = new Date(event.end?.dateTime || event.end?.date);
            const busyStart = new Date(evStart.getTime() - Number(consultant.buffer_before || 0) * 60000);
            const busyEnd = new Date(evEnd.getTime() + Number(consultant.buffer_after || 0) * 60000);
            return slotStart < busyEnd && slotEnd > busyStart;
          });
          if (conflict) continue;

          const key = String(slotStart.getTime());
          const current = available.get(key);
          if (!current || Number(consultant.weight || 50) < current.weight) {
            available.set(key, {
              displayText: formatSlot(slotStart, tz),
              dateKey: dateString,
              dateLabel: new Intl.DateTimeFormat('zh-TW', {
                timeZone: tz,
                month: 'long',
                day: 'numeric',
                weekday: 'long'
              }).format(slotStart),
              timeLabel: new Intl.DateTimeFormat('zh-TW', {
                timeZone: tz,
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
              }).format(slotStart),
              timestamp: slotStart.getTime(),
              consultant: consultant.name,
              consultantId: consultant.id,
              weight: Number(consultant.weight || 50)
            });
          }
        }
      }
    }
  }

  return Array.from(available.values()).sort((a, b) => a.timestamp - b.timestamp);
}

async function resolveRescheduleAppointment(token, tenant) {
  const decoded = readRescheduleToken(token, tenant);
  const result = await query(
    `select a.*, c.google_refresh_token as old_google_refresh_token,
            c.microsoft_refresh_token as old_microsoft_refresh_token
       from appointments a
       left join consultants c
         on c.id = a.consultant_id and c.tenant_slug = a.tenant_slug
      where a.tenant_slug = $1 and a.id = $2
      limit 1`,
    [tenant, decoded.appointmentId]
  );
  const appointment = result.rows[0];
  if (!appointment) throw new Error('找不到這筆預約，請聯繫顧問。');
  return appointment;
}

async function getRescheduleData(payload, tenant) {
  const appointment = await resolveRescheduleAppointment(payload.rescheduleToken || payload.rid, tenant);
  return {
    success: true,
    projectCode: appointment.project_code,
    projectName: appointment.project_name,
    clientName: appointment.client_name,
    clientEmail: appointment.client_email,
    clientPhone: appointment.client_phone || '',
    answers: appointment.answers || ''
  };
}

async function resolveBookingInviteData(token, tenant) {
  const decoded = readBookingInviteToken(token, tenant);
  if (decoded.waitlistId) {
    const result = await query(
      `select id, project_code, client_name, client_email, client_phone, answers
         from waitlist_clients
        where tenant_slug = $1 and id = $2
        limit 1`,
      [tenant, decoded.waitlistId]
    );
    const row = result.rows[0];
    if (!row) throw new Error('這筆等候名單邀請已失效。');
    return {
      projectCode: row.project_code,
      clientName: row.client_name,
      clientEmail: row.client_email,
      clientPhone: row.client_phone || '',
      answers: row.answers || '',
      requireForm: false,
      waitlistId: row.id
    };
  }
  return {
    projectCode: normalizeProject(decoded.projectCode),
    clientName: decoded.clientName || '',
    clientEmail: normalizeEmail(decoded.clientEmail),
    clientPhone: decoded.clientPhone || '',
    answers: decoded.answers || '',
    requireForm: decoded.requireForm !== false,
    waitlistId: null
  };
}

async function getBookingInviteData(payload, tenant) {
  const invite = await resolveBookingInviteData(payload.invitationToken || payload.invite, tenant);
  return Object.assign({ success: true }, invite);
}

async function submitBooking(payload, tenant) {
  const rescheduleAppointment = payload.rescheduleToken
    ? await resolveRescheduleAppointment(payload.rescheduleToken, tenant)
    : null;
  const invite = payload.invitationToken
    ? await resolveBookingInviteData(payload.invitationToken, tenant)
    : null;
  const projectCode = normalizeProject(rescheduleAppointment?.project_code || invite?.projectCode || payload.projectCode);
  const project = await projectByCode(tenant, projectCode);
  if (!project) throw new Error('找不到專案。');

  const timestamp = Number(payload.timestamp);
  if (!timestamp) throw new Error('缺少預約時間。');

  const available = await getAvailableTimes({ projectCode }, tenant);
  const selected = available.find(slot => Number(slot.timestamp) === timestamp);
  if (!selected) {
    return { success: false, message: '這個時段已被預約或目前不可用，請重新選擇。' };
  }

  const cResult = await query(`select * from consultants where tenant_slug = $1 and id = $2`, [tenant, selected.consultantId]);
  const consultant = cResult.rows[0];
  if (!consultant) throw new Error('找不到負責顧問。');
  const provider = consultantCalendarProvider(consultant);
  if (provider === 'zoom') throw new Error('Zoom OAuth 尚未完成串接，請改用 Google Meet 或 Microsoft Teams。');
  if (provider === 'google' && !consultant.google_refresh_token) throw new Error('顧問尚未連接 Google Calendar。');
  if (provider === 'microsoft' && !consultant.microsoft_refresh_token) throw new Error('顧問尚未連接 Microsoft Calendar。');

  const slotStart = new Date(timestamp);
  const slotEnd = new Date(timestamp + 60 * 60000);
  const clientName = rescheduleAppointment?.client_name || invite?.clientName || payload.name || invite?.clientEmail;
  const clientEmail = rescheduleAppointment?.client_email || invite?.clientEmail || payload.email;
  const clientPhone = rescheduleAppointment?.client_phone || invite?.clientPhone || payload.phone || '';
  const answers = rescheduleAppointment?.answers || invite?.answers || payload.answers || '';
  const conflictResult = await query(
    `select id
       from appointments
      where tenant_slug = $1
        and consultant_id = $2
        and start_at = $3
        and id <> $4
        and status not in ('已取消', 'cancelled', 'canceled')
      limit 1`,
    [tenant, consultant.id, slotStart, rescheduleAppointment?.id || 0]
  );
  if (conflictResult.rows[0]) {
    return { success: false, message: '這個時段剛剛已被預約，請重新選擇。' };
  }

  const eventTitle = `【${project.name}】${clientName}`;
  const description = [
    `聯絡電話：${clientPhone}`,
    `Email：${clientEmail}`,
    '',
    '【客戶填答狀況】',
    answers
  ].join('\n');

  let event;
  try {
    event = provider === 'microsoft'
      ? await createMicrosoftCalendarEvent({
          encryptedRefreshToken: consultant.microsoft_refresh_token,
          calendarId: consultant.calendar_id || 'primary',
          event: {
            subject: eventTitle,
            body: { contentType: 'text', content: description },
            start: { dateTime: slotStart.toISOString().replace(/Z$/, ''), timeZone: 'UTC' },
            end: { dateTime: slotEnd.toISOString().replace(/Z$/, ''), timeZone: 'UTC' },
            attendees: clientEmail ? [{
              emailAddress: { address: clientEmail, name: clientName },
              type: 'required'
            }] : [],
            isOnlineMeeting: true,
            onlineMeetingProvider: 'teamsForBusiness'
          }
        })
      : await createCalendarEvent({
          encryptedRefreshToken: consultant.google_refresh_token,
          calendarId: consultant.calendar_id || 'primary',
          event: {
            summary: eventTitle,
            description,
            start: { dateTime: slotStart.toISOString(), timeZone: consultant.time_zone || 'Asia/Taipei' },
            end: { dateTime: slotEnd.toISOString(), timeZone: consultant.time_zone || 'Asia/Taipei' },
            attendees: clientEmail ? [{ email: clientEmail }] : [],
            conferenceData: {
              createRequest: {
                requestId: `meet_${tenant}_${Date.now()}`,
                conferenceSolutionKey: { type: 'hangoutsMeet' }
              }
            }
          }
        });
  } catch (error) {
    await createAdminAlert({
      tenant,
      level: 'error',
      title: 'Calendar 建立失敗',
      message: `${clientEmail || 'unknown'}｜${project.name}｜${error.message || String(error)}`,
      context: { projectCode, consultantId: consultant.id, provider, timestamp }
    });
    throw error;
  }

  const meetLink = provider === 'microsoft'
    ? (event.onlineMeeting?.joinUrl || '')
    : (event.hangoutLink ||
      (event.conferenceData?.entryPoints || []).find(item => item.entryPointType === 'video')?.uri || '');

  let appointmentResult;
  try {
    if (rescheduleAppointment) {
    try {
      if (rescheduleAppointment.event_id) {
        if (rescheduleAppointment.calendar_provider === 'microsoft' && rescheduleAppointment.old_microsoft_refresh_token) {
          await deleteMicrosoftCalendarEvent({
            encryptedRefreshToken: rescheduleAppointment.old_microsoft_refresh_token,
            calendarId: rescheduleAppointment.calendar_id || 'primary',
            eventId: rescheduleAppointment.event_id
          });
        } else if (rescheduleAppointment.old_google_refresh_token) {
          await deleteCalendarEvent({
            encryptedRefreshToken: rescheduleAppointment.old_google_refresh_token,
            calendarId: rescheduleAppointment.calendar_id || 'primary',
            eventId: rescheduleAppointment.event_id
          });
        }
      }
    } catch (error) {
      const cleanup = provider === 'microsoft' ? deleteMicrosoftCalendarEvent : deleteCalendarEvent;
      await cleanup({
        encryptedRefreshToken: provider === 'microsoft' ? consultant.microsoft_refresh_token : consultant.google_refresh_token,
        calendarId: consultant.calendar_id || 'primary',
        eventId: event.id
      }).catch(() => {});
      throw error;
    }
    appointmentResult = await query(
      `update appointments
          set project_code = $3, project_name = $4, consultant_id = $5,
              consultant_name = $6, calendar_id = $7, calendar_provider = $8, event_id = $9,
              meet_link = $10, start_at = $11, end_at = $12, status = '待開會',
              notes = concat_ws(E'\n', nullif(notes, ''), $13::text)
        where tenant_slug = $1 and id = $2
        returning id`,
      [
        tenant,
        rescheduleAppointment.id,
        projectCode,
        project.name,
        consultant.id,
        consultant.name,
        consultant.calendar_id || 'primary',
        provider,
        event.id,
        meetLink,
        slotStart,
        slotEnd,
        `[系統：客戶已自選改期至 ${slotStart.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })}]`
      ]
    );
  } else {
    appointmentResult = await query(
      `insert into appointments(
         tenant_slug, project_code, project_name, consultant_id, consultant_name,
         calendar_id, calendar_provider, event_id, meet_link, start_at, end_at,
         client_name, client_email, client_phone, answers, status
       )
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'待開會')
       returning id`,
      [
        tenant,
        projectCode,
        project.name,
        consultant.id,
        consultant.name,
        consultant.calendar_id || 'primary',
        provider,
        event.id,
        meetLink,
        slotStart,
        slotEnd,
        clientName,
        clientEmail,
        clientPhone,
        answers
      ]
    );
  }
  } catch (error) {
    const cleanup = provider === 'microsoft' ? deleteMicrosoftCalendarEvent : deleteCalendarEvent;
    await cleanup({
      encryptedRefreshToken: provider === 'microsoft' ? consultant.microsoft_refresh_token : consultant.google_refresh_token,
      calendarId: consultant.calendar_id || 'primary',
      eventId: event?.id
    }).catch(() => {});
    if (error.code === '23505') {
      return { success: false, message: '這個時段剛剛已被預約，請重新選擇。' };
    }
    throw error;
  }
  const appointmentId = appointmentResult.rows[0]?.id;
  const leadPayload = {
    projectCode,
    name: clientName,
    email: clientEmail,
    phone: clientPhone,
    answers
  };
  const lead = await upsertLeadRecord(leadPayload, tenant, 'booked', appointmentId);
  const quizResponseId = await resolveQuizResponseId(tenant, payload);
  await syncAppointmentBooked({
    tenant,
    projectCode,
    lead,
    contactPayload: leadPayload,
    appointmentId,
    consultantId: consultant.id,
    quizResponseId,
    isReschedule: Boolean(rescheduleAppointment)
  });
  await cancelLeadFollowups({ tenant, projectCode, clientEmail });
  const appointmentEmailData = {
    time: slotStart.toISOString(),
    meetLink,
    consultant: consultant.name
  };
  await queueTriggeredEmails({
    tenant,
    projectCode,
    triggerName: rescheduleAppointment ? 'booking_rescheduled' : 'booking_created',
    lead,
    appointmentId,
    appointment: appointmentEmailData
  });
  await queueTriggeredEmails({
    tenant,
    projectCode,
    triggerName: 'meeting_before',
    lead,
    appointmentId,
    appointment: appointmentEmailData
  });
  await queueTriggeredEmails({
    tenant,
    projectCode,
    triggerName: 'meeting_after',
    lead,
    appointmentId,
    appointment: appointmentEmailData
  });
  if (invite?.waitlistId) {
    await query(`delete from waitlist_clients where tenant_slug = $1 and id = $2`, [tenant, invite.waitlistId]);
  }

  return {
    success: true,
    message: '預約成功。',
    meetLink,
    consultant: consultant.name,
    time: slotStart.toISOString()
  };
}

async function logRejected(payload, tenant) {
  const projectCode = normalizeProject(payload.projectCode);
  const project = await projectByCode(tenant, projectCode);
  await query(
    `insert into rejected_clients(tenant_slug, project_code, project_name, client_name, client_email, client_phone, answers)
     values($1,$2,$3,$4,$5,$6,$7)`,
    [tenant, projectCode, project?.name || projectCode, payload.name, payload.email, payload.phone || '', payload.answers || '']
  );
  const lead = await upsertLeadRecord(payload, tenant, 'rejected');
  await syncClientStatus({ tenant, projectCode, lead, payload, status: 'rejected', eventType: 'rejected_created', title: '拒絕 / 淘汰名單建立', body: payload.answers || '' });
  await cancelLeadFollowups({ tenant, projectCode, clientEmail: payload.email });
  await queueTriggeredEmails({ tenant, projectCode, triggerName: 'rejected_created', lead });
  return { success: true };
}

async function logMissed(payload, tenant) {
  const projectCode = normalizeProject(payload.projectCode);
  const project = await projectByCode(tenant, projectCode);
  await query(
    `insert into waitlist_clients(tenant_slug, project_code, project_name, client_name, client_email, client_phone, answers)
     values($1,$2,$3,$4,$5,$6,$7)`,
    [tenant, projectCode, project?.name || projectCode, payload.name, payload.email, payload.phone || '', payload.answers || '']
  );
  const lead = await upsertLeadRecord(payload, tenant, 'waitlist');
  await syncClientStatus({ tenant, projectCode, lead, payload, status: 'waitlist', eventType: 'waitlist_created', title: '等候名單建立', body: payload.answers || '' });
  await cancelLeadFollowups({ tenant, projectCode, clientEmail: payload.email });
  await queueTriggeredEmails({ tenant, projectCode, triggerName: 'waitlist_created', lead });
  return { success: true };
}

async function logPageView(payload, tenant) {
  await query(
    `insert into page_views(tenant_slug, project_code) values($1,$2)`,
    [tenant, normalizeProject(payload.projectCode)]
  );
  return { success: true };
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isInactiveTemplate(status) {
  return ['inactive', 'disabled', 'off', '停用'].includes(String(status || '').trim().toLowerCase());
}

function escapeEmailHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderEmailText(templateText, data, options = {}) {
  const values = {
    name: data.clientName || '',
    email: data.clientEmail || '',
    phone: data.clientPhone || '',
    project: data.projectName || data.projectCode || '',
    time: data.time || '',
    meetLink: data.meetLink || '',
    consultant: data.consultant || '',
    rescheduleLink: data.rescheduleLink || '',
    unsubscribeLink: data.unsubscribeLink || ''
  };
  const aliases = {
    '客戶姓名': 'name',
    '姓名': 'name',
    '客戶Email': 'email',
    'Email': 'email',
    '客戶電話': 'phone',
    '電話': 'phone',
    '專案名稱': 'project',
    '預約時間': 'time',
    '會議連結': 'meetLink',
    '顧問姓名': 'consultant',
    '顧問': 'consultant',
    '改期專屬連結': 'rescheduleLink',
    '退訂連結': 'unsubscribeLink'
  };
  return String(templateText || '').replace(
    /\{\{\s*(name|email|phone|project|time|meetLink|consultant|rescheduleLink|unsubscribeLink|客戶姓名|姓名|客戶Email|Email|客戶電話|電話|專案名稱|預約時間|會議連結|顧問姓名|顧問|改期專屬連結|退訂連結)\s*\}\}/g,
    (_match, key) => {
      const value = values[aliases[key] || key] || '';
      return options.html ? escapeEmailHtml(value) : value;
    }
  );
}

function sanitizeEmailHtml(value) {
  return String(value || '')
    .replace(/<\s*(script|iframe|object|embed|form|input|button|meta|link|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|iframe|object|embed|form|input|button|meta|link|style)\b[^>]*\/?\s*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(["'])[\s\S]*?\1/gi, '')
    .replace(/\s+(href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, '');
}

async function upsertLeadRecord(payload, tenant, status = 'pending', appointmentId = null) {
  const projectCode = normalizeProject(payload.projectCode);
  const email = normalizeEmail(payload.email || payload.clientEmail);
  if (!email) return null;
  const project = await projectByCode(tenant, projectCode);
  const result = await query(
    `insert into leads(
       tenant_slug, project_code, project_name, client_name, client_email,
       client_phone, answers, status, booked_appointment_id, updated_at
     )
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
     on conflict(tenant_slug, project_code, client_email) do update
     set project_name = excluded.project_name,
         client_name = excluded.client_name,
         client_phone = excluded.client_phone,
         answers = excluded.answers,
         status = case
           when leads.status in ('booked', 'waitlist', 'rejected') and excluded.status = 'pending' then leads.status
           else excluded.status
         end,
         booked_appointment_id = coalesce(excluded.booked_appointment_id, leads.booked_appointment_id),
         updated_at = now()
     returning *`,
    [
      tenant,
      projectCode,
      project?.name || projectCode,
      payload.name || payload.clientName || '',
      email,
      payload.phone || payload.clientPhone || '',
      payload.answers || '',
      status,
      appointmentId
    ]
  );
  const lead = result.rows[0];
  const contact = await syncLead(lead, payload, tenant, status, { appointmentId, source: payload.source || 'lead' });
  return Object.assign({}, lead, { crm_contact_id: lead.crm_contact_id || contact?.id || null });
}

async function cancelLeadFollowups({ tenant, projectCode, clientEmail }) {
  await updateEmailQueueCompat(
    `update email_queue
        set status = 'cancelled', cancelled_at = now()
      where tenant_slug = $1
        and project_code = $2
        and lower(client_email) = lower($3)
        and status = 'queued'
        and (
          trigger_name in ('lead_created', 'quiz_followup', 'quiz_completed_unbooked')
          or cancellation_policy = 'stop_when_booked'
          or stop_when_booked = true
        )`,
    [tenant, normalizeProject(projectCode), normalizeEmail(clientEmail)],
    `update email_queue
        set status = 'cancelled', cancelled_at = now()
      where tenant_slug = $1
        and project_code = $2
        and lower(client_email) = lower($3)
        and trigger_name = 'lead_created'
        and status = 'queued'`,
    [tenant, normalizeProject(projectCode), normalizeEmail(clientEmail)]
  );
}

async function queueTriggeredEmails({ tenant, projectCode, triggerName, lead, appointmentId = null, appointment = {} }) {
  if (!lead) return { queued: 0 };
  const templates = await query(
    `select *
       from email_templates
      where tenant_slug = $1
        and project_code = $2
        and trigger_name = $3
      order by time_param asc, id asc`,
    [tenant, normalizeProject(projectCode), triggerName]
  );
  let queued = 0;
  let hasDueNow = false;
  for (const template of templates.rows) {
    if (isInactiveTemplate(template.status)) continue;
    const duplicate = await query(
      `select id
         from email_queue
        where template_id = $1
          and client_email = $2
          and project_code = $3
          and trigger_name = $4
          and status in ('queued', 'sent')
        limit 1`,
      [template.id, lead.client_email, normalizeProject(projectCode), triggerName]
    );
    if (duplicate.rows[0]) continue;

    const delayAmount = Math.max(0, Number(template.time_param || 0));
    const delayUnit = String(template.delay_unit || 'hours').toLowerCase();
    const delayMs = delayUnit === 'minutes'
      ? delayAmount * 60 * 1000
      : delayUnit === 'days'
        ? delayAmount * 24 * 60 * 60 * 1000
        : delayAmount * 60 * 60 * 1000;
    const appointmentTime = appointment.time ? new Date(appointment.time) : null;
    let scheduledAt = new Date(Date.now() + delayMs);
    if (appointmentTime && !Number.isNaN(appointmentTime.getTime())) {
      if (triggerName === 'meeting_before') {
        scheduledAt = new Date(appointmentTime.getTime() - delayMs);
      } else if (triggerName === 'meeting_after') {
        scheduledAt = new Date(appointmentTime.getTime() + delayMs);
      }
    }

    const data = {
      clientName: lead.client_name,
      clientEmail: lead.client_email,
      clientPhone: lead.client_phone,
      projectCode: lead.project_code,
      projectName: lead.project_name,
      time: appointment.time || '',
      meetLink: appointment.meetLink || '',
      consultant: appointment.consultant || '',
      rescheduleLink: appointment.rescheduleLink || '',
      unsubscribeLink: unsubscribeUrl(tenant, lead.client_email)
    };
    const subject = renderEmailText(template.subject, data);
    const body = appendEmailFooter(renderEmailText(template.body, data, { html: true }), data.unsubscribeLink);
    const moduleName = template.module || (String(triggerName).startsWith('quiz_') ? 'quiz' : 'booking');
    const stopWhenBooked = template.stop_when_booked !== false;
    const cancellationPolicy = stopWhenBooked ? 'stop_when_booked' : 'none';
    const inserted = await updateEmailQueueCompat(
      `insert into email_queue(
         tenant_slug, project_code, lead_id, appointment_id, crm_contact_id, quiz_response_id, template_id,
         trigger_name, client_name, client_email, subject, body, sender_name,
         scheduled_at, stop_when_booked, module, cancellation_policy, status
       )
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'queued')
       returning id`,
      [
        tenant,
        normalizeProject(projectCode),
        lead.id,
        appointmentId,
        lead.crm_contact_id || null,
        appointment.quizResponseId || null,
        template.id,
        triggerName,
        lead.client_name,
        lead.client_email,
        subject,
        body,
        template.sender_name || '',
        scheduledAt,
        stopWhenBooked,
        moduleName,
        cancellationPolicy
      ],
      `insert into email_queue(
         tenant_slug, project_code, lead_id, appointment_id, template_id,
         trigger_name, client_name, client_email, subject, body, sender_name,
         scheduled_at, stop_when_booked, status
       )
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'queued')
       returning id`,
      [
        tenant,
        normalizeProject(projectCode),
        lead.id,
        appointmentId,
        template.id,
        triggerName,
        lead.client_name,
        lead.client_email,
        subject,
        body,
        template.sender_name || '',
        scheduledAt,
        stopWhenBooked
      ]
    );
    await recordTimelineEvent({
      tenant,
      projectCode,
      crmContactId: lead.crm_contact_id,
      leadId: lead.id,
      quizResponseId: appointment.quizResponseId || null,
      appointmentId,
      emailQueueId: inserted.rows[0]?.id,
      eventType: 'email_queued',
      title: '信件排入佇列',
      body: subject,
      metadata: { triggerName, templateId: template.id, module: moduleName }
    });
    queued += 1;
    if (scheduledAt.getTime() <= Date.now() + 1000) hasDueNow = true;
  }
  const immediate = hasDueNow ? await runDueEmails({ tenant, limit: 20 }) : null;
  return { queued, immediate };
}
async function trackLead(payload, tenant) {
  const lead = await upsertLeadRecord(payload, tenant, 'pending');
  if (lead && lead.status !== 'booked') {
    await queueTriggeredEmails({
      tenant,
      projectCode: payload.projectCode,
      triggerName: 'lead_created',
      lead
    });
  }
  return { success: true };
}


function webhookValue(payload, keys) {
  for (const key of keys) {
    const parts = key.split('.');
    let value = payload;
    for (const part of parts) value = value?.[part];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}

async function systemeWebhook(payload, tenant, req) {
  const tenantRow = await tenantBySlug(tenant);
  verifyWebhookRequest(req, payload, tenantRow);
  const projectCode = normalizeProject(payload.projectCode || payload.project_code || payload.tag || payload.funnel || 'P01');
  const email = normalizeEmail(webhookValue(payload, ['email', 'clientEmail', 'contact.email', 'data.email', 'payload.email']));
  if (!email) throw new Error('Webhook 缺少 email。');
  const name = webhookValue(payload, ['name', 'clientName', 'firstName', 'contact.name', 'contact.first_name', 'data.name', 'payload.name']) || email;
  const phone = webhookValue(payload, ['phone', 'clientPhone', 'contact.phone', 'data.phone', 'payload.phone']);
  const lead = await upsertLeadRecord({
    projectCode,
    name,
    email,
    phone,
    answers: payload.answers || payload.rawAnswers || JSON.stringify(payload)
  }, tenant, 'pending');
  if (lead && lead.status !== 'booked') {
    await queueTriggeredEmails({ tenant, projectCode, triggerName: 'lead_created', lead });
  }
  return { success: true, leadId: lead?.id || null };
}

async function unsubscribeEmail(payload, tenant) {
  const decoded = readEmailPreferenceToken(payload.token, tenant);
  await addEmailSuppression({ tenant, email: decoded.email, reason: payload.reason || 'unsubscribe', source: 'unsubscribe_page' });
  await safeQuery(
    `update email_queue
        set status = 'cancelled', cancelled_at = now(), error_message = 'recipient unsubscribed'
      where tenant_slug = $1
        and lower(client_email) = lower($2)
        and status in ('queued', 'sending')`,
    [tenant, decoded.email]
  );
  return { success: true, email: decoded.email };
}
async function getSenderConsultant(tenant) {
  const result = await query(
    `select *
       from consultants
      where tenant_slug = $1
        and google_refresh_token is not null
        and (
          upper(permissions) like '%TENANT_ADMIN%'
          or upper(permissions) = 'ALL'
          or lower(login_email) = lower($2)
        )
      order by case
        when lower(login_email) = lower($2) then 0
        when permissions = 'TENANT_ADMIN' then 1
        when permissions = 'ALL' then 2
        else 3
      end, id asc
      limit 1`,
    [tenant, ownerEmail()]
  );
  return result.rows[0];
}

async function runDueEmails(options = {}) {
  const params = [];
  let tenantClause = '';
  if (options.tenant) {
    params.push(options.tenant);
    tenantClause = ` and tenant_slug = $${params.length}`;
  }
  params.push(Math.min(Math.max(Number(options.limit || 50), 1), 100));
  const result = await query(
    `select *
       from email_queue
      where status = 'queued'
        and scheduled_at <= now()
        ${tenantClause}
      order by scheduled_at asc, id asc
      limit $${params.length}`,
    params
  );

  const summary = { scanned: result.rows.length, sent: 0, cancelled: 0, retried: 0, failed: 0 };
  for (const item of result.rows) {
    try {
      const claimed = await query(
        `update email_queue
            set status = 'sending'
          where id = $1 and status = 'queued'
          returning id`,
        [item.id]
      );
      if (!claimed.rows[0]) continue;

      if (await isEmailSuppressed(item.tenant_slug, item.client_email)) {
        await query(
          `update email_queue
              set status = 'cancelled', cancelled_at = now(), error_message = 'recipient suppressed'
            where id = $1`,
          [item.id]
        );
        await recordTimelineEvent({
          tenant: item.tenant_slug,
          projectCode: item.project_code,
          crmContactId: item.crm_contact_id,
          leadId: item.lead_id,
          quizResponseId: item.quiz_response_id,
          appointmentId: item.appointment_id,
          emailQueueId: item.id,
          eventType: 'email_cancelled',
          title: '信件取消',
          body: item.subject,
          metadata: { reason: 'recipient suppressed', triggerName: item.trigger_name }
        });
        summary.cancelled += 1;
        continue;
      }

      if (item.stop_when_booked || item.cancellation_policy === 'stop_when_booked') {
        const booked = await query(
          `select id
             from appointments
            where tenant_slug = $1
              and project_code = $2
              and lower(client_email) = lower($3)
              and status not in ('已取消', 'cancelled', 'canceled')
            limit 1`,
          [item.tenant_slug, item.project_code, item.client_email]
        );
        if (booked.rows[0]) {
          await query(
            `update email_queue set status = 'cancelled', cancelled_at = now()
              where id = $1`,
            [item.id]
          );
          await recordTimelineEvent({
            tenant: item.tenant_slug,
            projectCode: item.project_code,
            crmContactId: item.crm_contact_id,
            leadId: item.lead_id,
            quizResponseId: item.quiz_response_id,
            appointmentId: item.appointment_id,
            emailQueueId: item.id,
            eventType: 'email_cancelled',
            title: '信件取消',
            body: item.subject,
            metadata: { reason: 'already booked', triggerName: item.trigger_name }
          });
          summary.cancelled += 1;
          continue;
        }
      }

      const sender = await getSenderConsultant(item.tenant_slug, item.project_code, item.appointment_id);
      if (!sender) throw new Error('No connected Google sender for this tenant.');
      await sendGmailMessage({
        encryptedRefreshToken: sender.google_refresh_token,
        senderEmail: sender.google_email || sender.login_email,
        senderName: item.sender_name || sender.name,
        to: item.client_email,
        subject: item.subject,
        body: item.body
      });
      await query(
        `update email_queue
            set status = 'sent', sent_at = now(), error_message = ''
          where id = $1`,
        [item.id]
      );
      await recordTimelineEvent({
        tenant: item.tenant_slug,
        projectCode: item.project_code,
        crmContactId: item.crm_contact_id,
        leadId: item.lead_id,
        quizResponseId: item.quiz_response_id,
        appointmentId: item.appointment_id,
        emailQueueId: item.id,
        eventType: 'email_sent',
        title: '信件寄出',
        body: item.subject,
        metadata: { triggerName: item.trigger_name }
      });
      summary.sent += 1;
    } catch (error) {
      const nextRetryCount = Number(item.retry_count || 0) + 1;
      const maxAttempts = Math.max(Number(item.max_attempts || 3), 1);
      const message = error.message || String(error);
      if (nextRetryCount < maxAttempts) {
        const delay = retryDelayMinutes(nextRetryCount);
        await updateEmailQueueCompat(
          `update email_queue
              set status = 'queued',
                  retry_count = $2,
                  scheduled_at = now() + ($3::int * interval '1 minute'),
                  error_message = $4,
                  last_attempt_at = now()
            where id = $1`,
          [item.id, nextRetryCount, delay, message],
          `update email_queue
              set status = 'queued',
                  scheduled_at = now() + ($2::int * interval '1 minute'),
                  error_message = $3
            where id = $1`,
          [item.id, delay, message]
        );
        summary.retried += 1;
        continue;
      }

      await updateEmailQueueCompat(
        `update email_queue
            set status = 'error', retry_count = $2, error_message = $3, last_attempt_at = now()
          where id = $1`,
        [item.id, nextRetryCount, message],
        `update email_queue
            set status = 'error', error_message = $2
          where id = $1`,
        [item.id, message]
      );
      await recordTimelineEvent({
        tenant: item.tenant_slug,
        projectCode: item.project_code,
        crmContactId: item.crm_contact_id,
        leadId: item.lead_id,
        quizResponseId: item.quiz_response_id,
        appointmentId: item.appointment_id,
        emailQueueId: item.id,
        eventType: 'email_failed',
        title: '信件寄送失敗',
        body: item.subject,
        metadata: { triggerName: item.trigger_name, error: message }
      });
      await createAdminAlert({
        tenant: item.tenant_slug,
        level: 'error',
        title: '信件寄送失敗',
        message: `${item.client_email}｜${item.subject}｜${message}`,
        context: { queueId: item.id, trigger: item.trigger_name, projectCode: item.project_code }
      });
      summary.failed += 1;
    }
  }
  return { success: true, summary };
}
async function getEmailAutomationData(payload, tenant) {
  const projectCode = payload.projectCode && payload.projectCode !== 'ALL' ? normalizeProject(payload.projectCode) : null;
  const params = [tenant];
  let projectClause = '';
  if (projectCode) {
    params.push(projectCode);
    projectClause = ` and project_code = $${params.length}`;
  }
  const [projects, templates, leads, queue, suppressions, alerts] = await Promise.all([
    query(`select code, name from projects where tenant_slug = $1 order by id asc`, [tenant]),
    query(
      `select id, project_code, name, trigger_name, time_param, subject, body, status, sender_name, stop_when_booked
         from email_templates
        where tenant_slug = $1${projectClause}
        order by project_code, trigger_name, time_param, id`,
      params
    ),
    query(
      `select id, project_code, project_name, client_name, client_email, status, created_at, updated_at
         from leads
        where tenant_slug = $1${projectClause}
        order by updated_at desc
        limit 80`,
      params
    ),
    query(
      `select id, project_code, trigger_name, client_email, subject, scheduled_at, sent_at, status, error_message
         from email_queue
        where tenant_slug = $1${projectClause}
        order by created_at desc
        limit 80`,
      params
    ),
    safeQuery(`select id, client_email, reason, source, created_at from email_suppressions where tenant_slug = $1 order by created_at desc limit 80`, [tenant]),
    safeQuery(`select id, level, title, message, created_at from admin_alerts where tenant_slug = $1 and resolved_at is null order by created_at desc limit 20`, [tenant])
  ]);
  return {
    success: true,
    projects: projects.rows,
    templates: templates.rows.map(row => ({
      rowId: row.id,
      projectCode: row.project_code,
      name: row.name,
      triggerName: row.trigger_name,
      timeParam: row.time_param,
      subject: row.subject,
      body: row.body,
      status: row.status,
      senderName: row.sender_name || '',
      stopWhenBooked: row.stop_when_booked !== false
    })),
    leads: leads.rows,
    queue: queue.rows,
    suppressions: suppressions.rows,
    alerts: alerts.rows
  };
}
async function saveEmailTemplate(payload, tenant) {
  const projectCode = normalizeProject(payload.projectCode);
  const triggerName = payload.triggerName || 'lead_created';
  const status = payload.status || 'active';
  const body = sanitizeEmailHtml(payload.body || '');
  const inlineImages = Array.from(body.matchAll(/<img\b[^>]*\bsrc=(["'])data:image\/(png|jpeg|jpg|webp);base64,([^"']+)\1/gi));
  if (inlineImages.length > 4) throw new Error('每封信最多只能放 4 張圖片。');
  for (const image of inlineImages) {
    const imageBytes = Math.ceil(String(image[3] || '').length * 0.75);
    if (imageBytes > 768 * 1024) throw new Error('單張信件圖片不可超過 750KB。');
  }
  const currentId = Number(payload.rowId || payload.id || 0);
  const usageResult = await query(
    `select coalesce(sum(octet_length(body)), 0)::bigint as bytes
       from email_templates
      where tenant_slug = $1
        and ($2::bigint = 0 or id <> $2::bigint)`,
    [tenant, currentId]
  );
  const totalBytes = Number(usageResult.rows[0]?.bytes || 0) + Buffer.byteLength(body, 'utf8');
  if (totalBytes > 10 * 1024 * 1024) {
    throw new Error('這個使用者的信件範本與圖片已達 10MB 上限，請刪除部分圖片後再儲存。');
  }
  if (payload.rowId || payload.id) {
    await query(
      `update email_templates
          set project_code = $3, name = $4, trigger_name = $5, time_param = $6,
              subject = $7, body = $8, status = $9, sender_name = $10,
              stop_when_booked = $11
        where tenant_slug = $1 and id = $2`,
      [
        tenant,
        payload.rowId || payload.id,
        projectCode,
        payload.name || 'Email template',
        triggerName,
        Number(payload.timeParam || payload.time_param || 0),
        payload.subject || '',
        body,
        status,
        payload.senderName || '',
        payload.stopWhenBooked !== false
      ]
    );
  } else {
    await query(
      `insert into email_templates(
         tenant_slug, project_code, name, trigger_name, time_param, subject, body,
         status, sender_name, stop_when_booked
       )
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        tenant,
        projectCode,
        payload.name || 'Email template',
        triggerName,
        Number(payload.timeParam || payload.time_param || 0),
        payload.subject || '',
        body,
        status,
        payload.senderName || '',
        payload.stopWhenBooked !== false
      ]
    );
  }
  return { success: true };
}

async function runEmailQueue(payload, tenant) {
  return runDueEmails({ tenant, limit: payload.limit || 50 });
}

async function getConsultantAppointments(payload, tenant, user) {
  const admin = isAdmin(user);
  const tenantWide = canSeeTenantWide(user);
  const params = [tenant];
  let where = `where a.tenant_slug = $1`;
  if (!tenantWide) {
    params.push(user.id);
    where += ` and a.consultant_id = $2`;
  }
  if (payload.projectCode && payload.projectCode !== 'ALL') {
    params.push(normalizeProject(payload.projectCode));
    where += ` and a.project_code = $${params.length}`;
  }
  const result = await query(
    `select a.*
       from appointments a
       ${where}
      order by a.start_at desc nulls last, a.created_at desc
      limit 300`,
    params
  );

  const projectCodes = visibleProjectCodes(user);
  const clientProjectParams = [tenant];
  let clientProjectClause = '';
  if (!tenantWide && !projectCodes.includes('ALL')) {
    clientProjectParams.push(projectCodes);
    clientProjectClause = ` and project_code = any($${clientProjectParams.length})`;
  }
  if (payload.projectCode && payload.projectCode !== 'ALL') {
    clientProjectParams.push(normalizeProject(payload.projectCode));
    clientProjectClause += ` and project_code = $${clientProjectParams.length}`;
  }

  const [rejected, waitlist, leads, quizToday, bookingsToday] = tenantWide
    ? await Promise.all([
      query(
        `select id, project_code, project_name, client_name, client_email, client_phone, answers, status, created_at
           from rejected_clients
          where tenant_slug = $1${clientProjectClause}
          order by created_at desc
          limit 120`,
        clientProjectParams
      ),
      query(
        `select id, project_code, project_name, client_name, client_email, client_phone, answers, status, created_at
           from waitlist_clients
          where tenant_slug = $1${clientProjectClause}
          order by created_at desc
          limit 120`,
        clientProjectParams
      ),
      query(
        `select id, project_code, project_name, client_name, client_email, client_phone, answers, status, lifecycle_stage, crm_contact_id, latest_quiz_response_id, created_at, updated_at
           from leads
          where tenant_slug = $1${clientProjectClause}
          order by updated_at desc
          limit 200`,
        clientProjectParams
      ),
      query(
        `select count(*)::int as count
           from quiz_responses
          where tenant_slug = $1${clientProjectClause.replace(/project_code/g, 'project_code')}
            and (submitted_at at time zone 'Asia/Taipei')::date = (now() at time zone 'Asia/Taipei')::date`,
        clientProjectParams
      ),
      query(
        `select count(*)::int as count
           from appointments
          where tenant_slug = $1${clientProjectClause}
            and (start_at at time zone 'Asia/Taipei')::date = (now() at time zone 'Asia/Taipei')::date`,
        clientProjectParams
      )
    ])
    : [{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [{ count: 0 }] }, { rows: [{ count: 0 }] }];

  const consultants = await query(
    `select id, name, accepting, project_codes, meet_tool,
            (google_refresh_token is not null) as google_connected,
            (microsoft_refresh_token is not null) as microsoft_connected
       from consultants
      where tenant_slug = $1
      order by name`,
    [tenant]
  );
  const projects = await query(`select code, name from projects where tenant_slug = $1 order by code`, [tenant]);
  const appointmentRows = result.rows.map(row => ({
    rowId: row.id,
    kind: 'appointment',
    projectCode: row.project_code,
    projectName: row.project_name,
    meetTime: row.start_at ? new Date(row.start_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }) : '',
    timeObj: row.start_at ? new Date(row.start_at).getTime() : 0,
    clientName: row.client_name,
    clientEmail: row.client_email,
    clientPhone: row.client_phone,
    answers: row.answers,
    status: row.status,
    eventId: row.event_id,
    consultantId: row.consultant_id,
    crmContactId: row.crm_contact_id || null,
    quizResponseId: row.quiz_response_id || null,
    consultant: row.consultant_name,
    meetLink: row.meet_link || '',
    attendance: row.attendance || '',
    dealStatus: row.deal_status || '',
    plan: row.plan || '',
    notes: row.notes || ''
  }));

  const rejectedRows = rejected.rows.map(row => ({
    rowId: row.id,
    kind: 'rejected',
    projectCode: row.project_code,
    projectName: row.project_name,
    meetTime: row.created_at ? new Date(row.created_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }) : '',
    timeObj: row.created_at ? new Date(row.created_at).getTime() : 0,
    clientName: row.client_name,
    clientEmail: row.client_email,
    clientPhone: row.client_phone,
    answers: row.answers,
    status: row.status || 'rejected',
    consultant: '',
    meetLink: ''
  }));

  const waitlistRows = waitlist.rows.map(row => ({
    rowId: row.id,
    kind: 'waitlist',
    projectCode: row.project_code,
    projectName: row.project_name,
    meetTime: row.created_at ? new Date(row.created_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }) : '',
    timeObj: row.created_at ? new Date(row.created_at).getTime() : 0,
    clientName: row.client_name,
    clientEmail: row.client_email,
    clientPhone: row.client_phone,
    answers: row.answers,
    status: row.status || 'waitlist',
    consultant: '',
    meetLink: ''
  }));
  const leadRows = leads.rows.map(row => ({
    rowId: row.id,
    kind: 'lead',
    projectCode: row.project_code,
    projectName: row.project_name,
    meetTime: row.updated_at ? new Date(row.updated_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }) : '',
    timeObj: row.updated_at ? new Date(row.updated_at).getTime() : 0,
    clientName: row.client_name,
    clientEmail: row.client_email,
    clientPhone: row.client_phone,
    answers: row.answers,
    status: row.lifecycle_stage || row.status || 'lead',
    crmContactId: row.crm_contact_id || null,
    quizResponseId: row.latest_quiz_response_id || null,
    consultant: '',
    meetLink: ''
  }));

  return {
    success: true,
    data: appointmentRows,
    rejected: rejectedRows,
    waitlist: waitlistRows,
    leads: leadRows,
    rawLeads: leads.rows,
    crmOverview: { todayQuizResponses: Number(quizToday.rows[0]?.count || 0), todayBookings: Number(bookingsToday.rows[0]?.count || 0), unbookedCount: leadRows.length, upcomingCount: appointmentRows.filter(row => row.timeObj && row.timeObj >= Date.now()).length },
    isAdmin: admin,
    role: publicRole(roleOf(user)),
    permissions: user.permissions || '',
    allConsultants: consultants.rows,
    allProjects: projects.rows
  };
}

async function updateCRMRecord(payload, tenant, user) {
  if (!canSeeTenantWide(user)) {
    const allowed = await query(
      `select id from appointments where tenant_slug = $1 and id = $2 and consultant_id = $3 limit 1`,
      [tenant, payload.rowId, user.id]
    );
    if (!allowed.rows[0]) throw new Error('你沒有權限更新這筆客戶資料。');
  }
  await query(
    `update appointments
        set attendance = $3, plan = $4, notes = $5
      where tenant_slug = $1 and id = $2`,
    [tenant, payload.rowId, payload.attendance || '', payload.plan || '', payload.notes || '']
  );
  return { success: true };
}

async function deleteAppointmentCalendarEvent(row) {
  if (!row?.event_id) return;
  if (row.calendar_provider === 'microsoft' && row.microsoft_refresh_token) {
    await deleteMicrosoftCalendarEvent({
      encryptedRefreshToken: row.microsoft_refresh_token,
      calendarId: row.calendar_id || 'primary',
      eventId: row.event_id
    });
  } else if (row.google_refresh_token) {
    await deleteCalendarEvent({
      encryptedRefreshToken: row.google_refresh_token,
      calendarId: row.calendar_id || 'primary',
      eventId: row.event_id
    });
  }
}

async function createTransferredCalendarEvent(consultant, appointment, tenant) {
  const provider = consultantCalendarProvider(consultant);
  if (provider === 'zoom') throw new Error('Zoom OAuth 尚未完成串接，無法轉派。');
  if (provider === 'google' && !consultant.google_refresh_token) throw new Error('接手顧問尚未連結 Google Calendar。');
  if (provider === 'microsoft' && !consultant.microsoft_refresh_token) throw new Error('接手顧問尚未連結 Microsoft Calendar。');
  const slotStart = new Date(appointment.start_at);
  const slotEnd = new Date(appointment.end_at);
  const busyEvents = provider === 'microsoft'
    ? await microsoftCalendarEvents({
        encryptedRefreshToken: consultant.microsoft_refresh_token,
        calendarId: consultant.calendar_id || 'primary',
        timeMin: slotStart,
        timeMax: slotEnd
      })
    : await calendarEvents({
        encryptedRefreshToken: consultant.google_refresh_token,
        calendarId: consultant.calendar_id || 'primary',
        timeMin: slotStart,
        timeMax: slotEnd
      });
  const conflict = busyEvents.some(event => {
    if (event.status === 'cancelled' || event.transparency === 'transparent') return false;
    const eventStart = new Date(event.start?.dateTime || event.start?.date);
    const eventEnd = new Date(event.end?.dateTime || event.end?.date);
    return slotStart < eventEnd && slotEnd > eventStart;
  });
  if (conflict) throw new Error('接手顧問在這個時間已有行程，請先改期或選擇其他顧問。');
  const eventTitle = `【${appointment.project_name}】${appointment.client_name}`;
  const description = [
    `聯絡電話：${appointment.client_phone || ''}`,
    `Email：${appointment.client_email}`,
    '',
    '【客戶填答狀況】',
    appointment.answers || ''
  ].join('\n');
  const event = provider === 'microsoft'
    ? await createMicrosoftCalendarEvent({
        encryptedRefreshToken: consultant.microsoft_refresh_token,
        calendarId: consultant.calendar_id || 'primary',
        event: {
          subject: eventTitle,
          body: { contentType: 'text', content: description },
          start: { dateTime: slotStart.toISOString().replace(/Z$/, ''), timeZone: 'UTC' },
          end: { dateTime: slotEnd.toISOString().replace(/Z$/, ''), timeZone: 'UTC' },
          attendees: [{ emailAddress: { address: appointment.client_email, name: appointment.client_name }, type: 'required' }],
          isOnlineMeeting: true,
          onlineMeetingProvider: 'teamsForBusiness'
        }
      })
    : await createCalendarEvent({
        encryptedRefreshToken: consultant.google_refresh_token,
        calendarId: consultant.calendar_id || 'primary',
        event: {
          summary: eventTitle,
          description,
          start: { dateTime: slotStart.toISOString(), timeZone: consultant.time_zone || 'Asia/Taipei' },
          end: { dateTime: slotEnd.toISOString(), timeZone: consultant.time_zone || 'Asia/Taipei' },
          attendees: [{ email: appointment.client_email }],
          conferenceData: {
            createRequest: {
              requestId: `transfer_${tenant}_${appointment.id}_${Date.now()}`,
              conferenceSolutionKey: { type: 'hangoutsMeet' }
            }
          }
        }
      });
  return {
    provider,
    event,
    meetLink: provider === 'microsoft'
      ? (event.onlineMeeting?.joinUrl || '')
      : (event.hangoutLink || (event.conferenceData?.entryPoints || []).find(item => item.entryPointType === 'video')?.uri || '')
  };
}

async function handleAppointmentAction(payload, tenant, user) {
  const result = await query(
    `select a.*, c.google_refresh_token, c.microsoft_refresh_token
       from appointments a
       left join consultants c on c.id = a.consultant_id and c.tenant_slug = a.tenant_slug
      where a.tenant_slug = $1 and a.id = $2`,
    [tenant, payload.rowId]
  );
  const row = result.rows[0];
  if (row && !canSeeTenantWide(user) && Number(row.consultant_id) !== Number(user.id)) {
    throw new Error('你沒有權限處理這筆預約。');
  }
  if (!row) throw new Error('找不到預約。');
  if (payload.actionType === 'reschedule') {
    await query(
      `update email_queue
          set status = 'cancelled', cancelled_at = now()
        where tenant_slug = $1
          and appointment_id = $2
          and trigger_name in ('meeting_before', 'meeting_after')
          and status = 'queued'`,
      [tenant, row.id]
    );
    const response = await submitBooking({
      timestamp: payload.timestamp,
      rescheduleToken: createRescheduleToken(tenant, row.id)
    }, tenant);
    if (!response.success) return response;
    return { success: true, message: '已完成改期並同步新的行事曆與視訊會議。' };
  }
  if (payload.actionType === 'transfer') {
    const targetResult = await query(
      `select * from consultants where tenant_slug = $1 and id = $2 limit 1`,
      [tenant, payload.targetConsultantId]
    );
    const target = targetResult.rows[0];
    if (!target) throw new Error('找不到接手顧問。');
    if (!projectMatches(target, row.project_code)) throw new Error('接手顧問沒有這個專案的權限。');
    if (!target.accepting) throw new Error('接手顧問目前未開啟接收派單。');
    const created = await createTransferredCalendarEvent(target, row, tenant);
    try {
      await deleteAppointmentCalendarEvent(row);
    } catch (error) {
      const cleanup = created.provider === 'microsoft' ? deleteMicrosoftCalendarEvent : deleteCalendarEvent;
      await cleanup({
        encryptedRefreshToken: created.provider === 'microsoft' ? target.microsoft_refresh_token : target.google_refresh_token,
        calendarId: target.calendar_id || 'primary',
        eventId: created.event.id
      }).catch(() => {});
      throw error;
    }
    await query(
      `update appointments
          set consultant_id = $3, consultant_name = $4, calendar_id = $5,
              calendar_provider = $6, event_id = $7, meet_link = $8,
              notes = concat_ws(E'\n', nullif(notes, ''), $9::text)
        where tenant_slug = $1 and id = $2`,
      [
        tenant, row.id, target.id, target.name, target.calendar_id || 'primary',
        created.provider, created.event.id, created.meetLink,
        `[系統：${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })} 已轉派給 ${target.name}]`
      ]
    );
    return { success: true, message: `已轉派給 ${target.name}，並同步新的行事曆邀請。` };
  }
  if (payload.actionType !== 'cancel') {
    throw new Error('不支援的預約操作。');
  }
  await deleteAppointmentCalendarEvent(row);
  await query(`update appointments set status = '已取消' where tenant_slug = $1 and id = $2`, [tenant, payload.rowId]);
  const lead = await upsertLeadRecord({
    projectCode: row.project_code,
    name: row.client_name,
    email: row.client_email,
    phone: row.client_phone,
    answers: row.answers
  }, tenant, 'cancelled', row.id);
  await queueTriggeredEmails({
    tenant,
    projectCode: row.project_code,
    triggerName: 'booking_cancelled',
    lead,
    appointmentId: row.id,
    appointment: {
      time: row.start_at,
      meetLink: row.meet_link || '',
      consultant: row.consultant_name || ''
    }
  });
  return { success: true, message: '已取消預約並同步行事曆。' };
}

async function sendBookingInviteEmail({ tenant, project, clientEmail, clientName = '', clientPhone = '', answers = '', requireForm = true, waitlistId = null }) {
  const sender = await getSenderConsultant(tenant);
  if (!sender) throw new Error('請先由使用者管理員連結 Google Gmail，才能寄出預約邀請。');
  const bookingBase = await bookingBaseForTenant(tenant);
  const token = createBookingInviteToken({
    tenant,
    projectCode: project.code,
    clientEmail,
    clientName,
    clientPhone,
    answers,
    requireForm,
    waitlistId
  });
  const link = `${bookingBase}/booking?tenant=${encodeURIComponent(tenant)}&p=${encodeURIComponent(project.code)}&invite=${encodeURIComponent(token)}`;
  const instruction = requireForm ? '填寫諮詢前表單並選擇時間' : '直接選擇適合的日期與時間';
  await sendGmailMessage({
    encryptedRefreshToken: sender.google_refresh_token,
    senderEmail: sender.google_email || sender.login_email,
    senderName: sender.name,
    to: clientEmail,
    subject: `【${project.name}】請選擇諮詢時間`,
    body: `<p>你好${clientName ? ` ${escapeEmailHtml(clientName)}` : ''}，</p><p>請點擊下方按鈕${instruction}：</p><p><a href="${escapeEmailHtml(link)}" style="display:inline-block;padding:12px 18px;background:#1a73e8;color:#ffffff;text-decoration:none;border-radius:6px;">選擇預約時間</a></p>`
  });
  return link;
}

async function sendBookingInvite(payload, tenant) {
  const projectCode = normalizeProject(payload.projectCode);
  const project = await projectByCode(tenant, projectCode);
  if (!project) throw new Error('找不到專案。');
  const clientEmail = normalizeEmail(payload.email || payload.clientEmail);
  if (!clientEmail || !clientEmail.includes('@')) throw new Error('請輸入正確的客戶 Email。');
  await sendBookingInviteEmail({
    tenant,
    project,
    clientEmail,
    requireForm: payload.requireForm !== false
  });
  return { success: true, message: payload.requireForm !== false ? '諮詢前表單與預約連結已寄出。' : '時段選擇連結已寄出。' };
}

async function sendWaitlistInvite(payload, tenant, user) {
  if (!canSeeTenantWide(user)) throw new Error('你沒有權限發送等候名單邀請。');
  const result = await query(
    `select *
       from waitlist_clients
      where tenant_slug = $1 and id = $2
      limit 1`,
    [tenant, payload.rowId]
  );
  const row = result.rows[0];
  if (!row) throw new Error('找不到這筆等候名單。');
  const project = await projectByCode(tenant, row.project_code);
  if (!project) throw new Error('找不到專案。');
  await sendBookingInviteEmail({
    tenant,
    project,
    clientEmail: row.client_email,
    clientName: row.client_name,
    clientPhone: row.client_phone,
    answers: row.answers,
    requireForm: false,
    waitlistId: row.id
  });
  await query(
    `update waitlist_clients set status = '已寄出時段邀請' where tenant_slug = $1 and id = $2`,
    [tenant, row.id]
  );
  return { success: true, message: '時段選擇連結已寄給等候名單客戶。' };
}

async function sendSelfRescheduleLink(payload, tenant, user) {
  const result = await query(
    `select a.*
       from appointments a
      where a.tenant_slug = $1 and a.id = $2
      limit 1`,
    [tenant, payload.rowId]
  );
  const appointment = result.rows[0];
  if (!appointment) throw new Error('找不到這筆預約。');
  if (!canSeeTenantWide(user) && Number(appointment.consultant_id) !== Number(user.id)) {
    throw new Error('你沒有權限處理這筆預約。');
  }

  const sender = await getSenderConsultant(tenant);
  if (!sender) throw new Error('請先由使用者管理員連結 Google Gmail，才能寄出改期信。');

  const token = createRescheduleToken(tenant, appointment.id);
  const bookingBase = await bookingBaseForTenant(tenant);
  const rescheduleLink = `${bookingBase}/booking?tenant=${encodeURIComponent(tenant)}&p=${encodeURIComponent(appointment.project_code)}&rid=${encodeURIComponent(token)}`;
  const templateResult = await query(
    `select *
       from email_templates
      where tenant_slug = $1
        and project_code = $2
        and trigger_name in ('reschedule_link', '發送改期連結時')
      order by id asc
      limit 1`,
    [tenant, appointment.project_code]
  );
  const template = templateResult.rows.find(row => !isInactiveTemplate(row.status));
  const emailData = {
    clientName: appointment.client_name,
    clientEmail: appointment.client_email,
    clientPhone: appointment.client_phone,
    projectCode: appointment.project_code,
    projectName: appointment.project_name,
    time: appointment.start_at ? new Date(appointment.start_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }) : '',
    meetLink: appointment.meet_link || '',
    consultant: appointment.consultant_name || '',
    rescheduleLink
  };
  const subject = template
    ? renderEmailText(template.subject, emailData)
    : `【${appointment.project_name}】請重新選擇諮詢時段`;
  const body = template
    ? renderEmailText(template.body, emailData, { html: true })
    : `<p>你好 ${escapeEmailHtml(appointment.client_name)}，</p><p>請點擊下方連結重新選擇預約時間，原始資料已自動帶入：</p><p><a href="${escapeEmailHtml(rescheduleLink)}">選擇新的預約時間</a></p>`;

  await sendGmailMessage({
    encryptedRefreshToken: sender.google_refresh_token,
    senderEmail: sender.google_email || sender.login_email,
    senderName: template?.sender_name || sender.name,
    to: appointment.client_email,
    subject,
    body: sanitizeEmailHtml(body)
  });

  const sentAt = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
  await query(
    `update appointments
        set status = '待開會 (已發送改期)',
            notes = concat_ws(E'\n', nullif(notes, ''), $3::text)
      where tenant_slug = $1 and id = $2`,
    [tenant, appointment.id, `[系統：${sentAt} 已發送自選改期連結]`]
  );
  return { success: true, message: '自選改期連結已寄出，並已寫入追蹤紀錄。' };
}

async function getAnalyticsData(payload, tenant) {
  const projectCode = payload.projectCode && payload.projectCode !== 'ALL' ? normalizeProject(payload.projectCode) : null;
  const params = [tenant];
  let projectClause = '';
  if (projectCode) {
    params.push(projectCode);
    projectClause = ` and project_code = $${params.length}`;
  }
  const [views, bookings, rejected, waitlist] = await Promise.all([
    query(`select count(*)::int as count from page_views where tenant_slug = $1${projectClause}`, params),
    query(`select count(*)::int as count from appointments where tenant_slug = $1${projectClause}`, params),
    query(`select count(*)::int as count from rejected_clients where tenant_slug = $1${projectClause}`, params),
    query(`select count(*)::int as count from waitlist_clients where tenant_slug = $1${projectClause}`, params)
  ]);
  return {
    success: true,
    stats: {
      views: views.rows[0].count,
      bookings: bookings.rows[0].count,
      rejected: rejected.rows[0].count,
      waitlist: waitlist.rows[0].count,
      deals: 0,
      completed: 0
    },
    sysHealth: {
      apiStatus: '中央 API 正常',
      emailQuota: '請改接寄信服務',
      apiLoad: 0
    }
  };
}

async function getSystemUsage(_payload, tenant, user) {
  if (!isSystemOwner(user)) throw new Error('只有最高權限系統管理員可以查看全系統用量。');
  const [database, imageUsage, emailUsage, totals] = await Promise.all([
    query(`select pg_database_size(current_database())::bigint as bytes`),
    query(`select coalesce(sum(octet_length(body)), 0)::bigint as bytes from email_templates where tenant_slug = $1`, [tenant]),
    query(
      `select
         count(*) filter (where status = 'sent' and sent_at >= date_trunc('month', now()))::int as sent_month,
         count(*) filter (where status in ('failed', 'error') and created_at >= date_trunc('month', now()))::int as failed_month
       from email_queue`
    ),
    query(
      `select
         (select count(*)::int from tenants) as tenants,
         (select count(*)::int from projects) as projects,
         (select count(*)::int from consultants) as consultants,
         (select count(*)::int from appointments) as appointments`
    )
  ]);
  const total = totals.rows[0] || {};
  const email = emailUsage.rows[0] || {};
  return {
    success: true,
    databaseMb: Number((Number(database.rows[0]?.bytes || 0) / 1024 / 1024).toFixed(2)),
    emailImageMb: Number((Number(imageUsage.rows[0]?.bytes || 0) / 1024 / 1024).toFixed(2)),
    emailsSentMonth: email.sent_month || 0,
    emailsFailedMonth: email.failed_month || 0,
    tenants: total.tenants || 0,
    projects: total.projects || 0,
    consultants: total.consultants || 0,
    appointments: total.appointments || 0
  };
}

async function getOwnerScopeData(_payload, tenant, user) {
  if (!isSystemOwner(user)) {
    throw new Error('只有最高權限系統管理員可以切換使用者');
  }
  const [tenants, projects] = await Promise.all([
    query(
      `select t.slug, t.name, t.owner_name, t.owner_email, t.created_at,
              (select count(*)::int from projects p where p.tenant_slug = t.slug) as project_count,
              (select count(*)::int from consultants c where c.tenant_slug = t.slug) as consultant_count,
              (select count(*)::int from appointments a where a.tenant_slug = t.slug) as appointment_count
         from tenants t
        order by name asc, slug asc`,
    ),
    query(
      `select code, name
         from projects
        where tenant_slug = $1
        order by name asc, code asc`,
      [tenant],
    ),
  ]);
  return {
    success: true,
    currentTenant: tenant,
    tenants: tenants.rows,
    projects: projects.rows,
  };
}

async function saveTenantAsOwner(payload, tenant, user) {
  if (!isSystemOwner(user)) throw new Error('只有最高權限系統管理員可以管理使用者');
  const targetTenant = normalizeTenant(payload.targetTenant || tenant);
  const newTenant = normalizeTenant(payload.newTenant || targetTenant);
  const tenantName = String(payload.tenantName || '').trim() || newTenant;
  const owner = String(payload.ownerName || '').trim();
  const email = normalizeEmail(payload.ownerEmail);

  const userRow = await transaction(async client => {
    if (newTenant === targetTenant) {
      const result = await client.query(
        `update tenants
            set name = $2, owner_name = $3, owner_email = $4
          where slug = $1
          returning slug, name, owner_name, owner_email`,
        [targetTenant, tenantName, owner, email]
      );
      return result.rows[0];
    }

    const existing = await client.query(`select 1 from tenants where slug = $1`, [newTenant]);
    if (existing.rows[0]) throw new Error('這個使用者代碼已被使用。');

    const inserted = await client.query(
      `insert into tenants(slug, name, owner_name, owner_email, owner_password_hash, app_base_url, booking_base_urls, created_at)
       select $2, $3, $4, $5, owner_password_hash, app_base_url, booking_base_urls, created_at
         from tenants
        where slug = $1
       returning slug, name, owner_name, owner_email`,
      [targetTenant, newTenant, tenantName, owner, email]
    );
    if (!inserted.rows[0]) throw new Error('找不到這個使用者。');

    const tenantTables = [
      'projects',
      'consultants',
      'availability_rules',
      'questions',
      'appointments',
      'rejected_clients',
      'waitlist_clients',
      'page_views',
      'email_templates',
      'leads',
      'email_queue'
    ];
    for (const table of tenantTables) {
      await client.query(`update ${table} set tenant_slug = $2 where tenant_slug = $1`, [targetTenant, newTenant]);
    }
    await client.query(`delete from tenants where slug = $1`, [targetTenant]);
    return inserted.rows[0];
  });

  if (!userRow) throw new Error('找不到這個使用者。');
  return { success: true, user: userRow };
}

async function routeAction(action, payload, req, tenant) {
  switch (action) {
    case 'initializeSystem':
    case 'initializeTenant':
      return initializeTenant(payload);
    case 'verifyLogin':
      return verifyLogin(payload, tenant, req);
    case 'getQuestions':
      return getQuestions(payload, tenant);
    case 'getQuizConfig':
      return getQuizConfig(payload, tenant);
    case 'submitQuiz':
      return submitQuiz(payload, tenant);
    case 'getQuizResult':
      return getQuizResult(payload, tenant);
    case 'trackReportClick':
      return trackReportClick(payload, tenant, req);
    case 'getRescheduleData':
      return getRescheduleData(payload, tenant);
    case 'getBookingInviteData':
      return getBookingInviteData(payload, tenant);
    case 'getAvailableTimes':
      return getAvailableTimes(payload, tenant);
    case 'submitBooking':
      return submitBooking(payload, tenant);
    case 'logRejected':
      return logRejected(payload, tenant);
    case 'logMissed':
      return logMissed(payload, tenant);
    case 'logPageView':
      return logPageView(payload, tenant);
    case 'trackLead':
      return trackLead(payload, tenant);
    case 'systemeWebhook':
      return systemeWebhook(payload, tenant, req);
    case 'unsubscribeEmail':
      return unsubscribeEmail(payload, tenant);
    default:
      break;
  }

  const user = await requireUser(req, payload);
  if (user.tenant_slug !== tenant && !isSystemOwner(user)) throw new Error('此帳號不能查看其他租戶資料。');

  const tenantAdminOnlyActions = new Set([
    'getAdminConsultantData',
    'saveConsultantData',
    'deleteConsultantData',
    'ensureDemoAccounts',
    'createTenantAsOwner',
    'importLegacyData'
  ]);
  if (tenantAdminOnlyActions.has(action) && !isTenantAdmin(user)) {
    throw new Error('你的帳號沒有管理權限。');
  }

  const featureActions = {
    getAdminQuestions: 'FORMS',
    saveAdminQuestions: 'FORMS',
    getAdminProjectData: 'PROJECTS',
    saveProjectData: 'PROJECTS',
    saveBookingBaseUrls: 'PROJECTS',
    sendBookingInvite: 'PROJECTS',
    getAnalyticsData: 'ANALYTICS',
    getEmailAutomationData: 'EMAILS',
    saveEmailTemplate: 'EMAILS',
    runEmailQueue: 'EMAILS'
  };
  if (featureActions[action] && !hasPermission(user, featureActions[action])) {
    throw new Error('此帳號尚未開通這個後台功能。');
  }

  if (action === 'getGoogleConnectUrl' || action === 'getMicrosoftConnectUrl') {
    const consultantId = Number(payload.consultantId || payload.rowId);
    if (!isAdmin(user) && consultantId !== Number(user.id)) {
      throw new Error('你只能連接自己的行事曆。');
    }
  }

  switch (action) {
    case 'getOwnerScopeData':
      return getOwnerScopeData(payload, tenant, user);
    case 'saveTenantAsOwner':
      return saveTenantAsOwner(payload, tenant, user);
    case 'createTenantAsOwner':
      if (!isSystemOwner(user)) throw new Error('只有最高權限系統管理員可以建立使用者');
      return initializeTenant(payload, { skipInstallerSecret: true });
    case 'importLegacyData':
      return importLegacyData(payload, tenant, user);
    case 'getAdminQuestions':
      return getAdminQuestions(payload, tenant);
    case 'saveAdminQuestions':
      return saveAdminQuestions(payload, tenant);
    case 'getAdminProjectData':
      return getAdminProjectData(payload, tenant);
    case 'saveProjectData':
      return saveProjectData(payload, tenant);
    case 'saveBookingBaseUrls':
      return saveBookingBaseUrls(payload, tenant);
    case 'sendBookingInvite':
      return sendBookingInvite(payload, tenant);
    case 'getAdminConsultantData':
      return getAdminConsultantData(payload, tenant);
    case 'saveConsultantData':
      return saveConsultantData(payload, tenant, user);
    case 'deleteConsultantData':
      return deleteConsultantData(payload, tenant, user);
    case 'getGoogleConnectUrl':
      return getGoogleConnectUrl(payload, tenant);
    case 'getMicrosoftConnectUrl':
      return getMicrosoftConnectUrl(payload, tenant);
    case 'getConsultantScheduleData':
      return getConsultantScheduleData(payload, tenant, user);
    case 'saveConsultantWeeklyAndSettings':
      return saveConsultantWeeklyAndSettings(payload, tenant, user);
    case 'getConsultantAppointments':
      return getConsultantAppointments(payload, tenant, user);
    case 'getCRMContactDetail':
      return getCRMContactDetail(payload, tenant, user);
    case 'getQuizAdminEditor':
      return getQuizAdminEditor(payload, tenant, user);
    case 'saveQuizAdminEditor':
      return saveQuizAdminEditor(payload, tenant, user);
    case 'getQuizReportEditor':
      return getQuizReportEditor(payload, tenant, user);
    case 'saveQuizReportEditor':
      return saveQuizReportEditor(payload, tenant, user);
    case 'updateCRMRecord':
      return updateCRMRecord(payload, tenant, user);
    case 'handleAppointmentAction':
      return handleAppointmentAction(payload, tenant, user);
    case 'sendSelfRescheduleLink':
      return sendSelfRescheduleLink(payload, tenant, user);
    case 'sendWaitlistInvite':
      return sendWaitlistInvite(payload, tenant, user);
    case 'getAnalyticsData':
      return getAnalyticsData(payload, tenant);
    case 'getSystemUsage':
      return getSystemUsage(payload, tenant, user);
    case 'getEmailAutomationData':
      return getEmailAutomationData(payload, tenant);
    case 'saveEmailTemplate':
      return saveEmailTemplate(payload, tenant);
    case 'runEmailQueue':
      return runEmailQueue(payload, tenant);
    case 'ensureDemoAccounts':
      return seedDemoAccounts(tenant);
    case 'me': {
      const tenantInfo = await tenantBySlug(tenant);
      return {
        success: true,
        user: Object.assign({}, user, {
          role: publicRole(roleOf(user)),
          isAdmin: isTenantAdmin(user),
          isSystemOwner: isSystemOwner(user),
          tenantName: tenantInfo?.name || tenant,
          projectCodes: visibleProjectCodes(user)
        })
      };
    }
    default:
      throw new Error(`未知 API action: ${action}`);
  }
}

module.exports = {
  initializeTenant,
  routeAction,
  normalizeTenant,
  runDueEmails
};














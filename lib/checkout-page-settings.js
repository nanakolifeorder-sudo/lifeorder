const { query } = require('./db');

const DEFAULT_SETTINGS = Object.freeze({
  checkoutTitle: '人生秩序完整版',
  checkoutDescription: '完成付款後，即可開始完整版測驗。',
  successTitle: '付款完成',
  successDescription: '人生秩序完整版測驗已為你開通。',
  successButtonLabel: '立即開始完整版測驗',
  successImageUrl: '',
  successImageAlt: ''
});

let schemaPromise;

function text(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function imageUrl(value) {
  const url = text(value, 2000);
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid protocol');
    return parsed.toString();
  } catch (_) {
    throw new Error('圖片網址需使用有效的 http 或 https 網址。');
  }
}

async function ensureCheckoutPageSettingsSchema() {
  if (!schemaPromise) {
    schemaPromise = query(`create table if not exists checkout_page_settings (
      tenant_slug text primary key references tenants(slug) on delete cascade,
      checkout_title text not null default '',
      checkout_description text not null default '',
      success_title text not null default '',
      success_description text not null default '',
      success_button_label text not null default '',
      success_image_url text not null default '',
      success_image_alt text not null default '',
      updated_at timestamptz not null default now()
    )`).catch(error => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

function normalize(row = {}) {
  return {
    checkoutTitle: text(row.checkout_title ?? row.checkoutTitle, 160) || DEFAULT_SETTINGS.checkoutTitle,
    checkoutDescription: text(row.checkout_description ?? row.checkoutDescription, 500) || DEFAULT_SETTINGS.checkoutDescription,
    successTitle: text(row.success_title ?? row.successTitle, 160) || DEFAULT_SETTINGS.successTitle,
    successDescription: text(row.success_description ?? row.successDescription, 1000) || DEFAULT_SETTINGS.successDescription,
    successButtonLabel: text(row.success_button_label ?? row.successButtonLabel, 100) || DEFAULT_SETTINGS.successButtonLabel,
    successImageUrl: imageUrl(row.success_image_url ?? row.successImageUrl),
    successImageAlt: text(row.success_image_alt ?? row.successImageAlt, 200)
  };
}

async function getCheckoutPageSettings(tenant) {
  await ensureCheckoutPageSettingsSchema();
  const result = await query('select * from checkout_page_settings where tenant_slug = $1 limit 1', [tenant]);
  return normalize(result.rows[0] || {});
}

async function saveCheckoutPageSettings(payload, tenant) {
  const settings = normalize(payload);
  await ensureCheckoutPageSettingsSchema();
  await query(
    `insert into checkout_page_settings(
       tenant_slug, checkout_title, checkout_description, success_title,
       success_description, success_button_label, success_image_url, success_image_alt, updated_at
     ) values($1,$2,$3,$4,$5,$6,$7,$8,now())
     on conflict(tenant_slug) do update set
       checkout_title = excluded.checkout_title,
       checkout_description = excluded.checkout_description,
       success_title = excluded.success_title,
       success_description = excluded.success_description,
       success_button_label = excluded.success_button_label,
       success_image_url = excluded.success_image_url,
       success_image_alt = excluded.success_image_alt,
       updated_at = now()`,
    [tenant, settings.checkoutTitle, settings.checkoutDescription, settings.successTitle, settings.successDescription, settings.successButtonLabel, settings.successImageUrl, settings.successImageAlt]
  );
  return settings;
}

module.exports = { getCheckoutPageSettings, saveCheckoutPageSettings };

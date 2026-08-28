const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && !process.env[key]) process.env[key] = value;
  }
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

function env(name, fallback = '') {
  return process.env[name] || fallback;
}

function normalizeTenant(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'client';
}

function normalizeProject(value) {
  return String(value || 'P01').trim().toUpperCase() || 'P01';
}

async function applySql(client, file) {
  const fullPath = path.resolve(process.cwd(), file);
  const sql = fs.readFileSync(fullPath, 'utf8');
  await client.query(sql);
  console.log(`SQL applied: ${file}`);
}

async function main() {
  loadEnvFile(path.join(process.cwd(), '.env'));
  loadEnvFile(path.join(process.cwd(), '.env.client'));

  const databaseUrl = required('DATABASE_URL');
  const tenant = normalizeTenant(env('CLIENT_TENANT_SLUG', 'nanako'));
  const tenantName = env('CLIENT_TENANT_NAME', 'Life Order 客戶系統');
  const adminName = env('CLIENT_ADMIN_NAME', 'Life Order 管理員');
  const adminEmail = required('CLIENT_ADMIN_EMAIL');
  const adminPassword = required('CLIENT_ADMIN_PASSWORD');
  const projectCode = normalizeProject(env('CLIENT_PROJECT_CODE', 'P01'));
  const projectName = env('CLIENT_PROJECT_NAME', '人生診斷卡點');
  const appBaseUrl = env('APP_URL', '');
  const webhookSecret = env('WEBHOOK_SECRET', crypto.randomBytes(24).toString('hex'));
  const passwordHash = await bcrypt.hash(String(adminPassword), 12);

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
    options: process.env.PGOPTIONS || '-c search_path=public'
  });
  const client = await pool.connect();
  try {
    await client.query('begin');
    await applySql(client, 'sql/schema.sql');
    await applySql(client, 'sql/upgrade-security-email-backup.sql');
    await applySql(client, 'sql/integration-phase-2-quiz-crm-schema.sql');
    await applySql(client, 'sql/upgrade-booking-base-urls.sql');

    await client.query(
      `insert into tenants(slug, name, owner_name, owner_email, owner_password_hash, app_base_url, webhook_secret)
       values($1,$2,$3,$4,$5,$6,$7)
       on conflict(slug) do update set
         name = excluded.name,
         owner_name = excluded.owner_name,
         owner_email = excluded.owner_email,
         owner_password_hash = excluded.owner_password_hash,
         app_base_url = excluded.app_base_url,
         webhook_secret = excluded.webhook_secret`,
      [tenant, tenantName, adminName, adminEmail, passwordHash, appBaseUrl || null, webhookSecret]
    );

    await client.query(
      `insert into projects(tenant_slug, code, name, status, quiz_enabled, default_quiz_version_code)
       values($1,$2,$3,'啟用',true,'A')
       on conflict(tenant_slug, code) do update set
         name = excluded.name,
         status = excluded.status,
         quiz_enabled = true,
         default_quiz_version_code = 'A'`,
      [tenant, projectCode, projectName]
    );

    await client.query(
      `insert into consultants(
         tenant_slug, name, login_email, password_hash, calendar_id,
         accepting, weight, permissions, project_codes, meet_tool, time_zone
       ) values($1,$2,$3,$4,'primary',false,1,'TENANT_ADMIN',array['ALL']::text[],'Google Meet','Asia/Taipei')
       on conflict(tenant_slug, login_email) do update set
         name = excluded.name,
         password_hash = excluded.password_hash,
         accepting = false,
         permissions = 'TENANT_ADMIN',
         project_codes = array['ALL']::text[],
         meet_tool = 'Google Meet',
         time_zone = 'Asia/Taipei'`,
      [tenant, adminName, adminEmail, passwordHash]
    );

    await client.query('commit');
    console.log(JSON.stringify({
      success: true,
      tenant,
      projectCode,
      adminEmail,
      adminUrl: appBaseUrl ? `${appBaseUrl.replace(/\/$/, '')}/admin?tenant=${tenant}` : `/admin?tenant=${tenant}`,
      quizUrl: appBaseUrl ? `${appBaseUrl.replace(/\/$/, '')}/quiz?tenant=${tenant}&p=${projectCode}` : `/quiz?tenant=${tenant}&p=${projectCode}`,
      bookingUrl: appBaseUrl ? `${appBaseUrl.replace(/\/$/, '')}/booking?tenant=${tenant}&p=${projectCode}` : `/booking?tenant=${tenant}&p=${projectCode}`
    }, null, 2));
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
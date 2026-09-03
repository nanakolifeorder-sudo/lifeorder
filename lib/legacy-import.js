const { transaction } = require('./db');
const { hashPassword, isTenantAdmin, ROLE_CONSULTANT, ROLE_TENANT_ADMIN } = require('./auth');
const { ownerEmail: configuredOwnerEmail } = require('./config');

function clean(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function boolFromChinese(value) {
  return ['是', '啟用', 'true', '1', 'yes'].includes(clean(value).toLowerCase());
}

function numberOr(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function dateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function listFrom(value) {
  return clean(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function projectCodeFor(projectName, projectNameMap, fallback = 'LO') {
  const name = clean(projectName);
  if (!name) return fallback;
  const upper = name.toUpperCase();
  if (projectNameMap.has(upper)) return projectNameMap.get(upper);
  return projectNameMap.get(name) || fallback;
}

function normalizeRole(item) {
  const ownerEmail = clean(configuredOwnerEmail()).toLowerCase();
  const email = clean(item.email).toLowerCase();
  if (email && email === ownerEmail) return ROLE_TENANT_ADMIN;
  if (clean(item.role) === ROLE_TENANT_ADMIN) return ROLE_TENANT_ADMIN;
  if (clean(item.permissions).includes('管理')) return ROLE_TENANT_ADMIN;
  return ROLE_CONSULTANT;
}

async function importLegacyData(payload, tenantSlug, user) {
  if (!isTenantAdmin(user)) {
    throw Object.assign(new Error('只有系統管理員或使用者管理員可以匯入資料'), { status: 403 });
  }
  if (payload.stage) {
    return importLegacyStage(payload, tenantSlug);
  }

  const tenantName = clean(payload.tenantName) || 'DM Chen';
  const ownerName = clean(payload.ownerName) || 'DMtest';
  const ownerEmail = clean(payload.ownerEmail) || configuredOwnerEmail();
  const projects = Array.isArray(payload.projects) ? payload.projects : [];
  const questions = Array.isArray(payload.questions) ? payload.questions : [];
  const consultants = Array.isArray(payload.consultants) ? payload.consultants : [];
  const availability = Array.isArray(payload.availability) ? payload.availability : [];
  const appointments = Array.isArray(payload.appointments) ? payload.appointments : [];
  const rejected = Array.isArray(payload.rejected) ? payload.rejected : [];
  const waitlist = Array.isArray(payload.waitlist) ? payload.waitlist : [];
  const emailTemplates = Array.isArray(payload.emailTemplates) ? payload.emailTemplates : [];
  const leads = Array.isArray(payload.leads) ? payload.leads : [];

  const passwordHashes = new Map();
  const hashByPassword = new Map();
  for (const item of consultants) {
    const email = clean(item.email).toLowerCase();
    if (!email) continue;
    const password = clean(item.password) || '1111';
    if (!hashByPassword.has(password)) {
      hashByPassword.set(password, await hashPassword(password));
    }
    passwordHashes.set(email, hashByPassword.get(password));
  }

  const counts = {
    projects: 0,
    questions: 0,
    consultants: 0,
    availability: 0,
    appointments: 0,
    rejected: 0,
    waitlist: 0,
    emailTemplates: 0,
    leads: 0,
  };

  await transaction(async (client) => {
    await client.query(
      `
        update tenants
        set name = $2,
            owner_name = $3,
            owner_email = $4
        where slug = $1
      `,
      [tenantSlug, tenantName, ownerName, ownerEmail],
    );

    await client.query('delete from email_queue where tenant_slug = $1', [tenantSlug]);
    await client.query('delete from appointments where tenant_slug = $1', [tenantSlug]);
    await client.query('delete from rejected_clients where tenant_slug = $1', [tenantSlug]);
    await client.query('delete from waitlist_clients where tenant_slug = $1', [tenantSlug]);
    await client.query('delete from leads where tenant_slug = $1', [tenantSlug]);
    await client.query('delete from questions where tenant_slug = $1', [tenantSlug]);
    await client.query('delete from email_templates where tenant_slug = $1', [tenantSlug]);
    await client.query('delete from availability_rules where tenant_slug = $1', [tenantSlug]);

    for (const item of projects) {
      const code = clean(item.code).toUpperCase();
      if (!code) continue;
      await client.query(
        `
          insert into projects (
            tenant_slug, code, name, status, main_url, fallback_url,
            booking_notice, reject_type, reject_value
          )
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          on conflict (tenant_slug, code) do update set
            name = excluded.name,
            status = excluded.status,
            main_url = excluded.main_url,
            fallback_url = excluded.fallback_url,
            booking_notice = excluded.booking_notice,
            reject_type = excluded.reject_type,
            reject_value = excluded.reject_value
        `,
        [
          tenantSlug,
          code,
          clean(item.name) || code,
          boolFromChinese(item.status) ? 'active' : 'inactive',
          clean(item.mainUrl),
          clean(item.fallbackUrl),
          clean(item.bookingNotice),
          'text',
          clean(item.rejectValue),
        ],
      );
      counts.projects += 1;
    }

    const projectRows = await client.query('select code, name from projects where tenant_slug = $1', [tenantSlug]);
    const projectNameMap = new Map();
    for (const row of projectRows.rows) {
      projectNameMap.set(clean(row.name), row.code);
      projectNameMap.set(clean(row.code).toUpperCase(), row.code);
    }

    for (const item of consultants) {
      const email = clean(item.email).toLowerCase();
      if (!email) continue;
      const role = normalizeRole(item);
      await client.query(
        `
          insert into consultants (
            tenant_slug, name, login_email, password_hash, calendar_id, accepting, weight,
            permissions, project_codes, meet_tool, time_zone, interval_minutes,
            buffer_before, buffer_after
          )
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
          on conflict (tenant_slug, login_email) do update set
            name = excluded.name,
            password_hash = excluded.password_hash,
            calendar_id = excluded.calendar_id,
            accepting = excluded.accepting,
            weight = excluded.weight,
            permissions = excluded.permissions,
            project_codes = excluded.project_codes,
            meet_tool = excluded.meet_tool,
            time_zone = excluded.time_zone,
            interval_minutes = excluded.interval_minutes,
            buffer_before = excluded.buffer_before,
            buffer_after = excluded.buffer_after
        `,
        [
          tenantSlug,
          clean(item.name) || email,
          email,
          passwordHashes.get(email),
          clean(item.calendarId) || 'primary',
          boolFromChinese(item.accepting),
          numberOr(item.weight, 50),
          role,
          listFrom(item.projectCodes),
          clean(item.meetTool) || 'google_meet',
          clean(item.timeZone) || 'Asia/Taipei',
          numberOr(item.intervalMinutes, 60),
          numberOr(item.bufferBeforeMinutes, 0),
          numberOr(item.bufferAfterMinutes, 0),
        ],
      );
      counts.consultants += 1;
    }

    const consultantRows = await client.query(
      'select id, name, login_email from consultants where tenant_slug = $1',
      [tenantSlug],
    );
    const consultantByName = new Map();
    const consultantByEmail = new Map();
    for (const row of consultantRows.rows) {
      consultantByName.set(clean(row.name), row);
      consultantByEmail.set(clean(row.login_email).toLowerCase(), row);
    }

    for (const item of questions) {
      const projectCode = clean(item.projectCode).toUpperCase();
      if (!projectCode || !clean(item.title)) continue;
      await client.query(
        `
          insert into questions (
            tenant_slug, project_code, sort_order, title, type, options,
            reject_word, is_required
          )
          values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
        `,
        [
          tenantSlug,
          projectCode,
          numberOr(item.sortOrder, counts.questions + 1),
          clean(item.title),
          clean(item.type) || '文字',
          JSON.stringify(Array.isArray(item.options) ? item.options : []),
          clean(item.rejectWord),
          item.isRequired !== false,
        ],
      );
      counts.questions += 1;
    }

    for (const item of availability) {
      const consultant = consultantByName.get(clean(item.consultantName)) || consultantByEmail.get(clean(item.email).toLowerCase());
      if (!consultant || !clean(item.startTime) || !clean(item.endTime)) continue;
      if (item.intervalMinutes || item.bufferBeforeMinutes || item.bufferAfterMinutes) {
        await client.query(
          `
            update consultants
            set interval_minutes = $3,
                buffer_before = $4,
                buffer_after = $5
            where tenant_slug = $1 and id = $2
          `,
          [
            tenantSlug,
            consultant.id,
            numberOr(item.intervalMinutes, 60),
            numberOr(item.bufferBeforeMinutes, 0),
            numberOr(item.bufferAfterMinutes, 0),
          ],
        );
      }
      await client.query(
        `
          insert into availability_rules (
            tenant_slug, consultant_id, kind, day_of_week, date_value, start_time, end_time
          )
          values ($1,$2,$3,$4,$5,$6,$7)
        `,
        [
          tenantSlug,
          consultant.id,
          clean(item.kind) || (item.dateValue ? 'specific' : 'weekly'),
          item.dayOfWeek === null || item.dayOfWeek === undefined ? null : numberOr(item.dayOfWeek, null),
          item.dateValue || null,
          clean(item.startTime),
          clean(item.endTime),
        ],
      );
      counts.availability += 1;
    }

    const insertPersonRecord = async (table, item) => {
      const projectCode = clean(item.projectCode) || projectCodeFor(item.projectName, projectNameMap);
      const consultant = consultantByName.get(clean(item.consultantName)) || null;
      const startAt = dateOrNull(item.startAt);
      const endAt = startAt ? new Date(startAt.getTime() + 60 * 60 * 1000) : null;
      const createdAt = dateOrNull(item.createdAt) || new Date();

      if (table === 'appointments') {
        await client.query(
          `
            insert into appointments (
              tenant_slug, project_code, project_name, consultant_id, consultant_name,
              calendar_id, event_id, meet_link, start_at, end_at, client_name,
              client_email, client_phone, answers, status,
              attendance, deal_status, plan, notes, created_at
            )
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
          `,
          [
            tenantSlug,
            projectCode,
            clean(item.projectName),
            consultant?.id || null,
            consultant?.name || clean(item.consultantName),
            clean(item.calendarId) || '',
            clean(item.eventId),
            clean(item.meetLink),
            startAt,
            endAt,
            clean(item.clientName),
            clean(item.email),
            clean(item.phone),
            clean(item.answers),
            clean(item.status) || 'booked',
            clean(item.attendance),
            clean(item.dealStatus),
            clean(item.plan),
            clean(item.notes),
            createdAt,
          ],
        );
        return;
      }

      await client.query(
        `
          insert into ${table} (
            tenant_slug, project_code, project_name, client_name, client_email, client_phone,
            answers, status, created_at
          )
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          on conflict (tenant_slug, project_code, client_email) do update set
            project_name = excluded.project_name,
            client_name = excluded.client_name,
            client_phone = excluded.client_phone,
            answers = excluded.answers,
            status = excluded.status,
            updated_at = now()
        `,
        [
          tenantSlug,
          projectCode,
          clean(item.projectName),
          clean(item.clientName),
          clean(item.email),
          clean(item.phone),
          clean(item.answers),
          clean(item.status) || (table === 'rejected_clients' ? 'rejected' : 'waiting'),
          createdAt,
        ],
      );
    };

    for (const item of appointments) {
      await insertPersonRecord('appointments', item);
      counts.appointments += 1;
    }
    for (const item of rejected) {
      await insertPersonRecord('rejected_clients', item);
      counts.rejected += 1;
    }
    for (const item of waitlist) {
      await insertPersonRecord('waitlist_clients', item);
      counts.waitlist += 1;
    }

    for (const item of emailTemplates) {
      const projectCode = clean(item.projectCode).toUpperCase();
      if (!projectCode || !clean(item.name)) continue;
      await client.query(
        `
          insert into email_templates (
            tenant_slug, project_code, name, trigger_name, time_param, subject,
            body, sender_name, status, stop_when_booked
          )
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        `,
        [
          tenantSlug,
          projectCode,
          clean(item.name),
          clean(item.triggerType) || 'booking_created',
          numberOr(item.offsetHours, 0),
          clean(item.subject),
          clean(item.body),
          clean(item.senderName) || tenantName,
          boolFromChinese(item.status) ? 'active' : 'inactive',
          item.stopWhenBooked !== false,
        ],
      );
      counts.emailTemplates += 1;
    }

    for (const item of leads) {
      const projectCode = clean(item.projectCode).toUpperCase();
      if (!projectCode || !clean(item.email)) continue;
      await client.query(
        `
          insert into leads (
            tenant_slug, project_code, project_name, client_name, client_email, client_phone,
            answers, status, created_at
          )
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        `,
        [
          tenantSlug,
          projectCode,
          projectNameMap.get(projectCode) || clean(item.projectName),
          clean(item.clientName),
          clean(item.email),
          clean(item.phone),
          clean(item.answers),
          clean(item.status) || 'pending',
          dateOrNull(item.createdAt) || new Date(),
        ],
      );
      counts.leads += 1;
    }
  });

  return {
    success: true,
    message: '舊系統資料已匯入',
    tenantName,
    counts,
  };
}

async function getProjectNameMap(client, tenantSlug) {
  const projectRows = await client.query('select code, name from projects where tenant_slug = $1', [tenantSlug]);
  const projectNameMap = new Map();
  for (const row of projectRows.rows) {
    projectNameMap.set(clean(row.name), row.code);
    projectNameMap.set(clean(row.code).toUpperCase(), row.code);
  }
  return projectNameMap;
}

async function getConsultantMaps(client, tenantSlug) {
  const consultantRows = await client.query(
    'select id, name, login_email from consultants where tenant_slug = $1',
    [tenantSlug],
  );
  const byName = new Map();
  const byEmail = new Map();
  for (const row of consultantRows.rows) {
    byName.set(clean(row.name), row);
    byEmail.set(clean(row.login_email).toLowerCase(), row);
  }
  return { byName, byEmail };
}

async function importLegacyStage(payload, tenantSlug) {
  const stage = clean(payload.stage);
  const items = Array.isArray(payload.items) ? payload.items : [];

  if (stage === 'reset') {
    const tenantName = clean(payload.tenantName) || 'DM Chen';
    const ownerName = clean(payload.ownerName) || 'DMtest';
    const ownerEmail = clean(payload.ownerEmail) || configuredOwnerEmail();
    await transaction(async (client) => {
      await client.query(
        `
          update tenants
          set name = $2,
              owner_name = $3,
              owner_email = $4
          where slug = $1
        `,
        [tenantSlug, tenantName, ownerName, ownerEmail],
      );
      await client.query('delete from email_queue where tenant_slug = $1', [tenantSlug]);
      await client.query('delete from appointments where tenant_slug = $1', [tenantSlug]);
      await client.query('delete from rejected_clients where tenant_slug = $1', [tenantSlug]);
      await client.query('delete from waitlist_clients where tenant_slug = $1', [tenantSlug]);
      await client.query('delete from leads where tenant_slug = $1', [tenantSlug]);
      await client.query('delete from questions where tenant_slug = $1', [tenantSlug]);
      await client.query('delete from email_templates where tenant_slug = $1', [tenantSlug]);
      await client.query('delete from availability_rules where tenant_slug = $1', [tenantSlug]);
    });
    return { success: true, stage, tenantName, count: 1 };
  }

  if (stage === 'projects') {
    let count = 0;
    await transaction(async (client) => {
      for (const item of items) {
        const code = clean(item.code).toUpperCase();
        if (!code) continue;
        await client.query(
          `
            insert into projects (
              tenant_slug, code, name, status, main_url, fallback_url,
              booking_notice, reject_type, reject_value
            )
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            on conflict (tenant_slug, code) do update set
              name = excluded.name,
              status = excluded.status,
              main_url = excluded.main_url,
              fallback_url = excluded.fallback_url,
              booking_notice = excluded.booking_notice,
              reject_type = excluded.reject_type,
              reject_value = excluded.reject_value
          `,
          [
            tenantSlug,
            code,
            clean(item.name) || code,
            boolFromChinese(item.status) ? 'active' : 'inactive',
            clean(item.mainUrl),
            clean(item.fallbackUrl),
            clean(item.bookingNotice),
            'text',
            clean(item.rejectValue),
          ],
        );
        count += 1;
      }
    });
    return { success: true, stage, count };
  }

  if (stage === 'consultants') {
    let count = 0;
    const hashByPassword = new Map();
    await transaction(async (client) => {
      for (const item of items) {
        const email = clean(item.email).toLowerCase();
        if (!email) continue;
        const password = clean(item.password) || '1111';
        if (!hashByPassword.has(password)) {
          hashByPassword.set(password, await hashPassword(password));
        }
        await client.query(
          `
            insert into consultants (
              tenant_slug, name, login_email, password_hash, calendar_id, accepting, weight,
              permissions, project_codes, meet_tool, time_zone, interval_minutes,
              buffer_before, buffer_after
            )
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
            on conflict (tenant_slug, login_email) do update set
              name = excluded.name,
              password_hash = excluded.password_hash,
              calendar_id = excluded.calendar_id,
              accepting = excluded.accepting,
              weight = excluded.weight,
              permissions = excluded.permissions,
              project_codes = excluded.project_codes,
              meet_tool = excluded.meet_tool,
              time_zone = excluded.time_zone,
              interval_minutes = excluded.interval_minutes,
              buffer_before = excluded.buffer_before,
              buffer_after = excluded.buffer_after
          `,
          [
            tenantSlug,
            clean(item.name) || email,
            email,
            hashByPassword.get(password),
            clean(item.calendarId) || 'primary',
            boolFromChinese(item.accepting),
            numberOr(item.weight, 50),
            normalizeRole(item),
            listFrom(item.projectCodes),
            clean(item.meetTool) || 'Google Meet',
            clean(item.timeZone) || 'Asia/Taipei',
            numberOr(item.intervalMinutes, 60),
            numberOr(item.bufferBeforeMinutes, 0),
            numberOr(item.bufferAfterMinutes, 0),
          ],
        );
        count += 1;
      }
    });
    return { success: true, stage, count };
  }

  if (stage === 'questions') {
    let count = 0;
    await transaction(async (client) => {
      for (const item of items) {
        const projectCode = clean(item.projectCode).toUpperCase();
        if (!projectCode || !clean(item.title)) continue;
        await client.query(
          `
            insert into questions (
              tenant_slug, project_code, sort_order, title, type, options,
              reject_word, is_required
            )
            values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
          `,
          [
            tenantSlug,
            projectCode,
            numberOr(item.sortOrder, count + 1),
            clean(item.title),
            clean(item.type) || '文字',
            JSON.stringify(Array.isArray(item.options) ? item.options : []),
            clean(item.rejectWord),
            item.isRequired !== false,
          ],
        );
        count += 1;
      }
    });
    return { success: true, stage, count };
  }

  if (stage === 'availability') {
    let count = 0;
    await transaction(async (client) => {
      const consultants = await getConsultantMaps(client, tenantSlug);
      for (const item of items) {
        const consultant = consultants.byName.get(clean(item.consultantName)) || consultants.byEmail.get(clean(item.email).toLowerCase());
        if (!consultant || !clean(item.startTime) || !clean(item.endTime)) continue;
        if (item.intervalMinutes || item.bufferBeforeMinutes || item.bufferAfterMinutes) {
          await client.query(
            `
              update consultants
              set interval_minutes = $3,
                  buffer_before = $4,
                  buffer_after = $5
              where tenant_slug = $1 and id = $2
            `,
            [
              tenantSlug,
              consultant.id,
              numberOr(item.intervalMinutes, 60),
              numberOr(item.bufferBeforeMinutes, 0),
              numberOr(item.bufferAfterMinutes, 0),
            ],
          );
        }
        await client.query(
          `
            insert into availability_rules (
              tenant_slug, consultant_id, kind, day_of_week, date_value, start_time, end_time
            )
            values ($1,$2,$3,$4,$5,$6,$7)
          `,
          [
            tenantSlug,
            consultant.id,
            clean(item.kind) || (item.dateValue ? 'specific' : 'weekly'),
            item.dayOfWeek === null || item.dayOfWeek === undefined ? null : numberOr(item.dayOfWeek, null),
            item.dateValue || null,
            clean(item.startTime),
            clean(item.endTime),
          ],
        );
        count += 1;
      }
    });
    return { success: true, stage, count };
  }

  if (stage === 'appointments' || stage === 'rejected' || stage === 'waitlist') {
    let count = 0;
    await transaction(async (client) => {
      const projectNameMap = await getProjectNameMap(client, tenantSlug);
      const consultants = await getConsultantMaps(client, tenantSlug);
      for (const item of items) {
        const projectCode = clean(item.projectCode) || projectCodeFor(item.projectName, projectNameMap);
        const consultant = consultants.byName.get(clean(item.consultantName)) || null;
        const startAt = dateOrNull(item.startAt);
        const endAt = startAt ? new Date(startAt.getTime() + 60 * 60 * 1000) : null;
        const createdAt = dateOrNull(item.createdAt) || new Date();
        if (stage === 'appointments') {
          await client.query(
            `
              insert into appointments (
                tenant_slug, project_code, project_name, consultant_id, consultant_name,
                calendar_id, event_id, meet_link, start_at, end_at, client_name,
                client_email, client_phone, answers, status,
                attendance, deal_status, plan, notes, created_at
              )
              values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
            `,
            [
              tenantSlug,
              projectCode,
              clean(item.projectName),
              consultant?.id || null,
              consultant?.name || clean(item.consultantName),
              clean(item.calendarId) || '',
              clean(item.eventId),
              clean(item.meetLink),
              startAt,
              endAt,
              clean(item.clientName),
              clean(item.email),
              clean(item.phone),
              clean(item.answers),
              clean(item.status) || 'booked',
              clean(item.attendance),
              clean(item.dealStatus),
              clean(item.plan),
              clean(item.notes),
              createdAt,
            ],
          );
        } else {
          const table = stage === 'rejected' ? 'rejected_clients' : 'waitlist_clients';
          await client.query(
            `
              insert into ${table} (
                tenant_slug, project_code, project_name, client_name, client_email, client_phone,
                answers, status, created_at
              )
              values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            `,
            [
              tenantSlug,
              projectCode,
              clean(item.projectName),
              clean(item.clientName),
              clean(item.email),
              clean(item.phone),
              clean(item.answers),
              clean(item.status) || (stage === 'rejected' ? 'rejected' : 'waiting'),
              createdAt,
            ],
          );
        }
        count += 1;
      }
    });
    return { success: true, stage, count };
  }

  if (stage === 'emailTemplates') {
    let count = 0;
    const tenantName = clean(payload.tenantName) || 'DM Chen';
    await transaction(async (client) => {
      for (const item of items) {
        const projectCode = clean(item.projectCode).toUpperCase();
        if (!projectCode || !clean(item.name)) continue;
        await client.query(
          `
            insert into email_templates (
              tenant_slug, project_code, name, trigger_name, time_param, subject,
              body, sender_name, status, stop_when_booked
            )
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          `,
          [
            tenantSlug,
            projectCode,
            clean(item.name),
            clean(item.triggerType) || 'booking_created',
            numberOr(item.offsetHours, 0),
            clean(item.subject),
            clean(item.body),
            clean(item.senderName) || tenantName,
            boolFromChinese(item.status) ? 'active' : 'inactive',
            item.stopWhenBooked !== false,
          ],
        );
        count += 1;
      }
    });
    return { success: true, stage, count };
  }

  if (stage === 'leads') {
    let count = 0;
    await transaction(async (client) => {
      const projectNameMap = await getProjectNameMap(client, tenantSlug);
      for (const item of items) {
        const projectCode = clean(item.projectCode).toUpperCase();
        if (!projectCode || !clean(item.email)) continue;
        await client.query(
          `
            insert into leads (
              tenant_slug, project_code, project_name, client_name, client_email, client_phone,
              answers, status, created_at
            )
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            on conflict (tenant_slug, project_code, client_email) do update set
              project_name = excluded.project_name,
              client_name = excluded.client_name,
              client_phone = excluded.client_phone,
              answers = excluded.answers,
              status = excluded.status,
              updated_at = now()
          `,
          [
            tenantSlug,
            projectCode,
            projectNameMap.get(projectCode) || clean(item.projectName),
            clean(item.clientName),
            clean(item.email),
            clean(item.phone),
            clean(item.answers),
            clean(item.status) || 'pending',
            dateOrNull(item.createdAt) || new Date(),
          ],
        );
        count += 1;
      }
    });
    return { success: true, stage, count };
  }

  throw Object.assign(new Error(`未知匯入階段：${stage}`), { status: 400 });
}

module.exports = {
  importLegacyData,
};


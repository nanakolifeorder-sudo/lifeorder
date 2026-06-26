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

function normalizeTenant(slug) {
  const value = String(slug || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(value)) {
    throw new Error('租戶代碼只能使用小寫英文、數字、連字號，長度 2-49。');
  }
  return value;
}

function normalizeProject(code) {
  return String(code || 'P01').trim().toUpperCase();
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
  const result = await query(
    `select slug, name, owner_name, owner_email, app_base_url from tenants where slug = $1 limit 1`,
    [tenant]
  );
  return result.rows[0] || null;
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
       values($1, 'DMtest 租戶管理員', 'tenant-admin@dmtest.test', $2, 'primary',
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
      { role: 'tenant_admin', name: 'DMtest 租戶管理員', email: 'tenant-admin@dmtest.test', password: '1111' },
      { role: 'consultant', name: 'DMtest 顧問', email: 'consultant@dmtest.test', password: '1111' }
    ]
  };
}

async function verifyLogin(payload, tenant) {
  const user = await login(tenant, payload.email, payload.password);
  const role = user ? roleOf(user) : '';
  const tenantInfo = user ? await tenantBySlug(tenant) : null;
  if (!user) return { success: false, message: '帳號或密碼不正確。' };
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
  const result = await query(
    `select id, code, name, status, main_url, fallback_url, booking_notice, reject_type, reject_value
       from projects
      where tenant_slug = $1
      order by id asc`,
    [tenant]
  );
  return {
    success: true,
    systemBaseUrl: `${appUrl()}/booking?tenant=${tenant}`,
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
      bookingUrl: `${appUrl()}/booking?tenant=${tenant}&p=${row.code}`
    }))
  };
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
      `select id, name, login_email, calendar_id, google_email, accepting, weight, permissions,
              project_codes, meet_tool, time_zone, interval_minutes, buffer_before, buffer_after,
              min_days, max_days, google_refresh_token
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

async function saveConsultantData(payload, tenant) {
  const passwordHash = payload.password ? await hashPassword(payload.password) : null;
  const projectCodes = parseProjectCodes(payload.projects || payload.projectCodes);
  if (payload.rowId || payload.id) {
    const id = payload.rowId || payload.id;
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
          projectCodes, payload.meetTool || 'Google Meet', payload.shiftTZ || payload.timeZone || 'Asia/Taipei'
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
          projectCodes, payload.meetTool || 'Google Meet', payload.shiftTZ || payload.timeZone || 'Asia/Taipei'
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
        projectCodes, payload.meetTool || 'Google Meet', payload.shiftTZ || payload.timeZone || 'Asia/Taipei'
      ]
    );
  }
  return { success: true };
}

async function getGoogleConnectUrl(payload, tenant) {
  const consultantId = payload.consultantId || payload.rowId;
  if (!consultantId) throw new Error('缺少 consultantId。');
  const returnTo = payload.returnTo || `${appUrl()}/admin?tenant=${tenant}`;
  return { success: true, url: googleAuthUrl({ tenant, consultantId, returnTo }) };
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
    googleConnected: Boolean(consultant.google_refresh_token),
    googleEmail: consultant.google_email || '',
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
              time_zone = $8
        where tenant_slug = $1 and id = $2`,
      [
        tenant,
        consultantId,
        Number(settings.interval || 60),
        Number(settings.bufferBefore || 0),
        Number(settings.bufferAfter || 0),
        Number(settings.minDays || 1),
        Number(settings.maxDays || 14),
        payload.shiftTZ || payload.timeZone || 'Asia/Taipei'
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

async function getAvailableTimes(payload, tenant) {
  const projectCode = normalizeProject(payload.projectCode);
  const project = await projectByCode(tenant, projectCode);
  if (!project || !isActiveStatus(project.status)) return [];

  const consultants = await query(
    `select * from consultants
      where tenant_slug = $1 and accepting = true and google_refresh_token is not null`,
    [tenant]
  );
  const eligible = consultants.rows.filter(c => projectMatches(c, projectCode));
  if (!eligible.length) return [];

  const available = new Map();
  const now = new Date();

  for (const consultant of eligible) {
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
      busyEvents = await calendarEvents({
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

async function submitBooking(payload, tenant) {
  const projectCode = normalizeProject(payload.projectCode);
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
  if (!consultant || !consultant.google_refresh_token) throw new Error('顧問尚未連接 Google Calendar。');

  const slotStart = new Date(timestamp);
  const slotEnd = new Date(timestamp + 60 * 60000);
  const eventTitle = `【${project.name}】${payload.name}`;
  const description = [
    `聯絡電話：${payload.phone || ''}`,
    `Email：${payload.email || ''}`,
    '',
    '【客戶填答狀況】',
    payload.answers || ''
  ].join('\n');

  const event = await createCalendarEvent({
    encryptedRefreshToken: consultant.google_refresh_token,
    calendarId: consultant.calendar_id || 'primary',
    event: {
      summary: eventTitle,
      description,
      start: { dateTime: slotStart.toISOString(), timeZone: consultant.time_zone || 'Asia/Taipei' },
      end: { dateTime: slotEnd.toISOString(), timeZone: consultant.time_zone || 'Asia/Taipei' },
      attendees: payload.email ? [{ email: payload.email }] : [],
      conferenceData: {
        createRequest: {
          requestId: `meet_${tenant}_${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' }
        }
      }
    }
  });

  const meetLink = event.hangoutLink ||
    (event.conferenceData?.entryPoints || []).find(item => item.entryPointType === 'video')?.uri || '';

  const appointmentResult = await query(
    `insert into appointments(
       tenant_slug, project_code, project_name, consultant_id, consultant_name,
       calendar_id, event_id, meet_link, start_at, end_at,
       client_name, client_email, client_phone, answers, status
     )
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'待開會')
     returning id`,
    [
      tenant,
      projectCode,
      project.name,
      consultant.id,
      consultant.name,
      consultant.calendar_id || 'primary',
      event.id,
      meetLink,
      slotStart,
      slotEnd,
      payload.name,
      payload.email,
      payload.phone || '',
      payload.answers || ''
    ]
  );
  const appointmentId = appointmentResult.rows[0]?.id;
  const lead = await upsertLeadRecord(Object.assign({}, payload, { projectCode }), tenant, 'booked', appointmentId);
  await cancelLeadFollowups({ tenant, projectCode, clientEmail: payload.email });
  await queueTriggeredEmails({
    tenant,
    projectCode,
    triggerName: 'booking_created',
    lead,
    appointmentId,
    appointment: {
      time: slotStart.toISOString(),
      meetLink,
      consultant: consultant.name
    }
  });

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

function renderEmailText(templateText, data) {
  const values = {
    name: data.clientName || '',
    email: data.clientEmail || '',
    phone: data.clientPhone || '',
    project: data.projectName || data.projectCode || '',
    time: data.time || '',
    meetLink: data.meetLink || '',
    consultant: data.consultant || ''
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
    '顧問': 'consultant'
  };
  return String(templateText || '').replace(
    /\{\{\s*(name|email|phone|project|time|meetLink|consultant|客戶姓名|姓名|客戶Email|Email|客戶電話|電話|專案名稱|預約時間|會議連結|顧問姓名|顧問)\s*\}\}/g,
    (_match, key) => values[aliases[key] || key] || ''
  );
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
  return result.rows[0];
}

async function cancelLeadFollowups({ tenant, projectCode, clientEmail }) {
  await query(
    `update email_queue
        set status = 'cancelled', cancelled_at = now()
      where tenant_slug = $1
        and project_code = $2
        and client_email = $3
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
    const delayHours = Math.max(0, Number(template.time_param || 0));
    const scheduledAt = new Date(Date.now() + delayHours * 60 * 60 * 1000);
    const data = {
      clientName: lead.client_name,
      clientEmail: lead.client_email,
      clientPhone: lead.client_phone,
      projectCode: lead.project_code,
      projectName: lead.project_name,
      time: appointment.time || '',
      meetLink: appointment.meetLink || '',
      consultant: appointment.consultant || ''
    };
    await query(
      `insert into email_queue(
         tenant_slug, project_code, lead_id, appointment_id, template_id,
         trigger_name, client_name, client_email, subject, body, sender_name,
         scheduled_at, stop_when_booked, status
       )
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'queued')`,
      [
        tenant,
        normalizeProject(projectCode),
        lead.id,
        appointmentId,
        template.id,
        triggerName,
        lead.client_name,
        lead.client_email,
        renderEmailText(template.subject, data),
        renderEmailText(template.body, data),
        template.sender_name || '',
        scheduledAt,
        template.stop_when_booked !== false
      ]
    );
    queued += 1;
  }
  return { queued };
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

async function getSenderConsultant(tenant) {
  const result = await query(
    `select *
       from consultants
      where tenant_slug = $1
        and google_refresh_token is not null
        and (permissions in ('TENANT_ADMIN', 'ALL') or lower(login_email) = lower($2))
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

  const summary = { scanned: result.rows.length, sent: 0, cancelled: 0, failed: 0 };
  for (const item of result.rows) {
    try {
      if (item.stop_when_booked && item.trigger_name === 'lead_created') {
        const booked = await query(
          `select id
             from appointments
            where tenant_slug = $1
              and project_code = $2
              and lower(client_email) = lower($3)
              and status <> '已取消'
            limit 1`,
          [item.tenant_slug, item.project_code, item.client_email]
        );
        if (booked.rows[0]) {
          await query(
            `update email_queue set status = 'cancelled', cancelled_at = now()
              where id = $1`,
            [item.id]
          );
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
      summary.sent += 1;
    } catch (error) {
      await query(
        `update email_queue
            set status = 'error', error_message = $2
          where id = $1`,
        [item.id, error.message || String(error)]
      );
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
  const [projects, templates, leads, queue] = await Promise.all([
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
    )
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
    queue: queue.rows
  };
}

async function saveEmailTemplate(payload, tenant) {
  const projectCode = normalizeProject(payload.projectCode);
  const triggerName = payload.triggerName || 'lead_created';
  const status = payload.status || 'active';
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
        payload.body || '',
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
        payload.body || '',
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

  const [rejected, waitlist, leads] = tenantWide
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
        `select id, project_code, project_name, client_name, client_email, client_phone, answers, status, created_at, updated_at
           from leads
          where tenant_slug = $1${clientProjectClause}
          order by updated_at desc
          limit 200`,
        clientProjectParams
      )
    ])
    : [{ rows: [] }, { rows: [] }, { rows: [] }];

  const consultants = await query(`select id, name from consultants where tenant_slug = $1 order by name`, [tenant]);
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

  return {
    success: true,
    data: appointmentRows,
    rejected: rejectedRows,
    waitlist: waitlistRows,
    leads: leads.rows,
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
        set attendance = $3, deal_status = $4, plan = $5, notes = $6
      where tenant_slug = $1 and id = $2`,
    [tenant, payload.rowId, payload.attendance || '', payload.dealStatus || '', payload.plan || '', payload.notes || '']
  );
  return { success: true };
}

async function handleAppointmentAction(payload, tenant, user) {
  if (payload.actionType !== 'cancel') {
    return { success: false, message: '這個 SaaS 初版目前已支援取消；改期/轉派會在下一階段接上。' };
  }
  const result = await query(
    `select a.*, c.google_refresh_token
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
  if (row.google_refresh_token && row.event_id) {
    await deleteCalendarEvent({
      encryptedRefreshToken: row.google_refresh_token,
      calendarId: row.calendar_id || 'primary',
      eventId: row.event_id
    });
  }
  await query(`update appointments set status = '已取消' where tenant_slug = $1 and id = $2`, [tenant, payload.rowId]);
  return { success: true, message: '已取消預約並同步 Google Calendar。' };
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

async function getOwnerScopeData(_payload, tenant, user) {
  if (!isSystemOwner(user)) {
    throw new Error('只有最高權限系統管理員可以切換使用者');
  }
  const [tenants, projects] = await Promise.all([
    query(
      `select slug, name, owner_name, owner_email, created_at
         from tenants
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

async function routeAction(action, payload, req, tenant) {
  switch (action) {
    case 'initializeSystem':
    case 'initializeTenant':
      return initializeTenant(payload);
    case 'verifyLogin':
      return verifyLogin(payload, tenant);
    case 'getQuestions':
      return getQuestions(payload, tenant);
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
    default:
      break;
  }

  const user = await requireUser(req, payload);
  if (user.tenant_slug !== tenant && !isSystemOwner(user)) throw new Error('此帳號不能查看其他租戶資料。');

  const tenantAdminOnlyActions = new Set([
    'getAdminConsultantData',
    'saveConsultantData',
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
    getAnalyticsData: 'ANALYTICS',
    getEmailAutomationData: 'EMAILS',
    saveEmailTemplate: 'EMAILS',
    runEmailQueue: 'EMAILS'
  };
  if (featureActions[action] && !hasPermission(user, featureActions[action])) {
    throw new Error('此帳號尚未開通這個後台功能。');
  }

  if (action === 'getGoogleConnectUrl') {
    const consultantId = Number(payload.consultantId || payload.rowId);
    if (!isAdmin(user) && consultantId !== Number(user.id)) {
      throw new Error('你只能連接自己的 Google Calendar。');
    }
  }

  switch (action) {
    case 'getOwnerScopeData':
      return getOwnerScopeData(payload, tenant, user);
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
    case 'getAdminConsultantData':
      return getAdminConsultantData(payload, tenant);
    case 'saveConsultantData':
      return saveConsultantData(payload, tenant);
    case 'getGoogleConnectUrl':
      return getGoogleConnectUrl(payload, tenant);
    case 'getConsultantScheduleData':
      return getConsultantScheduleData(payload, tenant, user);
    case 'saveConsultantWeeklyAndSettings':
      return saveConsultantWeeklyAndSettings(payload, tenant, user);
    case 'getConsultantAppointments':
      return getConsultantAppointments(payload, tenant, user);
    case 'updateCRMRecord':
      return updateCRMRecord(payload, tenant, user);
    case 'handleAppointmentAction':
      return handleAppointmentAction(payload, tenant, user);
    case 'getAnalyticsData':
      return getAnalyticsData(payload, tenant);
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

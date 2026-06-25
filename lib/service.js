const { query, transaction } = require('./db');
const { hashPassword, login, signSession, requireUser, isAdmin } = require('./auth');
const {
  googleAuthUrl,
  calendarEvents,
  createCalendarEvent,
  deleteCalendarEvent
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
const { appUrl, ownerName, ownerEmail } = require('./config');

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

async function projectByCode(tenant, projectCode) {
  const result = await query(
    `select * from projects where tenant_slug = $1 and code = $2 limit 1`,
    [tenant, normalizeProject(projectCode)]
  );
  return result.rows[0];
}

async function initializeTenant(payload) {
  const installerSecret = process.env.INSTALLER_SECRET || '';
  if (installerSecret && payload.installerSecret !== installerSecret) {
    throw new Error('安裝密鑰不正確。');
  }

  const tenant = normalizeTenant(payload.tenant || payload.tenantSlug);
  const password = payload.adminPwd || payload.password;
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
       values($1, $2, $3, $4, 'primary', true, 1, 'ALL', array['ALL']::text[], 'Google Meet', 'Asia/Taipei')
       on conflict(tenant_slug, login_email) do update
       set name = excluded.name,
           password_hash = excluded.password_hash,
           permissions = 'ALL',
           project_codes = array['ALL']::text[]`,
      [tenant, adminName, adminEmail, passwordHash]
    );
  });

  return {
    success: true,
    tenant,
    adminUrl: `${appUrl()}/admin?tenant=${tenant}`,
    bookingUrl: `${appUrl()}/booking?tenant=${tenant}&p=P01`
  };
}

async function verifyLogin(payload, tenant) {
  const user = await login(tenant, payload.email, payload.password);
  if (!user) return { success: false, message: '帳號或密碼不正確。' };
  return {
    success: true,
    name: user.name,
    email: user.login_email,
    isAdmin: user.permissions === 'ALL',
    permissions: user.permissions || '',
    authToken: signSession(user)
  };
}

async function getQuestions(payload, tenant) {
  const projectCode = normalizeProject(payload.projectCode);
  const project = await projectByCode(tenant, projectCode);
  if (!project || project.status !== '啟用') {
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
          Number(payload.weight || 50), payload.sysRole || payload.permissions || '',
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
          Number(payload.weight || 50), payload.sysRole || payload.permissions || '',
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
        Number(payload.weight || 50), payload.sysRole || payload.permissions || '',
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
  if (!project || project.status !== '啟用') return [];

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

  await query(
    `insert into appointments(
       tenant_slug, project_code, project_name, consultant_id, consultant_name,
       calendar_id, event_id, meet_link, start_at, end_at,
       client_name, client_email, client_phone, answers, status
     )
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'待開會')`,
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
  return { success: true };
}

async function logPageView(payload, tenant) {
  await query(
    `insert into page_views(tenant_slug, project_code) values($1,$2)`,
    [tenant, normalizeProject(payload.projectCode)]
  );
  return { success: true };
}

async function getConsultantAppointments(payload, tenant, user) {
  const admin = isAdmin(user);
  const params = [tenant];
  let where = `where a.tenant_slug = $1`;
  if (!admin) {
    params.push(user.id);
    where += ` and a.consultant_id = $2`;
  }
  const result = await query(
    `select a.*
       from appointments a
       ${where}
      order by a.start_at desc nulls last, a.created_at desc
      limit 300`,
    params
  );
  const consultants = await query(`select id, name from consultants where tenant_slug = $1 order by name`, [tenant]);
  const projects = await query(`select code, name from projects where tenant_slug = $1 order by code`, [tenant]);
  return {
    success: true,
    data: result.rows.map(row => ({
      rowId: row.id,
      projectName: row.project_name,
      meetTime: row.start_at ? new Date(row.start_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }) : '',
      timeObj: row.start_at ? new Date(row.start_at).getTime() : 0,
      clientName: row.client_name,
      clientEmail: row.client_email,
      clientPhone: row.client_phone,
      answers: row.answers,
      status: row.status,
      eventId: row.event_id,
      consultant: row.consultant_name,
      meetLink: row.meet_link || '',
      attendance: row.attendance || '',
      dealStatus: row.deal_status || '',
      plan: row.plan || '',
      notes: row.notes || ''
    })),
    isAdmin: admin,
    permissions: user.permissions || '',
    allConsultants: consultants.rows,
    allProjects: projects.rows
  };
}

async function updateCRMRecord(payload, tenant) {
  await query(
    `update appointments
        set attendance = $3, deal_status = $4, plan = $5, notes = $6
      where tenant_slug = $1 and id = $2`,
    [tenant, payload.rowId, payload.attendance || '', payload.dealStatus || '', payload.plan || '', payload.notes || '']
  );
  return { success: true };
}

async function handleAppointmentAction(payload, tenant) {
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
    default:
      break;
  }

  const user = await requireUser(req, payload);
  if (user.tenant_slug !== tenant) throw new Error('租戶不一致，請重新登入。');

  const adminActions = new Set([
    'getAdminQuestions',
    'saveAdminQuestions',
    'getAdminProjectData',
    'saveProjectData',
    'getAdminConsultantData',
    'saveConsultantData',
    'getAnalyticsData'
  ]);
  if (adminActions.has(action) && !isAdmin(user)) {
    throw new Error('你的帳號沒有管理權限。');
  }

  if (action === 'getGoogleConnectUrl') {
    const consultantId = Number(payload.consultantId || payload.rowId);
    if (!isAdmin(user) && consultantId !== Number(user.id)) {
      throw new Error('你只能連接自己的 Google Calendar。');
    }
  }

  switch (action) {
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
      return updateCRMRecord(payload, tenant);
    case 'handleAppointmentAction':
      return handleAppointmentAction(payload, tenant);
    case 'getAnalyticsData':
      return getAnalyticsData(payload, tenant);
    case 'me':
      return { success: true, user };
    default:
      throw new Error(`未知 API action: ${action}`);
  }
}

module.exports = {
  initializeTenant,
  routeAction,
  normalizeTenant
};

const { query, transaction } = require('./db');
const { appUrl } = require('./config');

function normalizeProject(code) {
  return String(code || 'P01').trim().toUpperCase();
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isEmailLimitedQuizVersion(versionCode, version) {
  const code = String(versionCode || '').trim().toUpperCase();
  const text = [code, version?.name, version?.description]
    .map(value => String(value || '').toLowerCase())
    .join(' ');
  if (['A', 'FREE', 'TRIAL', 'SIMPLE'].includes(code)) return false;
  if (/(免費|簡易|free|trial|simple)/i.test(text)) return false;
  return /(980|付費|完整版|完整|paid|full|premium|pro)/i.test(text) || ['B', 'PAID', 'FULL', 'PRO', 'PREMIUM'].includes(code);
}
function isFullQuizVersion(versionCode, version) {
  return isEmailLimitedQuizVersion(versionCode, version);
}

const AGE_GROUPS = [
  { key: "under_35", label: "35歲以下", aliases: ["35以下", "35歲以下", "34以下", "29歲以下", "30-34", "30–34", "under35", "under_35"] },
  { key: "35_45", label: "35-45歲", aliases: ["35-45", "35–45", "35-44", "35–44", "35_45"] },
  { key: "45_55", label: "45-55歲", aliases: ["45-55", "45–55", "45-54", "45–54", "45_55"] },
  { key: "55_65", label: "55-65歲", aliases: ["55-65", "55–65", "55-64", "55–64", "55_65"] },
  { key: "65_75", label: "65-75歲", aliases: ["65-75", "65–75", "65-74", "65–74", "65_75"] },
  { key: "75_plus", label: "75歲以上", aliases: ["75以上", "75歲以上", "75+", "75_plus", "70歲以上", "70以上"] }
];

function normalizeAgeGroup(value) {
  const text = String(value || "").trim().toLowerCase().replace(/歲/g, "").replace(/\s+/g, "");
  if (!text) return "";
  for (const group of AGE_GROUPS) {
    if (group.key === text || group.aliases.some(alias => text.includes(String(alias).toLowerCase().replace(/歲/g, "").replace(/\s+/g, "")))) return group.key;
  }
  const numeric = Number((text.match(/\d+/) || [])[0] || 0);
  if (!numeric) return "";
  if (numeric < 35) return "under_35";
  if (numeric < 45) return "35_45";
  if (numeric < 55) return "45_55";
  if (numeric < 65) return "55_65";
  if (numeric < 75) return "65_75";
  return "75_plus";
}

function ageGroupLabel(key) {
  return AGE_GROUPS.find(group => group.key === key)?.label || "";
}

function extractDemographics(answerRows) {
  const result = { ageGroup: "", ageGroupLabel: "", identity: "" };
  for (const row of answerRows || []) {
    const title = String(row.question?.title || "");
    const stage = String(row.question?.stage_key || row.question?.stageKey || "").toLowerCase();
    const settings = row.question?.settings || {};
    const key = String(settings.demographicKey || settings.profileKey || "").toLowerCase();
    if (!result.ageGroup && (key === "age" || key === "age_group" || stage.includes("profile") || title.includes("年齡"))) {
      result.ageGroup = normalizeAgeGroup(row.answerText || row.value);
      result.ageGroupLabel = ageGroupLabel(result.ageGroup);
    }
    if (!result.identity && (key === "identity" || key === "work_identity" || title.includes("身份") || title.includes("工作"))) {
      result.identity = String(row.answerText || row.value || "").trim().slice(0, 120);
    }
  }
  return result;
}

function isMissingSchemaError(error) {
  const message = String(error?.message || '');
  return error?.code === '42P01' || error?.code === '42703' || message.includes('does not exist');
}

async function safeQuery(text, params = []) {
  try {
    return await query(text, params);
  } catch (error) {
    if (isMissingSchemaError(error)) return { rows: [] };
    throw error;
  }
}

function normalizeAccessCode(value) {
  return String(value || '').trim().toUpperCase();
}

async function resolveQuizAccessCode({ tenant, projectCode, versionCode, code, clientEmail }) {
  const normalizedCode = normalizeAccessCode(code);
  if (!normalizedCode) return null;
  const result = await safeQuery(
    `select *
       from quiz_access_codes
      where tenant_slug = $1
        and project_code = $2
        and coalesce(version_code, '') = coalesce($3, '')
        and code_normalized = $4
        and status not in ('停用', 'disabled', 'deleted')
      limit 1`,
    [tenant, projectCode, versionCode || '', normalizedCode]
  );
  const accessCode = result.rows[0];
  if (!accessCode) throw new Error('折扣碼或重測碼不存在，請確認後再送出。');
  const now = Date.now();
  if (accessCode.starts_at && new Date(accessCode.starts_at).getTime() > now) throw new Error('這組代碼尚未開始使用。');
  if (accessCode.ends_at && new Date(accessCode.ends_at).getTime() < now) throw new Error('這組代碼已經過期。');
  if (accessCode.max_uses !== null && accessCode.max_uses !== undefined && Number(accessCode.used_count || 0) >= Number(accessCode.max_uses)) throw new Error('這組代碼已達使用次數上限。');
  const emailUses = await safeQuery(
    `select count(*)::int as count
       from quiz_access_code_usages
      where tenant_slug = $1 and access_code_id = $2 and client_email_normalized = lower($3)`,
    [tenant, accessCode.id, clientEmail]
  );
  if (Number(emailUses.rows[0]?.count || 0) >= Number(accessCode.per_email_limit || 1)) throw new Error('這組代碼已經被這個 Email 使用過。');
  return accessCode;
}
function isActiveStatus(value) {
  const text = String(value || '').trim().toLowerCase();
  return !text || ['active', 'enabled', '啟用'].includes(text);
}

function lifecycleStageForStatus(status, appointmentId = null) {
  const value = String(status || '').trim().toLowerCase();
  if (appointmentId || ['booked', '已預約'].includes(value)) return 'booked';
  if (['waitlist', '等候名單'].includes(value)) return 'waitlist';
  if (['rejected', '已婉拒'].includes(value)) return 'rejected';
  if (['cancelled', 'canceled', '已取消'].includes(value)) return 'cancelled';
  if (['quiz_completed', '測驗完成'].includes(value)) return 'quiz_completed';
  return 'lead';
}
const REPORT_ORDER_TITLES = {
  external: '外在秩序',
  internal: '內在秩序',
  continuity: '延續秩序'
};
const REPORT_ORDER_PRIORITY = ['continuity', 'external', 'internal'];

function reportScoreLevel(score) {
  const value = Number(score || 0);
  if (value >= 70) return '穩定成熟';
  if (value >= 40) return '部分穩定';
  return '需要補強';
}

function buildReportContext(displayScores, displayMaxScores) {
  const keys = Object.keys(displayScores || {}).filter(key => Number.isFinite(Number(displayScores[key])));
  const levels = {};
  keys.forEach(key => { levels[key] = reportScoreLevel(displayScores[key]); });
  let minScore = null;
  keys.forEach(key => {
    const score = Number(displayScores[key]);
    if (minScore === null || score < minScore) minScore = score;
  });
  const tied = keys.filter(key => Number(displayScores[key]) === Number(minScore));
  const mainOrder = REPORT_ORDER_PRIORITY.find(key => tied.includes(key)) || tied[0] || '';
  return {
    levels,
    mainOrder,
    mainOrderTitle: REPORT_ORDER_TITLES[mainOrder] || mainOrder,
    mainOrderScore: mainOrder ? Number(displayScores[mainOrder] || 0) : null,
    mainOrderMaxScore: mainOrder ? Number((displayMaxScores || {})[mainOrder] || 0) : null,
    mainOrderLevel: mainOrder ? levels[mainOrder] || '' : ''
  };
}

function reportTemplateVars(scoreSummary = {}) {
  const scores = scoreSummary.display_scores || scoreSummary.scores || {};
  const levels = scoreSummary.levels || {};
  return {
    external_score: scores.external ?? '',
    internal_score: scores.internal ?? '',
    continuity_score: scores.continuity ?? '',
    external_level: levels.external || '',
    internal_level: levels.internal || '',
    continuity_level: levels.continuity || '',
    main_order: scoreSummary.main_order_title || scoreSummary.main_order || '',
    main_order_title: scoreSummary.main_order_title || '',
    main_order_score: scoreSummary.main_order_score ?? '',
    main_order_level: scoreSummary.main_order_level || '',
    daily_scenario_copy: scoreSummary.daily_scenario_copy || ""
  };
}

function applyReportTemplates(value, vars) {
  if (typeof value === 'string') {
    return value.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => String(vars[key] ?? ''));
  }
  if (Array.isArray(value)) return value.map(item => applyReportTemplates(item, vars));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, applyReportTemplates(item, vars)]));
  }
  return value;
}

function reportBlockVisible(block, scoreSummary = {}) {
  const rule = block.visibilityRule || block.visibility_rule || {};
  if (!rule || typeof rule !== 'object' || !Object.keys(rule).length) return true;
  const mainOrder = scoreSummary.main_order || '';
  if (rule.mainOrder && String(rule.mainOrder) !== String(mainOrder)) return false;
  if (rule.main_order && String(rule.main_order) !== String(mainOrder)) return false;
  if (rule.level && String(rule.level) !== String(scoreSummary.main_order_level || '')) return false;
  if (rule.dimensionKey && !Object.prototype.hasOwnProperty.call(scoreSummary.display_scores || scoreSummary.scores || {}, rule.dimensionKey)) return false;
  if (rule.rangeKey) {
    const dimensionKey = rule.dimensionKey || rule.dimension_key || mainOrder;
    if (String((scoreSummary.matched_ranges || {})[dimensionKey] || '') !== String(rule.rangeKey)) return false;
  }
  return true;
}

function prepareReportBlock(block, scoreSummary = {}) {
  const vars = reportTemplateVars(scoreSummary);
  const prepared = {
    blockKey: block.block_key || block.blockKey,
    blockType: block.block_type || block.blockType,
    title: block.title || '',
    content: block.content || {},
    visibilityRule: block.visibility_rule || block.visibilityRule || {},
    sortOrder: block.sort_order || block.sortOrder
  };
  return applyReportTemplates(prepared, vars);
}

async function projectByCode(tenant, projectCode) {
  const result = await query(
    `select * from projects where tenant_slug = $1 and code = $2 limit 1`,
    [tenant, normalizeProject(projectCode)]
  );
  return result.rows[0] || null;
}

async function upsertCrmContact(payload, tenant, options = {}) {
  const projectCode = normalizeProject(payload.projectCode || payload.project_code);
  const email = normalizeEmail(payload.email || payload.clientEmail || payload.client_email);
  if (!email) return null;
  const result = await safeQuery(
    `insert into crm_contacts(
       tenant_slug, project_code, name, email, phone, lifecycle_stage,
       latest_quiz_response_id, latest_appointment_id, assigned_consultant_id,
       source, updated_at
     )
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
     on conflict(tenant_slug, project_code, email_normalized) do update
     set name = coalesce(nullif(excluded.name, ''), crm_contacts.name),
         phone = coalesce(nullif(excluded.phone, ''), crm_contacts.phone),
         lifecycle_stage = case
           when excluded.lifecycle_stage in ('booked', 'completed') then excluded.lifecycle_stage
           when crm_contacts.lifecycle_stage in ('booked', 'completed') then crm_contacts.lifecycle_stage
           else excluded.lifecycle_stage
         end,
         latest_quiz_response_id = coalesce(excluded.latest_quiz_response_id, crm_contacts.latest_quiz_response_id),
         latest_appointment_id = coalesce(excluded.latest_appointment_id, crm_contacts.latest_appointment_id),
         assigned_consultant_id = coalesce(excluded.assigned_consultant_id, crm_contacts.assigned_consultant_id),
         source = coalesce(nullif(excluded.source, ''), crm_contacts.source),
         updated_at = now()
     returning *`,
    [
      tenant,
      projectCode,
      payload.name || payload.clientName || payload.client_name || '',
      email,
      payload.phone || payload.clientPhone || payload.client_phone || '',
      options.lifecycleStage || lifecycleStageForStatus(options.status || payload.status, options.appointmentId),
      options.quizResponseId || null,
      options.appointmentId || null,
      options.consultantId || null,
      options.source || payload.source || ''
    ]
  );
  return result.rows[0] || null;
}

async function attachLeadToCrmContact(lead, contact, options = {}) {
  if (!lead?.id || !contact?.id) return;
  await safeQuery(
    `update leads
        set crm_contact_id = $3,
            lifecycle_stage = $4,
            latest_quiz_response_id = coalesce($5, latest_quiz_response_id)
      where tenant_slug = $1 and id = $2`,
    [
      lead.tenant_slug,
      lead.id,
      contact.id,
      contact.lifecycle_stage || lifecycleStageForStatus(options.status || lead.status, options.appointmentId || lead.booked_appointment_id),
      options.quizResponseId || null
    ]
  );
}

async function recordTimelineEvent(event) {
  if (!event?.tenant || !event?.projectCode || !event?.eventType || !event?.title) return null;
  let crmContactId = event.crmContactId || null;
  if (!crmContactId && event.clientEmail) {
    const contact = await upsertCrmContact({
      projectCode: event.projectCode,
      name: event.clientName || '',
      email: event.clientEmail,
      phone: event.clientPhone || ''
    }, event.tenant, { source: event.source || 'timeline' });
    crmContactId = contact?.id || null;
  }
  const result = await safeQuery(
    `insert into crm_timeline_events(
       tenant_slug, project_code, crm_contact_id, lead_id, quiz_response_id,
       appointment_id, email_queue_id, actor_consultant_id, event_type,
       title, body, metadata, occurred_at
     )
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,coalesce($13::timestamptz, now()))
     returning id`,
    [
      event.tenant,
      normalizeProject(event.projectCode),
      crmContactId,
      event.leadId || null,
      event.quizResponseId || null,
      event.appointmentId || null,
      event.emailQueueId || null,
      event.actorConsultantId || null,
      event.eventType,
      event.title,
      event.body || '',
      JSON.stringify(event.metadata || {}),
      event.occurredAt || null
    ]
  );
  return result.rows[0] || null;
}

async function syncLead(lead, payload, tenant, status = 'pending', options = {}) {
  const contact = await upsertCrmContact(payload, tenant, {
    status,
    appointmentId: options.appointmentId || null,
    quizResponseId: options.quizResponseId || null,
    consultantId: options.consultantId || null,
    source: options.source || payload.source || 'lead'
  });
  await attachLeadToCrmContact(lead, contact, { status, appointmentId: options.appointmentId, quizResponseId: options.quizResponseId });
  if (status === 'pending') {
    await recordTimelineEvent({
      tenant,
      projectCode: payload.projectCode,
      crmContactId: contact?.id,
      leadId: lead?.id,
      eventType: 'lead_created',
      title: '名單建立',
      body: payload.answers || '',
      metadata: { source: options.source || payload.source || 'lead' }
    });
  }
  return contact;
}

async function syncAppointmentBooked({ tenant, projectCode, lead, contactPayload, appointmentId, consultantId, quizResponseId, isReschedule = false }) {
  const contact = await upsertCrmContact(contactPayload, tenant, {
    status: 'booked',
    appointmentId,
    quizResponseId,
    consultantId,
    source: quizResponseId ? 'quiz_booking' : 'booking'
  });
  await attachLeadToCrmContact(lead, contact, { status: 'booked', appointmentId, quizResponseId });
  await safeQuery(
    `update appointments
        set crm_contact_id = $3,
            lead_id = coalesce($4, lead_id),
            quiz_response_id = coalesce($5, quiz_response_id),
            meeting_tool = coalesce(nullif(meeting_tool, ''), calendar_provider, ''),
            meeting_url = coalesce(nullif(meeting_url, ''), meet_link, ''),
            booking_source = coalesce(nullif(booking_source, ''), $6),
            updated_at = now()
      where tenant_slug = $1 and id = $2`,
    [tenant, appointmentId, contact?.id || null, lead?.id || null, quizResponseId || null, quizResponseId ? 'quiz_report' : 'booking']
  );
  if (quizResponseId) {
    await safeQuery(
      `update quiz_responses
          set appointment_id = $3,
              crm_contact_id = coalesce(crm_contact_id, $4),
              lead_id = coalesce(lead_id, $5)
        where tenant_slug = $1 and id = $2`,
      [tenant, quizResponseId, appointmentId, contact?.id || null, lead?.id || null]
    );
  }
  await recordTimelineEvent({
    tenant,
    projectCode,
    crmContactId: contact?.id,
    leadId: lead?.id,
    quizResponseId,
    appointmentId,
    actorConsultantId: consultantId,
    eventType: isReschedule ? 'booking_rescheduled' : 'booking_created',
    title: isReschedule ? '預約改期' : '預約建立'
  });
  return contact;
}

async function syncClientStatus({ tenant, projectCode, lead, payload, status, eventType, title, body = '' }) {
  const contact = await syncLead(lead, payload, tenant, status, { source: eventType });
  await recordTimelineEvent({
    tenant,
    projectCode,
    crmContactId: contact?.id,
    leadId: lead?.id,
    eventType,
    title,
    body,
    metadata: { status }
  });
  return contact;
}

async function resolveQuizResponseId(tenant, payload) {
  const explicitId = Number(payload.quizResponseId || payload.quiz_response_id || 0);
  if (explicitId) return explicitId;
  const publicId = payload.quizResultId || payload.qrid || payload.resultId || payload.quiz_response_public_id;
  if (!publicId) return null;
  const result = await safeQuery(
    `select id from quiz_responses where tenant_slug = $1 and public_id = $2::uuid limit 1`,
    [tenant, publicId]
  );
  return result.rows[0]?.id || null;
}

async function getQuizConfig(payload, tenant) {
  const projectCode = normalizeProject(payload.projectCode);
  const project = await projectByCode(tenant, projectCode);
  if (!project || !isActiveStatus(project.status)) return { success: false, message: '這個測驗頁目前未啟用。' };
  const versionCode = String(payload.versionCode || payload.version || project.default_quiz_version_code || 'A').trim() || 'A';
  const [version, stages, questions, options, dimensions, settings] = await Promise.all([
    safeQuery(
      `select version_code, name, description, status
         from quiz_versions
        where tenant_slug = $1 and project_code = $2 and version_code = $3
        limit 1`,
      [tenant, projectCode, versionCode]
    ),
    safeQuery(
      `select stage_key, title, description, sort_order
         from quiz_stages
        where tenant_slug = $1 and project_code = $2 and version_code = $3 and status not in ('停用', 'disabled', 'deleted')
        order by sort_order asc, id asc`,
      [tenant, projectCode, versionCode]
    ),
    safeQuery(
      `select id, stage_key, question_no, title, help_text, type, is_required, sort_order, settings
         from quiz_questions
        where tenant_slug = $1 and project_code = $2 and version_code = $3 and status not in ('停用', 'disabled', 'deleted')
        order by sort_order asc, question_no asc, id asc`,
      [tenant, projectCode, versionCode]
    ),
    safeQuery(
      `select id, question_id, option_key, label, description, sort_order
         from quiz_question_options
        where tenant_slug = $1 and status not in ('停用', 'disabled', 'deleted')
        order by sort_order asc, id asc`,
      [tenant]
    ),
    safeQuery(
      `select dimension_key, name, description, max_score, display_max_score, display_score_format, rounding_mode, chart_type, sort_order
         from quiz_score_dimensions
        where tenant_slug = $1 and project_code = $2 and version_code = $3 and status not in ('停用', 'disabled', 'deleted')
        order by sort_order asc, id asc`,
      [tenant, projectCode, versionCode]
    ),
    safeQuery(
      `select title, subtitle, show_chart, show_score_cards, show_score_table, booking_cta_label, booking_cta_url, settings
         from quiz_result_settings
        where tenant_slug = $1 and project_code = $2 and version_code = $3 and status not in ('停用', 'disabled', 'deleted')
        limit 1`,
      [tenant, projectCode, versionCode]
    )
  ]);
  if (!version.rows[0] && !questions.rows.length) return { success: false, message: '尚未設定這個測驗版本。' };
  const optionsByQuestion = new Map();
  options.rows.forEach(option => {
    if (!optionsByQuestion.has(option.question_id)) optionsByQuestion.set(option.question_id, []);
    optionsByQuestion.get(option.question_id).push({
      id: option.id,
      key: option.option_key,
      label: option.label,
      description: option.description || ''
    });
  });
  return {
    success: true,
    tenant,
    projectCode,
    projectName: project.name,
    versionCode,
    version: version.rows[0] || { version_code: versionCode, name: versionCode },
    stages: stages.rows,
    dimensions: dimensions.rows,
    resultSettings: settings.rows[0] || {},
    questions: questions.rows.map(question => ({
      id: question.id,
      stageKey: question.stage_key,
      questionNo: question.question_no,
      title: question.title,
      helpText: question.help_text || '',
      type: question.type,
      isRequired: question.is_required,
      settings: question.settings || {},
      options: optionsByQuestion.get(question.id) || []
    }))
  };
}

function answerForQuestion(rawAnswers, question) {
  const keys = [question.id, String(question.id), question.question_no, String(question.question_no), `q${question.question_no}`];
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(rawAnswers, key)) return rawAnswers[key];
  }
  return undefined;
}

function selectedOptionKeys(value) {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
  if (value && typeof value === 'object') {
    if (Array.isArray(value.options)) return selectedOptionKeys(value.options);
    if (Array.isArray(value.selected)) return selectedOptionKeys(value.selected);
    if (value.optionKey) return [String(value.optionKey).trim()].filter(Boolean);
    if (value.value) return selectedOptionKeys(value.value);
  }
  const text = String(value ?? '').trim();
  return text ? [text] : [];
}

function normalizedAnswerKeys(value) {
  return selectedOptionKeys(value).map(item => String(item || '').trim().toLowerCase()).filter(Boolean);
}

function optionMatchesAnswer(option, answerKeys) {
  if (!answerKeys.length) return false;
  return [option.option_key, option.id, option.label]
    .map(value => String(value ?? '').trim().toLowerCase())
    .filter(Boolean)
    .some(value => answerKeys.includes(value));
}

function addScoreDelta(scores, delta) {
  Object.entries(delta || {}).forEach(([key, value]) => {
    const cleanKey = String(key || '').trim();
    const amount = Number(value || 0);
    if (!cleanKey || Number.isNaN(amount)) return;
    scores[cleanKey] = Number((Number(scores[cleanKey] || 0) + amount).toFixed(2));
  });
}

async function buildQuizScoreAndAnswers({ tenant, projectCode, versionCode, responseId, rawAnswers }) {
  const [questions, options, dimensions, ranges, blocks, settings, versionInfo] = await Promise.all([
    query(
      `select * from quiz_questions
        where tenant_slug = $1 and project_code = $2 and version_code = $3 and status not in ('停用', 'disabled', 'deleted')
        order by sort_order asc, question_no asc, id asc`,
      [tenant, projectCode, versionCode]
    ),
    query(
      `select * from quiz_question_options
        where tenant_slug = $1 and status not in ('停用', 'disabled', 'deleted')
        order by sort_order asc, id asc`,
      [tenant]
    ),
    query(
      `select * from quiz_score_dimensions
        where tenant_slug = $1 and project_code = $2 and version_code = $3 and status not in ('停用', 'disabled', 'deleted')
        order by sort_order asc, id asc`,
      [tenant, projectCode, versionCode]
    ),
    query(
      `select * from quiz_score_ranges
        where tenant_slug = $1 and project_code = $2 and version_code = $3 and status not in ('停用', 'disabled', 'deleted')
        order by sort_order asc, id asc`,
      [tenant, projectCode, versionCode]
    ),
    query(
      `select * from quiz_report_blocks
        where tenant_slug = $1 and project_code = $2 and version_code = $3 and status not in ('停用', 'disabled', 'deleted') and is_visible = true
        order by sort_order asc, id asc`,
      [tenant, projectCode, versionCode]
    ),
    query(
      `select * from quiz_result_settings
        where tenant_slug = $1 and project_code = $2 and version_code = $3 and status not in ('停用', 'disabled', 'deleted')
        limit 1`,
      [tenant, projectCode, versionCode]
    )
    ,
    safeQuery(
      `select version_code, name, description, status
         from quiz_versions
        where tenant_slug = $1 and project_code = $2 and version_code = $3
        limit 1`,
      [tenant, projectCode, versionCode]
    )
  ]);
  const optionsByQuestion = new Map();
  options.rows.forEach(option => {
    if (!optionsByQuestion.has(option.question_id)) optionsByQuestion.set(option.question_id, []);
    optionsByQuestion.get(option.question_id).push(option);
  });
  const scores = {};
  dimensions.rows.forEach(item => { scores[item.dimension_key] = 0; });
  const answerRows = [];
  for (const question of questions.rows) {
    const value = answerForQuestion(rawAnswers, question);
    const keys = selectedOptionKeys(value);
    const answerKeys = normalizedAnswerKeys(value);
    const qOptions = optionsByQuestion.get(question.id) || [];
    const selectedOptions = qOptions.filter(option => optionMatchesAnswer(option, answerKeys));
    const scoreDelta = {};
    selectedOptions.forEach(option => addScoreDelta(scoreDelta, option.score_weights || {}));
    addScoreDelta(scores, scoreDelta);
    const answerText = question.type === 'short_text' || question.type === 'long_text'
      ? String(value ?? '')
      : selectedOptions.map(option => option.label).join('、');
    answerRows.push({ question, selectedOptions, keys, value, answerText, scoreDelta });
  }
  const versionRow = versionInfo.rows[0] || { version_code: versionCode };
  const isFullReport = isFullQuizVersion(versionCode, versionRow);
  const demographics = extractDemographics(answerRows);
  const ageContents = isFullReport && demographics.ageGroup ? await safeQuery(
    `select age_group, dimension_key, title, body, action_text, sort_order, status
       from quiz_age_dimension_contents
      where tenant_slug = $1 and project_code = $2 and version_code = $3 and age_group = $4 and status not in ('停用', 'disabled', 'deleted')
      order by sort_order asc, id asc`,
    [tenant, projectCode, versionCode, demographics.ageGroup]
  ) : { rows: [] };
  const ageContentByDimension = new Map();
  ageContents.rows.forEach(row => { ageContentByDimension.set(row.dimension_key, row); });

  for (const row of answerRows) {
    await query(
      `insert into quiz_response_answers(
         tenant_slug, quiz_response_id, question_id, question_no, stage_key,
         question_title, question_type, selected_option_ids, selected_option_keys,
         answer_text, answer_json, score_delta
       )
       values($1,$2,$3,$4,$5,$6,$7,$8::bigint[],$9::text[],$10,$11::jsonb,$12::jsonb)`,
      [
        tenant,
        responseId,
        row.question.id,
        row.question.question_no,
        row.question.stage_key || '',
        row.question.title,
        row.question.type,
        row.selectedOptions.map(option => option.id),
        row.selectedOptions.map(option => option.option_key),
        row.answerText,
        JSON.stringify(row.value === undefined ? null : row.value),
        JSON.stringify(row.scoreDelta)
      ]
    );
  }
  const maxScores = {};
  dimensions.rows.forEach(item => { maxScores[item.dimension_key] = Number(item.max_score || 0); });
  const matchedRanges = {};
  const matchedContent = [];
  dimensions.rows.forEach(dimension => {
    const score = Number(scores[dimension.dimension_key] || 0);
    const maxScore = Number(dimension.max_score || 0);
    const scoreForRange = maxScore > 0 ? Math.min(score, maxScore) : score;
    const matched = ranges.rows.find(range => range.dimension_key === dimension.dimension_key && scoreForRange >= Number(range.min_score) && scoreForRange <= Number(range.max_score));
    if (!matched) return;
    matchedRanges[dimension.dimension_key] = matched.range_key;
    matchedContent.push({
      dimensionKey: dimension.dimension_key,
      dimensionName: dimension.name,
      score: scoreForRange,
      rawScore: score,
      rangeKey: matched.range_key,
      label: matched.label,
      title: matched.title,
      subtitle: matched.subtitle,
      body: matched.body,
      imageUrl: matched.image_url,
      ctaLabel: matched.cta_label,
      ctaUrl: matched.cta_url,
      ageContent: ageContentByDimension.has(dimension.dimension_key) ? {
        ageGroup: demographics.ageGroup,
        ageGroupLabel: demographics.ageGroupLabel,
        title: ageContentByDimension.get(dimension.dimension_key).title || "",
        body: ageContentByDimension.get(dimension.dimension_key).body || "",
        actionText: ageContentByDimension.get(dimension.dimension_key).action_text || ""
      } : null
    });
  });
  const scoreDimensions = dimensions.rows.map(item => ({
    key: item.dimension_key,
    name: item.name || item.dimension_key,
    description: item.description || '',
    maxScore: Number(item.max_score || 0),
    displayMaxScore: item.display_max_score === null || item.display_max_score === undefined ? null : Number(item.display_max_score || 0),
    displayScoreFormat: item.display_score_format || 'number',
    roundingMode: item.rounding_mode || 'round',
    chartType: item.chart_type || 'radar',
    sortOrder: Number(item.sort_order || 0)
  }));
  const displayScores = {};
  const displayMaxScores = {};
  scoreDimensions.forEach(item => {
    const rawMax = Number(item.maxScore || 0);
    const displayMax = item.displayMaxScore === null || item.displayMaxScore === undefined ? rawMax : Number(item.displayMaxScore || 0);
    const rawScore = Number(scores[item.key] || 0);
    const scoreForDisplay = rawMax > 0 ? Math.min(rawScore, rawMax) : rawScore;
    const converted = rawMax > 0 && displayMax > 0 ? (scoreForDisplay / rawMax) * displayMax : scoreForDisplay;
    const rounding = item.roundingMode || 'round';
    displayScores[item.key] = rounding === 'floor' ? Math.floor(converted) : rounding === 'ceil' ? Math.ceil(converted) : rounding === 'none' ? Number(converted.toFixed(2)) : Math.round(converted);
    displayMaxScores[item.key] = displayMax;
  });
  const reportContext = buildReportContext(displayScores, displayMaxScores);
  const scoreSummary = {
    scores,
    max_scores: maxScores,
    display_scores: displayScores,
    display_max_scores: displayMaxScores,
    matched_ranges: matchedRanges,
    dimensions: scoreDimensions,
    levels: reportContext.levels,
    main_order: reportContext.mainOrder,
    main_order_title: reportContext.mainOrderTitle,
    main_order_score: reportContext.mainOrderScore,
    main_order_max_score: reportContext.mainOrderMaxScore,
    main_order_level: reportContext.mainOrderLevel,
    daily_scenario_copy: '',
    demographics,
    is_full_report: isFullReport
  };
  const visibleBlocks = blocks.rows
    .map(block => prepareReportBlock(block, scoreSummary))
    .filter(block => reportBlockVisible(block, scoreSummary));
  const reportSnapshot = {
    version_code: versionCode,
    score_summary: scoreSummary,
    result_settings: settings.rows[0] || {},
    matched_content: matchedContent,
    blocks: visibleBlocks,
    generated_at: new Date().toISOString()
  };
  await query(
    `update quiz_responses set score_summary = $3::jsonb, report_snapshot = $4::jsonb where tenant_slug = $1 and id = $2`,
    [tenant, responseId, JSON.stringify(scoreSummary), JSON.stringify(reportSnapshot)]
  );
  return { scoreSummary, reportSnapshot };
}

async function queueQuizEmails({ tenant, projectCode, lead, contact, quizResponse, reportUrl }) {
  if (!lead?.id) return;
  const triggers = ['quiz_completed', 'quiz_followup', 'quiz_completed_unbooked'];
  for (const triggerName of triggers) {
    const templates = await safeQuery(
      `select * from email_templates
        where tenant_slug = $1 and project_code = $2 and trigger_name = $3 and status not in ('停用', 'disabled', 'deleted')
        order by time_param asc, id asc`,
      [tenant, projectCode, triggerName]
    );
    for (const template of templates.rows) {
      const unit = String(template.delay_unit || 'hours').toLowerCase();
      const amount = Math.max(0, Number(template.time_param || 0));
      const multiplier = unit === 'minutes' ? 60 * 1000 : unit === 'days' ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
      const subject = String(template.subject || '')
        .replace(/\{\{\s*(name|姓名|客戶姓名)\s*\}\}/g, lead.client_name || '')
        .replace(/\{\{\s*(email|Email)\s*\}\}/g, lead.client_email || '')
        .replace(/\{\{\s*(phone|電話)\s*\}\}/g, lead.client_phone || '')
        .replace(/\{\{\s*(project|專案名稱)\s*\}\}/g, lead.project_name || projectCode);
      const body = String(template.body || '')
        .replace(/\{\{\s*(name|姓名|客戶姓名)\s*\}\}/g, lead.client_name || '')
        .replace(/\{\{\s*(email|Email)\s*\}\}/g, lead.client_email || '')
        .replace(/\{\{\s*(phone|電話)\s*\}\}/g, lead.client_phone || '')
        .replace(/\{\{\s*(quizResultUrl|reportUrl|檢測報告連結)\s*\}\}/g, reportUrl)
        .replace(/\{\{\s*(project|專案名稱)\s*\}\}/g, lead.project_name || projectCode);
      const inserted = await safeQuery(
        `insert into email_queue(
           tenant_slug, project_code, lead_id, crm_contact_id, quiz_response_id, template_id,
           trigger_name, client_name, client_email, subject, body, sender_name,
           scheduled_at, stop_when_booked, module, cancellation_policy, status
         )
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'quiz','stop_when_booked','queued')
         returning id`,
        [
          tenant,
          projectCode,
          lead.id,
          contact?.id || null,
          quizResponse.id,
          template.id,
          triggerName,
          lead.client_name,
          lead.client_email,
          subject,
          body,
          template.sender_name || '',
          new Date(Date.now() + amount * multiplier),
          template.stop_when_booked !== false
        ]
      );
      await recordTimelineEvent({
        tenant,
        projectCode,
        crmContactId: contact?.id,
        leadId: lead.id,
        quizResponseId: quizResponse.id,
        emailQueueId: inserted.rows[0]?.id,
        eventType: 'email_queued',
        title: '測驗跟進信排入佇列',
        body: subject,
        metadata: { triggerName, templateId: template.id }
      });
    }
  }
}

async function submitQuiz(payload, tenant) {
  const projectCode = normalizeProject(payload.projectCode);
  const project = await projectByCode(tenant, projectCode);
  if (!project || !isActiveStatus(project.status)) return { success: false, message: '這個測驗頁目前未啟用。' };
  const versionCode = String(payload.versionCode || payload.version || project.default_quiz_version_code || 'A').trim() || 'A';
  const clientName = payload.name || payload.clientName || '';
  const clientEmail = normalizeEmail(payload.email || payload.clientEmail);
  const clientPhone = payload.phone || payload.clientPhone || '';
  if (!clientEmail || !clientEmail.includes('@')) throw new Error('請輸入正確的 Email。');
  const versionResult = await safeQuery(
    `select version_code, name, description
       from quiz_versions
      where tenant_slug = $1 and project_code = $2 and version_code = $3
      limit 1`,
    [tenant, projectCode, versionCode]
  );
  const emailLimited = isEmailLimitedQuizVersion(versionCode, versionResult.rows[0]);
  const existingResponse = emailLimited ? await safeQuery(
    `select id, public_id, submitted_at
       from quiz_responses
      where tenant_slug = $1
        and project_code = $2
        and version_code = $3
        and client_email_normalized = lower($4)
        and status = 'completed'
      order by submitted_at desc, id desc
      limit 1`,
    [tenant, projectCode, versionCode, clientEmail]
  ) : { rows: [] };
  const previousResponse = existingResponse.rows[0] || null;
  const accessCode = previousResponse
    ? await resolveQuizAccessCode({ tenant, projectCode, versionCode, code: payload.accessCode || payload.couponCode || payload.retakeCode, clientEmail })
    : null;
  if (previousResponse && !accessCode) {
    return {
      success: false,
      code: 'QUIZ_ALREADY_COMPLETED',
      message: '這個 Email 已經完成過本次檢測。若需要再次作答，請輸入折扣碼或重測碼。',
      existingResultId: previousResponse.public_id,
      existingReportUrl: `${appUrl()}/report?tenant=${encodeURIComponent(tenant)}&p=${encodeURIComponent(projectCode)}&qrid=${encodeURIComponent(previousResponse.public_id)}`
    };
  }
  const rawAnswers = payload.answers && typeof payload.answers === 'object' ? payload.answers : {};
  const contact = await upsertCrmContact({ projectCode, name: clientName, email: clientEmail, phone: clientPhone }, tenant, {
    lifecycleStage: 'quiz_completed',
    source: 'quiz'
  });
  const leadResult = await query(
    `insert into leads(
       tenant_slug, project_code, project_name, client_name, client_email,
       client_phone, answers, status, updated_at
     )
     values($1,$2,$3,$4,$5,$6,$7,'pending',now())
     on conflict(tenant_slug, project_code, client_email) do update
     set project_name = excluded.project_name,
         client_name = excluded.client_name,
         client_phone = excluded.client_phone,
         answers = excluded.answers,
         status = case when leads.status = 'booked' then leads.status else 'pending' end,
         updated_at = now()
     returning *`,
    [tenant, projectCode, project.name, clientName, clientEmail, clientPhone, JSON.stringify(rawAnswers)]
  );
  const lead = leadResult.rows[0];
  await attachLeadToCrmContact(lead, contact);
  const responseResult = await query(
    `insert into quiz_responses(
       tenant_slug, project_code, version_code, crm_contact_id, lead_id,
       access_code_id, retake_of_response_id, client_name, client_email, client_phone, raw_answers, status
     )
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,'completed')
     returning *`,
    [tenant, projectCode, versionCode, contact?.id || null, lead.id, accessCode?.id || null, previousResponse?.id || null, clientName, clientEmail, clientPhone, JSON.stringify(rawAnswers)]
  );
  const quizResponse = responseResult.rows[0];
  if (accessCode?.id) {
    await safeQuery(
      `insert into quiz_access_code_usages(
         tenant_slug, access_code_id, project_code, version_code, quiz_response_id,
         client_email, code, usage_type, metadata
       ) values($1,$2,$3,$4,$5,$6,$7,'quiz_retake',$8::jsonb)`,
      [tenant, accessCode.id, projectCode, versionCode, quizResponse.id, clientEmail, accessCode.code, JSON.stringify({ retakeOfResponseId: previousResponse?.id || null })]
    );
    await safeQuery(
      `update quiz_access_codes set used_count = used_count + 1, updated_at = now() where tenant_slug = $1 and id = $2`,
      [tenant, accessCode.id]
    );
  }
  const { scoreSummary, reportSnapshot } = await buildQuizScoreAndAnswers({ tenant, projectCode, versionCode, responseId: quizResponse.id, rawAnswers });
  await upsertCrmContact({ projectCode, name: clientName, email: clientEmail, phone: clientPhone }, tenant, {
    lifecycleStage: 'quiz_completed',
    quizResponseId: quizResponse.id,
    source: 'quiz'
  });
  await safeQuery(
    `update leads set latest_quiz_response_id = $3, lifecycle_stage = 'quiz_completed' where tenant_slug = $1 and id = $2`,
    [tenant, lead.id, quizResponse.id]
  );
  const reportUrl = `${appUrl()}/report?tenant=${encodeURIComponent(tenant)}&p=${encodeURIComponent(projectCode)}&qrid=${encodeURIComponent(quizResponse.public_id)}`;
  await recordTimelineEvent({
    tenant,
    projectCode,
    crmContactId: contact?.id,
    leadId: lead.id,
    quizResponseId: quizResponse.id,
    eventType: 'quiz_completed',
    title: '測驗完成',
    metadata: { versionCode, reportUrl, accessCode: accessCode?.code || '', retakeOfResponseId: previousResponse?.id || null }
  });
  await queueQuizEmails({ tenant, projectCode, lead: Object.assign({}, lead, { crm_contact_id: contact?.id }), contact, quizResponse, reportUrl });
  return {
    success: true,
    resultId: quizResponse.public_id,
    quizResponseId: quizResponse.id,
    reportUrl,
    scoreSummary,
    reportSnapshot
  };
}

async function getQuizResult(payload, tenant) {
  const resultId = payload.quizResultId || payload.qrid || payload.resultId || payload.rid;
  if (!resultId) throw new Error('缺少測驗結果 ID。');
  const result = await query(
    `select * from quiz_responses where tenant_slug = $1 and public_id = $2::uuid limit 1`,
    [tenant, resultId]
  );
  const row = result.rows[0];
  if (!row) return { success: false, message: '找不到測驗結果。' };
  await recordTimelineEvent({
    tenant,
    projectCode: row.project_code,
    crmContactId: row.crm_contact_id,
    leadId: row.lead_id,
    quizResponseId: row.id,
    eventType: 'quiz_report_viewed',
    title: '查看檢測報告'
  });
  return {
    success: true,
    resultId: row.public_id,
    projectCode: row.project_code,
    versionCode: row.version_code,
    clientName: row.client_name,
    clientEmail: row.client_email,
    clientPhone: row.client_phone,
    scoreSummary: row.score_summary || {},
    reportSnapshot: row.report_snapshot || {},
    submittedAt: row.submitted_at
  };
}

function crmReportUrl(tenant, projectCode, publicId) {
  if (!publicId) return '';
  return `${appUrl()}/report?tenant=${encodeURIComponent(tenant)}&p=${encodeURIComponent(projectCode || 'P01')}&qrid=${encodeURIComponent(publicId)}`;
}

function crmScoreItems(scoreSummary) {
  const summary = scoreSummary && typeof scoreSummary === 'object' ? scoreSummary : {};
  const scores = summary.scores || {};
  const maxScores = summary.max_scores || {};
  const displayScores = summary.display_scores || {};
  const displayMaxScores = summary.display_max_scores || {};
  const dimensions = Array.isArray(summary.dimensions) ? summary.dimensions : [];
  const keys = dimensions.length ? dimensions.map(item => item.key) : Object.keys(scores);
  return keys.filter(Boolean).map(key => {
    const dim = dimensions.find(item => item.key === key) || {};
    const rawScore = Number(scores[key] || 0);
    const rawMax = Number(dim.maxScore || maxScores[key] || 0);
    const displayScore = displayScores[key] === undefined ? rawScore : displayScores[key];
    const displayMax = displayMaxScores[key] === undefined ? rawMax : displayMaxScores[key];
    return { key, name: dim.name || key, description: dim.description || '', rawScore, rawMax, displayScore, displayMax, rangeKey: (summary.matched_ranges || {})[key] || '', pct: rawMax > 0 ? Math.max(0, Math.min(1, rawScore / rawMax)) : 0 };
  });
}

function crmTimelineCategory(eventType) {
  const type = String(eventType || '').toLowerCase();
  if (type.includes('email')) return 'email';
  if (type.includes('link') || type.includes('click')) return 'click';
  if (type.includes('booking') || type.includes('appointment') || type.includes('reschedule') || type.includes('cancel')) return 'booking';
  if (type.includes('quiz') || type.includes('report')) return 'quiz';
  return 'note';
}

function crmTimelineEvent(row) {
  return { id: row.id, type: row.event_type, category: crmTimelineCategory(row.event_type), title: row.title || '', body: row.body || '', metadata: row.metadata || {}, occurredAt: row.occurred_at, createdAt: row.created_at, leadId: row.lead_id, quizResponseId: row.quiz_response_id, appointmentId: row.appointment_id, emailQueueId: row.email_queue_id, actorConsultantId: row.actor_consultant_id };
}

function crmEmailEvent(row) {
  return { id: row.id, triggerName: row.trigger_name || '', module: row.module || '', subject: row.subject || '', status: row.status || '', scheduledAt: row.scheduled_at, sentAt: row.sent_at, cancelledAt: row.cancelled_at, errorMessage: row.error_message || '', createdAt: row.created_at, quizResponseId: row.quiz_response_id, appointmentId: row.appointment_id };
}

function crmAppointmentEvent(row) {
  return { id: row.id, consultantId: row.consultant_id, consultantName: row.consultant_name || '', startAt: row.start_at, endAt: row.end_at, meetLink: row.meet_link || '', meetingTool: row.meeting_tool || '', meetingUrl: row.meeting_url || '', status: row.status || '', attendance: row.attendance || '', dealStatus: row.deal_status || '', plan: row.plan || '', notes: row.notes || '', createdAt: row.created_at };
}

function crmQuizHistoryItem(row, tenant) {
  const snapshot = row.report_snapshot || {};
  const summary = row.score_summary || snapshot.score_summary || {};
  return { id: row.id, resultId: row.public_id, reportUrl: crmReportUrl(tenant, row.project_code, row.public_id), projectCode: row.project_code, versionCode: row.version_code, status: row.status || '', submittedAt: row.submitted_at, scoreSummary: summary, scoreItems: crmScoreItems(summary), matchedContent: snapshot.matched_content || [], resultSettings: snapshot.result_settings || {}, reportBlocks: snapshot.blocks || [] };
}

async function getCRMContactDetail(payload, tenant) {
  const contactId = Number(payload.contactId || payload.crmContactId || 0);
  const email = normalizeEmail(payload.email || payload.clientEmail);
  const projectCode = normalizeProject(payload.projectCode || 'P01');
  const contactResult = contactId
    ? await safeQuery(`select * from crm_contacts where tenant_slug = $1 and id = $2 and coalesce(status, '') not in ('deleted', '刪除') limit 1`, [tenant, contactId])
    : await safeQuery(
        `select * from crm_contacts
          where tenant_slug = $1 and project_code = $2 and email_normalized = lower($3)
            and coalesce(status, '') not in ('deleted', '刪除')
          limit 1`,
        [tenant, projectCode, email]
      );
  const contact = contactResult.rows[0];
  if (!contact) return { success: false, message: '找不到客戶資料。' };
  const [quizResponses, quizAnswers, appointments, emails, timeline] = await Promise.all([
    safeQuery(
      `select id, public_id, project_code, version_code, score_summary, report_snapshot, status, submitted_at
         from quiz_responses
        where tenant_slug = $1 and crm_contact_id = $2
        order by submitted_at desc, id desc
        limit 20`,
      [tenant, contact.id]
    ),
    safeQuery(
      `select a.*
         from quiz_response_answers a
         join quiz_responses r on r.id = a.quiz_response_id
        where r.tenant_slug = $1 and r.crm_contact_id = $2
        order by r.submitted_at desc, a.question_no asc, a.id asc
        limit 500`,
      [tenant, contact.id]
    ),
    safeQuery(
      `select id, consultant_id, consultant_name, start_at, end_at, meet_link, meeting_tool,
              meeting_url, status, attendance, deal_status, plan, notes, created_at
         from appointments
        where tenant_slug = $1 and crm_contact_id = $2
        order by start_at desc nulls last, created_at desc
        limit 50`,
      [tenant, contact.id]
    ),
    safeQuery(
      `select id, trigger_name, module, appointment_id, quiz_response_id, subject, scheduled_at, sent_at, cancelled_at, status, error_message, created_at
         from email_queue
        where tenant_slug = $1 and crm_contact_id = $2
        order by created_at desc
        limit 100`,
      [tenant, contact.id]
    ),
    safeQuery(
      `select id, event_type, title, body, metadata, occurred_at, created_at,
              lead_id, quiz_response_id, appointment_id, email_queue_id, actor_consultant_id
         from crm_timeline_events
        where tenant_slug = $1 and crm_contact_id = $2
        order by occurred_at desc, id desc
        limit 200`,
      [tenant, contact.id]
    )
  ]);
  const answersByResponse = {};
  quizAnswers.rows.forEach(row => {
    const key = String(row.quiz_response_id);
    if (!answersByResponse[key]) answersByResponse[key] = [];
    answersByResponse[key].push({
      id: row.id,
      quizResponseId: row.quiz_response_id,
      questionId: row.question_id,
      questionNo: row.question_no,
      stageKey: row.stage_key || '',
      questionTitle: row.question_title || '',
      questionType: row.question_type || '',
      selectedOptionIds: row.selected_option_ids || [],
      selectedOptionKeys: row.selected_option_keys || [],
      answerText: row.answer_text || '',
      answerJson: row.answer_json || {},
      scoreDelta: row.score_delta || {},
      createdAt: row.created_at
    });
  });
  const quizHistory = quizResponses.rows.map(row => crmQuizHistoryItem(row, tenant));
  const normalizedTimeline = timeline.rows.map(crmTimelineEvent);
  const emailHistory = emails.rows.map(crmEmailEvent);
  const appointmentHistory = appointments.rows.map(crmAppointmentEvent);
  const clickEvents = normalizedTimeline.filter(item => item.category === 'click' || ['booking_cta_click', 'external_link_click'].includes(item.type));
  const latestQuiz = quizHistory[0] || null;
  const latestAppointment = appointmentHistory[0] || null;
  const crmSummary = {
    contactId: contact.id,
    projectCode: contact.project_code,
    lifecycleStage: contact.lifecycle_stage,
    quizCount: quizHistory.length,
    appointmentCount: appointmentHistory.length,
    emailCount: emailHistory.length,
    timelineCount: normalizedTimeline.length,
    clickCount: clickEvents.length,
    bookingCtaClicks: clickEvents.filter(item => item.type === 'booking_cta_click').length,
    externalLinkClicks: clickEvents.filter(item => item.type === 'external_link_click').length,
    reportViews: normalizedTimeline.filter(item => item.type === 'quiz_report_viewed').length,
    emailQueued: emailHistory.filter(item => item.status === 'queued').length,
    emailSent: emailHistory.filter(item => item.status === 'sent').length,
    emailCancelled: emailHistory.filter(item => item.status === 'cancelled').length,
    emailFailed: emailHistory.filter(item => item.status === 'failed').length,
    latestQuizAt: latestQuiz?.submittedAt || null,
    latestAppointmentAt: latestAppointment?.startAt || null,
    latestReportUrl: latestQuiz?.reportUrl || ''
  };
  return {
    success: true,
    contact,
    crmSummary,
    latestQuiz,
    latestAppointment,
    quizHistory,
    answersByResponse,
    appointmentHistory,
    emailHistory,
    clickEvents,
    normalizedTimeline,
    quizResponses: quizResponses.rows,
    quizAnswers: quizAnswers.rows,
    appointments: appointments.rows,
    emails: emails.rows,
    timeline: timeline.rows
  };
}
function normalizeReportVersion(value) {
  return String(value || 'A').trim().toUpperCase() || 'A';
}

function normalizeReportBlockType(value) {
  const type = String(value || '').trim().toLowerCase();
  const allowed = new Set(['heading', 'text', 'list', 'image', 'score_chart', 'score_table', 'button', 'link', 'booking_cta', 'score_range_content']);
  return allowed.has(type) ? type : 'text';
}

function normalizeReportBlockContent(type, content) {
  const raw = content && typeof content === 'object' ? content : {};
  if (type === 'heading') return { text: String(raw.text || '').slice(0, 240) };
  if (type === 'text') return { text: String(raw.text || '').slice(0, 8000) };
  if (type === 'list') return { items: Array.isArray(raw.items) ? raw.items.map(item => String(item || '').slice(0, 240)).filter(Boolean).slice(0, 30) : [] };
  if (type === 'image') return { url: String(raw.url || '').slice(0, 1200), alt: String(raw.alt || '').slice(0, 240) };
  if (type === 'score_chart') return { chartType: ['radar', 'bar'].includes(String(raw.chartType || '').toLowerCase()) ? String(raw.chartType || '').toLowerCase() : 'radar' };
  if (type === 'score_table') return { title: String(raw.title || '').slice(0, 240) };
  if (type === 'button' || type === 'link') return {
    label: String(raw.label || '').slice(0, 80),
    url: String(raw.url || '').slice(0, 1200),
    appendParams: raw.appendParams === true,
    appendFields: Array.isArray(raw.appendFields) ? raw.appendFields.filter(item => ['tenant', 'p', 'qrid', 'name', 'email'].includes(item)).slice(0, 5) : []
  };
  if (type === 'booking_cta') return {
    label: String(raw.label || '預約一對一諮詢').slice(0, 80),
    urlMode: raw.urlMode === 'custom' ? 'custom' : 'system',
    url: String(raw.url || '').slice(0, 1200),
    appendParams: raw.appendParams === true,
    appendFields: Array.isArray(raw.appendFields) ? raw.appendFields.filter(item => ['tenant', 'p', 'qrid', 'name', 'email'].includes(item)).slice(0, 5) : []
  };
  if (type === 'score_range_content') return { title: String(raw.title || '').slice(0, 240) };
  return {};
}

async function trackReportClick(payload, tenant, req = {}) {
  const publicId = payload.quizResultId || payload.qrid || payload.resultId;
  if (!publicId) return { success: false, message: '缺少測驗結果 ID。' };
  const result = await safeQuery(
    `select id, public_id, tenant_slug, project_code, version_code, crm_contact_id, lead_id, client_name, client_email, client_phone
       from quiz_responses
      where tenant_slug = $1 and public_id = $2::uuid
      limit 1`,
    [tenant, publicId]
  );
  const row = result.rows[0];
  if (!row) return { success: false, message: '找不到測驗結果。' };
  const blockType = normalizeReportBlockType(payload.blockType || payload.block_type || 'link');
  const blockKey = String(payload.blockKey || payload.block_key || '').slice(0, 80);
  const label = String(payload.label || payload.linkLabel || '').slice(0, 160);
  const targetUrl = String(payload.targetUrl || payload.url || '').slice(0, 1600);
  const clickType = blockType === 'booking_cta' ? 'booking_cta_click' : 'external_link_click';
  await recordTimelineEvent({
    tenant,
    projectCode: row.project_code,
    crmContactId: row.crm_contact_id,
    leadId: row.lead_id,
    quizResponseId: row.id,
    eventType: clickType,
    title: blockType === 'booking_cta' ? '點擊預約 CTA' : '點擊報告連結',
    body: label || targetUrl || blockKey,
    metadata: {
      blockKey,
      blockType,
      label,
      targetUrl,
      pageType: 'quiz_report',
      userAgent: String(req.headers?.['user-agent'] || '').slice(0, 500),
      referrer: String(req.headers?.referer || req.headers?.referrer || '').slice(0, 1200),
      ip: String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim().slice(0, 80)
    }
  });
  return { success: true };
}

async function getQuizReportEditor(payload, tenant) {
  const projectCode = normalizeProject(payload.projectCode);
  const versionCode = normalizeReportVersion(payload.versionCode || payload.version);
  const [projects, versions, settings, blocks, dimensions, ageContents] = await Promise.all([
    safeQuery(
      `select code, name, default_quiz_version_code from projects where tenant_slug = $1 and status not in ('inactive', '停用', 'disabled', 'deleted') order by code`,
      [tenant]
    ),
    safeQuery(
      `select version_code, name, description, status from quiz_versions where tenant_slug = $1 and project_code = $2 order by version_code`,
      [tenant, projectCode]
    ),
    safeQuery(
      `select title, subtitle, show_chart, show_score_cards, show_score_table, booking_cta_label, booking_cta_url, settings, status
         from quiz_result_settings
        where tenant_slug = $1 and project_code = $2 and version_code = $3
        limit 1`,
      [tenant, projectCode, versionCode]
    ),
    safeQuery(
      `select id, block_key, block_type, title, content, visibility_rule, sort_order, is_visible, status
         from quiz_report_blocks
        where tenant_slug = $1 and project_code = $2 and version_code = $3 and status not in ('deleted')
        order by sort_order asc, id asc`,
      [tenant, projectCode, versionCode]
    ),
    safeQuery(
      `select dimension_key, name, max_score, display_max_score, display_score_format, rounding_mode, chart_type, sort_order
         from quiz_score_dimensions
        where tenant_slug = $1 and project_code = $2 and version_code = $3 and status not in ('停用', 'disabled', 'deleted')
        order by sort_order asc, id asc`,
      [tenant, projectCode, versionCode]
    )
    ,
    safeQuery(
      `select age_group, dimension_key, title, body, action_text, sort_order, status
         from quiz_age_dimension_contents
        where tenant_slug = $1 and project_code = $2 and version_code = $3 and status not in ('deleted')
        order by age_group asc, sort_order asc, dimension_key asc`,
      [tenant, projectCode, versionCode]
    )
  ]);
  const defaultSettings = {
    title: '你的檢測報告',
    subtitle: '以下內容會依照你的作答與分數區間自動產生。',
    show_chart: true,
    show_score_cards: true,
    show_score_table: true,
    booking_cta_label: '預約一對一諮詢',
    booking_cta_url: '',
    settings: {},
    status: '啟用'
  };
  return {
    success: true,
    projectCode,
    versionCode,
    projects: projects.rows,
    versions: versions.rows,
    settings: settings.rows[0] || defaultSettings,
    dimensions: dimensions.rows,
    blocks: blocks.rows.map(row => ({
      rowId: row.id,
      blockKey: row.block_key,
      blockType: row.block_type,
      title: row.title || '',
      content: row.content || {},
      visibilityRule: row.visibility_rule || {},
      sortOrder: Number(row.sort_order || 0),
      isVisible: row.is_visible !== false,
      status: row.status || '啟用'
    })),
    ageGroups: AGE_GROUPS.map(group => ({ key: group.key, label: group.label })),
    isFullVersion: isFullQuizVersion(versionCode, versions.rows.find(row => row.version_code === versionCode) || {}),
    ageContents: ageContents.rows.map(row => ({
      ageGroup: row.age_group,
      dimensionKey: row.dimension_key,
      title: row.title || "",
      body: row.body || "",
      actionText: row.action_text || "",
      sortOrder: Number(row.sort_order || 0),
      status: row.status || "啟用"
    }))
  };
}

async function saveQuizReportEditor(payload, tenant) {
  const projectCode = normalizeProject(payload.projectCode);
  const versionCode = normalizeReportVersion(payload.versionCode || payload.version);
  const settings = payload.settings && typeof payload.settings === 'object' ? payload.settings : {};
  const blocks = Array.isArray(payload.blocks) ? payload.blocks.slice(0, 80) : [];
  const ageContents = Array.isArray(payload.ageContents) ? payload.ageContents.slice(0, 120) : [];
  return transaction(async client => {
    await client.query(
      `insert into quiz_result_settings(
         tenant_slug, project_code, version_code, report_mode, title, subtitle,
         show_chart, show_score_cards, show_score_table, booking_cta_label, booking_cta_url, settings, status, updated_at
       ) values($1,$2,$3,'score_ranges',$4,$5,$6,$7,$8,$9,$10,$11::jsonb,'啟用',now())
       on conflict(tenant_slug, project_code, version_code) do update
       set title = excluded.title,
           subtitle = excluded.subtitle,
           show_chart = excluded.show_chart,
           show_score_cards = excluded.show_score_cards,
           show_score_table = excluded.show_score_table,
           booking_cta_label = excluded.booking_cta_label,
           booking_cta_url = excluded.booking_cta_url,
           settings = excluded.settings,
           status = excluded.status,
           updated_at = now()`,
      [
        tenant,
        projectCode,
        versionCode,
        String(settings.title || '你的檢測報告').slice(0, 240),
        String(settings.subtitle || '').slice(0, 800),
        settings.showChart !== false,
        settings.showScoreCards !== false,
        settings.showScoreTable !== false,
        String(settings.bookingCtaLabel || '預約一對一諮詢').slice(0, 80),
        String(settings.bookingCtaUrl || '').slice(0, 1200),
        JSON.stringify(settings.settings || {})
      ]
    );
    await client.query(
      `update quiz_report_blocks
          set status = 'deleted', is_visible = false, updated_at = now()
        where tenant_slug = $1 and project_code = $2 and version_code = $3`,
      [tenant, projectCode, versionCode]
    );
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index] || {};
      const type = normalizeReportBlockType(block.blockType || block.block_type);
      const keySource = String(block.blockKey || block.block_key || '').trim().toLowerCase();
      const blockKey = /^[a-z0-9][a-z0-9-]{1,60}$/.test(keySource) ? keySource : `block-${Date.now()}-${index}`;
      await client.query(
        `insert into quiz_report_blocks(
           tenant_slug, project_code, version_code, block_key, block_type, title, content, visibility_rule, sort_order, is_visible, status, updated_at
         ) values($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,'啟用',now())
         on conflict(tenant_slug, project_code, version_code, block_key) do update
         set block_type = excluded.block_type,
             title = excluded.title,
             content = excluded.content,
             visibility_rule = excluded.visibility_rule,
             sort_order = excluded.sort_order,
             is_visible = excluded.is_visible,
             status = excluded.status,
             updated_at = now()`,
        [
          tenant,
          projectCode,
          versionCode,
          blockKey,
          type,
          String(block.title || '').slice(0, 240),
          JSON.stringify(normalizeReportBlockContent(type, block.content)),
          JSON.stringify(block.visibilityRule || block.visibility_rule || {}),
          Number(block.sortOrder || block.sort_order || (index + 1) * 10),
          block.isVisible !== false && block.is_visible !== false
        ]
      );
    }
    await client.query(
      `update quiz_age_dimension_contents
          set status = 'deleted', updated_at = now()
        where tenant_slug = $1 and project_code = $2 and version_code = $3`,
      [tenant, projectCode, versionCode]
    );
    const allowedAges = new Set(AGE_GROUPS.map(group => group.key));
    for (let index = 0; index < ageContents.length; index += 1) {
      const item = ageContents[index] || {};
      const ageGroup = normalizeAgeGroup(item.ageGroup || item.age_group);
      const dimensionKey = String(item.dimensionKey || item.dimension_key || "").trim();
      if (!allowedAges.has(ageGroup) || !dimensionKey) continue;
      await client.query(
        `insert into quiz_age_dimension_contents(
           tenant_slug, project_code, version_code, age_group, dimension_key, title, body, action_text, sort_order, status, updated_at
         ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,'啟用',now())
         on conflict(tenant_slug, project_code, version_code, age_group, dimension_key) do update
         set title = excluded.title,
             body = excluded.body,
             action_text = excluded.action_text,
             sort_order = excluded.sort_order,
             status = excluded.status,
             updated_at = now()`,
        [tenant, projectCode, versionCode, ageGroup, dimensionKey, String(item.title || "").slice(0, 240), String(item.body || "").slice(0, 8000), String(item.actionText || item.action_text || "").slice(0, 2000), Number(item.sortOrder || item.sort_order || (index + 1) * 10)]
      );
    }
    return { success: true, message: '報告設定已儲存。' };
  });
}

function normalizeQuizKey(value, fallback) {
  const clean = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return clean || fallback;
}

function normalizeQuizQuestionType(value) {
  const type = String(value || '').trim().toLowerCase();
  return ['single', 'multiple', 'short_text', 'long_text'].includes(type) ? type : 'single';
}

function normalizeScoreFormat(value) {
  const format = String(value || '').trim().toLowerCase();
  return ['number', 'percent', 'decimal'].includes(format) ? format : 'number';
}

function normalizeRoundingMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return ['round', 'floor', 'ceil', 'none'].includes(mode) ? mode : 'round';
}

function assertNonOverlappingRanges(ranges) {
  const byDimension = new Map();
  ranges.forEach((range, index) => {
    const dimensionKey = normalizeQuizKey(range.dimensionKey || range.dimension_key, '');
    if (!dimensionKey) throw new Error('第 ' + (index + 1) + ' 個分數區間缺少面向。');
    const minScore = Number(range.minScore ?? range.min_score);
    const maxScore = Number(range.maxScore ?? range.max_score);
    if (!Number.isFinite(minScore) || !Number.isFinite(maxScore)) throw new Error('第 ' + (index + 1) + ' 個分數區間需要填寫數字。');
    if (minScore > maxScore) throw new Error('第 ' + (index + 1) + ' 個分數區間起始分數不能大於結束分數。');
    if (!byDimension.has(dimensionKey)) byDimension.set(dimensionKey, []);
    byDimension.get(dimensionKey).push({ minScore, maxScore, index });
  });
  for (const [dimensionKey, list] of byDimension.entries()) {
    list.sort((a, b) => a.minScore - b.minScore || a.maxScore - b.maxScore);
    for (let i = 1; i < list.length; i += 1) {
      if (list[i].minScore <= list[i - 1].maxScore) {
        throw new Error('面向 ' + dimensionKey + ' 的分數區間重疊，請調整第 ' + (list[i - 1].index + 1) + ' 與第 ' + (list[i].index + 1) + ' 個區間。');
      }
    }
  }
}

async function getQuizAdminEditor(payload, tenant) {
  const projectCode = normalizeProject(payload.projectCode);
  const versionCode = normalizeReportVersion(payload.versionCode || payload.version);
  const [projects, versions, stages, dimensions, ranges, questions, options] = await Promise.all([
    safeQuery(
      `select code, name, quiz_enabled, default_quiz_version_code from projects where tenant_slug = $1 and status not in ('inactive', '停用', 'disabled', 'deleted') order by code`,
      [tenant]
    ),
    safeQuery(
      `select version_code, name, description, traffic_weight, status from quiz_versions where tenant_slug = $1 and project_code = $2 order by version_code`,
      [tenant, projectCode]
    ),
    safeQuery(
      `select stage_key, title, description, sort_order, status from quiz_stages where tenant_slug = $1 and project_code = $2 and version_code = $3 and status not in ('deleted') order by sort_order asc, id asc`,
      [tenant, projectCode, versionCode]
    ),
    safeQuery(
      `select dimension_key, name, description, max_score, display_max_score, display_score_format, rounding_mode, chart_type, sort_order, status from quiz_score_dimensions where tenant_slug = $1 and project_code = $2 and version_code = $3 and status not in ('deleted') order by sort_order asc, id asc`,
      [tenant, projectCode, versionCode]
    ),
    safeQuery(
      `select dimension_key, range_key, label, min_score, max_score, title, subtitle, body, image_url, cta_label, cta_url, sort_order, status from quiz_score_ranges where tenant_slug = $1 and project_code = $2 and version_code = $3 and status not in ('deleted') order by sort_order asc, id asc`,
      [tenant, projectCode, versionCode]
    ),
    safeQuery(
      `select id, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status from quiz_questions where tenant_slug = $1 and project_code = $2 and version_code = $3 and status not in ('deleted') order by sort_order asc, question_no asc, id asc`,
      [tenant, projectCode, versionCode]
    ),
    safeQuery(
      `select o.id, o.question_id, q.question_no, o.option_key, o.label, o.description, o.score_weights, o.sort_order, o.status
         from quiz_question_options o
         join quiz_questions q on q.id = o.question_id
        where o.tenant_slug = $1 and q.tenant_slug = $1 and q.project_code = $2 and q.version_code = $3 and o.status not in ('deleted')
        order by q.sort_order asc, q.question_no asc, o.sort_order asc, o.id asc`,
      [tenant, projectCode, versionCode]
    )
  ]);
  const optionsByQuestion = new Map();
  options.rows.forEach(option => {
    if (!optionsByQuestion.has(option.question_id)) optionsByQuestion.set(option.question_id, []);
    optionsByQuestion.get(option.question_id).push({ optionKey: option.option_key, label: option.label || '', description: option.description || '', scoreWeights: option.score_weights || {}, sortOrder: Number(option.sort_order || 0), status: option.status || '啟用' });
  });
  return {
    success: true,
    projectCode,
    versionCode,
    projects: projects.rows,
    versions: versions.rows,
    stages: stages.rows.map(row => ({ stageKey: row.stage_key, title: row.title || '', description: row.description || '', sortOrder: Number(row.sort_order || 0), status: row.status || '啟用' })),
    dimensions: dimensions.rows.map(row => ({ dimensionKey: row.dimension_key, name: row.name || '', description: row.description || '', maxScore: row.max_score === null ? null : Number(row.max_score || 0), displayMaxScore: row.display_max_score === null || row.display_max_score === undefined ? null : Number(row.display_max_score || 0), displayScoreFormat: row.display_score_format || 'number', roundingMode: row.rounding_mode || 'round', chartType: row.chart_type || 'radar', sortOrder: Number(row.sort_order || 0), status: row.status || '啟用' })),
    ranges: ranges.rows.map(row => ({ dimensionKey: row.dimension_key, rangeKey: row.range_key, label: row.label || '', minScore: Number(row.min_score || 0), maxScore: Number(row.max_score || 0), title: row.title || '', subtitle: row.subtitle || '', body: row.body || '', imageUrl: row.image_url || '', ctaLabel: row.cta_label || '', ctaUrl: row.cta_url || '', sortOrder: Number(row.sort_order || 0), status: row.status || '啟用' })),
    questions: questions.rows.map(row => ({ rowId: row.id, stageKey: row.stage_key || '1', questionNo: Number(row.question_no || 0), title: row.title || '', helpText: row.help_text || '', type: row.type || 'single', isRequired: row.is_required !== false, scoringMode: row.scoring_mode || 'option_weights', settings: row.settings || {}, sortOrder: Number(row.sort_order || 0), status: row.status || '啟用', options: optionsByQuestion.get(row.id) || [] }))
  };
}

async function saveQuizAdminEditor(payload, tenant) {
  const projectCode = normalizeProject(payload.projectCode);
  const versionCode = normalizeReportVersion(payload.versionCode || payload.version);
  const version = payload.version && typeof payload.version === 'object' ? payload.version : {};
  const stages = Array.isArray(payload.stages) ? payload.stages.slice(0, 40) : [];
  const dimensions = Array.isArray(payload.dimensions) ? payload.dimensions.slice(0, 20) : [];
  const ranges = Array.isArray(payload.ranges) ? payload.ranges.slice(0, 120) : [];
  const questions = Array.isArray(payload.questions) ? payload.questions.slice(0, 120) : [];
  if (!dimensions.length) throw new Error('至少需要一個分數面向。');
  assertNonOverlappingRanges(ranges);
  return transaction(async client => {
    await client.query(`update projects set quiz_enabled = true, default_quiz_version_code = $3, updated_at = now() where tenant_slug = $1 and code = $2`, [tenant, projectCode, versionCode]);
    await client.query(`insert into quiz_versions(tenant_slug, project_code, version_code, name, description, traffic_weight, status, updated_at) values($1,$2,$3,$4,$5,$6,'啟用',now()) on conflict(tenant_slug, project_code, version_code) do update set name = excluded.name, description = excluded.description, traffic_weight = excluded.traffic_weight, status = excluded.status, updated_at = now()`, [tenant, projectCode, versionCode, String(version.name || versionCode + ' 版測驗').slice(0, 160), String(version.description || '').slice(0, 800), Math.max(0, Number(version.trafficWeight || version.traffic_weight || 100))]);
    await client.query(`update quiz_stages set status = 'deleted', updated_at = now() where tenant_slug = $1 and project_code = $2 and version_code = $3`, [tenant, projectCode, versionCode]);
    await client.query(`update quiz_score_dimensions set status = 'deleted', updated_at = now() where tenant_slug = $1 and project_code = $2 and version_code = $3`, [tenant, projectCode, versionCode]);
    await client.query(`update quiz_score_ranges set status = 'deleted', updated_at = now() where tenant_slug = $1 and project_code = $2 and version_code = $3`, [tenant, projectCode, versionCode]);
    await client.query(`update quiz_question_options o set status = 'deleted' from quiz_questions q where o.question_id = q.id and o.tenant_slug = $1 and q.tenant_slug = $1 and q.project_code = $2 and q.version_code = $3`, [tenant, projectCode, versionCode]);
    await client.query(`update quiz_questions set status = 'deleted', updated_at = now() where tenant_slug = $1 and project_code = $2 and version_code = $3`, [tenant, projectCode, versionCode]);
    for (let index = 0; index < stages.length; index += 1) {
      const row = stages[index] || {};
      const stageKey = normalizeQuizKey(row.stageKey || row.stage_key, String(index + 1));
      await client.query(`insert into quiz_stages(tenant_slug, project_code, version_code, stage_key, title, description, sort_order, status, updated_at) values($1,$2,$3,$4,$5,$6,$7,'啟用',now()) on conflict(tenant_slug, project_code, version_code, stage_key) do update set title = excluded.title, description = excluded.description, sort_order = excluded.sort_order, status = excluded.status, updated_at = now()`, [tenant, projectCode, versionCode, stageKey, String(row.title || ('第 ' + (index + 1) + ' 階段')).slice(0, 240), String(row.description || '').slice(0, 800), Number(row.sortOrder || row.sort_order || (index + 1) * 10)]);
    }
    for (let index = 0; index < dimensions.length; index += 1) {
      const row = dimensions[index] || {};
      const dimensionKey = normalizeQuizKey(row.dimensionKey || row.dimension_key, 'dimension-' + (index + 1));
      await client.query(`insert into quiz_score_dimensions(tenant_slug, project_code, version_code, dimension_key, name, description, max_score, display_max_score, display_score_format, rounding_mode, chart_type, sort_order, status, updated_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'啟用',now()) on conflict(tenant_slug, project_code, version_code, dimension_key) do update set name = excluded.name, description = excluded.description, max_score = excluded.max_score, display_max_score = excluded.display_max_score, display_score_format = excluded.display_score_format, rounding_mode = excluded.rounding_mode, chart_type = excluded.chart_type, sort_order = excluded.sort_order, status = excluded.status, updated_at = now()`, [tenant, projectCode, versionCode, dimensionKey, String(row.name || dimensionKey).slice(0, 160), String(row.description || '').slice(0, 800), Number(row.maxScore ?? row.max_score ?? 10), row.displayMaxScore === '' || row.displayMaxScore === null || row.displayMaxScore === undefined ? null : Number(row.displayMaxScore ?? row.display_max_score), normalizeScoreFormat(row.displayScoreFormat || row.display_score_format), normalizeRoundingMode(row.roundingMode || row.rounding_mode), ['bar', 'radar', 'line', 'none'].includes(String(row.chartType || row.chart_type || '').toLowerCase()) ? String(row.chartType || row.chart_type).toLowerCase() : 'radar', Number(row.sortOrder || row.sort_order || (index + 1) * 10)]);
    }
    for (let index = 0; index < ranges.length; index += 1) {
      const row = ranges[index] || {};
      const dimensionKey = normalizeQuizKey(row.dimensionKey || row.dimension_key, '');
      if (!dimensionKey) continue;
      const rangeKey = normalizeQuizKey(row.rangeKey || row.range_key, 'range-' + (index + 1));
      await client.query(`insert into quiz_score_ranges(tenant_slug, project_code, version_code, dimension_key, range_key, label, min_score, max_score, title, subtitle, body, image_url, cta_label, cta_url, sort_order, status, updated_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'啟用',now()) on conflict(tenant_slug, project_code, version_code, dimension_key, range_key) do update set label = excluded.label, min_score = excluded.min_score, max_score = excluded.max_score, title = excluded.title, subtitle = excluded.subtitle, body = excluded.body, image_url = excluded.image_url, cta_label = excluded.cta_label, cta_url = excluded.cta_url, sort_order = excluded.sort_order, status = excluded.status, updated_at = now()`, [tenant, projectCode, versionCode, dimensionKey, rangeKey, String(row.label || '').slice(0, 120), Number(row.minScore ?? row.min_score ?? 0), Number(row.maxScore ?? row.max_score ?? 0), String(row.title || '').slice(0, 240), String(row.subtitle || '').slice(0, 800), String(row.body || '').slice(0, 8000), String(row.imageUrl || row.image_url || '').slice(0, 1200), String(row.ctaLabel || row.cta_label || '').slice(0, 120), String(row.ctaUrl || row.cta_url || '').slice(0, 1200), Number(row.sortOrder || row.sort_order || (index + 1) * 10)]);
    }
    for (let index = 0; index < questions.length; index += 1) {
      const row = questions[index] || {};
      const questionNo = Math.max(1, Number(row.questionNo || row.question_no || index + 1));
      const questionResult = await client.query(`insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,'啟用',now()) on conflict(tenant_slug, project_code, version_code, question_no) do update set stage_key = excluded.stage_key, title = excluded.title, help_text = excluded.help_text, type = excluded.type, is_required = excluded.is_required, scoring_mode = excluded.scoring_mode, settings = excluded.settings, sort_order = excluded.sort_order, status = excluded.status, updated_at = now() returning id`, [tenant, projectCode, versionCode, normalizeQuizKey(row.stageKey || row.stage_key, '1'), questionNo, String(row.title || '').slice(0, 500), String(row.helpText || row.help_text || '').slice(0, 800), normalizeQuizQuestionType(row.type), row.isRequired !== false && row.is_required !== false, row.scoringMode === 'none' || row.scoring_mode === 'none' ? 'none' : 'option_weights', JSON.stringify(row.settings || {}), Number(row.sortOrder || row.sort_order || (index + 1) * 10)]);
      const questionId = questionResult.rows[0].id;
      const optionRows = Array.isArray(row.options) ? row.options.slice(0, 20) : [];
      for (let optionIndex = 0; optionIndex < optionRows.length; optionIndex += 1) {
        const option = optionRows[optionIndex] || {};
        const optionKey = normalizeQuizKey(option.optionKey || option.option_key, String.fromCharCode(65 + optionIndex));
        await client.query(`insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status) values($1,$2,$3,$4,$5,$6::jsonb,$7,'啟用') on conflict(question_id, option_key) do update set label = excluded.label, description = excluded.description, score_weights = excluded.score_weights, sort_order = excluded.sort_order, status = excluded.status`, [tenant, questionId, optionKey, String(option.label || '').slice(0, 500), String(option.description || '').slice(0, 800), JSON.stringify(option.scoreWeights || option.score_weights || {}), Number(option.sortOrder || option.sort_order || (optionIndex + 1) * 10)]);
      }
    }
    return { success: true, message: '測驗設定已儲存。' };
  });
}

module.exports = {
  attachLeadToCrmContact,
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
  trackReportClick,
  upsertCrmContact
};






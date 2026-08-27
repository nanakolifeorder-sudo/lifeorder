const { query, transaction } = require('./db');
const { appUrl } = require('./config');

function normalizeProject(code) {
  return String(code || 'P01').trim().toUpperCase();
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
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

function addScoreDelta(scores, delta) {
  Object.entries(delta || {}).forEach(([key, value]) => {
    const cleanKey = String(key || '').trim();
    const amount = Number(value || 0);
    if (!cleanKey || Number.isNaN(amount)) return;
    scores[cleanKey] = Number((Number(scores[cleanKey] || 0) + amount).toFixed(2));
  });
}

async function buildQuizScoreAndAnswers({ tenant, projectCode, versionCode, responseId, rawAnswers }) {
  const [questions, options, dimensions, ranges, blocks, settings] = await Promise.all([
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
    const qOptions = optionsByQuestion.get(question.id) || [];
    const selectedOptions = qOptions.filter(option => keys.includes(option.option_key) || keys.includes(String(option.id)) || keys.includes(option.label));
    const scoreDelta = {};
    selectedOptions.forEach(option => addScoreDelta(scoreDelta, option.score_weights || {}));
    addScoreDelta(scores, scoreDelta);
    const answerText = question.type === 'short_text' || question.type === 'long_text'
      ? String(value ?? '')
      : selectedOptions.map(option => option.label).join('、');
    answerRows.push({ question, selectedOptions, keys, value, answerText, scoreDelta });
  }
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
    const matched = ranges.rows.find(range => range.dimension_key === dimension.dimension_key && score >= Number(range.min_score) && score <= Number(range.max_score));
    if (!matched) return;
    matchedRanges[dimension.dimension_key] = matched.range_key;
    matchedContent.push({
      dimensionKey: dimension.dimension_key,
      dimensionName: dimension.name,
      score,
      rangeKey: matched.range_key,
      label: matched.label,
      title: matched.title,
      subtitle: matched.subtitle,
      body: matched.body,
      imageUrl: matched.image_url,
      ctaLabel: matched.cta_label,
      ctaUrl: matched.cta_url
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
    const converted = rawMax > 0 && displayMax > 0 ? (rawScore / rawMax) * displayMax : rawScore;
    const rounding = item.roundingMode || 'round';
    displayScores[item.key] = rounding === 'floor' ? Math.floor(converted) : rounding === 'ceil' ? Math.ceil(converted) : rounding === 'none' ? Number(converted.toFixed(2)) : Math.round(converted);
    displayMaxScores[item.key] = displayMax;
  });
  const scoreSummary = { scores, max_scores: maxScores, display_scores: displayScores, display_max_scores: displayMaxScores, matched_ranges: matchedRanges, dimensions: scoreDimensions };
  const reportSnapshot = {
    version_code: versionCode,
    score_summary: scoreSummary,
    result_settings: settings.rows[0] || {},
    matched_content: matchedContent,
    blocks: blocks.rows.map(block => ({
      blockKey: block.block_key,
      blockType: block.block_type,
      title: block.title || '',
      content: block.content || {},
      visibilityRule: block.visibility_rule || {},
      sortOrder: block.sort_order
    })),
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
        .replace(/\{\{\s*(project|專案名稱)\s*\}\}/g, lead.project_name || projectCode);
      const body = String(template.body || '')
        .replace(/\{\{\s*(name|姓名|客戶姓名)\s*\}\}/g, lead.client_name || '')
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
       client_name, client_email, client_phone, raw_answers, status
     )
     values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,'completed')
     returning *`,
    [tenant, projectCode, versionCode, contact?.id || null, lead.id, clientName, clientEmail, clientPhone, JSON.stringify(rawAnswers)]
  );
  const quizResponse = responseResult.rows[0];
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
    metadata: { versionCode, reportUrl }
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

async function getCRMContactDetail(payload, tenant) {
  const contactId = Number(payload.contactId || payload.crmContactId || 0);
  const email = normalizeEmail(payload.email || payload.clientEmail);
  const projectCode = normalizeProject(payload.projectCode || 'P01');
  const contactResult = contactId
    ? await safeQuery(`select * from crm_contacts where tenant_slug = $1 and id = $2 limit 1`, [tenant, contactId])
    : await safeQuery(
        `select * from crm_contacts
          where tenant_slug = $1 and project_code = $2 and email_normalized = lower($3)
          limit 1`,
        [tenant, projectCode, email]
      );
  const contact = contactResult.rows[0];
  if (!contact) return { success: false, message: '找不到客戶資料。' };
  const [quizResponses, quizAnswers, appointments, emails, timeline] = await Promise.all([
    safeQuery(
      `select id, public_id, version_code, score_summary, report_snapshot, status, submitted_at
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
      `select id, trigger_name, subject, scheduled_at, sent_at, cancelled_at, status, error_message, created_at
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
  return {
    success: true,
    contact,
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
  const [projects, versions, settings, blocks, dimensions] = await Promise.all([
    safeQuery(
      `select code, name, default_quiz_version_code from projects where tenant_slug = $1 and status not in ('inactive', '停用', 'disabled', 'deleted') order by code`,
      [tenant]
    ),
    safeQuery(
      `select version_code, name, status from quiz_versions where tenant_slug = $1 and project_code = $2 order by version_code`,
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
      `select id, block_key, block_type, title, content, sort_order, is_visible, status
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
      sortOrder: Number(row.sort_order || 0),
      isVisible: row.is_visible !== false,
      status: row.status || '啟用'
    }))
  };
}

async function saveQuizReportEditor(payload, tenant) {
  const projectCode = normalizeProject(payload.projectCode);
  const versionCode = normalizeReportVersion(payload.versionCode || payload.version);
  const settings = payload.settings && typeof payload.settings === 'object' ? payload.settings : {};
  const blocks = Array.isArray(payload.blocks) ? payload.blocks.slice(0, 80) : [];
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
           tenant_slug, project_code, version_code, block_key, block_type, title, content, sort_order, is_visible, status, updated_at
         ) values($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,'啟用',now())
         on conflict(tenant_slug, project_code, version_code, block_key) do update
         set block_type = excluded.block_type,
             title = excluded.title,
             content = excluded.content,
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
          Number(block.sortOrder || block.sort_order || (index + 1) * 10),
          block.isVisible !== false && block.is_visible !== false
        ]
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








-- Nanako Life Order full version 47-question seed.
-- Scope: tenant lifeorder, project LO, version FULL ($980 完整版).
-- Source: 人生秩序_完整版測試_給顧問拷貝.docx.

begin;

insert into quiz_versions(tenant_slug, project_code, version_code, name, description, traffic_weight, status, published_at, updated_at)
values('lifeorder', 'LO', 'FULL', '完整版', '$980 付費版測驗：47 題、11 面向完整版報告，一個 Email 限測一次。', 0, '啟用', now(), now())
on conflict(tenant_slug, project_code, version_code) do update
set name = excluded.name,
    description = excluded.description,
    status = excluded.status,
    updated_at = now();

insert into quiz_stages(tenant_slug, project_code, version_code, stage_key, title, description, sort_order, status, updated_at)
values
  ('lifeorder', 'LO', 'FULL', 'external', '外在秩序', '整理物品、空間、資訊與資產，讓生活中的外在資源更容易被找到、管理與交接。', 10, '啟用', now()),
  ('lifeorder', 'LO', 'FULL', 'internal', '內在秩序', '整理價值觀、願望與關係，讓選擇、時間與情感能回到真正重要的位置。', 20, '啟用', now()),
  ('lifeorder', 'LO', 'FULL', 'continuity', '延續秩序', '整理百年安排、寵物、家文化與傳承，讓重要的人事物在需要時有人能接手。', 30, '啟用', now())
on conflict(tenant_slug, project_code, version_code, stage_key) do update
set title = excluded.title,
    description = excluded.description,
    sort_order = excluded.sort_order,
    status = excluded.status,
    updated_at = now();

update quiz_question_options o
   set status = 'deleted'
  from quiz_questions q
 where o.question_id = q.id
   and q.tenant_slug = 'lifeorder'
   and q.project_code = 'LO'
   and q.version_code = 'FULL';

update quiz_questions
   set status = 'deleted',
       updated_at = now()
 where tenant_slug = 'lifeorder'
   and project_code = 'LO'
   and version_code = 'FULL';

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'external', 1, '家中／工作空間裡，物品的狀態最接近？', '物品｜外在秩序', 'single', true, 'option_weights', '{"sourceCode":"物1","dimensionKey":"objects","dimensionName":"物品","orderName":"外在秩序"}'::jsonb, 10, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '所有物品都有固定位置，需要時都找得到。', '物品 +4', '{"objects":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '自認為有分類，卻還是經常在找東西——甚至因為「知道有、卻找不到」而重複購買。', '物品 +3', '{"objects":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '檯面與各種櫃體都塞滿東西，知道該整理，卻因為不會、不想、沒時間而一直沒面對。', '物品 +2', '{"objects":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '超過一年沒有全面整理，很多地方不確定放了什麼，甚至堆著不少過期物品。', '物品 +1', '{"objects":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'external', 2, '面對擁有的物品，我通常：', '物品｜外在秩序', 'single', true, 'option_weights', '{"sourceCode":"物2","dimensionKey":"objects","dimensionName":"物品","orderName":"外在秩序"}'::jsonb, 20, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '能清楚判斷去留，不被情緒或其他因素困擾。', '物品 +4', '{"objects":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '大部分能判斷，少數會猶豫不決、想很久。', '物品 +3', '{"objects":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '常常很糾結、不知如何選擇，多半因為捨不得而留下。', '物品 +2', '{"objects":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '幾乎都留下，即使知道用不到。', '物品 +1', '{"objects":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'external', 3, '上一次「主動」整理一個空間是？', '物品｜外在秩序', 'single', true, 'option_weights', '{"sourceCode":"物3","dimensionKey":"objects","dimensionName":"物品","orderName":"外在秩序"}'::jsonb, 30, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '3 個月內', '物品 +4', '{"objects":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '6 個月內', '物品 +3', '{"objects":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '一年以內', '物品 +2', '{"objects":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '想不起來', '物品 +1', '{"objects":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'external', 4, '走進最常使用的空間，第一眼的感受？', '空間｜外在秩序', 'single', true, 'option_weights', '{"sourceCode":"空1","dimensionKey":"space","dimensionName":"空間","orderName":"外在秩序"}'::jsonb, 40, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '舒服清爽，能靜下心。', '空間 +4', '{"space":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '還算整齊，一兩處不想看。', '空間 +3', '{"space":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '有點亂、心浮但能將就。', '空間 +2', '{"space":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '亂到想逃避。', '空間 +1', '{"space":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'external', 5, '臨時有人要來訪，我的反應？', '空間｜外在秩序', 'single', true, 'option_weights', '{"sourceCode":"空2","dimensionKey":"space","dimensionName":"空間","orderName":"外在秩序"}'::jsonb, 50, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '隨時可以。', '空間 +4', '{"space":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '花 10–20 分鐘整理。', '空間 +3', '{"space":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '要一兩小時才敢讓人看。', '空間 +2', '{"space":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '盡量避免讓人來。', '空間 +1', '{"space":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'external', 6, '空間的使用分區（工作／休息／收納）？', '空間｜外在秩序', 'single', true, 'option_weights', '{"sourceCode":"空3","dimensionKey":"space","dimensionName":"空間","orderName":"外在秩序"}'::jsonb, 60, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '界線清楚。', '空間 +4', '{"space":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '大致有，偶爾混用。', '空間 +3', '{"space":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '常混用、界線模糊。', '空間 +2', '{"space":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '沒有分區概念。', '空間 +1', '{"space":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'external', 7, '你的帳號密碼管理？', '資訊｜外在秩序', 'single', true, 'option_weights', '{"sourceCode":"資1","dimensionKey":"information","dimensionName":"資訊","orderName":"外在秩序"}'::jsonb, 70, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '有系統化管理，必要時家人也能取得。', '資訊 +4', '{"information":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '自己知道，但沒整理成家人看得懂的形式。', '資訊 +3', '{"information":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '散落各處，連自己也要找。', '資訊 +2', '{"information":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '沒整理，經常忘記帳號或密碼。', '資訊 +1', '{"information":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'external', 8, '你的重要檔案與照片（雲端／裝置）？', '資訊｜外在秩序', 'single', true, 'option_weights', '{"sourceCode":"資2","dimensionKey":"information","dimensionName":"資訊","orderName":"外在秩序"}'::jsonb, 80, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '有整理且有備援。', '資訊 +4', '{"information":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '大致有，備援不完整。', '資訊 +3', '{"information":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '散在各裝置，沒備援。', '資訊 +2', '{"information":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '完全沒整理。', '資訊 +1', '{"information":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'external', 9, '萬一你無法使用手機／電腦，家人進得去你的 email 與重要帳號嗎？', '資訊｜外在秩序', 'single', true, 'option_weights', '{"sourceCode":"資3","dimensionKey":"information","dimensionName":"資訊","orderName":"外在秩序"}'::jsonb, 90, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '進得去，已安排。', '資訊 +4', '{"information":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '部分可以。', '資訊 +3', '{"information":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '幾乎不行。', '資訊 +2', '{"information":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '完全不行、也沒想過。', '資訊 +1', '{"information":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'external', 10, '你越來越依賴 AI（ChatGPT／Claude 等）處理工作與生活，你清楚這些對話紀錄、自訂指令、上傳資料累積了什麼、又存在哪裡嗎？', '資訊｜外在秩序', 'single', true, 'option_weights', '{"sourceCode":"資4","dimensionKey":"information","dimensionName":"資訊","orderName":"外在秩序"}'::jsonb, 100, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '清楚，也定期整理／備份重要內容。', '資訊 +4', '{"information":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '大致知道，但沒整理。', '資訊 +3', '{"information":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '沒想過，任它累積。', '資訊 +2', '{"information":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '幾乎不知道自己在 AI 裡留了什麼。', '資訊 +1', '{"information":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'external', 11, '對名下傳統資產（存款／保單／不動產／投資）的掌握？', '資產｜外在秩序', 'single', true, 'option_weights', '{"sourceCode":"產1","dimensionKey":"assets","dimensionName":"資產","orderName":"外在秩序"}'::jsonb, 110, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '有清楚清冊。', '資產 +4', '{"assets":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '大致有數，沒寫下。', '資產 +3', '{"assets":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '只記得一部分。', '資產 +2', '{"assets":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '從未盤點。', '資產 +1', '{"assets":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'external', 12, '保單、合約等重要文件的存放？', '資產｜外在秩序', 'single', true, 'option_weights', '{"sourceCode":"產2","dimensionKey":"assets","dimensionName":"資產","orderName":"外在秩序"}'::jsonb, 120, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '集中且知情人清楚。', '資產 +4', '{"assets":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '集中但只有自己知道。', '資產 +3', '{"assets":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '分散、要花時間收齊。', '資產 +2', '{"assets":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '不確定是否齊全。', '資產 +1', '{"assets":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'external', 13, '你的數位金融資產（加密貨幣、比特幣、冷錢包、交易所、私鑰、資產代幣化）整理與保管的狀態？', '資產｜外在秩序', 'single', true, 'option_weights', '{"sourceCode":"產3","dimensionKey":"assets","dimensionName":"資產","orderName":"外在秩序"}'::jsonb, 130, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '有盤點，私鑰／助記詞安全保管，並交代了存取路徑。', '資產 +4', '{"assets":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '有，但保管或交代不完整。', '資產 +3', '{"assets":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '有，但幾乎沒在管理。', '資產 +2', '{"assets":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '完全沒概念。', '資產 +1', '{"assets":1}'::jsonb, 40, '啟用'),
  ('lifeorder', (select id from saved_question), 'na', '不適用（沒有這類資產）。', '不適用，不計入此選項分數', '{}'::jsonb, 50, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'external', 14, '數位收益與智財（自媒體分潤、線上課程、數位著作）？', '資產｜外在秩序', 'single', true, 'option_weights', '{"sourceCode":"產4","dimensionKey":"assets","dimensionName":"資產","orderName":"外在秩序"}'::jsonb, 140, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '有整理帳號、授權與收益來源。', '資產 +4', '{"assets":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '大致知道，沒整理。', '資產 +3', '{"assets":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '很零散。', '資產 +2', '{"assets":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '沒有。', '資產 +1', '{"assets":1}'::jsonb, 40, '啟用'),
  ('lifeorder', (select id from saved_question), 'na', '不適用。', '不適用，不計入此選項分數', '{}'::jsonb, 50, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'external', 15, '付費 AI 帳號盤點：你清楚自己有幾個付費 AI、各自費用、以及累積的價值（對話、知識庫、API 餘額）嗎？', '資產｜外在秩序', 'single', true, 'option_weights', '{"sourceCode":"產5","dimensionKey":"assets","dimensionName":"資產","orderName":"外在秩序"}'::jsonb, 150, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '清楚，定期檢視。', '資產 +4', '{"assets":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '大致知道。', '資產 +3', '{"assets":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '有付費但沒在管。', '資產 +2', '{"assets":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '不清楚自己付了哪些。', '資產 +1', '{"assets":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'internal', 16, '面臨重大選擇時？', '價值觀｜內在秩序', 'single', true, 'option_weights', '{"sourceCode":"價1","dimensionKey":"values","dimensionName":"價值觀","orderName":"內在秩序"}'::jsonb, 160, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '清楚自己重視什麼，能快速做符合自己的決定。', '價值觀 +4', '{"values":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '大致知道，需花時間釐清。', '價值觀 +3', '{"values":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '常被外界牽著走。', '價值觀 +2', '{"values":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '不確定自己在意什麼。', '價值觀 +1', '{"values":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'internal', 17, '能立刻說出「現階段最重要的三件事」嗎？', '價值觀｜內在秩序', 'single', true, 'option_weights', '{"sourceCode":"價2","dimensionKey":"values","dimensionName":"價值觀","orderName":"內在秩序"}'::jsonb, 170, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '可以且很清楚。', '價值觀 +4', '{"values":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '可以但要想。', '價值觀 +3', '{"values":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '說得出一兩件、不確定順序。', '價值觀 +2', '{"values":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '說不出來。', '價值觀 +1', '{"values":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'internal', 18, '當你的選擇與他人期待不同？', '價值觀｜內在秩序', 'single', true, 'option_weights', '{"sourceCode":"價3","dimensionKey":"values","dimensionName":"價值觀","orderName":"內在秩序"}'::jsonb, 180, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '能安然接受並說明理由。', '價值觀 +4', '{"values":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '猶豫但仍照自己。', '價值觀 +3', '{"values":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '常內疚或動搖。', '價值觀 +2', '{"values":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '幾乎都妥協。', '價值觀 +1', '{"values":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'internal', 19, '你的時間分配，和你說的「重要的事」一致嗎？', '價值觀｜內在秩序', 'single', true, 'option_weights', '{"sourceCode":"價4","dimensionKey":"values","dimensionName":"價值觀","orderName":"內在秩序"}'::jsonb, 190, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '大致一致。', '價值觀 +4', '{"values":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '部分一致。', '價值觀 +3', '{"values":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '常常不一致。', '價值觀 +2', '{"values":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '幾乎背道而馳。', '價值觀 +1', '{"values":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'internal', 20, '你的金錢花用，反映你的價值觀嗎？', '價值觀｜內在秩序', 'single', true, 'option_weights', '{"sourceCode":"價5","dimensionKey":"values","dimensionName":"價值觀","orderName":"內在秩序"}'::jsonb, 200, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '花在我真正重視的地方。', '價值觀 +4', '{"values":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '大致是。', '價值觀 +3', '{"values":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '常衝動或隨波。', '價值觀 +2', '{"values":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '不清楚錢花去哪。', '價值觀 +1', '{"values":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'internal', 21, '生活忙亂時，你有一個能回到的內在準則嗎？', '價值觀｜內在秩序', 'single', true, 'option_weights', '{"sourceCode":"價6","dimensionKey":"values","dimensionName":"價值觀","orderName":"內在秩序"}'::jsonb, 210, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '有，清楚且用得上。', '價值觀 +4', '{"values":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '有，但不常想起。', '價值觀 +3', '{"values":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '模糊。', '價值觀 +2', '{"values":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '沒有。', '價值觀 +1', '{"values":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'internal', 22, '關於「這輩子還想完成的事」？', '願望｜內在秩序', 'single', true, 'option_weights', '{"sourceCode":"願1","dimensionKey":"wishes","dimensionName":"願望","orderName":"內在秩序"}'::jsonb, 220, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '有清單且在行動。', '願望 +4', '{"wishes":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '有想法沒寫下。', '願望 +3', '{"wishes":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '偶爾想到、被日常淹沒。', '願望 +2', '{"wishes":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '幾乎沒想過。', '願望 +1', '{"wishes":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'internal', 23, '過去一年，完成過一件對自己有意義的願望嗎？', '願望｜內在秩序', 'single', true, 'option_weights', '{"sourceCode":"願2","dimensionKey":"wishes","dimensionName":"願望","orderName":"內在秩序"}'::jsonb, 230, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '不只一件。', '願望 +4', '{"wishes":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '一件。', '願望 +3', '{"wishes":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '想過沒行動。', '願望 +2', '{"wishes":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '沒有、也不知想要什麼。', '願望 +1', '{"wishes":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'internal', 24, '若時間金錢不是問題，你答得出想做什麼嗎？', '願望｜內在秩序', 'single', true, 'option_weights', '{"sourceCode":"願3","dimensionKey":"wishes","dimensionName":"願望","orderName":"內在秩序"}'::jsonb, 240, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '立刻列出好幾件。', '願望 +4', '{"wishes":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '一兩件。', '願望 +3', '{"wishes":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '想很久。', '願望 +2', '{"wishes":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '答不出。', '願望 +1', '{"wishes":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'internal', 25, '對身邊重要關係（家人／伴侶／朋友）？', '關係｜內在秩序', 'single', true, 'option_weights', '{"sourceCode":"關1","dimensionKey":"relationships","dimensionName":"關係","orderName":"內在秩序"}'::jsonb, 250, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '清楚哪些滋養／消耗並做安排。', '關係 +4', '{"relationships":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '大致知道沒行動。', '關係 +3', '{"relationships":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '常在消耗性關係裡疲憊。', '關係 +2', '{"relationships":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '沒想過。', '關係 +1', '{"relationships":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'internal', 26, '面對不舒服的關係要求？', '關係｜內在秩序', 'single', true, 'option_weights', '{"sourceCode":"關2","dimensionKey":"relationships","dimensionName":"關係","orderName":"內在秩序"}'::jsonb, 260, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '能溫柔而堅定表達界線。', '關係 +4', '{"relationships":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '大部分能拒絕。', '關係 +3', '{"relationships":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '常勉強答應後悔。', '關係 +2', '{"relationships":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '幾乎無法拒絕。', '關係 +1', '{"relationships":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'internal', 27, '有沒有想感謝／和解卻沒說出口的人？', '關係｜內在秩序', 'single', true, 'option_weights', '{"sourceCode":"關3","dimensionKey":"relationships","dimensionName":"關係","orderName":"內在秩序"}'::jsonb, 270, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '沒有，該說的都說了。', '關係 +4', '{"relationships":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '有一兩位，正準備說。', '關係 +3', '{"relationships":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '有但拖延。', '關係 +2', '{"relationships":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '有很多、選擇不面對。', '關係 +1', '{"relationships":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'internal', 28, '你的社交時間，花在讓你有能量的人身上嗎？', '關係｜內在秩序', 'single', true, 'option_weights', '{"sourceCode":"關4","dimensionKey":"relationships","dimensionName":"關係","orderName":"內在秩序"}'::jsonb, 280, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '大多是。', '關係 +4', '{"relationships":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '一半一半。', '關係 +3', '{"relationships":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '常花在消耗的人。', '關係 +2', '{"relationships":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '幾乎被義務占滿。', '關係 +1', '{"relationships":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'internal', 29, '家人之間，重要的事能好好說嗎？', '關係｜內在秩序', 'single', true, 'option_weights', '{"sourceCode":"關5","dimensionKey":"relationships","dimensionName":"關係","orderName":"內在秩序"}'::jsonb, 290, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '能開放溝通。', '關係 +4', '{"relationships":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '大致可以。', '關係 +3', '{"relationships":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '常迴避或衝突。', '關係 +2', '{"relationships":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '幾乎不談。', '關係 +1', '{"relationships":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'continuity', 30, '關於醫療決定、遺囑、百年安排？', '百年安排｜延續秩序', 'single', true, 'option_weights', '{"sourceCode":"百1","dimensionKey":"end_of_life","dimensionName":"百年安排","orderName":"延續秩序"}'::jsonb, 300, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '已有規劃並讓重要的人知道。', '百年安排 +4', '{"end_of_life":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '想過沒寫下／沒說。', '百年安排 +3', '{"end_of_life":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '知道重要但逃避。', '百年安排 +2', '{"end_of_life":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '沒想過。', '百年安排 +1', '{"end_of_life":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'continuity', 31, '家人今天需替你做重大醫療決定，他們知道你的意願嗎？', '百年安排｜延續秩序', 'single', true, 'option_weights', '{"sourceCode":"百2","dimensionKey":"end_of_life","dimensionName":"百年安排","orderName":"延續秩序"}'::jsonb, 310, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '知道，明確溝通過。', '百年安排 +4', '{"end_of_life":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '大概猜得到。', '百年安排 +3', '{"end_of_life":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '完全不知道。', '百年安排 +2', '{"end_of_life":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '我自己也沒想清楚。', '百年安排 +1', '{"end_of_life":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'continuity', 32, '「萬一文件盒」（文件／聯絡人／帳號入口統整）？', '百年安排｜延續秩序', 'single', true, 'option_weights', '{"sourceCode":"百3","dimensionKey":"end_of_life","dimensionName":"百年安排","orderName":"延續秩序"}'::jsonb, 320, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '已備好、家人知道在哪。', '百年安排 +4', '{"end_of_life":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '準備中。', '百年安排 +3', '{"end_of_life":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '想過沒開始。', '百年安排 +2', '{"end_of_life":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '沒聽過／沒想過。', '百年安排 +1', '{"end_of_life":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'continuity', 33, '器官捐贈／預立醫療決定（AD）的意願？', '百年安排｜延續秩序', 'single', true, 'option_weights', '{"sourceCode":"百4","dimensionKey":"end_of_life","dimensionName":"百年安排","orderName":"延續秩序"}'::jsonb, 330, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '已表達且有文件。', '百年安排 +4', '{"end_of_life":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '心裡有數沒正式。', '百年安排 +3', '{"end_of_life":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '沒想過。', '百年安排 +2', '{"end_of_life":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '逃避不想面對。', '百年安排 +1', '{"end_of_life":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'continuity', 34, '你希望的告別／身後方式，有讓家人知道嗎？', '百年安排｜延續秩序', 'single', true, 'option_weights', '{"sourceCode":"百5","dimensionKey":"end_of_life","dimensionName":"百年安排","orderName":"延續秩序"}'::jsonb, 340, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '有明確交代。', '百年安排 +4', '{"end_of_life":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '提過沒細節。', '百年安排 +3', '{"end_of_life":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '沒談過。', '百年安排 +2', '{"end_of_life":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '完全沒想。', '百年安排 +1', '{"end_of_life":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'continuity', 35, '萬一你無法照顧，毛孩的安排？', '寵物｜延續秩序', 'single', true, 'option_weights', '{"sourceCode":"寵1","dimensionKey":"pets","dimensionName":"寵物","orderName":"延續秩序"}'::jsonb, 350, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '有明確照顧人選與交代。', '寵物 +4', '{"pets":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '有人選沒溝通細節。', '寵物 +3', '{"pets":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '沒想過。', '寵物 +2', '{"pets":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'na', '不適用（無寵物）。', '不適用，不計入此選項分數', '{}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'continuity', 36, '醫療／飲食／照護紀錄是否能讓人接手？', '寵物｜延續秩序', 'single', true, 'option_weights', '{"sourceCode":"寵2","dimensionKey":"pets","dimensionName":"寵物","orderName":"延續秩序"}'::jsonb, 360, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '完整紀錄。', '寵物 +4', '{"pets":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '部分。', '寵物 +3', '{"pets":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '只有我知道。', '寵物 +2', '{"pets":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'na', '不適用。', '不適用，不計入此選項分數', '{}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'continuity', 37, '有和信任的人談過長期照顧嗎？', '寵物｜延續秩序', 'single', true, 'option_weights', '{"sourceCode":"寵3","dimensionKey":"pets","dimensionName":"寵物","orderName":"延續秩序"}'::jsonb, 370, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '有且對方同意。', '寵物 +4', '{"pets":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '提過沒共識。', '寵物 +3', '{"pets":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '沒談過。', '寵物 +2', '{"pets":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'na', '不適用。', '不適用，不計入此選項分數', '{}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'continuity', 38, '家族故事／習慣／記憶的傳遞？', '家文化｜延續秩序', 'single', true, 'option_weights', '{"sourceCode":"家1","dimensionKey":"family_culture","dimensionName":"家文化","orderName":"延續秩序"}'::jsonb, 380, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '已用某形式保存。', '家文化 +4', '{"family_culture":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '常聊但沒紀錄。', '家文化 +3', '{"family_culture":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '知道在流失沒行動。', '家文化 +2', '{"family_culture":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '沒意識到要整理。', '家文化 +1', '{"family_culture":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'continuity', 39, '你清楚長輩的人生故事嗎？', '家文化｜延續秩序', 'single', true, 'option_weights', '{"sourceCode":"家2","dimensionKey":"family_culture","dimensionName":"家文化","orderName":"延續秩序"}'::jsonb, 390, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '清楚且有紀錄。', '家文化 +4', '{"family_culture":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '大致知道細節模糊。', '家文化 +3', '{"family_culture":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '只知片段。', '家文化 +2', '{"family_culture":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '幾乎不清楚。', '家文化 +1', '{"family_culture":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'continuity', 40, '重要傳統／價值觀，有意識傳給下一代嗎？', '家文化｜延續秩序', 'single', true, 'option_weights', '{"sourceCode":"家3","dimensionKey":"family_culture","dimensionName":"家文化","orderName":"延續秩序"}'::jsonb, 400, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '有且刻意規劃。', '家文化 +4', '{"family_culture":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '有些但隨機。', '家文化 +3', '{"family_culture":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '很少、靠自然。', '家文化 +2', '{"family_culture":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '沒想過。', '家文化 +1', '{"family_culture":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'continuity', 41, '家庭的數位照片、影片、對話記錄，有整理與保存嗎？（避免哪天帳號消失就不見）', '家文化｜延續秩序', 'single', true, 'option_weights', '{"sourceCode":"家4","dimensionKey":"family_culture","dimensionName":"家文化","orderName":"延續秩序"}'::jsonb, 410, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '有整理且備份。', '家文化 +4', '{"family_culture":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '有存但很亂。', '家文化 +3', '{"family_culture":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '全散在各裝置／雲端。', '家文化 +2', '{"family_culture":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '從沒整理過。', '家文化 +1', '{"family_culture":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'continuity', 42, '對「有一天家人要接手我的一切」？', '傳承｜延續秩序', 'single', true, 'option_weights', '{"sourceCode":"傳1","dimensionKey":"legacy","dimensionName":"傳承","orderName":"延續秩序"}'::jsonb, 420, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '已準備好、家人清楚怎麼處理。', '傳承 +4', '{"legacy":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '有想法沒系統化。', '傳承 +3', '{"legacy":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '覺得重要不知從何開始。', '傳承 +2', '{"legacy":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '幾乎沒想過。', '傳承 +1', '{"legacy":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'continuity', 43, '資產分配意向有初步想法嗎？', '傳承｜延續秩序', 'single', true, 'option_weights', '{"sourceCode":"傳2","dimensionKey":"legacy","dimensionName":"傳承","orderName":"延續秩序"}'::jsonb, 430, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '有且有記錄。', '傳承 +4', '{"legacy":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '有想法沒寫下。', '傳承 +3', '{"legacy":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '沒想過。', '傳承 +2', '{"legacy":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '太遙遠不想面對。', '傳承 +1', '{"legacy":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'continuity', 44, '家人能找到「所有重要資訊的入口」嗎？', '傳承｜延續秩序', 'single', true, 'option_weights', '{"sourceCode":"傳3","dimensionKey":"legacy","dimensionName":"傳承","orderName":"延續秩序"}'::jsonb, 440, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '有一份清單。', '傳承 +4', '{"legacy":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '大概找得到、要花時間。', '傳承 +3', '{"legacy":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '很分散。', '傳承 +2', '{"legacy":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '完全找不到。', '傳承 +1', '{"legacy":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'continuity', 45, '你的數位資產（帳號／加密貨幣／雲端／AI）有交代身後由誰、如何處理嗎？', '傳承｜延續秩序', 'single', true, 'option_weights', '{"sourceCode":"傳4","dimensionKey":"legacy","dimensionName":"傳承","orderName":"延續秩序"}'::jsonb, 450, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '有明確交代。', '傳承 +4', '{"legacy":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '想過沒寫下。', '傳承 +3', '{"legacy":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '沒想過。', '傳承 +2', '{"legacy":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '逃避不面對。', '傳承 +1', '{"legacy":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'continuity', 46, 'AI 聲音克隆、數位分身、你訓練過的 AI——你想過身後怎麼處理嗎？（繼續／封存／授權家人／刪除）', '傳承｜延續秩序', 'single', true, 'option_weights', '{"sourceCode":"傳5","dimensionKey":"legacy","dimensionName":"傳承","orderName":"延續秩序"}'::jsonb, 460, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '想過且有意願交代。', '傳承 +4', '{"legacy":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '想過沒決定。', '傳承 +3', '{"legacy":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '沒想過但覺得重要。', '傳承 +2', '{"legacy":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '從沒想過。', '傳承 +1', '{"legacy":1}'::jsonb, 40, '啟用'),
  ('lifeorder', (select id from saved_question), 'na', '不適用（無 AI 分身／克隆）。', '不適用，不計入此選項分數', '{}'::jsonb, 50, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

with saved_question as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, scoring_mode, settings, sort_order, status, updated_at)
  values('lifeorder', 'LO', 'FULL', 'continuity', 47, '你想留給家人的「精神／心意」有被表達嗎？（不只財產）', '傳承｜延續秩序', 'single', true, 'option_weights', '{"sourceCode":"傳6","dimensionKey":"legacy","dimensionName":"傳承","orderName":"延續秩序"}'::jsonb, 470, '啟用', now())
  on conflict(tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      is_required = excluded.is_required,
      scoring_mode = excluded.scoring_mode,
      settings = excluded.settings,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, description, score_weights, sort_order, status)
values
  ('lifeorder', (select id from saved_question), 'a', '有，說出來／寫下來了。', '傳承 +4', '{"legacy":4}'::jsonb, 10, '啟用'),
  ('lifeorder', (select id from saved_question), 'b', '部分。', '傳承 +3', '{"legacy":3}'::jsonb, 20, '啟用'),
  ('lifeorder', (select id from saved_question), 'c', '想過沒表達。', '傳承 +2', '{"legacy":2}'::jsonb, 30, '啟用'),
  ('lifeorder', (select id from saved_question), 'd', '沒想過。', '傳承 +1', '{"legacy":1}'::jsonb, 40, '啟用')
on conflict(question_id, option_key) do update
set label = excluded.label,
    description = excluded.description,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;


update quiz_questions
   set help_text = '',
       updated_at = now()
 where tenant_slug = 'lifeorder'
   and project_code = 'LO'
   and version_code = 'FULL'
   and status not in ('deleted');

update quiz_question_options o
   set label = regexp_replace(label, '[。．.]$', ''),
       description = regexp_replace(description, '[。．.]$', '')
  from quiz_questions q
 where q.id = o.question_id
   and q.tenant_slug = 'lifeorder'
   and q.project_code = 'LO'
   and q.version_code = 'FULL'
   and q.status not in ('deleted')
   and o.status not in ('deleted');
commit;




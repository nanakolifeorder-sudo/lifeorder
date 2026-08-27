insert into quiz_versions(tenant_slug, project_code, version_code, name, description, status)
select p.tenant_slug, p.code, 'A', 'A 版測驗', '整合版測驗漏斗 MVP 範例版本', '啟用'
  from projects p
 where p.code = 'P01'
on conflict (tenant_slug, project_code, version_code) do update
set name = excluded.name,
    description = excluded.description,
    status = excluded.status,
    updated_at = now();

insert into quiz_stages(tenant_slug, project_code, version_code, stage_key, title, description, sort_order, status)
select p.tenant_slug, p.code, 'A', seed.stage_key, seed.title, seed.description, seed.sort_order, '啟用'
  from projects p
 cross join (values
   ('1', '第一階段：目前狀態', '先了解你現在最明顯的困擾。', 10),
   ('2', '第二階段：期待與補充', '再確認你想改善的方向。', 20)
 ) as seed(stage_key, title, description, sort_order)
 where p.code = 'P01'
on conflict (tenant_slug, project_code, version_code, stage_key) do update
set title = excluded.title,
    description = excluded.description,
    sort_order = excluded.sort_order,
    status = excluded.status,
    updated_at = now();

insert into quiz_score_dimensions(tenant_slug, project_code, version_code, dimension_key, name, description, max_score, chart_type, sort_order, status)
select p.tenant_slug, p.code, 'A', seed.dimension_key, seed.name, seed.description, 10, 'radar', seed.sort_order, '啟用'
  from projects p
 cross join (values
   ('clarity', '需求清晰度', '客戶是否已清楚知道自己想解決什麼問題。', 10),
   ('urgency', '預約急迫度', '客戶是否有明確時間壓力或強烈行動意願。', 20),
   ('readiness', '執行準備度', '客戶是否已具備進入諮詢或服務安排的準備。', 30)
 ) as seed(dimension_key, name, description, sort_order)
 where p.code = 'P01'
on conflict (tenant_slug, project_code, version_code, dimension_key) do update
set name = excluded.name,
    description = excluded.description,
    max_score = excluded.max_score,
    chart_type = excluded.chart_type,
    sort_order = excluded.sort_order,
    status = excluded.status,
    updated_at = now();

insert into quiz_score_ranges(tenant_slug, project_code, version_code, dimension_key, range_key, label, min_score, max_score, title, subtitle, body, sort_order, status)
select p.tenant_slug, p.code, 'A', seed.dimension_key, seed.range_key, seed.label, seed.min_score, seed.max_score, seed.title, seed.subtitle, seed.body, seed.sort_order, '啟用'
  from projects p
 cross join (values
   ('clarity', 'low', '需要釐清', 0::numeric, 5::numeric, '目前需求還需要整理', '你可能還在收斂問題與目標。', '建議先把最想解決的問題、目前卡住的地方，以及期待成果寫下來。預約前整理越清楚，顧問越能快速協助判斷下一步。', 10),
   ('clarity', 'high', '方向清楚', 6::numeric, 10::numeric, '你的需求方向已經相對清楚', '你已經能描述主要問題與期待成果。', '接下來適合安排一對一諮詢，把目前狀況、可行方案與執行順序整理成具體計畫。', 20),
   ('urgency', 'low', '可先觀察', 0::numeric, 5::numeric, '目前急迫度不高', '你可以先用報告內容做初步整理。', '如果你還在比較或蒐集資訊，可以先保存這份報告。等問題更明確或時間壓力提高時，再預約顧問討論。', 10),
   ('urgency', 'high', '適合預約', 6::numeric, 10::numeric, '現在適合安排諮詢', '你已經有較明確的行動需求。', '建議直接預約一對一諮詢，讓顧問依照你的分數與作答內容協助判斷優先順序。', 20),
   ('readiness', 'low', '需要準備', 0::numeric, 5::numeric, '目前準備度還可以再整理', '你可能還需要補齊背景資料或決策條件。', '建議先整理目前資源、預算、時間與主要限制，再安排諮詢會更有效率。', 10),
   ('readiness', 'high', '準備充足', 6::numeric, 10::numeric, '你已經具備行動準備', '你的作答顯示已經可以進入下一步討論。', '接下來適合預約一對一諮詢，讓顧問協助把優先順序與執行安排具體化。', 20)
 ) as seed(dimension_key, range_key, label, min_score, max_score, title, subtitle, body, sort_order)
 where p.code = 'P01'
on conflict (tenant_slug, project_code, version_code, dimension_key, range_key) do update
set label = excluded.label,
    min_score = excluded.min_score,
    max_score = excluded.max_score,
    title = excluded.title,
    subtitle = excluded.subtitle,
    body = excluded.body,
    sort_order = excluded.sort_order,
    status = excluded.status,
    updated_at = now();

insert into quiz_result_settings(tenant_slug, project_code, version_code, report_mode, title, subtitle, show_chart, show_score_cards, show_score_table, booking_cta_label, status)
select p.tenant_slug, p.code, 'A', 'score_ranges', '你的檢測報告', '以下內容會依照你的作答與分數區間自動產生。', true, true, true, '預約一對一諮詢', '啟用'
  from projects p
 where p.code = 'P01'
on conflict (tenant_slug, project_code, version_code) do update
set title = excluded.title,
    subtitle = excluded.subtitle,
    show_chart = excluded.show_chart,
    show_score_cards = excluded.show_score_cards,
    show_score_table = excluded.show_score_table,
    booking_cta_label = excluded.booking_cta_label,
    status = excluded.status,
    updated_at = now();

with q as (
  insert into quiz_questions(tenant_slug, project_code, version_code, stage_key, question_no, title, help_text, type, is_required, sort_order, status)
  select p.tenant_slug, p.code, 'A', seed.stage_key, seed.question_no, seed.title, seed.help_text, seed.type, true, seed.sort_order, '啟用'
    from projects p
   cross join (values
     ('1', 1, '你目前最想解決的是什麼？', '選一個最接近你現在狀態的答案。', 'single', 10),
     ('1', 2, '這個問題大約困擾你多久了？', '', 'single', 20),
     ('2', 3, '你期待諮詢後得到什麼？', '可複選。', 'multiple', 30),
     ('2', 4, '還有沒有想補充的背景？', '', 'long_text', 40)
   ) as seed(stage_key, question_no, title, help_text, type, sort_order)
   where p.code = 'P01'
  on conflict (tenant_slug, project_code, version_code, question_no) do update
  set stage_key = excluded.stage_key,
      title = excluded.title,
      help_text = excluded.help_text,
      type = excluded.type,
      sort_order = excluded.sort_order,
      status = excluded.status,
      updated_at = now()
  returning id, tenant_slug, project_code, version_code, question_no
)
insert into quiz_question_options(tenant_slug, question_id, option_key, label, score_weights, sort_order, status)
select q.tenant_slug, q.id, seed.option_key, seed.label, seed.score_weights::jsonb, seed.sort_order, '啟用'
  from q
  join (values
    (1, 'A', '我還不太確定，只是想先了解', '{"clarity":1,"urgency":1,"readiness":1}', 10),
    (1, 'B', '我有明確問題，但還不知道怎麼處理', '{"clarity":3,"urgency":2,"readiness":3}', 20),
    (1, 'C', '我已經想處理，正在找適合方案', '{"clarity":5,"urgency":4,"readiness":4}', 30),
    (2, 'A', '剛開始出現', '{"clarity":1,"urgency":1,"readiness":1}', 10),
    (2, 'B', '持續一段時間了', '{"clarity":2,"urgency":3,"readiness":2}', 20),
    (2, 'C', '已經影響到我的安排或決策', '{"clarity":3,"urgency":5,"readiness":3}', 30),
    (3, 'A', '釐清問題', '{"clarity":2,"urgency":1,"readiness":2}', 10),
    (3, 'B', '知道下一步怎麼做', '{"clarity":3,"urgency":2,"readiness":3}', 20),
    (3, 'C', '盡快安排實作或服務', '{"clarity":2,"urgency":4,"readiness":4}', 30)
  ) as seed(question_no, option_key, label, score_weights, sort_order)
    on seed.question_no = q.question_no
on conflict (question_id, option_key) do update
set label = excluded.label,
    score_weights = excluded.score_weights,
    sort_order = excluded.sort_order,
    status = excluded.status;

insert into quiz_report_blocks(tenant_slug, project_code, version_code, block_key, block_type, title, content, sort_order, is_visible, status)
select p.tenant_slug, p.code, 'A', seed.block_key, seed.block_type, seed.title, seed.content::jsonb, seed.sort_order, true, '啟用'
  from projects p
 cross join (values
   ('intro', 'text', '報告說明', '{"text":"這份報告會依照你的作答顯示目前狀態。分數不是絕對判斷，而是協助你快速整理下一步。"}', 10),
   ('score-radar', 'score_chart', '多面向分數圖', '{"chartType":"radar"}', 20),
   ('booking', 'booking_cta', '預約 CTA', '{"label":"預約一對一諮詢"}', 90)
 ) as seed(block_key, block_type, title, content, sort_order)
 where p.code = 'P01'
on conflict (tenant_slug, project_code, version_code, block_key) do update
set block_type = excluded.block_type,
    title = excluded.title,
    content = excluded.content,
    sort_order = excluded.sort_order,
    is_visible = excluded.is_visible,
    status = excluded.status,
    updated_at = now();

update projects
   set quiz_enabled = true,
       default_quiz_version_code = 'A',
       updated_at = now()
 where code = 'P01';

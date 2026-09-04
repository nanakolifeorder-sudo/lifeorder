-- Nanako Life Order simple version adjustments.
-- Scope: tenant lifeorder, project LO, version A only.

begin;

insert into quiz_stages(tenant_slug, project_code, version_code, stage_key, title, description, sort_order, status, updated_at)
values('lifeorder', 'LO', 'LITE', '1', '測驗題目', '請依照目前狀況作答，完成後會產生簡易診斷報告。', 10, '啟用', now())
on conflict(tenant_slug, project_code, version_code, stage_key) do update
set title = excluded.title,
    description = excluded.description,
    sort_order = excluded.sort_order,
    status = excluded.status,
    updated_at = now();

insert into quiz_result_settings(tenant_slug, project_code, version_code, report_mode, title, subtitle, show_chart, show_score_cards, show_score_table, booking_cta_label, booking_cta_url, settings, status, updated_at)
values('lifeorder', 'LO', 'LITE', 'score_ranges', '免費版測驗報告', '這份報告會依照你的作答，整理目前三大秩序的狀態與下一步方向。', true, true, false, '我要做完整版測驗', '', '{}'::jsonb, '啟用', now())
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
    updated_at = now();

update quiz_questions
   set stage_key = '1',
       updated_at = now()
 where tenant_slug = 'lifeorder'
   and project_code = 'LO'
   and version_code = 'LITE';

update quiz_stages
   set status = 'deleted',
       updated_at = now()
 where tenant_slug = 'lifeorder'
   and project_code = 'LO'
   and version_code = 'LITE'
   and stage_key <> '1';

commit;


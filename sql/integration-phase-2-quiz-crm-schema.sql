create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create table if not exists quiz_versions (
  id bigserial primary key,
  tenant_slug text not null references tenants(slug) on delete cascade,
  project_code text not null,
  version_code text not null,
  name text not null default '',
  description text default '',
  traffic_weight integer not null default 100,
  status text not null default '啟用',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_slug, project_code, version_code)
);

create table if not exists quiz_stages (
  id bigserial primary key,
  tenant_slug text not null references tenants(slug) on delete cascade,
  project_code text not null,
  version_code text not null,
  stage_key text not null,
  title text not null default '',
  description text default '',
  sort_order integer not null default 0,
  status text not null default '啟用',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_slug, project_code, version_code, stage_key)
);

create table if not exists quiz_questions (
  id bigserial primary key,
  tenant_slug text not null references tenants(slug) on delete cascade,
  project_code text not null,
  version_code text not null,
  stage_key text not null default '1',
  question_no integer not null default 0,
  title text not null,
  help_text text default '',
  type text not null default 'single',
  is_required boolean not null default true,
  status text not null default '啟用',
  sort_order integer not null default 0,
  scoring_mode text not null default 'option_weights',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_slug, project_code, version_code, question_no),
  check (type in ('single', 'multiple', 'short_text', 'long_text')),
  check (scoring_mode in ('option_weights', 'none'))
);

create table if not exists quiz_question_options (
  id bigserial primary key,
  tenant_slug text not null references tenants(slug) on delete cascade,
  question_id bigint not null references quiz_questions(id) on delete cascade,
  option_key text not null,
  label text not null,
  description text default '',
  score_weights jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  status text not null default '啟用',
  created_at timestamptz not null default now(),
  unique (question_id, option_key)
);

create table if not exists quiz_score_dimensions (
  id bigserial primary key,
  tenant_slug text not null references tenants(slug) on delete cascade,
  project_code text not null,
  version_code text not null,
  dimension_key text not null,
  name text not null,
  description text default '',
  max_score numeric(10,2),
  display_max_score numeric(10,2),
  display_score_format text not null default 'number',
  rounding_mode text not null default 'round',
  chart_type text not null default 'bar',
  sort_order integer not null default 0,
  status text not null default '啟用',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_slug, project_code, version_code, dimension_key),
  check (max_score is null or max_score >= 0),
  check (display_max_score is null or display_max_score >= 0),
  check (display_score_format in ('number', 'percent', 'decimal')),
  check (rounding_mode in ('round', 'floor', 'ceil', 'none')),
  check (chart_type in ('bar', 'radar', 'line', 'none'))
);

create table if not exists quiz_score_ranges (
  id bigserial primary key,
  tenant_slug text not null references tenants(slug) on delete cascade,
  project_code text not null,
  version_code text not null,
  dimension_key text not null,
  range_key text not null,
  label text not null default '',
  min_score numeric(10,2) not null,
  max_score numeric(10,2) not null,
  title text not null default '',
  subtitle text default '',
  body text default '',
  image_url text default '',
  cta_label text default '',
  cta_url text default '',
  sort_order integer not null default 0,
  status text not null default '啟用',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_slug, project_code, version_code, dimension_key, range_key),
  check (min_score <= max_score)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'quiz_score_ranges_no_overlap'
  ) then
    alter table quiz_score_ranges
      add constraint quiz_score_ranges_no_overlap
      exclude using gist (
        tenant_slug with =,
        project_code with =,
        version_code with =,
        dimension_key with =,
        numrange(min_score, max_score, '[]') with &&
      )
      where (status not in ('停用', 'disabled', 'deleted'));
  end if;
end
$$;

create table if not exists quiz_result_settings (
  id bigserial primary key,
  tenant_slug text not null references tenants(slug) on delete cascade,
  project_code text not null,
  version_code text not null,
  report_mode text not null default 'score_ranges',
  title text not null default '',
  subtitle text default '',
  show_chart boolean not null default true,
  show_score_cards boolean not null default true,
  show_score_table boolean not null default true,
  primary_dimension_key text default '',
  booking_cta_label text default '預約諮詢',
  booking_cta_url text default '',
  settings jsonb not null default '{}'::jsonb,
  status text not null default '啟用',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_slug, project_code, version_code),
  check (report_mode in ('score_ranges', 'custom_blocks'))
);

create table if not exists quiz_report_blocks (
  id bigserial primary key,
  tenant_slug text not null references tenants(slug) on delete cascade,
  project_code text not null,
  version_code text not null,
  block_key text not null,
  parent_block_id bigint references quiz_report_blocks(id) on delete cascade,
  block_type text not null,
  title text default '',
  content jsonb not null default '{}'::jsonb,
  visibility_rule jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  is_visible boolean not null default true,
  status text not null default '啟用',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_slug, project_code, version_code, block_key),
  check (block_type in (
    'heading',
    'text',
    'list',
    'image',
    'score_chart',
    'score_table',
    'button',
    'link',
    'booking_cta',
    'score_range_content'
  ))
);

create table if not exists crm_contacts (
  id bigserial primary key,
  tenant_slug text not null references tenants(slug) on delete cascade,
  project_code text not null,
  name text not null default '',
  email text not null,
  email_normalized text generated always as (lower(email)) stored,
  phone text default '',
  status text not null default 'active',
  lifecycle_stage text not null default 'lead',
  latest_quiz_response_id bigint,
  latest_appointment_id bigint references appointments(id) on delete set null,
  assigned_consultant_id bigint references consultants(id) on delete set null,
  source text default '',
  tags text[] not null default array[]::text[],
  notes text default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_slug, project_code, email_normalized),
  check (lifecycle_stage in (
    'lead',
    'quiz_completed',
    'unbooked',
    'booked',
    'waitlist',
    'rejected',
    'cancelled',
    'completed'
  ))
);

create table if not exists quiz_responses (
  id bigserial primary key,
  public_id uuid not null default gen_random_uuid(),
  tenant_slug text not null references tenants(slug) on delete cascade,
  project_code text not null,
  version_code text not null,
  crm_contact_id bigint references crm_contacts(id) on delete set null,
  lead_id bigint references leads(id) on delete set null,
  appointment_id bigint references appointments(id) on delete set null,
  client_name text not null default '',
  client_email text not null,
  client_email_normalized text generated always as (lower(client_email)) stored,
  client_phone text default '',
  raw_answers jsonb not null default '{}'::jsonb,
  score_summary jsonb not null default '{}'::jsonb,
  report_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'completed',
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_slug, public_id)
);

create table if not exists quiz_response_answers (
  id bigserial primary key,
  tenant_slug text not null references tenants(slug) on delete cascade,
  quiz_response_id bigint not null references quiz_responses(id) on delete cascade,
  question_id bigint references quiz_questions(id) on delete set null,
  question_no integer not null default 0,
  stage_key text default '',
  question_title text not null default '',
  question_type text not null default '',
  selected_option_ids bigint[] not null default array[]::bigint[],
  selected_option_keys text[] not null default array[]::text[],
  answer_text text default '',
  answer_json jsonb not null default '{}'::jsonb,
  score_delta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists crm_timeline_events (
  id bigserial primary key,
  tenant_slug text not null references tenants(slug) on delete cascade,
  project_code text not null,
  crm_contact_id bigint references crm_contacts(id) on delete cascade,
  lead_id bigint references leads(id) on delete set null,
  quiz_response_id bigint references quiz_responses(id) on delete set null,
  appointment_id bigint references appointments(id) on delete set null,
  email_queue_id bigint references email_queue(id) on delete set null,
  actor_consultant_id bigint references consultants(id) on delete set null,
  event_type text not null,
  title text not null,
  body text default '',
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists page_settings (
  id bigserial primary key,
  tenant_slug text not null references tenants(slug) on delete cascade,
  project_code text not null,
  version_code text not null default '',
  page_type text not null,
  page_name text not null default '',
  public_url text default '',
  systeme_url text default '',
  embed_mode text not null default 'iframe',
  settings jsonb not null default '{}'::jsonb,
  status text not null default '啟用',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_slug, project_code, version_code, page_type),
  check (page_type in ('quiz', 'report', 'booking', 'booking_success')),
  check (embed_mode in ('iframe'))
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'crm_contacts_latest_quiz_response_id_fkey'
  ) then
    alter table crm_contacts
      add constraint crm_contacts_latest_quiz_response_id_fkey
      foreign key (latest_quiz_response_id) references quiz_responses(id) on delete set null;
  end if;
end
$$;

alter table projects add column if not exists default_quiz_version_code text not null default 'A';
alter table quiz_score_dimensions add column if not exists display_max_score numeric(10,2);
alter table quiz_score_dimensions add column if not exists display_score_format text not null default 'number';
alter table quiz_score_dimensions add column if not exists rounding_mode text not null default 'round';
alter table projects add column if not exists quiz_enabled boolean not null default false;
alter table projects add column if not exists quiz_page_slug text default 'quiz';
alter table projects add column if not exists report_page_slug text default 'report';
alter table projects add column if not exists booking_success_page_slug text default 'booking-success';
alter table projects add column if not exists iframe_embed_settings jsonb not null default '{}'::jsonb;
alter table projects add column if not exists funnel_settings jsonb not null default '{}'::jsonb;
alter table projects add column if not exists updated_at timestamptz not null default now();

alter table leads add column if not exists crm_contact_id bigint references crm_contacts(id) on delete set null;
alter table leads add column if not exists latest_quiz_response_id bigint references quiz_responses(id) on delete set null;
alter table leads add column if not exists source text default '';
alter table leads add column if not exists lifecycle_stage text not null default 'lead';
alter table leads add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table appointments add column if not exists crm_contact_id bigint references crm_contacts(id) on delete set null;
alter table appointments add column if not exists lead_id bigint references leads(id) on delete set null;
alter table appointments add column if not exists quiz_response_id bigint references quiz_responses(id) on delete set null;
alter table appointments add column if not exists meeting_tool text default '';
alter table appointments add column if not exists meeting_url text default '';
alter table appointments add column if not exists booking_source text default '';
alter table appointments add column if not exists updated_at timestamptz not null default now();

alter table email_templates add column if not exists module text not null default 'booking';
alter table email_templates add column if not exists delay_unit text not null default 'hours';
alter table email_templates add column if not exists audience_rule jsonb not null default '{}'::jsonb;
alter table email_templates add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table email_templates add column if not exists updated_at timestamptz not null default now();

alter table email_queue add column if not exists crm_contact_id bigint references crm_contacts(id) on delete set null;
alter table email_queue add column if not exists quiz_response_id bigint references quiz_responses(id) on delete set null;
alter table email_queue add column if not exists module text not null default 'booking';
alter table email_queue add column if not exists cancellation_policy text not null default 'none';
alter table email_queue add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table page_views add column if not exists crm_contact_id bigint references crm_contacts(id) on delete set null;
alter table page_views add column if not exists quiz_response_id bigint references quiz_responses(id) on delete set null;
alter table page_views add column if not exists page_type text not null default 'booking';
alter table page_views add column if not exists metadata jsonb not null default '{}'::jsonb;

insert into quiz_versions(tenant_slug, project_code, version_code, name, status)
select p.tenant_slug, p.code, coalesce(nullif(p.default_quiz_version_code, ''), 'A'), '預設版本', '啟用'
  from projects p
on conflict (tenant_slug, project_code, version_code) do nothing;

insert into crm_contacts(
  tenant_slug,
  project_code,
  name,
  email,
  phone,
  status,
  lifecycle_stage,
  latest_appointment_id,
  assigned_consultant_id,
  source,
  created_at,
  updated_at
)
select distinct on (tenant_slug, project_code, lower(client_email))
       tenant_slug,
       project_code,
       client_name,
       client_email,
       client_phone,
       'active',
       case
         when status in ('booked', '已預約') or booked_appointment_id is not null then 'booked'
         when status in ('waitlist', '等候名單') then 'waitlist'
         when status in ('rejected', '已婉拒') then 'rejected'
         when status in ('cancelled', '已取消') then 'cancelled'
         else 'lead'
       end,
       booked_appointment_id,
       null,
       'leads',
       created_at,
       updated_at
  from leads
 where coalesce(client_email, '') <> ''
 order by tenant_slug, project_code, lower(client_email), updated_at desc, id desc
on conflict (tenant_slug, project_code, email_normalized) do update
set name = coalesce(nullif(excluded.name, ''), crm_contacts.name),
    phone = coalesce(nullif(excluded.phone, ''), crm_contacts.phone),
    lifecycle_stage = case
      when crm_contacts.lifecycle_stage in ('booked', 'completed') then crm_contacts.lifecycle_stage
      else excluded.lifecycle_stage
    end,
    latest_appointment_id = coalesce(crm_contacts.latest_appointment_id, excluded.latest_appointment_id),
    updated_at = greatest(crm_contacts.updated_at, excluded.updated_at);

insert into crm_contacts(
  tenant_slug,
  project_code,
  name,
  email,
  phone,
  status,
  lifecycle_stage,
  latest_appointment_id,
  assigned_consultant_id,
  source,
  created_at,
  updated_at
)
select distinct on (tenant_slug, project_code, lower(client_email))
       tenant_slug,
       project_code,
       client_name,
       client_email,
       client_phone,
       'active',
       case
         when status in ('已取消', 'cancelled', 'canceled') then 'cancelled'
         when start_at is not null and start_at < now() then 'completed'
         else 'booked'
       end,
       id,
       consultant_id,
       'appointments',
       created_at,
       created_at
  from appointments
 where coalesce(client_email, '') <> ''
 order by tenant_slug, project_code, lower(client_email), created_at desc, id desc
on conflict (tenant_slug, project_code, email_normalized) do update
set name = coalesce(nullif(excluded.name, ''), crm_contacts.name),
    phone = coalesce(nullif(excluded.phone, ''), crm_contacts.phone),
    lifecycle_stage = case
      when excluded.lifecycle_stage in ('booked', 'completed') then excluded.lifecycle_stage
      when crm_contacts.lifecycle_stage in ('booked', 'completed') then crm_contacts.lifecycle_stage
      else excluded.lifecycle_stage
    end,
    latest_appointment_id = coalesce(excluded.latest_appointment_id, crm_contacts.latest_appointment_id),
    assigned_consultant_id = coalesce(excluded.assigned_consultant_id, crm_contacts.assigned_consultant_id),
    updated_at = greatest(crm_contacts.updated_at, excluded.updated_at);

insert into crm_contacts(
  tenant_slug,
  project_code,
  name,
  email,
  phone,
  status,
  lifecycle_stage,
  source,
  created_at,
  updated_at
)
select distinct on (tenant_slug, project_code, lower(client_email))
       tenant_slug,
       project_code,
       client_name,
       client_email,
       client_phone,
       'active',
       'rejected',
       'rejected_clients',
       created_at,
       created_at
  from rejected_clients
 where coalesce(client_email, '') <> ''
 order by tenant_slug, project_code, lower(client_email), created_at desc, id desc
on conflict (tenant_slug, project_code, email_normalized) do update
set name = coalesce(nullif(excluded.name, ''), crm_contacts.name),
    phone = coalesce(nullif(excluded.phone, ''), crm_contacts.phone),
    lifecycle_stage = case
      when crm_contacts.lifecycle_stage in ('booked', 'completed') then crm_contacts.lifecycle_stage
      else 'rejected'
    end,
    updated_at = greatest(crm_contacts.updated_at, excluded.updated_at);

insert into crm_contacts(
  tenant_slug,
  project_code,
  name,
  email,
  phone,
  status,
  lifecycle_stage,
  source,
  created_at,
  updated_at
)
select distinct on (tenant_slug, project_code, lower(client_email))
       tenant_slug,
       project_code,
       client_name,
       client_email,
       client_phone,
       'active',
       'waitlist',
       'waitlist_clients',
       created_at,
       created_at
  from waitlist_clients
 where coalesce(client_email, '') <> ''
 order by tenant_slug, project_code, lower(client_email), created_at desc, id desc
on conflict (tenant_slug, project_code, email_normalized) do update
set name = coalesce(nullif(excluded.name, ''), crm_contacts.name),
    phone = coalesce(nullif(excluded.phone, ''), crm_contacts.phone),
    lifecycle_stage = case
      when crm_contacts.lifecycle_stage in ('booked', 'completed') then crm_contacts.lifecycle_stage
      else 'waitlist'
    end,
    updated_at = greatest(crm_contacts.updated_at, excluded.updated_at);

update leads l
   set crm_contact_id = c.id,
       lifecycle_stage = case
         when l.status in ('booked', '已預約') or l.booked_appointment_id is not null then 'booked'
         when l.status in ('waitlist', '等候名單') then 'waitlist'
         when l.status in ('rejected', '已婉拒') then 'rejected'
         when l.status in ('cancelled', '已取消') then 'cancelled'
         else coalesce(nullif(l.lifecycle_stage, ''), 'lead')
       end
  from crm_contacts c
 where c.tenant_slug = l.tenant_slug
   and c.project_code = l.project_code
   and c.email_normalized = lower(l.client_email)
   and l.crm_contact_id is null;

update appointments a
   set crm_contact_id = c.id,
       lead_id = l.id,
       meeting_tool = coalesce(nullif(a.meeting_tool, ''), a.calendar_provider, ''),
       meeting_url = coalesce(nullif(a.meeting_url, ''), a.meet_link, '')
  from crm_contacts c
  left join leads l
    on l.tenant_slug = c.tenant_slug
   and l.project_code = c.project_code
   and lower(l.client_email) = c.email_normalized
 where c.tenant_slug = a.tenant_slug
   and c.project_code = a.project_code
   and c.email_normalized = lower(a.client_email)
   and (a.crm_contact_id is null or a.lead_id is null);

update email_queue q
   set crm_contact_id = c.id,
       module = coalesce(nullif(q.module, ''), 'booking'),
       cancellation_policy = case
         when q.stop_when_booked then 'stop_when_booked'
         else coalesce(nullif(q.cancellation_policy, ''), 'none')
       end
  from crm_contacts c
 where c.tenant_slug = q.tenant_slug
   and c.project_code = q.project_code
   and c.email_normalized = lower(q.client_email)
   and q.crm_contact_id is null;

update email_templates
   set module = coalesce(nullif(module, ''), 'booking'),
       delay_unit = coalesce(nullif(delay_unit, ''), 'hours');

create index if not exists idx_quiz_versions_project_status
  on quiz_versions(tenant_slug, project_code, status);

create index if not exists idx_quiz_stages_project_sort
  on quiz_stages(tenant_slug, project_code, version_code, sort_order);

create index if not exists idx_quiz_questions_project_stage_sort
  on quiz_questions(tenant_slug, project_code, version_code, stage_key, sort_order);

create index if not exists idx_quiz_questions_project_status
  on quiz_questions(tenant_slug, project_code, version_code, status);

create index if not exists idx_quiz_question_options_question_sort
  on quiz_question_options(question_id, sort_order);

create index if not exists idx_quiz_score_dimensions_project_sort
  on quiz_score_dimensions(tenant_slug, project_code, version_code, sort_order);

create index if not exists idx_quiz_score_ranges_dimension_sort
  on quiz_score_ranges(tenant_slug, project_code, version_code, dimension_key, sort_order);

create index if not exists idx_quiz_result_settings_project
  on quiz_result_settings(tenant_slug, project_code, version_code);

create index if not exists idx_quiz_report_blocks_project_sort
  on quiz_report_blocks(tenant_slug, project_code, version_code, sort_order);

create index if not exists idx_crm_contacts_stage_updated
  on crm_contacts(tenant_slug, project_code, lifecycle_stage, updated_at desc);

create index if not exists idx_crm_contacts_assigned_updated
  on crm_contacts(tenant_slug, assigned_consultant_id, updated_at desc);

create index if not exists idx_quiz_responses_project_submitted
  on quiz_responses(tenant_slug, project_code, submitted_at desc);

create index if not exists idx_quiz_responses_project_email_submitted
  on quiz_responses(tenant_slug, project_code, client_email_normalized, submitted_at desc);

create index if not exists idx_quiz_responses_contact_submitted
  on quiz_responses(crm_contact_id, submitted_at desc);

create index if not exists idx_quiz_response_answers_response_question
  on quiz_response_answers(quiz_response_id, question_no);

create index if not exists idx_quiz_response_answers_tenant_question
  on quiz_response_answers(tenant_slug, question_id);

create index if not exists idx_crm_timeline_contact_occurred
  on crm_timeline_events(crm_contact_id, occurred_at desc);

create index if not exists idx_crm_timeline_tenant_event_occurred
  on crm_timeline_events(tenant_slug, project_code, event_type, occurred_at desc);

create index if not exists idx_crm_timeline_quiz_response
  on crm_timeline_events(quiz_response_id);

create index if not exists idx_crm_timeline_appointment
  on crm_timeline_events(appointment_id);

create index if not exists idx_crm_timeline_email_queue
  on crm_timeline_events(email_queue_id);

create index if not exists idx_email_queue_contact_created
  on email_queue(tenant_slug, project_code, crm_contact_id, created_at desc);

create index if not exists idx_email_queue_quiz_response
  on email_queue(tenant_slug, project_code, quiz_response_id);

create index if not exists idx_page_settings_project_page
  on page_settings(tenant_slug, project_code, version_code, page_type);

create index if not exists idx_page_views_page_type_created
  on page_views(tenant_slug, project_code, page_type, created_at desc);

insert into crm_timeline_events(
  tenant_slug,
  project_code,
  crm_contact_id,
  lead_id,
  event_type,
  title,
  body,
  occurred_at,
  created_at
)
select l.tenant_slug,
       l.project_code,
       l.crm_contact_id,
       l.id,
       'lead_created',
       '名單建立',
       coalesce(l.answers, ''),
       l.created_at,
       now()
  from leads l
 where l.crm_contact_id is not null
   and not exists (
     select 1
       from crm_timeline_events e
      where e.tenant_slug = l.tenant_slug
        and e.project_code = l.project_code
        and e.lead_id = l.id
        and e.event_type = 'lead_created'
   );

insert into crm_timeline_events(
  tenant_slug,
  project_code,
  crm_contact_id,
  lead_id,
  appointment_id,
  actor_consultant_id,
  event_type,
  title,
  body,
  occurred_at,
  created_at
)
select a.tenant_slug,
       a.project_code,
       a.crm_contact_id,
       a.lead_id,
       a.id,
       a.consultant_id,
       case
         when a.status in ('已取消', 'cancelled', 'canceled') then 'booking_cancelled'
         else 'booking_created'
       end,
       case
         when a.status in ('已取消', 'cancelled', 'canceled') then '預約取消'
         else '預約建立'
       end,
       coalesce(a.notes, ''),
       a.created_at,
       now()
  from appointments a
 where a.crm_contact_id is not null
   and not exists (
     select 1
       from crm_timeline_events e
      where e.tenant_slug = a.tenant_slug
        and e.project_code = a.project_code
        and e.appointment_id = a.id
        and e.event_type in ('booking_created', 'booking_cancelled')
   );

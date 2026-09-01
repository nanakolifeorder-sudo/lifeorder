create extension if not exists pgcrypto;

create table if not exists tenants (
  slug text primary key,
  name text not null,
  owner_name text not null,
  owner_email text not null,
  owner_password_hash text not null,
  app_base_url text,
  booking_base_urls jsonb not null default '[]'::jsonb,
  webhook_secret text default '',
  created_at timestamptz not null default now()
);

alter table tenants add column if not exists booking_base_urls jsonb not null default '[]'::jsonb;
alter table tenants add column if not exists webhook_secret text default '';
alter table tenants add column if not exists zoom_account_id text default '';
alter table tenants add column if not exists zoom_client_id text default '';
alter table tenants add column if not exists zoom_client_secret text default '';

create table if not exists login_attempts (
  id bigserial primary key,
  tenant_slug text not null,
  email text not null,
  ip_address text not null default '',
  success boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists projects (
  id bigserial primary key,
  tenant_slug text not null references tenants(slug) on delete cascade,
  code text not null,
  name text not null,
  status text not null default '啟用',
  main_url text default '',
  fallback_url text default '',
  booking_notice text default '',
  reject_type text not null default 'text',
  reject_value text default '',
  created_at timestamptz not null default now(),
  unique (tenant_slug, code)
);

create table if not exists consultants (
  id bigserial primary key,
  tenant_slug text not null references tenants(slug) on delete cascade,
  name text not null,
  login_email text not null,
  password_hash text,
  calendar_id text not null default 'primary',
  google_email text,
  google_refresh_token text,
  microsoft_email text,
  microsoft_refresh_token text,
  accepting boolean not null default true,
  weight integer not null default 50,
  permissions text not null default '',
  project_codes text[] not null default array['ALL']::text[],
  meet_tool text not null default 'Google Meet',
  time_zone text not null default 'Asia/Taipei',
  interval_minutes integer not null default 60,
  buffer_before integer not null default 0,
  buffer_after integer not null default 0,
  min_days integer not null default 1,
  max_days integer not null default 14,
  created_at timestamptz not null default now(),
  unique (tenant_slug, login_email)
);

alter table consultants add column if not exists microsoft_email text;
alter table consultants add column if not exists microsoft_refresh_token text;
alter table consultants add column if not exists max_daily_bookings integer not null default 0;

create table if not exists availability_rules (
  id bigserial primary key,
  tenant_slug text not null references tenants(slug) on delete cascade,
  consultant_id bigint not null references consultants(id) on delete cascade,
  kind text not null check (kind in ('weekly', 'specific')),
  day_of_week integer,
  date_value date,
  start_time text not null,
  end_time text not null,
  start_time2 text default '',
  end_time2 text default ''
);

create table if not exists questions (
  id bigserial primary key,
  tenant_slug text not null references tenants(slug) on delete cascade,
  project_code text not null,
  sort_order integer not null default 0,
  title text not null,
  type text not null default '簡答',
  options jsonb not null default '[]'::jsonb,
  reject_word text default '',
  is_required boolean not null default true
);

create table if not exists appointments (
  id bigserial primary key,
  tenant_slug text not null references tenants(slug) on delete cascade,
  project_code text not null,
  project_name text not null,
  consultant_id bigint references consultants(id) on delete set null,
  consultant_name text not null,
  calendar_id text,
  calendar_provider text not null default 'google',
  event_id text,
  meet_link text default '',
  start_at timestamptz,
  end_at timestamptz,
  client_name text not null,
  client_email text not null,
  client_phone text default '',
  answers text default '',
  status text not null default '待開會',
  attendance text default '',
  deal_status text default '',
  plan text default '',
  notes text default '',
  created_at timestamptz not null default now()
);

alter table appointments add column if not exists calendar_provider text not null default 'google';

create table if not exists rejected_clients (
  id bigserial primary key,
  tenant_slug text not null references tenants(slug) on delete cascade,
  project_code text not null,
  project_name text not null,
  client_name text not null,
  client_email text not null,
  client_phone text default '',
  answers text default '',
  status text not null default '已婉拒',
  created_at timestamptz not null default now()
);

create table if not exists waitlist_clients (
  id bigserial primary key,
  tenant_slug text not null references tenants(slug) on delete cascade,
  project_code text not null,
  project_name text not null,
  client_name text not null,
  client_email text not null,
  client_phone text default '',
  answers text default '',
  status text not null default '等候名單',
  created_at timestamptz not null default now()
);

create table if not exists page_views (
  id bigserial primary key,
  tenant_slug text not null references tenants(slug) on delete cascade,
  project_code text not null,
  created_at timestamptz not null default now()
);

create table if not exists email_templates (
  id bigserial primary key,
  tenant_slug text not null references tenants(slug) on delete cascade,
  project_code text not null,
  name text not null,
  trigger_name text not null,
  time_param integer default 24,
  subject text not null,
  body text not null,
  status text not null default '啟用',
  sender_name text default '',
  stop_when_booked boolean not null default true
);

alter table email_templates add column if not exists stop_when_booked boolean not null default true;

create table if not exists quiz_access_codes (
  id bigserial primary key,
  tenant_slug text not null references tenants(slug) on delete cascade,
  project_code text not null,
  version_code text not null default '',
  code text not null,
  code_normalized text generated always as (upper(trim(code))) stored,
  name text not null default '',
  code_type text not null default 'retest',
  discount_label text default '',
  max_uses integer,
  used_count integer not null default 0,
  per_email_limit integer not null default 1,
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default '啟用',
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_slug, project_code, version_code, code_normalized),
  check (code_type in ('retest', 'discount', 'free_access'))
);

create table if not exists quiz_access_code_usages (
  id bigserial primary key,
  tenant_slug text not null references tenants(slug) on delete cascade,
  access_code_id bigint not null references quiz_access_codes(id) on delete cascade,
  project_code text not null,
  version_code text not null default '',
  quiz_response_id bigint,
  client_email text not null,
  client_email_normalized text generated always as (lower(client_email)) stored,
  code text not null,
  usage_type text not null default 'quiz_submit',
  metadata jsonb not null default '{}'::jsonb,
  used_at timestamptz not null default now()
);

create table if not exists leads (
  id bigserial primary key,
  tenant_slug text not null references tenants(slug) on delete cascade,
  project_code text not null,
  project_name text not null,
  client_name text not null,
  client_email text not null,
  client_phone text default '',
  answers text default '',
  status text not null default 'pending',
  booked_appointment_id bigint references appointments(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_slug, project_code, client_email)
);

create table if not exists email_queue (
  id bigserial primary key,
  tenant_slug text not null references tenants(slug) on delete cascade,
  project_code text not null,
  lead_id bigint references leads(id) on delete set null,
  appointment_id bigint references appointments(id) on delete set null,
  template_id bigint references email_templates(id) on delete set null,
  trigger_name text not null,
  client_name text not null,
  client_email text not null,
  subject text not null,
  body text not null,
  sender_name text default '',
  scheduled_at timestamptz not null,
  sent_at timestamptz,
  cancelled_at timestamptz,
  stop_when_booked boolean not null default true,
  status text not null default 'queued',
  error_message text default '',
  retry_count integer not null default 0,
  max_attempts integer not null default 3,
  last_attempt_at timestamptz,
  created_at timestamptz not null default now()
);

alter table email_queue add column if not exists retry_count integer not null default 0;
alter table email_queue add column if not exists max_attempts integer not null default 3;
alter table email_queue add column if not exists last_attempt_at timestamptz;

create table if not exists email_suppressions (
  id bigserial primary key,
  tenant_slug text not null references tenants(slug) on delete cascade,
  client_email text not null,
  reason text not null default 'unsubscribe',
  source text not null default 'system',
  created_at timestamptz not null default now(),
  unique (tenant_slug, client_email)
);

create table if not exists admin_alerts (
  id bigserial primary key,
  tenant_slug text not null references tenants(slug) on delete cascade,
  level text not null default 'warning',
  title text not null,
  message text not null default '',
  context jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_appointments_tenant_start on appointments(tenant_slug, start_at);
create unique index if not exists uq_active_appointment_slot
  on appointments(tenant_slug, consultant_id, start_at)
  where status not in ('已取消', 'cancelled', 'canceled');
create index if not exists idx_questions_project on questions(tenant_slug, project_code, sort_order);
create index if not exists idx_rules_consultant on availability_rules(tenant_slug, consultant_id);
create index if not exists idx_leads_project_email on leads(tenant_slug, project_code, client_email);
create index if not exists idx_quiz_access_codes_lookup on quiz_access_codes(tenant_slug, project_code, version_code, code_normalized);
create index if not exists idx_quiz_access_code_usages_code_used on quiz_access_code_usages(access_code_id, used_at desc);
create index if not exists idx_email_queue_due on email_queue(status, scheduled_at);
create index if not exists idx_email_queue_retry on email_queue(status, scheduled_at, retry_count);
create index if not exists idx_login_attempts_lookup on login_attempts(tenant_slug, email, ip_address, created_at);
create index if not exists idx_admin_alerts_tenant_unresolved on admin_alerts(tenant_slug, resolved_at, created_at desc);


create extension if not exists pgcrypto;

create table if not exists tenants (
  slug text primary key,
  name text not null,
  owner_name text not null,
  owner_email text not null,
  owner_password_hash text not null,
  app_base_url text,
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
  created_at timestamptz not null default now()
);

create index if not exists idx_appointments_tenant_start on appointments(tenant_slug, start_at);
create index if not exists idx_questions_project on questions(tenant_slug, project_code, sort_order);
create index if not exists idx_rules_consultant on availability_rules(tenant_slug, consultant_id);
create index if not exists idx_leads_project_email on leads(tenant_slug, project_code, client_email);
create index if not exists idx_email_queue_due on email_queue(status, scheduled_at);

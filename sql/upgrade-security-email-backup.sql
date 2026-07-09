alter table tenants add column if not exists webhook_secret text default '';

create table if not exists login_attempts (
  id bigserial primary key,
  tenant_slug text not null,
  email text not null,
  ip_address text not null default '',
  success boolean not null default false,
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

create unique index if not exists uq_active_appointment_slot
  on appointments(tenant_slug, consultant_id, start_at)
  where status not in ('已取消', 'cancelled', 'canceled');
create index if not exists idx_email_queue_retry on email_queue(status, scheduled_at, retry_count);
create index if not exists idx_login_attempts_lookup on login_attempts(tenant_slug, email, ip_address, created_at);
create index if not exists idx_admin_alerts_tenant_unresolved on admin_alerts(tenant_slug, resolved_at, created_at desc);
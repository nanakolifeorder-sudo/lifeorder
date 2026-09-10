create table if not exists payment_orders (
  id bigserial primary key,
  tenant_slug text not null references tenants(slug) on delete cascade,
  project_code text not null,
  version_code text not null default '',
  product_code text not null,
  product_name text not null,
  amount integer not null check (amount > 0),
  merchant_order_no text not null unique,
  public_token uuid not null unique,
  client_name text not null,
  client_email text not null,
  client_phone text not null,
  crm_contact_id bigint references crm_contacts(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'expired', 'refunded')),
  trade_no text default '',
  payment_type text default '',
  callback_payload jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_payment_orders_tenant_status on payment_orders(tenant_slug, status, created_at desc);
create index if not exists idx_payment_orders_client_phone on payment_orders(tenant_slug, client_phone, created_at desc);
create index if not exists idx_payment_orders_crm_contact on payment_orders(tenant_slug, crm_contact_id, paid_at desc);

alter table payment_orders add column if not exists crm_contact_id bigint references crm_contacts(id) on delete set null;
create index if not exists idx_payment_orders_crm_contact on payment_orders(tenant_slug, crm_contact_id, paid_at desc);

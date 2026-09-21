create table if not exists quiz_access_code_batches (
  id bigserial primary key,
  tenant_slug text not null references tenants(slug) on delete cascade,
  project_code text not null,
  version_code text not null default 'FULL',
  buyer_name text not null default '',
  buyer_email text not null,
  buyer_email_normalized text generated always as (lower(trim(buyer_email))) stored,
  label text not null default '',
  total_codes integer not null check (total_codes > 0),
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default '啟用',
  notes text not null default '',
  portal_token_hash text not null,
  portal_token_ciphertext text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_slug, portal_token_hash)
);

alter table quiz_access_codes
  add column if not exists batch_id bigint references quiz_access_code_batches(id) on delete set null;

create index if not exists idx_quiz_access_codes_batch on quiz_access_codes(tenant_slug, batch_id, id);
create index if not exists idx_quiz_access_code_batches_owner on quiz_access_code_batches(tenant_slug, buyer_email_normalized, id);

alter table appointments add column if not exists intake_token_hash text;
alter table appointments add column if not exists intake_token_ciphertext text;
alter table appointments add column if not exists intake_questions jsonb;
alter table appointments add column if not exists intake_submitted_at timestamptz;
create unique index if not exists uq_appointments_intake_token
  on appointments(tenant_slug, intake_token_hash) where intake_token_hash is not null;

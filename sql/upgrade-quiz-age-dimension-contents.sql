create table if not exists quiz_age_dimension_contents (
  id bigserial primary key,
  tenant_slug text not null references tenants(slug) on delete cascade,
  project_code text not null,
  version_code text not null,
  age_group text not null,
  dimension_key text not null,
  title text not null default '',
  body text default '',
  action_text text default '',
  sort_order integer not null default 0,
  status text not null default '啟用',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_slug, project_code, version_code, age_group, dimension_key),
  check (age_group in ('under_35', '35_45', '45_55', '55_65', '65_75', '75_plus'))
);

create index if not exists idx_quiz_age_dimension_contents_lookup
  on quiz_age_dimension_contents(tenant_slug, project_code, version_code, age_group, dimension_key);

alter table tenants
  add column if not exists booking_base_urls jsonb not null default '[]'::jsonb;

update tenants
set booking_base_urls = jsonb_build_array(app_base_url)
where app_base_url is not null
  and btrim(app_base_url) <> ''
  and booking_base_urls = '[]'::jsonb;

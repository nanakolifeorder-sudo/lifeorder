create table if not exists checkout_page_settings (
  tenant_slug text primary key references tenants(slug) on delete cascade,
  checkout_title text not null default '',
  checkout_description text not null default '',
  success_title text not null default '',
  success_description text not null default '',
  success_button_label text not null default '',
  success_image_url text not null default '',
  success_image_alt text not null default '',
  updated_at timestamptz not null default now()
);

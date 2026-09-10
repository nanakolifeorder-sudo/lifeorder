alter table quiz_access_codes
  add column if not exists per_phone_limit integer not null default 1;

update quiz_access_codes
   set per_phone_limit = coalesce(per_phone_limit, per_email_limit, 1)
 where per_phone_limit is null;

alter table quiz_access_code_usages
  add column if not exists client_phone text not null default '';

create index if not exists idx_quiz_access_code_usages_phone
  on quiz_access_code_usages(access_code_id, client_phone, used_at desc);

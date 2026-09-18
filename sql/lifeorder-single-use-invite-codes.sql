alter table quiz_access_codes
  drop constraint if exists quiz_access_codes_code_type_check;

alter table quiz_access_codes
  add constraint quiz_access_codes_code_type_check
  check (code_type in ('retest', 'discount', 'free_access', 'invite'));

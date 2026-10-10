-- F054: public intake is anonymous by default; email verification is an explicit organization policy.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
alter table public.shipping_email_access_settings add column require_verification boolean not null default false;
alter table public.shipping_email_access_settings add constraint shipping_email_requirement_enabled check (not require_verification or enabled);
commit;

-- The built-in administrator role is fixed. Its current organization, exact
-- role binding and account eligibility are still checked by the caller.
begin;

create or replace function private.system_super_admin_role_enabled_v1(p_org_id uuid)
returns boolean language sql stable set search_path = ''
as $$
  select exists (
    select 1 from public.organizations where id = p_org_id and status = 'active'
  ) and exists (
    select 1 from public.roles where code = 'SUPER_ADMIN'
  );
$$;

commit;

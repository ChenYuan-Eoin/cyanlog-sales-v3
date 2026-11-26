-- Organization data is read through authorized server routes and RPCs.
begin;

revoke all privileges on table
  public.organizations, public.departments, public.user_departments, public.user_roles, public.roles
  from public, anon, authenticated;

drop policy if exists "Anyone reads orgs" on public.organizations;
drop policy if exists "Same org reads departments" on public.departments;
drop policy if exists "Same org reads user_departments" on public.user_departments;
drop policy if exists "Same org reads user_roles" on public.user_roles;
drop policy if exists "Only readable roles are exposed in bindings" on public.user_roles;
drop policy if exists "Anyone reads roles" on public.roles;
drop policy if exists "Anyone reads global roles" on public.roles;

-- Keep the separate self-profile policy usable after role-table access is revoked.
drop policy if exists "Admins can view all profiles" on public.user_profiles;

commit;

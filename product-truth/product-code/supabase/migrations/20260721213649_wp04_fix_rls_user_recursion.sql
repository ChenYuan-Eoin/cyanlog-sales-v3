begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- The legacy users policy selects from public.users while public.users RLS is
-- already being evaluated. Resolve only the caller's organization through a
-- non-exposed, non-enumerable helper owned by the migration role.
create schema if not exists private;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.current_user_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select profile.org_id
    from public.users as profile
   where profile.id = (select auth.uid())
     and profile.status = 'active'
   limit 1
$function$;

comment on function private.current_user_org_id() is
  'Returns only the active authenticated caller organization for RLS evaluation.';

revoke all on function private.current_user_org_id()
  from public, anon, authenticated, service_role;
grant execute on function private.current_user_org_id()
  to authenticated;

alter table public.users enable row level security;
drop policy if exists "Same org reads users" on public.users;
create policy "Same org reads users" on public.users
  for select to authenticated
  using (
    (select private.current_user_org_id()) is not null
    and org_id = (select private.current_user_org_id())
  );

alter table public.user_organizations enable row level security;
drop policy if exists "Same org reads user_organizations" on public.user_organizations;
create policy "Current user reads own user_organizations" on public.user_organizations
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and org_id = (select private.current_user_org_id())
  );

-- Contract reads stay owner-only. Organization managers use the scoped server
-- API; broad same-organization browser reads are intentionally not an RLS role.
alter table public.contracts enable row level security;
drop policy if exists "Owner reads contracts" on public.contracts;
create policy "Owner reads contracts" on public.contracts
  for select to authenticated
  using (
    created_by = (select auth.uid())
    and org_id = (select private.current_user_org_id())
  );

alter table public.contract_versions enable row level security;
drop policy if exists "Same org reads contract_versions" on public.contract_versions;
drop policy if exists "Owner reads contract_versions" on public.contract_versions;
create policy "Owner reads contract_versions" on public.contract_versions
  for select to authenticated
  using (
    exists (
      select 1
        from public.contracts as owned_contract
       where owned_contract.id = contract_versions.contract_id
         and owned_contract.created_by = (select auth.uid())
         and owned_contract.org_id = (select private.current_user_org_id())
    )
  );

alter table public.contract_reviews enable row level security;
drop policy if exists "Owner reads contract_reviews" on public.contract_reviews;
create policy "Owner reads contract_reviews" on public.contract_reviews
  for select to authenticated
  using (
    exists (
      select 1
        from public.contracts as owned_contract
       where owned_contract.id = contract_reviews.contract_id
         and owned_contract.created_by = (select auth.uid())
         and owned_contract.org_id = (select private.current_user_org_id())
    )
  );

alter table public.contract_analysis_jobs enable row level security;
drop policy if exists "Owner reads contract_analysis_jobs" on public.contract_analysis_jobs;
create policy "Owner reads contract_analysis_jobs" on public.contract_analysis_jobs
  for select to authenticated
  using (
    exists (
      select 1
        from public.contracts as owned_contract
       where owned_contract.id = contract_analysis_jobs.contract_id
         and owned_contract.created_by = (select auth.uid())
         and owned_contract.org_id = (select private.current_user_org_id())
    )
  );

commit;

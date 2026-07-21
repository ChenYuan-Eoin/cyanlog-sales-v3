begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- WP04 is server mediated: authenticated browsers may read their own contract
-- chain, but they never need direct access to the internal user directory or
-- write privileges on ingestion/review tables. Keep tenant resolution behind
-- a non-enumerable helper and reject users whose login has been disabled.
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
     and profile.login_enabled is true
   limit 1
$function$;

comment on function private.current_user_org_id() is
  'Returns only the active, login-enabled authenticated caller organization for RLS evaluation.';

revoke all on function private.current_user_org_id()
  from public, anon, authenticated, service_role;
grant execute on function private.current_user_org_id()
  to authenticated;

-- Remove Supabase default/broad table ACLs. Browser writes use scoped server
-- routes with service_role; authenticated receives only the SELECTs needed by
-- the owner-facing contract UI. public.users remains server-only so a browser
-- can never select password_hash (or enumerate the organization directory).
revoke all privileges on table public.users
  from public, anon, authenticated;
revoke all privileges on table public.user_organizations
  from public, anon, authenticated;
revoke all privileges on table public.contracts
  from public, anon, authenticated;
revoke all privileges on table public.contract_versions
  from public, anon, authenticated;
revoke all privileges on table public.contract_reviews
  from public, anon, authenticated;
revoke all privileges on table public.contract_analysis_jobs
  from public, anon, authenticated;

grant select on table public.user_organizations
  to authenticated;
grant select on table public.contracts
  to authenticated;
grant select on table public.contract_versions
  to authenticated;
grant select on table public.contract_reviews
  to authenticated;
grant select on table public.contract_analysis_jobs
  to authenticated;

alter table public.users enable row level security;
drop policy if exists "Same org reads users" on public.users;

alter table public.user_organizations enable row level security;
drop policy if exists "Same org reads user_organizations" on public.user_organizations;
drop policy if exists "Current user reads own user_organizations" on public.user_organizations;
create policy "Current user reads own user_organizations" on public.user_organizations
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and org_id = (select private.current_user_org_id())
  );

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

-- Recreate the source mutation fence inside the clean WP04 lineage. The
-- protected snapshot also referenced contract_review_submission_batches, but
-- that optional workflow table does not exist in this release candidate.
-- Active analysis jobs are the authoritative source lock for WP04.
create or replace function public.prevent_active_review_source_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  active_submission_batch boolean := false;
begin
  -- Some Preview histories still contain the later review-submission workflow.
  -- Preserve its lock when present without making that optional table a parse-
  -- time dependency of the clean WP04 migration chain.
  if pg_catalog.to_regclass('public.contract_review_submission_batches') is not null then
    execute 'select exists (
      select 1
        from public.contract_review_submission_batches
       where contract_id = $1
         and status in (''checking'', ''review_running'')
    )'
      into active_submission_batch
      using old.id;
  end if;
  if active_submission_batch then
    raise exception 'contract source is locked by an active review submission batch'
      using errcode = '55000';
  end if;

  if exists (
    select 1
      from public.contract_analysis_jobs
     where contract_id = old.id
       and status in ('preparing', 'queued', 'running')
  ) then
    raise exception 'contract source is locked by an active analysis job'
      using errcode = '55000';
  end if;

  if new.current_version_id is null
     or new.current_version_id is not distinct from old.current_version_id then
    raise exception 'contract source mutation requires a new current version'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
      from public.contract_versions as version
     where version.id = new.current_version_id
       and version.contract_id = old.id
       and version.storage_path = new.storage_path
       and version.file_size = new.size
       and version.mime_type = new.mime_type
       and version.parsed_text is not distinct from new.parsed_text
  ) then
    raise exception 'new current version does not match the contract source mutation'
      using errcode = '23514';
  end if;

  new.status := 'PENDING';
  new.conclusion := 'PENDING';
  new.conclusion_reason := null;
  new.concluded_at := null;
  new.concluded_by := null;
  return new;
end
$function$;

revoke all on function public.prevent_active_review_source_mutation()
  from public, anon, authenticated;
grant execute on function public.prevent_active_review_source_mutation()
  to service_role;

drop trigger if exists trg_contract_source_active_review_lock on public.contracts;
create trigger trg_contract_source_active_review_lock
before update of storage_path, parsed_text, filename, mime_type, size, current_version_id
on public.contracts
for each row
when (
  old.storage_path is distinct from new.storage_path
  or old.parsed_text is distinct from new.parsed_text
  or old.filename is distinct from new.filename
  or old.mime_type is distinct from new.mime_type
  or old.size is distinct from new.size
  or old.current_version_id is distinct from new.current_version_id
)
execute function public.prevent_active_review_source_mutation();

-- Every new ReviewRun is bound to the current immutable source version and its
-- page-map identity. Existing legacy rows stay readable because the constraint
-- is NOT VALID and ordinary result/status updates do not fire this trigger.
alter table public.contract_reviews
  drop constraint if exists contract_reviews_source_identity_check;
alter table public.contract_reviews
  add constraint contract_reviews_source_identity_check
  check (
    (
      contract_version_id is null
      and source_storage_path is null
      and source_hash is null
      and source_text_hash is null
    )
    or (
      contract_version_id is not null
      and source_storage_path is not null
      and pg_catalog.btrim(source_storage_path) <> ''
      and source_hash ~ '^[0-9a-f]{64}$'
      and source_text_hash ~ '^[0-9a-f]{64}$'
    )
  ) not valid;

create or replace function public.enforce_current_contract_review_source_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_version_id uuid;
  version_storage_path text;
  version_source_hash text;
  version_text_hash text;
  page_map_storage_path text;
  page_map_source_hash text;
  page_map_text_hash text;
begin
  if new.contract_version_id is null
     or new.source_storage_path is null
     or pg_catalog.btrim(new.source_storage_path) = ''
     or coalesce(new.source_hash, '') !~ '^[0-9a-f]{64}$'
     or coalesce(new.source_text_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'new or identity-changing review rows require complete source identity'
      using errcode = '23514';
  end if;

  select contract.current_version_id,
         version.storage_path,
         version.file_sha256,
         version.text_sha256,
         page_map.storage_path,
         page_map.source_hash,
         page_map.source_text_hash
    into current_version_id,
         version_storage_path,
         version_source_hash,
         version_text_hash,
         page_map_storage_path,
         page_map_source_hash,
         page_map_text_hash
    from public.contracts as contract
    join public.contract_versions as version
      on version.id = contract.current_version_id
     and version.contract_id = contract.id
    join public.contract_source_page_maps as page_map
      on page_map.contract_id = contract.id
     and page_map.contract_version_id = version.id
   where contract.id = new.contract_id
   for share of contract, version, page_map;

  if not found then
    raise exception 'current contract source identity is missing'
      using errcode = '23514';
  end if;
  if new.contract_version_id is distinct from current_version_id
     or new.source_storage_path is distinct from version_storage_path
     or new.source_hash is distinct from version_source_hash
     or new.source_text_hash is distinct from version_text_hash
     or new.source_storage_path is distinct from page_map_storage_path
     or new.source_hash is distinct from page_map_source_hash
     or new.source_text_hash is distinct from page_map_text_hash then
    raise exception 'review source identity does not match the current source version and page map'
      using errcode = '23514';
  end if;

  return new;
end
$function$;

revoke all on function public.enforce_current_contract_review_source_identity()
  from public, anon, authenticated;
grant execute on function public.enforce_current_contract_review_source_identity()
  to service_role;

drop trigger if exists trg_contract_review_run_source_identity on public.contract_reviews;
create trigger trg_contract_review_run_source_identity
before insert or update of contract_id, contract_version_id, source_storage_path, source_hash, source_text_hash
on public.contract_reviews
for each row execute function public.enforce_current_contract_review_source_identity();

-- SQLSTATE 40001 tells clients that retrying the entire transaction can
-- succeed. These branches are deterministic stale-state fences, so expose
-- check_violation (23514) instead. Rebuild only the six WP04 routines and
-- preserve their bodies, ownership, signatures and grants.
do $repair$
declare
  routine record;
  routine_definition text;
  repaired_definition text;
  repaired_names text[] := array[]::text[];
  required_names constant text[] := array[
    'finalize_contract_source_version',
    'start_initial_contract_review',
    'start_initial_contract_review_fenced',
    'mark_contract_analysis_job_running',
    'mark_contract_analysis_job_completed',
    'mark_contract_analysis_job_failed'
  ];
begin
  for routine in
    select routine_proc.oid, routine_proc.proname
      from pg_catalog.pg_proc as routine_proc
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = routine_proc.pronamespace
     where namespace.nspname = 'public'
       and routine_proc.proname = any(required_names)
  loop
    routine_definition := pg_catalog.pg_get_functiondef(routine.oid);
    repaired_definition := pg_catalog.replace(
      routine_definition,
      '40001',
      '23514'
    );
    if repaired_definition is distinct from routine_definition then
      execute repaired_definition;
    end if;
    repaired_names := pg_catalog.array_append(repaired_names, routine.proname);
  end loop;

  if exists (
    select 1
      from pg_catalog.unnest(required_names) as required_name
     where not (required_name = any(repaired_names))
  ) then
    raise exception 'one or more WP04 state-fence functions are missing'
      using errcode = '42704';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_proc as routine_proc
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = routine_proc.pronamespace
     where namespace.nspname = 'public'
       and routine_proc.proname = any(required_names)
       and pg_catalog.pg_get_functiondef(routine_proc.oid) like '%40001%'
  ) then
    raise exception 'WP04 deterministic state fence still exposes SQLSTATE 40001'
      using errcode = '23514';
  end if;
end
$repair$;

commit;

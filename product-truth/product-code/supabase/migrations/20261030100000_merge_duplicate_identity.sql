-- F003 / WP94. Reusable, audited account consolidation.
-- The explicitly selected primary account remains authoritative. The duplicate
-- is retained as an inactive historical record; no local or external identity
-- is guessed from name, phone or employee number.
begin;

create or replace function public.admin_merge_duplicate_identity_v1(
  p_actor_id uuid,
  p_org_id uuid,
  p_primary_user_id uuid,
  p_duplicate_user_id uuid,
  p_reason text,
  p_request_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_primary_before jsonb;
  v_duplicate_before jsonb;
  v_primary_phone text;
  v_duplicate_phone text;
  v_primary_employee_id text;
  v_duplicate_employee_id text;
  v_roles_moved integer := 0;
  v_departments_moved integer := 0;
  v_mappings_moved integer := 0;
  v_tokens_revoked integer := 0;
  v_periods_closed integer := 0;
  v_authoritative_mappings integer := 0;
  v_generic_total integer := 0;
  v_generic_updates jsonb := '{}'::jsonb;
  v_count integer := 0;
  v_now timestamptz := now();
  constraint_row record;
begin
  if p_actor_id is null
    or p_org_id is null
    or p_primary_user_id is null
    or p_duplicate_user_id is null
    or p_primary_user_id = p_duplicate_user_id
    or nullif(btrim(coalesce(p_reason, '')), '') is null
    or char_length(btrim(p_reason)) > 1000 then
    raise exception 'invalid duplicate identity merge input'
      using errcode = '22023';
  end if;

  perform private.personnel_lock_org_v1(p_org_id);

  if not exists (
    select 1
      from public.users as actor
      join public.user_organizations as membership
        on membership.user_id = actor.id
       and membership.org_id = p_org_id
       and membership.status = 'active'
       and membership.employment_status = 'active'
      join public.user_roles as assignment
        on assignment.user_id = actor.id
       and assignment.org_id = p_org_id
       and assignment.scope_type = 'org'
       and assignment.scope_id = p_org_id
      join public.roles as role
        on role.id = assignment.role_id
     where actor.id = p_actor_id
       and actor.org_id = p_org_id
       and actor.status = 'active'
       and actor.login_enabled = true
       and role.code = 'SUPER_ADMIN'
  ) then
    raise exception 'only an active organization SUPER_ADMIN may merge duplicate identities'
      using errcode = '42501';
  end if;

  select
    jsonb_build_object(
      'display_name', user_row.display_name,
      'email', user_row.email,
      'phone', user_row.phone,
      'employee_id', user_row.employee_id,
      'status', user_row.status,
      'login_enabled', user_row.login_enabled
    ),
    user_row.phone,
    user_row.employee_id
  into v_primary_before, v_primary_phone, v_primary_employee_id
  from public.users as user_row
  where user_row.id = p_primary_user_id
    and user_row.org_id = p_org_id
    and user_row.status = 'active'
    and user_row.login_enabled = true
  for update;

  if v_primary_before is null then
    raise exception 'primary identity must be an active login-enabled member of the organization'
      using errcode = '23514';
  end if;

  select
    jsonb_build_object(
      'display_name', user_row.display_name,
      'email', user_row.email,
      'phone', user_row.phone,
      'employee_id', user_row.employee_id,
      'status', user_row.status,
      'login_enabled', user_row.login_enabled
    ),
    user_row.phone,
    user_row.employee_id
  into v_duplicate_before, v_duplicate_phone, v_duplicate_employee_id
  from public.users as user_row
  where user_row.id = p_duplicate_user_id
    and user_row.org_id = p_org_id
  for update;

  if v_duplicate_before is null then
    raise exception 'duplicate identity must belong to the organization'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.user_organizations
     where user_id = p_duplicate_user_id
       and org_id = p_org_id
       and offboard_reason like 'merged_into:%'
  ) then
    raise exception 'duplicate identity has already been merged'
      using errcode = '23505';
  end if;

  if not exists (
    select 1
      from public.user_organizations
     where user_id = p_primary_user_id
       and org_id = p_org_id
       and status = 'active'
       and employment_status = 'active'
  ) or not exists (
    select 1
      from public.user_organizations
     where user_id = p_duplicate_user_id
       and org_id = p_org_id
  ) then
    raise exception 'both identities require organization memberships'
      using errcode = '23514';
  end if;

  select count(*)
  into v_authoritative_mappings
  from public.external_identities as mapping
  join public.organization_sources as source
    on source.id = mapping.source_id
   and source.system_org_id = mapping.system_org_id
  where mapping.system_org_id = p_org_id
    and mapping.canonical_user_id = p_primary_user_id
    and mapping.match_status = 'matched'
    and source.status = 'active'
    and source.authority_scope->>'identity' = 'authoritative';

  if v_authoritative_mappings <> 1 then
    raise exception 'primary identity requires exactly one active authoritative source mapping'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.external_identities as duplicate_mapping
      join public.external_identities as primary_mapping
        on primary_mapping.source_id = duplicate_mapping.source_id
       and primary_mapping.system_org_id = p_org_id
       and primary_mapping.canonical_user_id = p_primary_user_id
       and primary_mapping.match_status = 'matched'
     where duplicate_mapping.system_org_id = p_org_id
       and duplicate_mapping.canonical_user_id = p_duplicate_user_id
       and duplicate_mapping.match_status = 'matched'
  ) then
    raise exception 'primary and duplicate both have a stable mapping for the same source'
      using errcode = '23505';
  end if;

  insert into public.user_roles (
    user_id, role_id, scope_type, scope_id, granted_by, granted_at, org_id
  )
  select
    p_primary_user_id, role_id, scope_type, scope_id, granted_by, granted_at, p_org_id
  from public.user_roles
  where user_id = p_duplicate_user_id
    and org_id = p_org_id
  on conflict do nothing;
  get diagnostics v_roles_moved = row_count;
  delete from public.user_roles
  where user_id = p_duplicate_user_id
    and org_id = p_org_id;

  insert into public.user_departments (
    user_id, department_id, is_primary, joined_at, org_id
  )
  select
    p_primary_user_id, department_id, false, joined_at, p_org_id
  from public.user_departments
  where user_id = p_duplicate_user_id
    and org_id = p_org_id
  on conflict do nothing;
  get diagnostics v_departments_moved = row_count;
  delete from public.user_departments
  where user_id = p_duplicate_user_id
    and org_id = p_org_id;

  update public.external_identities
     set canonical_user_id = p_primary_user_id,
         updated_at = v_now
   where canonical_user_id = p_duplicate_user_id
     and system_org_id = p_org_id;
  get diagnostics v_mappings_moved = row_count;

  delete from public.auth_tokens
   where user_id = p_duplicate_user_id;
  get diagnostics v_tokens_revoked = row_count;

  update public.personnel_employment_periods
     set status = 'ended',
         ended_at = v_now,
         end_reason = 'merged_into:' || p_primary_user_id::text || ':' || btrim(p_reason),
         updated_at = v_now
   where user_id = p_duplicate_user_id
     and org_id = p_org_id
     and status in ('active', 'suspended');
  get diagnostics v_periods_closed = row_count;

  if not exists (
    select 1
      from public.user_profiles
     where user_id = p_primary_user_id
  ) then
    update public.user_profiles
       set user_id = p_primary_user_id
     where user_id = p_duplicate_user_id;
  end if;

  update public.user_organizations
     set status = 'ended',
         left_at = v_now,
         membership_version = membership_version + 1,
         employment_status = 'ended',
         employment_ended_at = v_now,
         offboard_reason = 'merged_into:' || p_primary_user_id::text || ':' || btrim(p_reason),
         updated_at = v_now
   where user_id = p_duplicate_user_id
     and org_id = p_org_id;

  if v_primary_phone is null and v_duplicate_phone is not null then
    update public.users
       set phone = v_duplicate_phone,
           updated_at = v_now
     where id = p_primary_user_id;
  end if;

  if v_primary_employee_id is null and v_duplicate_employee_id is not null then
    update public.users
       set employee_id = v_duplicate_employee_id,
           updated_at = v_now
     where id = p_primary_user_id;
  end if;

  update public.users
     set status = 'inactive',
         login_enabled = false,
         phone = null,
         employee_id = null,
         updated_at = v_now
   where id = p_duplicate_user_id
     and org_id = p_org_id;

  for constraint_row in
    select distinct
      src.relname as table_name,
      src_col.attname as column_name
    from pg_constraint as con
    join pg_class as src
      on src.oid = con.conrelid
    join pg_namespace as src_ns
      on src_ns.oid = src.relnamespace
    join pg_class as target
      on target.oid = con.confrelid
    join pg_namespace as target_ns
      on target_ns.oid = target.relnamespace
    join unnest(con.conkey) with ordinality as keys(attnum, ord)
      on true
    join unnest(con.confkey) with ordinality as refs(attnum, ord)
      on refs.ord = keys.ord
    join pg_attribute as src_col
      on src_col.attrelid = src.oid
     and src_col.attnum = keys.attnum
    join pg_attribute as target_col
      on target_col.attrelid = target.oid
     and target_col.attnum = refs.attnum
    where con.contype = 'f'
      and src_ns.nspname = 'public'
      and target_ns.nspname = 'public'
      and target.relname = 'users'
      and target_col.attname = 'id'
      and src.relname not in (
        'users',
        'user_organizations',
        'user_roles',
        'user_departments',
        'user_profiles',
        'auth_tokens',
        'external_identities',
        'personnel_employment_periods',
        'personnel_lifecycle_events'
      )
  loop
    execute format(
      'update public.%I set %I = $1 where %I = $2',
      constraint_row.table_name,
      constraint_row.column_name,
      constraint_row.column_name
    ) using p_primary_user_id, p_duplicate_user_id;
    get diagnostics v_count = row_count;
    if v_count > 0 then
      v_generic_total := v_generic_total + v_count;
      v_generic_updates := v_generic_updates || jsonb_build_object(
        constraint_row.table_name || '.' || constraint_row.column_name,
        v_count
      );
    end if;
  end loop;

  update public.users
     set report_to_user_id = p_primary_user_id,
         updated_at = v_now
   where report_to_user_id = p_duplicate_user_id
     and id <> p_duplicate_user_id
     and id <> p_primary_user_id
     and org_id = p_org_id;
  get diagnostics v_count = row_count;
  if v_count > 0 then
    v_generic_total := v_generic_total + v_count;
    v_generic_updates := v_generic_updates || jsonb_build_object(
      'users.report_to_user_id',
      v_count
    );
  end if;
  update public.users
     set report_to_user_id = null,
         updated_at = v_now
   where id = p_primary_user_id
     and report_to_user_id = p_duplicate_user_id;

  perform private.personnel_insert_event_v1(
    p_org_id,
    p_primary_user_id,
    p_actor_id,
    'merge_duplicate_identity_primary',
    v_primary_before,
    jsonb_build_object(
      'duplicate_user_id', p_duplicate_user_id,
      'roles_moved', v_roles_moved,
      'departments_moved', v_departments_moved,
      'mappings_moved', v_mappings_moved,
      'generic_reference_updates', v_generic_updates,
      'generic_reference_total', v_generic_total
    ),
    'primary account retained: ' || p_reason,
    p_request_id
  );

  perform private.personnel_insert_event_v1(
    p_org_id,
    p_duplicate_user_id,
    p_actor_id,
    'merge_duplicate_identity_source',
    v_duplicate_before,
    jsonb_build_object(
      'primary_user_id', p_primary_user_id,
      'status', 'inactive',
      'login_enabled', false,
      'phone_cleared', v_duplicate_phone is not null,
      'employee_id_cleared', v_duplicate_employee_id is not null,
      'tokens_revoked', v_tokens_revoked,
      'employment_periods_closed', v_periods_closed
    ),
    'source account retained as inactive history: ' || p_reason,
    p_request_id
  );

  return jsonb_build_object(
    'primary_user_id', p_primary_user_id,
    'duplicate_user_id', p_duplicate_user_id,
    'org_id', p_org_id,
    'roles_moved', v_roles_moved,
    'departments_moved', v_departments_moved,
    'mappings_moved', v_mappings_moved,
    'tokens_revoked', v_tokens_revoked,
    'employment_periods_closed', v_periods_closed,
    'generic_reference_updates', v_generic_updates,
    'generic_reference_total', v_generic_total
  );
end;
$$;

revoke all on function public.admin_merge_duplicate_identity_v1(uuid,uuid,uuid,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.admin_merge_duplicate_identity_v1(uuid,uuid,uuid,uuid,text,text)
  to service_role;

comment on function public.admin_merge_duplicate_identity_v1(uuid,uuid,uuid,uuid,text,text) is
  'Service-role-only audited merge of an explicit duplicate identity into an explicit active primary account; source history is retained as inactive.';

commit;

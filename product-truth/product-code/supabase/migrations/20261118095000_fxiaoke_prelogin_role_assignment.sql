-- WP44 / F003. Pending rows are administrative intent, never runtime access.
create table public.fxiaoke_pending_org_roles (
  org_id uuid not null,
  user_id uuid not null,
  role_id uuid not null references public.roles(id) on delete cascade,
  source_id uuid not null references public.organization_sources(id) on delete cascade,
  external_identity_id uuid not null references public.external_identities(id) on delete cascade,
  external_user_id text not null,
  granted_by uuid references public.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (org_id, user_id, role_id),
  foreign key (user_id, org_id) references public.user_organizations(user_id, org_id) on delete cascade
);
alter table public.fxiaoke_pending_org_roles enable row level security;
revoke all on public.fxiaoke_pending_org_roles from public, anon, authenticated, service_role;
grant select on public.fxiaoke_pending_org_roles to service_role;

-- This one predicate backs the directory, admin save and verified first-login grant.
create function public.fxiaoke_prelogin_role_targets_v1(p_org_id uuid, p_user_id uuid default null)
returns table (user_id uuid, source_id uuid, identity_id uuid, external_user_id text)
language sql stable security definer set search_path = ''
as $$
  select person.id, source.id, identity.id, identity.external_user_id
  from public.users person
  join public.user_organizations membership on membership.user_id = person.id and membership.org_id = person.org_id
  join public.organization_sources source on source.system_org_id = person.org_id and source.provider = 'fxiaoke'
  join public.external_identities identity on identity.system_org_id = person.org_id and identity.source_id = source.id
    and identity.canonical_user_id = person.id
  where person.org_id = p_org_id and (p_user_id is null or person.id = p_user_id)
    and person.status = 'inactive' and person.login_enabled = false
    and person.password_hash is null and person.last_login_at is null
    and membership.status = 'invited' and membership.employment_status = 'active' and membership.is_default
    and source.status = 'active' and source.connection_state = 'verified' and source.effective_revision is not null
    and source.authority_scope->>'identity' = 'authoritative' and source.authority_scope->>'directory' = 'authoritative'
    and identity.match_status = 'matched' and identity.external_user_id <> ''
    and identity.profile_snapshot->>'provisionedMemberId' = person.id::text
    and identity.profile_snapshot->>'status' = 'active'
    and identity.profile_snapshot->>'loginDisabled' is distinct from 'true'
    and identity.profile_snapshot->>'deleted' is distinct from 'true'
    -- An admin may explicitly disable an already inactive, never-logged-in account.
    -- Its current flags alone are identical to an untouched directory reservation.
    and not coalesce((
      select event.after_state->>'login_enabled' = 'false' or event.after_state->>'status' in ('inactive','suspended')
      from public.personnel_lifecycle_events event
      where event.org_id = p_org_id and event.target_user_id = person.id and event.command = 'set_account_state'
      order by event.occurred_at desc, event.id desc limit 1
    ), false)
    and not exists (
      select 1 from public.organization_sources other
      where other.system_org_id = p_org_id and other.provider = 'fxiaoke' and other.id <> source.id
    )
    and not exists (
      select 1 from public.external_identities other
      where other.source_id = source.id and other.canonical_user_id = person.id and other.id <> identity.id
        and other.match_status in ('matched', 'conflict')
    );
$$;
revoke all on function public.fxiaoke_prelogin_role_targets_v1(uuid,uuid) from public, anon, authenticated;
grant execute on function public.fxiaoke_prelogin_role_targets_v1(uuid,uuid) to service_role;

create or replace function public.admin_replace_org_roles_v1(
  p_actor_id uuid,
  p_org_id uuid,
  p_user_id uuid,
  p_role_ids uuid[],
  p_reason text default null,
  p_request_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_role_id uuid;
  v_valid_count integer;
  v_target record;
  v_pending boolean;
  v_deleted integer;
  v_inserted integer;
begin
  perform private.personnel_lock_org_v1(p_org_id);
  perform private.personnel_assert_last_admin_safe_v1(p_user_id, p_org_id);

  select not exists (
    select 1 from public.user_organizations
    where user_id = p_user_id and org_id = p_org_id and status = 'active'
  ) into v_pending;
  if v_pending then
    select * into v_target from public.fxiaoke_prelogin_role_targets_v1(p_org_id, p_user_id);
    if not found then return false; end if;
  end if;

  select count(*) into v_valid_count
  from public.roles
  where id = any(coalesce(p_role_ids, array[]::uuid[]));

  if v_valid_count <> cardinality(coalesce(p_role_ids, array[]::uuid[])) then
    raise exception 'role does not exist' using errcode = '23503';
  end if;

  if v_pending then
    select coalesce(jsonb_agg(role_id order by role_id), '[]'::jsonb) into v_before
    from public.fxiaoke_pending_org_roles where org_id = p_org_id and user_id = p_user_id;

    delete from public.fxiaoke_pending_org_roles
    where org_id = p_org_id and user_id = p_user_id
      and (not (role_id = any(coalesce(p_role_ids, array[]::uuid[])))
        or source_id <> v_target.source_id or external_identity_id <> v_target.identity_id
        or external_user_id <> v_target.external_user_id);
    get diagnostics v_deleted = row_count;
    insert into public.fxiaoke_pending_org_roles
      (org_id, user_id, role_id, source_id, external_identity_id, external_user_id, granted_by)
    select p_org_id, p_user_id, wanted.role_id, v_target.source_id, v_target.identity_id,
      v_target.external_user_id, p_actor_id from unnest(p_role_ids) wanted(role_id)
    on conflict (org_id, user_id, role_id) do nothing;
    get diagnostics v_inserted = row_count;
    if v_deleted = 0 and v_inserted = 0 then return true; end if;

    select coalesce(jsonb_agg(role_id order by role_id), '[]'::jsonb) into v_after
    from public.fxiaoke_pending_org_roles where org_id = p_org_id and user_id = p_user_id;
    perform private.personnel_insert_event_v1(
      p_org_id, p_user_id, p_actor_id, 'assign_org_roles',
      jsonb_build_object('pending_role_ids', v_before), jsonb_build_object('pending_role_ids', v_after),
      p_reason, p_request_id
    );
    return true;
  end if;

  delete from public.fxiaoke_pending_org_roles where org_id = p_org_id and user_id = p_user_id;
  select coalesce(jsonb_agg(role_id), '[]'::jsonb)
  into v_before
  from public.user_roles
  where user_id = p_user_id
    and org_id = p_org_id
    and scope_type = 'org'
    and scope_id = p_org_id;

  delete from public.user_roles
  where user_id = p_user_id
    and org_id = p_org_id
    and scope_type = 'org'
    and scope_id = p_org_id;

  foreach v_role_id in array coalesce(p_role_ids, array[]::uuid[]) loop
    insert into public.user_roles (
      user_id, role_id, org_id, scope_type, scope_id, granted_by
    ) values (
      p_user_id, v_role_id, p_org_id, 'org', p_org_id, p_actor_id
    );
  end loop;

  select coalesce(jsonb_agg(role_id), '[]'::jsonb)
  into v_after
  from public.user_roles
  where user_id = p_user_id
    and org_id = p_org_id
    and scope_type = 'org'
    and scope_id = p_org_id;

  perform private.personnel_insert_event_v1(
    p_org_id, p_user_id, p_actor_id, 'assign_org_roles',
    jsonb_build_object('role_ids', v_before), jsonb_build_object('role_ids', v_after),
    p_reason, p_request_id
  );
  return true;
end;
$$;

-- Editors submit the set they saw. A different administrator or first login may
-- have changed it since the page loaded. Compare inside the same organization lock.
create function public.admin_replace_org_roles_if_current_v1(
  p_actor_id uuid, p_org_id uuid, p_user_id uuid, p_role_ids uuid[], p_expected_role_ids uuid[],
  p_reason text default null, p_request_id text default null
)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_current uuid[];
begin
  perform private.personnel_lock_org_v1(p_org_id);
  select array(
    select assignment.role_id from public.user_roles assignment
    where assignment.org_id = p_org_id and assignment.user_id = p_user_id
      and assignment.scope_type = 'org' and assignment.scope_id = p_org_id
    union
    select pending.role_id from public.fxiaoke_pending_org_roles pending
    join public.fxiaoke_prelogin_role_targets_v1(p_org_id, p_user_id) target
      on target.source_id = pending.source_id and target.identity_id = pending.external_identity_id
      and target.external_user_id = pending.external_user_id
    where pending.org_id = p_org_id and pending.user_id = p_user_id
    order by role_id
  ) into v_current;
  if p_expected_role_ids is null or v_current <> array(
    select distinct role_id from unnest(p_expected_role_ids) expected(role_id) order by role_id
  ) then return 'conflict'; end if;
  if public.admin_replace_org_roles_v1(p_actor_id, p_org_id, p_user_id, p_role_ids, p_reason, p_request_id)
    then return 'saved'; end if;
  return 'ineligible';
end;
$$;
revoke all on function public.admin_replace_org_roles_if_current_v1(uuid,uuid,uuid,uuid[],uuid[],text,text)
  from public, anon, authenticated;
grant execute on function public.admin_replace_org_roles_if_current_v1(uuid,uuid,uuid,uuid[],uuid[],text,text)
  to service_role;

create or replace function public.activate_fxiaoke_sso_member_v1(
  p_org_id uuid,
  p_external_user_id text,
  p_expected_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.organization_sources%rowtype;
  v_identity public.external_identities%rowtype;
  v_person public.users%rowtype;
  v_membership public.user_organizations%rowtype;
  v_source_count integer;
  v_applied uuid[];
begin
  perform private.personnel_lock_org_v1(p_org_id);
  select count(*) into v_source_count from public.organization_sources
   where system_org_id = p_org_id and provider = 'fxiaoke';
  if v_source_count <> 1 then return null; end if;

  select * into v_source from public.organization_sources
   where system_org_id = p_org_id and provider = 'fxiaoke' for update;
  if v_source.status <> 'active' or v_source.connection_state <> 'verified'
    or v_source.effective_revision is null
    or v_source.authority_scope->>'identity' <> 'authoritative'
    or v_source.authority_scope->>'directory' <> 'authoritative'
  then return null; end if;

  select * into v_identity from public.external_identities
   where source_id = v_source.id and system_org_id = p_org_id
     and external_user_id = p_external_user_id and match_status = 'matched'
     and canonical_user_id = p_expected_user_id for update;
  if not found or v_identity.canonical_user_id is null
    or v_identity.profile_snapshot->>'provisionedMemberId' <> v_identity.canonical_user_id::text
    or v_identity.profile_snapshot->>'status' <> 'active'
    or v_identity.profile_snapshot->>'loginDisabled' = 'true'
  then return null; end if;

  select * into v_person from public.users
   where id = v_identity.canonical_user_id and org_id = p_org_id for update;
  if not found then return null; end if;
  select * into v_membership from public.user_organizations
   where user_id = v_person.id and org_id = p_org_id for update;
  if not found or v_membership.employment_status <> 'active'
    or v_membership.is_default is distinct from true
  then return null; end if;

  if v_person.status = 'active' and v_person.login_enabled = true
    and v_membership.status = 'active' then return v_person.id; end if;
  -- Revalidate the directory reservation under the same lock as administrative edits.
  if not exists (
    select 1 from public.fxiaoke_prelogin_role_targets_v1(p_org_id, v_person.id) target
    where target.source_id = v_source.id and target.identity_id = v_identity.id
      and target.external_user_id = p_external_user_id
  ) then return null; end if;

  update public.users set status = 'active', login_enabled = true, updated_at = now()
   where id = v_person.id and org_id = p_org_id;
  update public.user_organizations set status = 'active', updated_at = now()
   where user_id = v_person.id and org_id = p_org_id;
  -- The existing effective-role trigger now sees an active membership in this transaction.
  with applied as (
    insert into public.user_roles (user_id, role_id, org_id, scope_type, scope_id, granted_by)
    select pending.user_id, pending.role_id, pending.org_id, 'org', pending.org_id, pending.granted_by
    from public.fxiaoke_pending_org_roles pending
    where pending.org_id = p_org_id and pending.user_id = v_person.id
      and pending.source_id = v_source.id and pending.external_identity_id = v_identity.id
      and pending.external_user_id = p_external_user_id
    on conflict (user_id, role_id, scope_type, scope_id) do nothing
    returning role_id
  )
  select coalesce(array_agg(role_id order by role_id), array[]::uuid[]) into v_applied from applied;
  delete from public.fxiaoke_pending_org_roles where org_id = p_org_id and user_id = v_person.id;
  perform private.personnel_insert_event_v1(
    p_org_id, v_person.id, v_person.id, 'fxiaoke_sso_account_enabled',
    jsonb_build_object('account_status', v_person.status, 'membership_status', v_membership.status),
    jsonb_build_object('account_status', 'active', 'membership_status', 'active', 'role_granted', cardinality(v_applied) > 0,
      'preassigned_role_ids', v_applied),
    'verified Fxiaoke identity prepared for first login', null
  );
  return v_person.id;
end;
$$;

create function public.get_org_admin_directory_payload_v2(p_org_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$
  with base as (select public.get_org_admin_directory_payload_v1(p_org_id) as payload),
  targets as (select * from public.fxiaoke_prelogin_role_targets_v1(p_org_id)),
  pending as (
    select grant_row.user_id, jsonb_agg(jsonb_build_object(
      'id', role.id, 'code', role.code, 'name', role.name
    ) order by role.name, role.id) as roles
    from public.fxiaoke_pending_org_roles grant_row
    join public.roles role on role.id = grant_row.role_id
    join targets on targets.user_id = grant_row.user_id and targets.source_id = grant_row.source_id
      and targets.identity_id = grant_row.external_identity_id and targets.external_user_id = grant_row.external_user_id
    where grant_row.org_id = p_org_id group by grant_row.user_id
  )
  select base.payload || jsonb_build_object('users', coalesce((
    select jsonb_agg(member.value || jsonb_build_object(
      'can_preassign_org_roles', targets.user_id is not null,
      'pending_org_roles', coalesce(pending.roles, '[]'::jsonb)
    ) order by member.ordinality)
    from jsonb_array_elements(base.payload->'users') with ordinality member(value, ordinality)
    left join targets on targets.user_id = (member.value->>'id')::uuid
    left join pending on pending.user_id = targets.user_id
  ), '[]'::jsonb)) from base;
$$;
revoke all on function public.get_org_admin_directory_payload_v2(uuid) from public, anon, authenticated;
grant execute on function public.get_org_admin_directory_payload_v2(uuid) to service_role;

-- Keep verified pending roles removable after an administrator stops first login.
begin;

create function private.fxiaoke_prelogin_directory_members_v1(p_org_id uuid, p_user_id uuid)
returns table (user_id uuid, source_id uuid, identity_id uuid, external_user_id text, login_stopped boolean)
language sql stable set search_path = ''
as $$
  select person.id, source.id, identity.id, identity.external_user_id, coalesce((
    select event.after_state->>'login_enabled' = 'false' or event.after_state->>'status' in ('inactive','suspended')
    from public.personnel_lifecycle_events event
    where event.org_id = p_org_id and event.target_user_id = person.id and event.command = 'set_account_state'
    order by event.occurred_at desc, event.id desc limit 1
  ), false)
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
revoke all on function private.fxiaoke_prelogin_directory_members_v1(uuid, uuid)
  from public, anon, authenticated, service_role;

-- The eligibility shared by SSO and all pending-grant writers still rejects stopped members.
create or replace function public.fxiaoke_prelogin_role_targets_v1(p_org_id uuid, p_user_id uuid default null)
returns table (user_id uuid, source_id uuid, identity_id uuid, external_user_id text)
language sql stable security definer set search_path = ''
as $$
  select target.user_id, target.source_id, target.identity_id, target.external_user_id
  from private.fxiaoke_prelogin_directory_members_v1(p_org_id, p_user_id) target
  where not target.login_stopped;
$$;

create or replace function public.admin_replace_org_roles_if_current_v1(
  p_actor_id uuid, p_org_id uuid, p_user_id uuid, p_role_ids uuid[], p_expected_role_ids uuid[],
  p_reason text default null, p_request_id text default null
)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_target record;
  v_current uuid[];
  v_requested uuid[];
begin
  perform private.assert_system_role_assignment_actor_v1(p_actor_id, p_org_id);

  select * into v_target
  from private.fxiaoke_prelogin_directory_members_v1(p_org_id, p_user_id) target
  where target.login_stopped and target.user_id = p_user_id;
  if not found then
    return private.admin_replace_org_roles_if_current_before_system_actor_v1(
      p_actor_id, p_org_id, p_user_id, p_role_ids, p_expected_role_ids, p_reason, p_request_id
    );
  end if;

  if p_user_id = p_actor_id or private.has_exact_org_role_v1(p_user_id, p_org_id, 'SUPER_ADMIN') then
    raise exception 'stopped pending roles cannot change the administrator'
      using errcode = '42501';
  end if;

  select array(
    select pending.role_id
    from public.fxiaoke_pending_org_roles pending
    join public.admin_list_org_roles_v1(p_org_id) role on role.id = pending.role_id
    where pending.org_id = p_org_id and pending.user_id = p_user_id
      and pending.source_id = v_target.source_id and pending.external_identity_id = v_target.identity_id
      and pending.external_user_id = v_target.external_user_id
      and role.code not in ('SUPER_ADMIN', 'ORG_SUPER_ADMIN', 'FXIAOKE_BASELINE')
    order by pending.role_id
  ) into v_current;

  if p_expected_role_ids is null or v_current <> array(
    select distinct role_id from unnest(p_expected_role_ids) expected(role_id) order by role_id
  ) then return 'conflict'; end if;

  if p_role_ids is null then return 'ineligible'; end if;
  v_requested := array(select distinct role_id from unnest(p_role_ids) requested(role_id) order by role_id);
  if not (v_requested <@ v_current) then return 'ineligible'; end if;
  if v_requested = v_current then return 'saved'; end if;

  delete from public.fxiaoke_pending_org_roles pending
  where pending.org_id = p_org_id and pending.user_id = p_user_id
    and pending.source_id = v_target.source_id and pending.external_identity_id = v_target.identity_id
    and pending.external_user_id = v_target.external_user_id
    and pending.role_id = any(v_current) and not (pending.role_id = any(v_requested));

  perform private.personnel_insert_event_v1(
    p_org_id, p_user_id, p_actor_id, 'assign_org_roles',
    jsonb_build_object('pending_role_ids', v_current), jsonb_build_object('pending_role_ids', v_requested),
    p_reason, p_request_id
  );
  return 'saved';
end;
$$;

create or replace function public.get_org_admin_directory_payload_v2(p_org_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  with base as (select public.get_org_admin_directory_payload_v1(p_org_id) as payload),
  targets as (
    select * from private.fxiaoke_prelogin_directory_members_v1(p_org_id, null) target
    where not target.login_stopped or not private.has_exact_org_role_v1(target.user_id, p_org_id, 'SUPER_ADMIN')
  ),
  pending as (
    select grant_row.user_id, jsonb_agg(jsonb_build_object('id', role.id, 'code', role.code, 'name', role.name)
      order by role.name, role.id) as roles
    from public.fxiaoke_pending_org_roles as grant_row
    join public.admin_list_org_roles_v1(p_org_id) as role on role.id = grant_row.role_id
    join targets on targets.user_id = grant_row.user_id and targets.source_id = grant_row.source_id
      and targets.identity_id = grant_row.external_identity_id and targets.external_user_id = grant_row.external_user_id
    where grant_row.org_id = p_org_id
      and (not targets.login_stopped or role.code not in ('SUPER_ADMIN', 'ORG_SUPER_ADMIN', 'FXIAOKE_BASELINE'))
    group by grant_row.user_id
  )
  select base.payload || jsonb_build_object('users', coalesce((
    select jsonb_agg(member.value || jsonb_build_object(
      'can_preassign_org_roles', coalesce(not targets.login_stopped, false),
      'can_revoke_pending_org_roles', coalesce(targets.login_stopped, false) and pending.roles is not null,
      'pending_org_roles', coalesce(pending.roles, '[]'::jsonb)
    ) order by member.ordinality)
    from jsonb_array_elements(base.payload->'users') with ordinality as member(value, ordinality)
    left join targets on targets.user_id = (member.value->>'id')::uuid
    left join pending on pending.user_id = targets.user_id
  ), '[]'::jsonb)) from base;
$$;

revoke all on function public.fxiaoke_prelogin_role_targets_v1(uuid, uuid),
  public.admin_replace_org_roles_if_current_v1(uuid, uuid, uuid, uuid[], uuid[], text, text),
  public.get_org_admin_directory_payload_v2(uuid)
  from public, anon, authenticated;
grant execute on function public.fxiaoke_prelogin_role_targets_v1(uuid, uuid),
  public.admin_replace_org_roles_if_current_v1(uuid, uuid, uuid, uuid[], uuid[], text, text),
  public.get_org_admin_directory_payload_v2(uuid)
  to service_role;

commit;

begin;

-- A current active member can already have business history or an identity
-- from another source. Match the applied Fxiaoke identity on the original ICU
-- account without giving it the marker used to activate pending directory users.
create function private.fxiaoke_active_linked_member_v1(p_org_id uuid, p_external_user_id text, p_user_id uuid, p_require_identity_authority boolean
)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1
    from public.organization_sources source
    join public.external_identities identity on identity.source_id = source.id
      and identity.system_org_id = source.system_org_id
      and identity.external_user_id = p_external_user_id
      and identity.canonical_user_id = p_user_id
      and identity.match_status = 'matched'
    join public.users person on person.id = p_user_id and person.org_id = p_org_id
      and person.status = 'active' and person.login_enabled
    join public.user_organizations member on member.user_id = person.id and member.org_id = p_org_id
      and member.status = 'active' and member.employment_status = 'active' and member.is_default
      and member.left_at is null
    where source.system_org_id = p_org_id and source.provider = 'fxiaoke' and source.status = 'active'
      and source.connection_state = 'verified' and source.effective_revision is not null
      and (p_require_identity_authority = false or source.authority_scope->>'identity' = 'authoritative')
      and source.authority_scope->>'directory' = 'authoritative'
      and identity.profile_snapshot->>'status' = 'active'
      and identity.profile_snapshot->>'loginDisabled' is distinct from 'true'
      and not exists (
        select 1 from public.external_identities competing
        where competing.system_org_id = p_org_id and competing.source_id = source.id
          and competing.canonical_user_id = p_user_id and competing.id <> identity.id
          and competing.match_status in ('matched', 'conflict')
      )
      and not exists (
        select 1 from public.organization_sources other
        where other.system_org_id = p_org_id and other.provider = 'fxiaoke' and other.id <> source.id
      )
      and (
        identity.profile_snapshot->>'provisionedMemberId' = person.id::text
        or (
          not (identity.profile_snapshot ? 'provisionedMemberId')
          and identity.profile_snapshot->>'directorySyncVersion' = 'f003-directory-cutover-v2'
          and identity.profile_snapshot->>'provider' = source.provider
          and identity.profile_snapshot->>'externalUserId' = identity.external_user_id
          and exists (
            select 1 from public.organization_directory_cutover_runs run
            cross join lateral jsonb_array_elements(run.after_state->'targetIdentities') as binding(item)
            where run.system_org_id = p_org_id and run.target_source_id = source.id and run.status = 'applied'
              and run.applied_at = source.last_successful_sync_at
              and binding.item->>'id' = identity.id::text
              and binding.item->>'externalUserId' = identity.external_user_id
              and binding.item->>'canonicalUserId' = person.id::text
              and binding.item->>'matchStatus' = 'matched'
              and binding.item->'profileSnapshot' = identity.profile_snapshot
          )
        )
      )
  );
$$;
revoke all on function private.fxiaoke_active_linked_member_v1(uuid, text, uuid, boolean) from public, anon, authenticated, service_role;

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
  v_override_target_revision text;
begin
  perform private.personnel_lock_org_v1(p_org_id);
  select count(*) into v_source_count from public.organization_sources
   where system_org_id = p_org_id and provider = 'fxiaoke';
  if v_source_count <> 1 then return null; end if;

  select * into v_source from public.organization_sources
   where system_org_id = p_org_id and provider = 'fxiaoke' for update;
  if v_source.status <> 'active' or v_source.connection_state <> 'verified'
    or v_source.effective_revision is null
    or v_source.authority_scope->>'identity' is distinct from 'authoritative'
    or v_source.authority_scope->>'directory' is distinct from 'authoritative'
  then return null; end if;

  select * into v_identity from public.external_identities
   where source_id = v_source.id and system_org_id = p_org_id
     and external_user_id = p_external_user_id and match_status = 'matched'
     and canonical_user_id = p_expected_user_id for update;
  if not found or v_identity.canonical_user_id is null
    or v_identity.profile_snapshot->>'status' is distinct from 'active'
    or v_identity.profile_snapshot->>'loginDisabled' = 'true'
  then return null; end if;

  select * into v_person from public.users
   where id = v_identity.canonical_user_id and org_id = p_org_id for update;
  if not found then return null; end if;
  select * into v_membership from public.user_organizations
   where user_id = v_person.id and org_id = p_org_id for update;
  if not found or v_membership.employment_status is distinct from 'active' or v_membership.left_at is not null
    or v_membership.is_default is distinct from true
  then return null; end if;

  if v_membership.status = 'active' then
    if private.fxiaoke_active_linked_member_v1(p_org_id, p_external_user_id, v_person.id, true) then
      return v_person.id;
    end if;
    return null;
  end if;
  if v_identity.profile_snapshot->>'provisionedMemberId' is distinct from v_person.id::text then
    return null;
  end if;
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
  -- Activate only differences written for this verified login identity.
  v_override_target_revision := private.employee_prelogin_target_revision_v1(
    p_org_id, v_person.id, v_source.id, v_identity.id, p_external_user_id
  );
  delete from private.employee_permission_overrides
  where org_id = p_org_id and user_id = v_person.id and pending_target_revision is not null
    and pending_target_revision <> v_override_target_revision;

  update private.employee_permission_overrides
  set pending_target_revision = null
  where org_id = p_org_id and user_id = v_person.id and pending_target_revision = v_override_target_revision;

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
create or replace function public.record_fxiaoke_sso_login_v1(
  p_org_id uuid,
  p_user_id uuid,
  p_external_user_id text,
  p_session_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person public.users%rowtype;
  v_now timestamptz := now();
begin
  perform private.personnel_lock_org_v1(p_org_id);
  select * into v_person from public.users
   where id = p_user_id and org_id = p_org_id for update;
  if not found
    or not private.fxiaoke_active_linked_member_v1(p_org_id, p_external_user_id, p_user_id, true)
    or not exists (
      select 1 from public.auth_tokens session
      where session.id = p_session_id and session.user_id = p_user_id
        and session.auth_method = 'fxiaoke' and session.expires_at > v_now
    )
  then return false; end if;

  if exists (
    select 1 from public.personnel_lifecycle_events event
    where event.org_id = p_org_id and event.target_user_id = p_user_id
      and event.command = 'fxiaoke_sso_login_success'
      and event.request_id = p_session_id::text
  ) then return true; end if;

  update public.users set last_login_at = v_now where id = p_user_id and org_id = p_org_id;
  perform private.personnel_insert_event_v1(
    p_org_id, p_user_id, p_user_id, 'fxiaoke_sso_login_success',
    jsonb_build_object('last_login_at', v_person.last_login_at),
    jsonb_build_object('last_login_at', v_now, 'auth_method', 'fxiaoke'),
    'verified Fxiaoke OAuth session issued', p_session_id::text
  );
  return true;
end;
$$;

create or replace function private.fxiaoke_rotation_eligible_members(p_org_id uuid, p_source_id uuid)
returns table(member_id uuid, external_user_id text, display_name text)
language sql stable set search_path = '' as $$
  select person.id, identity.external_user_id, person.display_name::text
  from public.external_identities identity
  join public.users person on person.id = identity.canonical_user_id
  where identity.source_id = p_source_id and identity.system_org_id = p_org_id
    and identity.match_status = 'matched'
    and private.fxiaoke_active_linked_member_v1(p_org_id, identity.external_user_id, person.id, true);
$$;

create or replace function private.set_fxiaoke_identity_authority_before_system_guard_v1(
  p_actor_id uuid,
  p_org_id uuid,
  p_connection_revision uuid,
  p_enabled boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.organization_sources%rowtype;
  v_now timestamptz := now();
begin
  perform private.personnel_lock_org_v1(p_org_id);
  if not exists (
    select 1 from public.users actor
    join public.user_organizations membership on membership.user_id = actor.id
      and membership.org_id = p_org_id and membership.status = 'active'
    join public.user_roles assignment on assignment.user_id = actor.id
      and assignment.org_id = p_org_id and assignment.scope_type = 'org'
      and assignment.scope_id = p_org_id
    join public.roles role on role.id = assignment.role_id and role.code = 'SUPER_ADMIN'
    where actor.id = p_actor_id and actor.org_id = p_org_id
      and actor.status = 'active' and actor.login_enabled = true
  ) then return false; end if;

  select * into v_source from public.organization_sources
   where system_org_id = p_org_id and provider = 'fxiaoke'
   for update;
  if not found or v_source.configuration_revision <> p_connection_revision
    or v_source.status <> 'active' or v_source.connection_state <> 'verified'
    or v_source.effective_revision is null
    or v_source.authority_scope->>'directory' is distinct from 'authoritative'
  then return false; end if;

  if p_enabled then
    if exists (
      select 1 from public.organization_sources other
      where other.system_org_id = p_org_id and other.id <> v_source.id
        and other.status = 'active'
        and other.authority_scope->>'identity' = 'authoritative'
    ) then return false; end if;
    if not exists (
      select 1 from public.external_identities identity
      join public.users person on person.id = identity.canonical_user_id
        and person.org_id = p_org_id
      join public.user_organizations membership on membership.user_id = person.id
        and membership.org_id = p_org_id and membership.employment_status = 'active'
        and membership.is_default = true
      where identity.source_id = v_source.id and identity.system_org_id = p_org_id
        and identity.match_status = 'matched'
        and (
          private.fxiaoke_active_linked_member_v1(p_org_id, identity.external_user_id, person.id, false)
          or (
            identity.profile_snapshot->>'provisionedMemberId' = person.id::text
            and identity.profile_snapshot->>'status' = 'active'
            and identity.profile_snapshot->>'loginDisabled' is distinct from 'true'
            and membership.left_at is null
            and person.status = 'inactive' and person.login_enabled = false
            and person.password_hash is null and membership.status = 'invited'
          )
        )
    ) then return false; end if;
  else
    if not exists (
      select 1 from public.users person
      join public.user_organizations membership on membership.user_id = person.id
        and membership.org_id = p_org_id and membership.status = 'active'
      join public.user_roles assignment on assignment.user_id = person.id
        and assignment.org_id = p_org_id and assignment.scope_type = 'org'
        and assignment.scope_id = p_org_id
      join public.roles role on role.id = assignment.role_id and role.code = 'SUPER_ADMIN'
      where person.org_id = p_org_id and person.status = 'active'
        and person.login_enabled = true and person.password_hash is not null
    ) then return false; end if;
  end if;

  update public.organization_sources
     set authority_scope = jsonb_set(coalesce(authority_scope, '{}'::jsonb),
           '{identity}', to_jsonb(case when p_enabled then 'authoritative' else 'evidence' end)),
         lifecycle_audit = coalesce(lifecycle_audit, '[]'::jsonb) || jsonb_build_array(
           jsonb_build_object('action', case when p_enabled then 'enable_sso' else 'disable_sso' end,
             'actor_id', p_actor_id, 'at', v_now)),
         updated_by = p_actor_id, updated_at = v_now
   where id = v_source.id and system_org_id = p_org_id;

  if not p_enabled then
    -- A disabled identity source must not leave existing SSO sessions usable.
    delete from public.auth_tokens session
    where session.auth_method = 'fxiaoke' and exists (
      select 1 from public.users person
      where person.id = session.user_id and (
        person.org_id = p_org_id or exists (
          select 1 from public.user_organizations membership
          where membership.user_id = person.id and membership.org_id = p_org_id
        )
      )
    );
  end if;
  return true;
end;
$$;

commit;

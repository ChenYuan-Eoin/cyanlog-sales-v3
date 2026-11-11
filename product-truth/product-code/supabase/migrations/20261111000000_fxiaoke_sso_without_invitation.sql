-- F003 / WP94: assigning an org role to a synced, active Fxiaoke person
-- establishes an ICU session account without a local invitation or password.
-- Directory synchronization alone still grants no login or business role.
alter table public.auth_tokens
  add column if not exists auth_method text not null default 'local';
alter table public.auth_tokens
  add constraint auth_tokens_auth_method_check
  check (auth_method in ('local', 'fxiaoke'));

create unique index if not exists organization_sources_one_identity_authority_idx
  on public.organization_sources(system_org_id)
  where status = 'active' and authority_scope->>'identity' = 'authoritative';

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
  v_directory_identity_count integer;
  v_sso_account_enabled boolean := false;
begin
  perform private.personnel_lock_org_v1(p_org_id);
  perform private.personnel_assert_last_admin_safe_v1(p_user_id, p_org_id);

  select count(*) into v_valid_count
  from public.roles
  where id = any(coalesce(p_role_ids, array[]::uuid[]));
  if v_valid_count <> cardinality(coalesce(p_role_ids, array[]::uuid[])) then
    raise exception 'role does not exist' using errcode = '23503';
  end if;

  if exists (
    select 1 from public.user_organizations membership
    join public.users person on person.id = membership.user_id and person.org_id = membership.org_id
    where membership.user_id = p_user_id and membership.org_id = p_org_id
      and membership.status = 'invited' and membership.employment_status = 'active'
      and person.status = 'inactive' and person.login_enabled = false
  ) then
    -- Only the role-grant action may make a directory-only account usable.
    -- A normal invitation, a stale employee or an ambiguous mapping cannot
    -- enter this branch.
    if cardinality(coalesce(p_role_ids, array[]::uuid[])) = 0 then return false; end if;
    select count(*) into v_directory_identity_count
    from public.external_identities identity
    join public.organization_sources source on source.id = identity.source_id
    where identity.system_org_id = p_org_id
      and identity.canonical_user_id = p_user_id
      and identity.match_status = 'matched'
      and identity.profile_snapshot->>'provisionedMemberId' = p_user_id::text
      and identity.profile_snapshot->>'status' = 'active'
      and identity.profile_snapshot->>'loginDisabled' is distinct from 'true'
      and source.system_org_id = p_org_id and source.provider = 'fxiaoke'
      and source.status = 'active' and source.connection_state = 'verified'
      and source.effective_revision is not null
      and source.authority_scope->>'directory' = 'authoritative';
    if v_directory_identity_count <> 1 then return false; end if;

    update public.users
       set status = 'active', login_enabled = true, updated_at = now()
     where id = p_user_id and org_id = p_org_id
       and status = 'inactive' and login_enabled = false;
    if not found then raise exception 'directory account changed during role assignment'; end if;
    update public.user_organizations
       set status = 'active', updated_at = now()
     where user_id = p_user_id and org_id = p_org_id
       and status = 'invited' and employment_status = 'active';
    if not found then raise exception 'directory membership changed during role assignment'; end if;
    v_sso_account_enabled := true;
  end if;

  if not exists (
    select 1 from public.user_organizations
    where user_id = p_user_id and org_id = p_org_id and status = 'active'
  ) then return false; end if;

  select coalesce(jsonb_agg(role_id), '[]'::jsonb) into v_before
  from public.user_roles
  where user_id = p_user_id and org_id = p_org_id
    and scope_type = 'org' and scope_id = p_org_id;

  delete from public.user_roles
  where user_id = p_user_id and org_id = p_org_id
    and scope_type = 'org' and scope_id = p_org_id;

  foreach v_role_id in array coalesce(p_role_ids, array[]::uuid[]) loop
    insert into public.user_roles(user_id, role_id, org_id, scope_type, scope_id, granted_by)
      values (p_user_id, v_role_id, p_org_id, 'org', p_org_id, p_actor_id);
  end loop;

  select coalesce(jsonb_agg(role_id), '[]'::jsonb) into v_after
  from public.user_roles
  where user_id = p_user_id and org_id = p_org_id
    and scope_type = 'org' and scope_id = p_org_id;

  perform private.personnel_insert_event_v1(
    p_org_id, p_user_id, p_actor_id, 'assign_org_roles',
    jsonb_build_object('role_ids', v_before),
    jsonb_build_object('role_ids', v_after, 'sso_account_enabled', v_sso_account_enabled),
    p_reason, p_request_id
  );
  return true;
end;
$$;

revoke all on function public.admin_replace_org_roles_v1(uuid, uuid, uuid, uuid[], text, text)
  from public, anon, authenticated;
grant execute on function public.admin_replace_org_roles_v1(uuid, uuid, uuid, uuid[], text, text)
  to service_role;

-- A verified first OAuth login can establish the pre-matched directory
-- person's system account. It never grants a role or accepts an invitation.
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
     and canonical_user_id = p_expected_user_id;
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
  if v_person.status <> 'inactive' or v_person.login_enabled is distinct from false
    or v_person.password_hash is not null or v_membership.status <> 'invited'
  then return null; end if;

  update public.users set status = 'active', login_enabled = true, updated_at = now()
   where id = v_person.id and org_id = p_org_id;
  update public.user_organizations set status = 'active', updated_at = now()
   where user_id = v_person.id and org_id = p_org_id;
  perform private.personnel_insert_event_v1(
    p_org_id, v_person.id, v_person.id, 'fxiaoke_sso_account_enabled',
    jsonb_build_object('account_status', v_person.status, 'membership_status', v_membership.status),
    jsonb_build_object('account_status', 'active', 'membership_status', 'active', 'role_granted', false),
    'verified Fxiaoke identity prepared for first login', null
  );
  return v_person.id;
end;
$$;

revoke all on function public.activate_fxiaoke_sso_member_v1(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.activate_fxiaoke_sso_member_v1(uuid, text, uuid)
  to service_role;

-- Record a successful login only after the application session and signed
-- cookie have been created. The session UUID is an audit key, not a bearer.
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
  if not found or v_person.status <> 'active' or v_person.login_enabled is distinct from true
    or not exists (
      select 1 from public.user_organizations membership
      where membership.user_id = p_user_id and membership.org_id = p_org_id
        and membership.status = 'active' and membership.employment_status = 'active'
        and membership.is_default = true
    )
    or not exists (
      select 1 from public.auth_tokens session
      where session.id = p_session_id and session.user_id = p_user_id
        and session.auth_method = 'fxiaoke' and session.expires_at > v_now
    )
    or not exists (
      select 1 from public.organization_sources source
      join public.external_identities identity on identity.source_id = source.id
      where source.system_org_id = p_org_id and source.provider = 'fxiaoke'
        and source.status = 'active' and source.connection_state = 'verified'
        and source.effective_revision is not null
        and source.authority_scope->>'identity' = 'authoritative'
        and identity.system_org_id = p_org_id and identity.external_user_id = p_external_user_id
        and identity.canonical_user_id = p_user_id and identity.match_status = 'matched'
        and identity.profile_snapshot->>'provisionedMemberId' = p_user_id::text
        and identity.profile_snapshot->>'status' = 'active'
        and identity.profile_snapshot->>'loginDisabled' is distinct from 'true'
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

revoke all on function public.record_fxiaoke_sso_login_v1(uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.record_fxiaoke_sso_login_v1(uuid, uuid, text, uuid)
  to service_role;

-- An explicit organization-admin action opens or closes the enterprise SSO
-- source. It never creates a member or grants a role. A real, matched and
-- active directory person must exist before the login button can be exposed.
create or replace function public.set_fxiaoke_identity_authority_v1(
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
    or v_source.authority_scope->>'directory' <> 'authoritative'
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
        and identity.profile_snapshot->>'provisionedMemberId' = person.id::text
        and identity.profile_snapshot->>'status' = 'active'
        and identity.profile_snapshot->>'loginDisabled' is distinct from 'true'
        and (
          (person.status = 'active' and person.login_enabled = true and membership.status = 'active')
          or (person.status = 'inactive' and person.login_enabled = false
            and person.password_hash is null and membership.status = 'invited')
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

revoke all on function public.set_fxiaoke_identity_authority_v1(uuid, uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.set_fxiaoke_identity_authority_v1(uuid, uuid, uuid, boolean)
  to service_role;

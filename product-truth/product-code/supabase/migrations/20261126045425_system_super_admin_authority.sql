-- Canonical system administrator appointments use the existing SUPER_ADMIN role.
begin;

create function private.system_super_admin_role_enabled_v1(p_org_id uuid)
returns boolean language plpgsql stable set search_path = ''
as $$
declare
  v_role_id uuid;
  v_settings jsonb;
  v_overrides jsonb;
  v_permissions jsonb;
begin
  select role.id, organization.settings into v_role_id, v_settings
  from public.organizations as organization
  cross join public.roles as role
  where organization.id = p_org_id and organization.status = 'active' and role.code = 'SUPER_ADMIN';
  if not found then return false; end if;

  -- The canonical template supplies '*' until an explicit organization override.
  if v_settings is null or v_settings = 'null'::jsonb then return true; end if;
  if jsonb_typeof(v_settings) <> 'object' then return false; end if;
  if not (v_settings ? 'role_permission_overrides') then return true; end if;
  v_overrides := v_settings->'role_permission_overrides';
  if jsonb_typeof(v_overrides) <> 'object' then return false; end if;
  if not (v_overrides ? v_role_id::text) then return true; end if;
  v_permissions := v_overrides->v_role_id::text;
  if jsonb_typeof(v_permissions) <> 'array' then return false; end if;
  if exists (
    select 1 from jsonb_array_elements(v_permissions) as permission(value)
    where jsonb_typeof(permission.value) <> 'string' or permission.value = '""'::jsonb
  ) then return false; end if;
  return v_permissions ?| array['*', 'role:*', 'role:manage'];
end;
$$;

create or replace function private.personnel_is_org_control_admin_v1(p_user_id uuid, p_org_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.org_super_admin_active_member_v1(p_user_id, p_org_id)
    and private.has_exact_org_role_v1(p_user_id, p_org_id, 'SUPER_ADMIN')
    and private.system_super_admin_role_enabled_v1(p_org_id);
$$;

create or replace function private.can_manage_department_lead_access_v1(p_actor_id uuid, p_org_id uuid)
returns boolean language sql stable set search_path = ''
as $$
  select private.personnel_is_org_control_admin_v1(p_actor_id, p_org_id);
$$;

-- The existing membership and offboarding hooks use this platform guard.
create or replace function private.personnel_assert_last_platform_admin_safe_v1(p_user_id uuid, p_org_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not private.personnel_is_org_control_admin_v1(p_user_id, p_org_id) then return; end if;

  if not exists (
    select 1
    from public.user_roles as assignment
    join public.roles as role on role.id = assignment.role_id
    where assignment.org_id = p_org_id and assignment.scope_type = 'org'
      and assignment.scope_id = p_org_id and assignment.user_id <> p_user_id
      and role.code = 'SUPER_ADMIN'
      and private.org_super_admin_active_member_v1(assignment.user_id, p_org_id)
  ) then
    raise exception 'cannot remove the last effective system administrator'
      using errcode = '23514', detail = 'LAST_SYSTEM_SUPER_ADMIN_PROTECTED';
  end if;
end;
$$;

create or replace function public.admin_set_account_state_v1(
  p_actor_id uuid, p_org_id uuid, p_user_id uuid, p_status text, p_login_enabled boolean,
  p_reason text default null, p_request_id text default null
)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  perform private.personnel_lock_org_v1(p_org_id);
  if p_login_enabled = false or p_status in ('inactive', 'suspended') then
    perform private.personnel_assert_last_admin_safe_v1(p_user_id, p_org_id);
  end if;
  return private.admin_set_account_state_v1(p_actor_id, p_org_id, p_user_id, p_status, p_login_enabled, p_reason, p_request_id);
end;
$$;

create function private.read_super_admin_assignment_v1(p_actor_id uuid, p_org_id uuid, p_user_id uuid, p_role_code text)
returns boolean language plpgsql stable set search_path = ''
as $$
declare
  v_assigned boolean;
begin
  if p_actor_id is null or p_org_id is null or p_user_id is null then
    raise exception 'organization and user identifiers are required' using errcode = '22023';
  end if;
  if p_actor_id = p_user_id or not private.personnel_is_org_control_admin_v1(p_actor_id, p_org_id) then
    raise exception 'system administrator assignment denied' using errcode = '42501';
  end if;

  v_assigned := private.has_exact_org_role_v1(p_user_id, p_org_id, p_role_code);
  if not v_assigned and not exists (
    select 1 from public.user_organizations where user_id = p_user_id and org_id = p_org_id
  ) then
    raise exception 'organization member not found' using errcode = 'P0002';
  end if;
  return v_assigned;
end;
$$;

create function public.admin_get_system_super_admin_v1(p_actor_id uuid, p_org_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.read_super_admin_assignment_v1(p_actor_id, p_org_id, p_user_id, 'SUPER_ADMIN');
$$;

create or replace function public.admin_get_org_super_admin_v1(p_actor_id uuid, p_org_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.read_super_admin_assignment_v1(p_actor_id, p_org_id, p_user_id, 'ORG_SUPER_ADMIN');
$$;

create function private.set_super_admin_assignment_v1(
  p_actor_id uuid, p_org_id uuid, p_user_id uuid, p_role_code text,
  p_assigned boolean, p_expected_assigned boolean, p_request_id text
)
returns boolean language plpgsql set search_path = ''
as $$
declare
  v_role_id uuid;
  v_before boolean;
begin
  if p_org_id is null or p_assigned is null or p_expected_assigned is null then
    raise exception 'organization and assignment states are required' using errcode = '22023';
  end if;

  perform private.personnel_lock_org_v1(p_org_id);
  perform 1 from public.organizations where id = p_org_id for share;
  perform 1 from public.users as person
    join public.user_organizations as membership on membership.user_id = person.id
    where membership.org_id = p_org_id and person.id in (p_actor_id, p_user_id)
    order by person.id for share of person, membership;
  v_before := private.read_super_admin_assignment_v1(p_actor_id, p_org_id, p_user_id, p_role_code);

  if v_before <> p_expected_assigned then
    raise exception 'system administrator assignment changed' using errcode = '40001';
  end if;
  if p_assigned and not private.org_super_admin_active_member_v1(p_user_id, p_org_id) then
    raise exception 'system administrator must be an active login-enabled member'
      using errcode = '23514', detail = 'SYSTEM_SUPER_ADMIN_MEMBER_NOT_ELIGIBLE';
  end if;
  if v_before = p_assigned then return v_before; end if;

  select id into strict v_role_id from public.roles where code = p_role_code;
  if p_assigned then
    insert into public.user_roles (org_id, user_id, role_id, scope_type, scope_id, granted_by)
    values (p_org_id, p_user_id, v_role_id, 'org', p_org_id, p_actor_id);
  else
    if p_role_code = 'SUPER_ADMIN' then
      perform private.personnel_assert_last_platform_admin_safe_v1(p_user_id, p_org_id);
    end if;
    delete from public.user_roles
    where org_id = p_org_id and user_id = p_user_id and role_id = v_role_id
      and scope_type = 'org' and scope_id = p_org_id;
  end if;

  perform private.personnel_insert_event_v1(
    p_org_id, p_user_id, p_actor_id,
    case
      when p_assigned then 'assign_system_super_admin'
      when p_role_code = 'SUPER_ADMIN' then 'revoke_system_super_admin'
      else 'revoke_org_super_admin'
    end,
    jsonb_build_object('role_id', v_role_id, 'assigned', v_before),
    jsonb_build_object('role_id', v_role_id, 'assigned', p_assigned),
    case when p_role_code = 'SUPER_ADMIN' then 'system administrator assignment' else 'legacy administrator assignment cleanup' end,
    p_request_id
  );
  return p_assigned;
end;
$$;

create function public.admin_set_system_super_admin_v1(
  p_actor_id uuid, p_org_id uuid, p_user_id uuid, p_assigned boolean, p_expected_assigned boolean,
  p_request_id text default null
)
returns boolean language sql security definer set search_path = ''
as $$
  select private.set_super_admin_assignment_v1(
    p_actor_id, p_org_id, p_user_id, 'SUPER_ADMIN', p_assigned, p_expected_assigned, p_request_id
  );
$$;

-- Existing legacy bindings remain auditable and may only be removed.
create or replace function public.admin_set_org_super_admin_v1(
  p_actor_id uuid, p_org_id uuid, p_user_id uuid, p_assigned boolean, p_expected_assigned boolean,
  p_request_id text default null
)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  if p_assigned is distinct from false then
    raise exception 'legacy organization administrator appointments are closed' using errcode = '42501';
  end if;
  return private.set_super_admin_assignment_v1(
    p_actor_id, p_org_id, p_user_id, 'ORG_SUPER_ADMIN', false, p_expected_assigned, p_request_id
  );
end;
$$;

-- Generic scope commands keep their existing behavior for ordinary roles.
alter function public.admin_set_role_scope_assignment_v1(uuid, uuid, uuid, uuid, text, uuid, text, text, text)
  rename to admin_set_role_scope_assignment_before_system_admin_v1;
alter function public.admin_set_role_scope_assignment_before_system_admin_v1(uuid, uuid, uuid, uuid, text, uuid, text, text, text)
  set schema private;
revoke all on function private.admin_set_role_scope_assignment_before_system_admin_v1(uuid, uuid, uuid, uuid, text, uuid, text, text, text)
  from public, anon, authenticated, service_role;
create function public.admin_set_role_scope_assignment_v1(
  p_actor_id uuid, p_org_id uuid, p_user_id uuid, p_role_id uuid, p_scope_type text, p_scope_id uuid, p_action text,
  p_reason text default null, p_request_id text default null
)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.roles where id = p_role_id and code in ('SUPER_ADMIN', 'ORG_SUPER_ADMIN')) then
    raise exception 'use the dedicated system administrator command' using errcode = '42501';
  end if;
  return private.admin_set_role_scope_assignment_before_system_admin_v1(
    p_actor_id, p_org_id, p_user_id, p_role_id, p_scope_type, p_scope_id, p_action, p_reason, p_request_id
  );
end;
$$;

create or replace function private.reject_org_super_admin_invitation_v1()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.roles where code in ('SUPER_ADMIN', 'ORG_SUPER_ADMIN') and id = any(new.role_ids)) then
    raise exception 'system administrator cannot be appointed through an invitation' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.system_super_admin_role_enabled_v1(uuid),
  private.read_super_admin_assignment_v1(uuid, uuid, uuid, text),
  private.set_super_admin_assignment_v1(uuid, uuid, uuid, text, boolean, boolean, text),
  public.admin_get_org_super_admin_v1(uuid, uuid, uuid),
  public.admin_get_system_super_admin_v1(uuid, uuid, uuid),
  public.admin_set_system_super_admin_v1(uuid, uuid, uuid, boolean, boolean, text),
  public.admin_set_role_scope_assignment_v1(uuid, uuid, uuid, uuid, text, uuid, text, text, text),
  public.admin_set_org_super_admin_v1(uuid, uuid, uuid, boolean, boolean, text)
  from public, anon, authenticated, service_role;

grant execute on function public.admin_get_system_super_admin_v1(uuid, uuid, uuid),
  public.admin_set_system_super_admin_v1(uuid, uuid, uuid, boolean, boolean, text),
  public.admin_get_org_super_admin_v1(uuid, uuid, uuid),
  public.admin_set_org_super_admin_v1(uuid, uuid, uuid, boolean, boolean, text),
  public.admin_set_role_scope_assignment_v1(uuid, uuid, uuid, uuid, text, uuid, text, text, text)
  to service_role;

commit;

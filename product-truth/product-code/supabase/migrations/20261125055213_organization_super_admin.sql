-- WP44. Organization control is delegated through an exact-organization role.
begin;

insert into public.roles (code, name, description, permissions, sort_order)
values (
  'ORG_SUPER_ADMIN', '组织超级管理员', '管理本组织的成员、部门、角色和配置。',
  '["admin:access","org:write","user:view","user:write","dept:view","dept:write","config:read","config:write","config:publish","role:manage"]',
  1
);

create function private.has_exact_org_role_v1(p_user_id uuid, p_org_id uuid, p_code text)
returns boolean language sql stable set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles as grant_row
    join public.roles as role on role.id = grant_row.role_id
    where grant_row.user_id = p_user_id and grant_row.org_id = p_org_id
      and grant_row.scope_type = 'org' and grant_row.scope_id = p_org_id and role.code = p_code
  );
$$;

create function private.org_super_admin_active_member_v1(p_user_id uuid, p_org_id uuid)
returns boolean language sql stable set search_path = ''
as $$
  select exists (
    select 1 from public.user_organizations as membership
    join public.users as person on person.id = membership.user_id
    where membership.user_id = p_user_id and membership.org_id = p_org_id
      and membership.is_default and membership.status = 'active'
      and membership.employment_status = 'active' and membership.left_at is null
      and person.status = 'active' and person.login_enabled = true
  );
$$;

create or replace function private.can_manage_department_lead_access_v1(p_actor_id uuid, p_org_id uuid)
returns boolean language plpgsql stable set search_path = ''
as $$
declare
  v_root_role_id uuid;
  v_settings jsonb;
  v_overrides jsonb;
  v_permissions jsonb;
begin
  if not private.org_super_admin_active_member_v1(p_actor_id, p_org_id) then return false; end if;
  select settings into v_settings from public.organizations where id = p_org_id and status = 'active';
  if not found then return false; end if;

  -- The tenant role has a fixed template and cannot inherit platform overrides.
  if private.has_exact_org_role_v1(p_actor_id, p_org_id, 'ORG_SUPER_ADMIN')
    and exists (select 1 from public.roles where code = 'ORG_SUPER_ADMIN' and permissions ? 'role:manage')
  then return true; end if;

  select id into v_root_role_id from public.roles where code = 'SUPER_ADMIN';
  if not private.has_exact_org_role_v1(p_actor_id, p_org_id, 'SUPER_ADMIN') then return false; end if;
  if v_settings is null or v_settings = 'null'::jsonb then return true; end if;
  if jsonb_typeof(v_settings) <> 'object' then return false; end if;
  if not (v_settings ? 'role_permission_overrides') then return true; end if;
  v_overrides := v_settings->'role_permission_overrides';
  if jsonb_typeof(v_overrides) <> 'object' then return false; end if;
  if not (v_overrides ? v_root_role_id::text) then return true; end if;
  v_permissions := v_overrides->v_root_role_id::text;
  if jsonb_typeof(v_permissions) <> 'array' then return false; end if;
  if exists (
    select 1 from jsonb_array_elements(v_permissions) as permission(value)
    where jsonb_typeof(permission.value) <> 'string' or permission.value = '""'::jsonb
  ) then return false; end if;
  return v_permissions ?| array['*', 'role:*', 'role:manage'];
end;
$$;

create function private.assert_org_super_admin_target_v1(p_actor_id uuid, p_org_id uuid, p_user_id uuid)
returns void language plpgsql stable set search_path = ''
as $$
begin
  if p_actor_id is null or p_org_id is null or p_user_id is null then
    raise exception 'organization and user identifiers are required' using errcode = '22023';
  end if;
  if p_actor_id = p_user_id or not private.can_manage_department_lead_access_v1(p_actor_id, p_org_id) then
    raise exception 'organization administrator assignment denied' using errcode = '42501';
  end if;
  if not exists (select 1 from public.user_organizations where user_id = p_user_id and org_id = p_org_id) then
    raise exception 'organization member not found' using errcode = 'P0002';
  end if;
  if private.has_exact_org_role_v1(p_user_id, p_org_id, 'SUPER_ADMIN') then
    raise exception 'protected platform root administrator' using errcode = '42501';
  end if;
  if not private.org_super_admin_active_member_v1(p_user_id, p_org_id) then
    raise exception 'organization administrator must be an active login-enabled member' using errcode = '23514';
  end if;
end;
$$;

create function public.admin_get_org_super_admin_v1(p_actor_id uuid, p_org_id uuid, p_user_id uuid)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.assert_org_super_admin_target_v1(p_actor_id, p_org_id, p_user_id);
  return private.has_exact_org_role_v1(p_user_id, p_org_id, 'ORG_SUPER_ADMIN');
end;
$$;

create function public.admin_set_org_super_admin_v1(
  p_actor_id uuid, p_org_id uuid, p_user_id uuid, p_assigned boolean, p_expected_assigned boolean,
  p_request_id text default null
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  v_role_id uuid;
  v_before boolean;
begin
  if p_org_id is null or p_assigned is null or p_expected_assigned is null then
    raise exception 'organization and assignment states are required' using errcode = '22023';
  end if;

  perform private.personnel_lock_org_v1(p_org_id);
  -- Role permission settings and directory state may also be written by other flows.
  perform 1 from public.organizations where id = p_org_id for share;
  perform 1 from public.users as person
    join public.user_organizations as membership on membership.user_id = person.id
    where membership.org_id = p_org_id and person.id in (p_actor_id, p_user_id)
    order by person.id for share of person, membership;
  perform private.assert_org_super_admin_target_v1(p_actor_id, p_org_id, p_user_id);

  select id into strict v_role_id from public.roles where code = 'ORG_SUPER_ADMIN';
  v_before := private.has_exact_org_role_v1(p_user_id, p_org_id, 'ORG_SUPER_ADMIN');
  if v_before = p_assigned then return v_before; end if;
  if v_before <> p_expected_assigned then
    raise exception 'organization administrator assignment changed' using errcode = '40001';
  end if;

  if p_assigned then
    insert into public.user_roles (org_id, user_id, role_id, scope_type, scope_id, granted_by)
    values (p_org_id, p_user_id, v_role_id, 'org', p_org_id, p_actor_id);
  else
    -- The distinct, authorized actor must remain a viable controller after this change.
    delete from public.user_roles
    where org_id = p_org_id and user_id = p_user_id and role_id = v_role_id
      and scope_type = 'org' and scope_id = p_org_id;
  end if;

  perform private.personnel_insert_event_v1(
    p_org_id, p_user_id, p_actor_id,
    case when p_assigned then 'assign_org_super_admin' else 'revoke_org_super_admin' end,
    jsonb_build_object('role_id', v_role_id, 'assigned', v_before),
    jsonb_build_object('role_id', v_role_id, 'assigned', p_assigned),
    'organization control delegation', p_request_id
  );
  return p_assigned;
end;
$$;

-- Preserve the older command and its strict first-login contract for ordinary targets.
alter function public.admin_replace_org_roles_v1(uuid, uuid, uuid, uuid[], text, text) set schema private;
revoke all on function private.admin_replace_org_roles_v1(uuid, uuid, uuid, uuid[], text, text)
  from public, anon, authenticated, service_role;

create function public.admin_replace_org_roles_v1(
  p_actor_id uuid, p_org_id uuid, p_user_id uuid, p_role_ids uuid[], p_reason text default null, p_request_id text default null
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  v_org_admin_id uuid;
  v_holds_org_admin boolean;
  v_roles uuid[] := coalesce(p_role_ids, array[]::uuid[]);
  v_before jsonb;
  v_after jsonb;
begin
  perform private.personnel_lock_org_v1(p_org_id);
  select id into strict v_org_admin_id from public.roles where code = 'ORG_SUPER_ADMIN';
  v_holds_org_admin := private.has_exact_org_role_v1(p_user_id, p_org_id, 'ORG_SUPER_ADMIN');

  if (v_org_admin_id = any(v_roles) and not v_holds_org_admin)
    or private.has_exact_org_role_v1(p_user_id, p_org_id, 'SUPER_ADMIN')
    or exists (select 1 from public.roles where code = 'SUPER_ADMIN' and id = any(v_roles))
  then raise exception 'reserved administrator role mutation denied' using errcode = '42501'; end if;

  if not v_holds_org_admin then
    return private.admin_replace_org_roles_v1(p_actor_id, p_org_id, p_user_id, p_role_ids, p_reason, p_request_id);
  end if;

  -- Old clients may echo the dedicated grant. Preserve that row and its audit metadata.
  v_roles := array_remove(v_roles, v_org_admin_id);
  if not exists (
    select 1 from public.user_organizations where user_id = p_user_id and org_id = p_org_id and status = 'active'
  ) then return false; end if;
  if (select count(*) from public.roles where id = any(v_roles)) <> cardinality(v_roles) then
    raise exception 'role does not exist' using errcode = '23503';
  end if;

  with removed as (
    delete from public.user_roles
    where user_id = p_user_id and org_id = p_org_id and scope_type = 'org' and scope_id = p_org_id
      and role_id <> v_org_admin_id
    returning role_id
  )
  select coalesce(jsonb_agg(role_id order by role_id), '[]'::jsonb) into v_before from removed;
  delete from public.fxiaoke_pending_org_roles where org_id = p_org_id and user_id = p_user_id;
  with inserted as (
    insert into public.user_roles (user_id, role_id, org_id, scope_type, scope_id, granted_by)
    select p_user_id, wanted.role_id, p_org_id, 'org', p_org_id, p_actor_id
    from unnest(v_roles) as wanted(role_id) returning role_id
  )
  select coalesce(jsonb_agg(role_id order by role_id), '[]'::jsonb) into v_after from inserted;
  perform private.personnel_insert_event_v1(
    p_org_id, p_user_id, p_actor_id, 'assign_org_roles',
    jsonb_build_object('role_ids', v_before), jsonb_build_object('role_ids', v_after), p_reason, p_request_id
  );
  return true;
end;
$$;

create or replace function public.admin_replace_org_roles_if_current_v1(
  p_actor_id uuid, p_org_id uuid, p_user_id uuid, p_role_ids uuid[], p_expected_role_ids uuid[],
  p_reason text default null, p_request_id text default null
)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_current uuid[];
  v_org_admin_id uuid;
begin
  perform private.personnel_lock_org_v1(p_org_id);
  select id into strict v_org_admin_id from public.roles where code = 'ORG_SUPER_ADMIN';
  select array(
    select assignment.role_id from public.user_roles assignment
    where assignment.org_id = p_org_id and assignment.user_id = p_user_id
      and assignment.scope_type = 'org' and assignment.scope_id = p_org_id and assignment.role_id <> v_org_admin_id
    union
    select pending.role_id from public.fxiaoke_pending_org_roles pending
    join public.fxiaoke_prelogin_role_targets_v1(p_org_id, p_user_id) target
      on target.source_id = pending.source_id and target.identity_id = pending.external_identity_id
      and target.external_user_id = pending.external_user_id
    where pending.org_id = p_org_id and pending.user_id = p_user_id and pending.role_id <> v_org_admin_id
    order by role_id
  ) into v_current;
  if p_expected_role_ids is null or v_current <> array(
    select distinct role_id from unnest(p_expected_role_ids) expected(role_id)
    where role_id <> v_org_admin_id order by role_id
  ) then return 'conflict'; end if;
  if public.admin_replace_org_roles_v1(p_actor_id, p_org_id, p_user_id, p_role_ids, p_reason, p_request_id)
    then return 'saved'; end if;
  return 'ineligible';
end;
$$;

-- Generic scoped roles never manage the reserved organization's control assignment.
alter function public.admin_set_role_scope_assignment_v1(uuid, uuid, uuid, uuid, text, uuid, text, text, text) set schema private;
revoke all on function private.admin_set_role_scope_assignment_v1(uuid, uuid, uuid, uuid, text, uuid, text, text, text)
  from public, anon, authenticated, service_role;
create function public.admin_set_role_scope_assignment_v1(
  p_actor_id uuid, p_org_id uuid, p_user_id uuid, p_role_id uuid, p_scope_type text, p_scope_id uuid, p_action text,
  p_reason text default null, p_request_id text default null
)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  perform private.personnel_lock_org_v1(p_org_id);
  if exists (select 1 from public.roles where id = p_role_id and code = 'ORG_SUPER_ADMIN') then
    raise exception 'use the dedicated organization administrator command' using errcode = '42501';
  end if;
  if p_scope_type in ('department', 'space') and (
    p_actor_id = p_user_id
    or not private.org_super_admin_active_member_v1(p_actor_id, p_org_id)
    or not exists (select 1 from public.organizations where id = p_org_id and status = 'active')
    or private.has_exact_org_role_v1(p_user_id, p_org_id, 'SUPER_ADMIN')
  ) then raise exception 'scoped role mutation denied' using errcode = '42501'; end if;
  if p_action = 'assign' and p_scope_type in ('department', 'space')
    and exists (select 1 from public.roles where id = p_role_id and code = 'SHIPPING_OPERATOR') then
    raise exception 'shipping operator is only assignable at organization scope'
      using errcode = '23514', detail = 'ROLE_SCOPE_NOT_SUPPORTED';
  end if;
  return private.admin_set_role_scope_assignment_v1(
    p_actor_id, p_org_id, p_user_id, p_role_id, p_scope_type, p_scope_id, p_action, p_reason, p_request_id
  );
end;
$$;

create function private.assert_no_org_super_admin_v1(p_user_id uuid, p_org_id uuid)
returns void language plpgsql stable set search_path = ''
as $$
begin
  if private.has_exact_org_role_v1(p_user_id, p_org_id, 'ORG_SUPER_ADMIN') then
    raise exception 'revoke the organization administrator assignment first' using errcode = '42501';
  end if;
end;
$$;

-- The lifecycle hook is shared by offboarding and membership removal. Keep the
-- existing platform protection and require explicit delegation removal first.
alter function private.personnel_assert_last_admin_safe_v1(uuid, uuid)
  rename to personnel_assert_last_platform_admin_safe_v1;
create function private.personnel_assert_last_admin_safe_v1(p_user_id uuid, p_org_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform private.assert_no_org_super_admin_v1(p_user_id, p_org_id);
  perform private.personnel_assert_last_platform_admin_safe_v1(p_user_id, p_org_id);
end;
$$;

-- Account updates can combine active status with login disabled; both inputs
-- need explicit treatment before the legacy account command is reached.
alter function public.admin_set_account_state_v1(uuid, uuid, uuid, text, boolean, text, text) set schema private;
revoke all on function private.admin_set_account_state_v1(uuid, uuid, uuid, text, boolean, text, text)
  from public, anon, authenticated, service_role;
create function public.admin_set_account_state_v1(
  p_actor_id uuid, p_org_id uuid, p_user_id uuid, p_status text, p_login_enabled boolean,
  p_reason text default null, p_request_id text default null
)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  perform private.personnel_lock_org_v1(p_org_id);
  if p_login_enabled = false or p_status in ('inactive', 'suspended') then
    perform private.assert_no_org_super_admin_v1(p_user_id, p_org_id);
  end if;
  return private.admin_set_account_state_v1(p_actor_id, p_org_id, p_user_id, p_status, p_login_enabled, p_reason, p_request_id);
end;
$$;

-- Older application versions may still send this role through account invitations.
create function private.reject_org_super_admin_invitation_v1()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.roles where code = 'ORG_SUPER_ADMIN' and id = any(new.role_ids)) then
    raise exception 'organization administrator cannot be appointed through an invitation' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger reject_org_super_admin_invitation
  before insert or update of role_ids on public.personnel_invitations
  for each row execute function private.reject_org_super_admin_invitation_v1();

revoke all on function private.has_exact_org_role_v1(uuid, uuid, text),
  private.reject_org_super_admin_invitation_v1(),
  private.org_super_admin_active_member_v1(uuid, uuid),
  private.assert_org_super_admin_target_v1(uuid, uuid, uuid),
  private.assert_no_org_super_admin_v1(uuid, uuid),
  private.personnel_assert_last_platform_admin_safe_v1(uuid, uuid),
  private.personnel_assert_last_admin_safe_v1(uuid, uuid),
  public.admin_get_org_super_admin_v1(uuid, uuid, uuid),
  public.admin_set_org_super_admin_v1(uuid, uuid, uuid, boolean, boolean, text),
  public.admin_replace_org_roles_v1(uuid, uuid, uuid, uuid[], text, text),
  public.admin_set_role_scope_assignment_v1(uuid, uuid, uuid, uuid, text, uuid, text, text, text),
  public.admin_set_account_state_v1(uuid, uuid, uuid, text, boolean, text, text)
  from public, anon, authenticated, service_role;

grant execute on function public.admin_get_org_super_admin_v1(uuid, uuid, uuid),
  public.admin_set_org_super_admin_v1(uuid, uuid, uuid, boolean, boolean, text),
  public.admin_replace_org_roles_v1(uuid, uuid, uuid, uuid[], text, text),
  public.admin_set_role_scope_assignment_v1(uuid, uuid, uuid, uuid, text, uuid, text, text, text),
  public.admin_set_account_state_v1(uuid, uuid, uuid, text, boolean, text, text)
  to service_role;

commit;

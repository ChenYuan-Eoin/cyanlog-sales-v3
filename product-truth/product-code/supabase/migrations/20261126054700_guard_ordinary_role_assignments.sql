-- Recheck the system actor in the same transaction as every ordinary role write.
begin;

create function private.assert_system_role_assignment_actor_v1(p_actor_id uuid, p_org_id uuid)
returns void language plpgsql set search_path = ''
as $$
begin
  perform private.personnel_lock_org_v1(p_org_id);
  perform 1 from public.organizations where id = p_org_id for no key update;
  if not private.personnel_is_org_control_admin_v1(p_actor_id, p_org_id) then
    raise exception 'only the current system administrator can change role assignments'
      using errcode = '42501';
  end if;
end;
$$;

alter function public.admin_replace_org_roles_v1(uuid, uuid, uuid, uuid[], text, text)
  rename to admin_replace_org_roles_before_system_actor_v1;
alter function public.admin_replace_org_roles_before_system_actor_v1(uuid, uuid, uuid, uuid[], text, text)
  set schema private;

alter function public.admin_replace_org_roles_if_current_v1(uuid, uuid, uuid, uuid[], uuid[], text, text)
  rename to admin_replace_org_roles_if_current_before_system_actor_v1;
alter function public.admin_replace_org_roles_if_current_before_system_actor_v1(uuid, uuid, uuid, uuid[], uuid[], text, text)
  set schema private;

alter function public.admin_set_role_scope_assignment_v1(uuid, uuid, uuid, uuid, text, uuid, text, text, text)
  rename to admin_set_role_scope_assignment_before_system_actor_v1;
alter function public.admin_set_role_scope_assignment_before_system_actor_v1(uuid, uuid, uuid, uuid, text, uuid, text, text, text)
  set schema private;

revoke all on function private.assert_system_role_assignment_actor_v1(uuid, uuid),
  private.admin_replace_org_roles_before_system_actor_v1(uuid, uuid, uuid, uuid[], text, text),
  private.admin_replace_org_roles_if_current_before_system_actor_v1(uuid, uuid, uuid, uuid[], uuid[], text, text),
  private.admin_set_role_scope_assignment_before_system_actor_v1(uuid, uuid, uuid, uuid, text, uuid, text, text, text)
  from public, anon, authenticated, service_role;

create function public.admin_replace_org_roles_v1(
  p_actor_id uuid, p_org_id uuid, p_user_id uuid, p_role_ids uuid[],
  p_reason text default null, p_request_id text default null
)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  perform private.assert_system_role_assignment_actor_v1(p_actor_id, p_org_id);
  return private.admin_replace_org_roles_before_system_actor_v1(
    p_actor_id, p_org_id, p_user_id, p_role_ids, p_reason, p_request_id
  );
end;
$$;

create function public.admin_replace_org_roles_if_current_v1(
  p_actor_id uuid, p_org_id uuid, p_user_id uuid, p_role_ids uuid[], p_expected_role_ids uuid[],
  p_reason text default null, p_request_id text default null
)
returns text language plpgsql security definer set search_path = ''
as $$
begin
  perform private.assert_system_role_assignment_actor_v1(p_actor_id, p_org_id);
  return private.admin_replace_org_roles_if_current_before_system_actor_v1(
    p_actor_id, p_org_id, p_user_id, p_role_ids, p_expected_role_ids, p_reason, p_request_id
  );
end;
$$;

create function public.admin_set_role_scope_assignment_v1(
  p_actor_id uuid, p_org_id uuid, p_user_id uuid, p_role_id uuid, p_scope_type text, p_scope_id uuid,
  p_action text, p_reason text default null, p_request_id text default null
)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  perform private.assert_system_role_assignment_actor_v1(p_actor_id, p_org_id);
  if p_action = 'assign' and p_scope_type = 'space' then
    raise exception 'legacy space assignments can only be revoked'
      using errcode = '23514', detail = 'LEGACY_SCOPE_ASSIGNMENT_FORBIDDEN';
  end if;
  return private.admin_set_role_scope_assignment_before_system_actor_v1(
    p_actor_id, p_org_id, p_user_id, p_role_id, p_scope_type, p_scope_id, p_action, p_reason, p_request_id
  );
end;
$$;

revoke all on function public.admin_replace_org_roles_v1(uuid, uuid, uuid, uuid[], text, text),
  public.admin_replace_org_roles_if_current_v1(uuid, uuid, uuid, uuid[], uuid[], text, text),
  public.admin_set_role_scope_assignment_v1(uuid, uuid, uuid, uuid, text, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_replace_org_roles_v1(uuid, uuid, uuid, uuid[], text, text),
  public.admin_replace_org_roles_if_current_v1(uuid, uuid, uuid, uuid[], uuid[], text, text),
  public.admin_set_role_scope_assignment_v1(uuid, uuid, uuid, uuid, text, uuid, text, text, text)
  to service_role;

commit;

-- Existing scoped-role commands may remove a business role without changing system administration.
begin;

create or replace function private.admin_set_role_scope_assignment_before_system_admin_v1(
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
  if p_scope_type in ('department', 'space') then
    if p_actor_id = p_user_id
      or not private.org_super_admin_active_member_v1(p_actor_id, p_org_id)
      or not exists (select 1 from public.organizations where id = p_org_id and status = 'active')
    then
      raise exception 'scoped role mutation denied' using errcode = '42501';
    end if;

    if private.has_exact_org_role_v1(p_user_id, p_org_id, 'SUPER_ADMIN') then
      if p_action is distinct from 'revoke'
        or not private.org_super_admin_active_member_v1(p_user_id, p_org_id)
      then
        raise exception 'scoped role mutation denied' using errcode = '42501';
      end if;
      perform private.assert_org_role_references_v1(p_org_id, array[p_role_id]);
    end if;
  end if;
  if p_action = 'assign' and p_scope_type in ('department', 'space')
    and exists (select 1 from public.roles where id = p_role_id and code = 'SHIPPING_OPERATOR') then
    raise exception 'shipping operator is only assignable at organization scope'
      using errcode = '23514', detail = 'ROLE_SCOPE_NOT_SUPPORTED';
  end if;
  if p_action = 'assign' and p_scope_type = 'department' then
    -- Keep the department active through the assignment even when another
    -- transaction changes its status without taking the personnel lock.
    perform 1 from public.departments
    where id = p_scope_id and org_id = p_org_id and status = 'active'
    for share;
    if not found then
      raise exception 'department scope is not available'
        using errcode = '23514', detail = 'DEPARTMENT_SCOPE_UNAVAILABLE';
    end if;
  end if;
  return private.admin_set_role_scope_assignment_v1(
    p_actor_id, p_org_id, p_user_id, p_role_id, p_scope_type, p_scope_id, p_action, p_reason, p_request_id
  );
end;
$$;

commit;

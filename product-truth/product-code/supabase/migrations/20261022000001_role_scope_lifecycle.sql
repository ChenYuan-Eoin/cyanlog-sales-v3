-- WP58: explicit assignment/revocation of organization, department and sales-space role scopes.

begin;

create or replace function public.admin_set_role_scope_assignment_v1(
  p_actor_id uuid,
  p_org_id uuid,
  p_user_id uuid,
  p_role_id uuid,
  p_scope_type text,
  p_scope_id uuid,
  p_action text,
  p_reason text default null,
  p_request_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role_code text;
  v_before jsonb;
  v_after jsonb;
begin
  if p_scope_type not in ('org', 'department', 'space') then
    raise exception 'invalid role scope type' using errcode = '22023';
  end if;
  if p_action not in ('assign', 'revoke') then
    raise exception 'invalid role scope action' using errcode = '22023';
  end if;
  if p_scope_id is null then
    raise exception 'role scope id is required' using errcode = '22023';
  end if;

  perform private.personnel_lock_org_v1(p_org_id);

  if not exists (
    select 1 from public.user_organizations
    where user_id = p_user_id and org_id = p_org_id and status = 'active'
  ) then
    return false;
  end if;

  select code into v_role_code from public.roles where id = p_role_id;
  if v_role_code is null then
    raise exception 'role does not exist' using errcode = '23503';
  end if;
  if v_role_code = 'SUPER_ADMIN' and (p_scope_type <> 'org' or p_scope_id <> p_org_id) then
    raise exception 'SUPER_ADMIN may only use exact organization scope' using errcode = '23514';
  end if;

  if p_scope_type = 'org' and p_scope_id <> p_org_id then
    raise exception 'organization scope does not match tenant' using errcode = '23514';
  elsif p_scope_type = 'department' and not exists (
    select 1 from public.departments where id = p_scope_id and org_id = p_org_id
  ) then
    raise exception 'department scope does not match tenant' using errcode = '23514';
  elsif p_scope_type = 'space' and not exists (
    select 1 from public.sales_spaces where id = p_scope_id and org_id = p_org_id
  ) then
    raise exception 'sales space scope does not match tenant' using errcode = '23514';
  end if;

  select jsonb_build_object(
    'role_id', p_role_id,
    'scope_type', p_scope_type,
    'scope_id', p_scope_id,
    'assigned', exists (
      select 1 from public.user_roles
      where user_id = p_user_id and role_id = p_role_id
        and org_id = p_org_id and scope_type = p_scope_type and scope_id = p_scope_id
    )
  ) into v_before;

  if p_action = 'assign' then
    insert into public.user_roles (
      user_id, role_id, org_id, scope_type, scope_id, granted_by, granted_at
    ) values (
      p_user_id, p_role_id, p_org_id, p_scope_type, p_scope_id, p_actor_id, now()
    )
    on conflict (user_id, role_id, scope_type, scope_id)
    do update set org_id = excluded.org_id, granted_by = excluded.granted_by, granted_at = excluded.granted_at;
  else
    if v_role_code = 'SUPER_ADMIN' then
      perform private.personnel_assert_last_admin_safe_v1(p_user_id, p_org_id);
    end if;
    delete from public.user_roles
    where user_id = p_user_id and role_id = p_role_id
      and org_id = p_org_id and scope_type = p_scope_type and scope_id = p_scope_id;
  end if;

  v_after := jsonb_build_object(
    'role_id', p_role_id,
    'scope_type', p_scope_type,
    'scope_id', p_scope_id,
    'assigned', p_action = 'assign'
  );

  perform private.personnel_insert_event_v1(
    p_org_id,
    p_user_id,
    p_actor_id,
    case when p_action = 'assign' then 'assign_scoped_role' else 'revoke_scoped_role' end,
    v_before,
    v_after,
    p_reason,
    p_request_id
  );
  return true;
end;
$$;

revoke all on function public.admin_set_role_scope_assignment_v1(
  uuid, uuid, uuid, uuid, text, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.admin_set_role_scope_assignment_v1(
  uuid, uuid, uuid, uuid, text, uuid, text, text, text
) to service_role;

comment on function public.admin_set_role_scope_assignment_v1(
  uuid, uuid, uuid, uuid, text, uuid, text, text, text
) is 'Service-role-only tenant scope validation and audited role assignment/revocation.';

commit;

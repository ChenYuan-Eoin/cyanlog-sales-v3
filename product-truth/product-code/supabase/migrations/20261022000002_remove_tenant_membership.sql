-- WP58: remove one organization membership without deleting the person account
-- or unrelated memberships. The command is atomic, tenant-scoped and audited.

begin;

create or replace function private.personnel_remove_membership_v1(
  p_actor_id uuid,
  p_org_id uuid,
  p_user_id uuid,
  p_reason text,
  p_request_id text,
  p_command text,
  p_required_membership_status text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_is_root boolean;
  v_next_org_id uuid;
  v_home_org_id uuid;
begin
  perform private.personnel_lock_org_v1(p_org_id);
  perform private.personnel_assert_last_admin_safe_v1(p_user_id, p_org_id);

  if p_command = 'revoke_invitation' and not exists (
    select 1
    from public.personnel_invitations
    where user_id = p_user_id
      and org_id = p_org_id
      and status = 'pending'
  ) then
    return false;
  end if;

  select
    user_row.org_id,
    jsonb_build_object(
      'user_status', user_row.status,
      'login_enabled', user_row.login_enabled,
      'home_org_id', user_row.org_id,
      'primary_department_id', membership.primary_department_id,
      'membership_status', membership.status,
      'employment_status', membership.employment_status,
      'role_ids', coalesce((
        select jsonb_agg(assignment.role_id)
        from public.user_roles as assignment
        where assignment.user_id = p_user_id
          and assignment.org_id = p_org_id
      ), '[]'::jsonb),
      'department_ids', coalesce((
        select jsonb_agg(department.department_id)
        from public.user_departments as department
        where department.user_id = p_user_id
          and department.org_id = p_org_id
      ), '[]'::jsonb),
      'space_ids', coalesce((
        select jsonb_agg(space.space_id)
        from public.sales_space_members as space
        where space.user_id = p_user_id
          and space.org_id = p_org_id
      ), '[]'::jsonb)
    )
  into v_home_org_id, v_before
  from public.users as user_row
  join public.user_organizations as membership
    on membership.user_id = user_row.id
   and membership.org_id = p_org_id
  where user_row.id = p_user_id
    and membership.status in ('invited', 'active', 'suspended')
    and (
      p_required_membership_status is null
      or membership.status = p_required_membership_status
    )
  for update of user_row, membership;

  if v_before is null then
    return false;
  end if;

  select exists (
    select 1
    from public.user_roles as assignment
    join public.roles as role
      on role.id = assignment.role_id
    where assignment.user_id = p_user_id
      and assignment.org_id = p_org_id
      and assignment.scope_type = 'org'
      and assignment.scope_id = p_org_id
      and role.code = 'SUPER_ADMIN'
  ) into v_is_root;

  if v_is_root then
    raise exception 'protected platform root administrator' using errcode = '42501';
  end if;

  select membership.org_id
  into v_next_org_id
  from public.user_organizations as membership
  where membership.user_id = p_user_id
    and membership.org_id <> p_org_id
    and membership.status = 'active'
  order by membership.is_default desc, membership.joined_at asc, membership.org_id
  limit 1;

  update public.user_organizations
  set
    status = 'ended',
    employment_status = 'ended',
    is_default = false,
    left_at = now(),
    employment_ended_at = now(),
    offboard_reason = p_reason,
    primary_department_id = null,
    membership_version = membership_version + 1,
    updated_by = p_actor_id,
    updated_at = now()
  where user_id = p_user_id
    and org_id = p_org_id;

  if v_next_org_id is not null then
    update public.user_organizations
    set
      is_default = (org_id = v_next_org_id),
      updated_at = now()
    where user_id = p_user_id
      and status = 'active';
  end if;

  update public.personnel_employment_periods
  set
    status = 'ended',
    ended_at = now(),
    end_reason = p_reason,
    department_id = null,
    manager_user_id = null,
    updated_at = now()
  where user_id = p_user_id
    and org_id = p_org_id
    and status in ('active', 'suspended');

  delete from public.auth_tokens where user_id = p_user_id;
  delete from public.user_roles
  where user_id = p_user_id and org_id = p_org_id;
  delete from public.user_permission_assignments
  where user_id = p_user_id and org_id = p_org_id;
  delete from public.user_departments
  where user_id = p_user_id and org_id = p_org_id;
  delete from public.sales_space_members
  where user_id = p_user_id and org_id = p_org_id;

  update public.personnel_invitations
  set
    status = 'revoked',
    revoked_at = now()
  where user_id = p_user_id
    and org_id = p_org_id
    and status = 'pending';

  if v_next_org_id is null then
    update public.users
    set
      status = 'inactive',
      login_enabled = false,
      primary_dept_id = null,
      report_to_user_id = null,
      updated_at = now()
    where id = p_user_id;
  elsif v_home_org_id = p_org_id then
    -- Keep the legacy users.org_id column aligned while tenant selection itself
    -- remains sourced from active user_organizations memberships.
    update public.users
    set
      org_id = v_next_org_id,
      primary_dept_id = null,
      report_to_user_id = null,
      updated_at = now()
    where id = p_user_id
      and org_id = p_org_id;
  end if;

  v_after := jsonb_build_object(
    'membership_status', 'ended',
    'employment_status', 'ended',
    'left_at', now(),
    'next_default_org_id', v_next_org_id,
    'role_ids', '[]'::jsonb,
    'department_ids', '[]'::jsonb,
    'space_ids', '[]'::jsonb,
    'sessions_revoked', true,
    'pending_invitations_revoked', true
  );

  perform private.personnel_insert_event_v1(
    p_org_id,
    p_user_id,
    p_actor_id,
    p_command,
    v_before,
    v_after,
    p_reason,
    p_request_id
  );
  return true;
end;
$$;

create or replace function public.admin_remove_tenant_membership_v1(
  p_actor_id uuid,
  p_org_id uuid,
  p_user_id uuid,
  p_reason text default null,
  p_request_id text default null
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select private.personnel_remove_membership_v1(
    p_actor_id,
    p_org_id,
    p_user_id,
    p_reason,
    p_request_id,
    'remove_tenant_membership',
    null
  );
$$;

create or replace function public.admin_revoke_personnel_invitation_v1(
  p_actor_id uuid,
  p_org_id uuid,
  p_user_id uuid,
  p_reason text default null,
  p_request_id text default null
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select private.personnel_remove_membership_v1(
    p_actor_id,
    p_org_id,
    p_user_id,
    p_reason,
    p_request_id,
    'revoke_invitation',
    'invited'
  );
$$;

revoke all on function private.personnel_remove_membership_v1(
  uuid, uuid, uuid, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.admin_remove_tenant_membership_v1(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated;
revoke all on function public.admin_revoke_personnel_invitation_v1(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated;

grant execute on function public.admin_remove_tenant_membership_v1(
  uuid, uuid, uuid, text, text
) to service_role;
grant execute on function public.admin_revoke_personnel_invitation_v1(
  uuid, uuid, uuid, text, text
) to service_role;

comment on function public.admin_remove_tenant_membership_v1(
  uuid, uuid, uuid, text, text
) is 'End one tenant membership, revoke authority and preserve person/account history.';
comment on function public.admin_revoke_personnel_invitation_v1(
  uuid, uuid, uuid, text, text
) is 'Revoke a pending invitation and end only its invited tenant membership.';

commit;

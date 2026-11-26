-- WP82. Edit the visible organization roles and the canonical appointment atomically.
begin;

create function public.admin_save_member_org_roles_v1(
  p_actor_id uuid,
  p_org_id uuid,
  p_user_id uuid,
  p_role_ids uuid[],
  p_expected_role_ids uuid[],
  p_system_admin boolean,
  p_expected_system_admin boolean,
  p_request_id text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_visible_roles uuid[];
  v_current_roles uuid[];
  v_expected_roles uuid[];
  v_wanted_roles uuid[];
  v_current_system_admin boolean;
begin
  if p_actor_id is null or p_org_id is null or p_user_id is null or p_actor_id = p_user_id
    or p_role_ids is null or p_expected_role_ids is null
    or p_system_admin is null or p_expected_system_admin is null then
    return 'ineligible';
  end if;

  perform private.personnel_lock_org_v1(p_org_id);
  perform 1 from public.organizations where id = p_org_id and status = 'active' for no key update;
  if not found then
    return 'ineligible';
  end if;
  perform 1
  from public.users as person
  join public.user_organizations as membership on membership.user_id = person.id and membership.org_id = person.org_id
  where person.org_id = p_org_id and person.id in (p_actor_id, p_user_id)
  order by person.id for share of person, membership;

  -- The actor must still hold effective system authority. The target must be a
  -- current member, including a member whose ICU login was separately disabled.
  if not private.personnel_is_org_control_admin_v1(p_actor_id, p_org_id) or not exists (
    select 1 from public.users as person
    join public.user_organizations as membership on membership.user_id = person.id and membership.org_id = person.org_id
    where person.id = p_actor_id and person.org_id = p_org_id and membership.is_default
  ) or not exists (
    select 1 from public.users as person
    join public.user_organizations as membership on membership.user_id = person.id and membership.org_id = person.org_id
    where person.id = p_user_id and person.org_id = p_org_id and membership.is_default
      and person.status = 'active' and membership.status = 'active'
      and membership.employment_status = 'active' and membership.left_at is null
  ) then
    return 'ineligible';
  end if;

  -- Only the visible ordinary roles participate in this snapshot. Dormant and
  -- historical administrative roles retain their original bindings.
  select array(
    select role.id from private.org_role_catalog_v1(p_org_id, false) as role
    where role.code not in ('SUPER_ADMIN', 'ORG_SUPER_ADMIN', 'FXIAOKE_BASELINE')
  ) into v_visible_roles;
  select array(
    select distinct assignment.role_id from public.user_roles as assignment
    where assignment.user_id = p_user_id and assignment.org_id = p_org_id
      and assignment.scope_type = 'org' and assignment.scope_id = p_org_id
      and assignment.role_id = any(v_visible_roles)
    order by assignment.role_id
  ) into v_current_roles;
  select array(select distinct role_id from unnest(p_expected_role_ids) as expected(role_id) order by role_id)
    into v_expected_roles;
  v_current_system_admin := private.has_exact_org_role_v1(p_user_id, p_org_id, 'SUPER_ADMIN');
  if v_current_roles is distinct from v_expected_roles
    or v_current_system_admin is distinct from p_expected_system_admin then
    return 'conflict';
  end if;

  select array(select distinct role_id from unnest(p_role_ids) as wanted(role_id) order by role_id)
    into v_wanted_roles;
  if exists (
    select 1 from unnest(v_wanted_roles) as wanted(role_id)
    where (wanted.role_id = any(v_visible_roles)) is not true
  ) then
    return 'ineligible';
  end if;

  if v_current_roles is distinct from v_wanted_roles then
    delete from public.user_roles as assignment
    where assignment.user_id = p_user_id and assignment.org_id = p_org_id
      and assignment.scope_type = 'org' and assignment.scope_id = p_org_id
      and assignment.role_id = any(v_current_roles) and not (assignment.role_id = any(v_wanted_roles));

    insert into public.user_roles (org_id, user_id, role_id, scope_type, scope_id, granted_by)
    select p_org_id, p_user_id, wanted.role_id, 'org', p_org_id, p_actor_id
    from unnest(v_wanted_roles) as wanted(role_id)
    where not (wanted.role_id = any(v_current_roles));

    perform private.personnel_insert_event_v1(
      p_org_id, p_user_id, p_actor_id, 'assign_org_roles',
      jsonb_build_object('role_ids', v_current_roles), jsonb_build_object('role_ids', v_wanted_roles),
      'tenant role assignment', p_request_id
    );
  end if;

  if v_current_system_admin is distinct from p_system_admin then
    perform private.set_super_admin_assignment_v1(
      p_actor_id, p_org_id, p_user_id, 'SUPER_ADMIN', p_system_admin, v_current_system_admin, p_request_id
    );
  end if;
  return 'saved';
end;
$$;

revoke all on function public.admin_save_member_org_roles_v1(uuid, uuid, uuid, uuid[], uuid[], boolean, boolean, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_save_member_org_roles_v1(uuid, uuid, uuid, uuid[], uuid[], boolean, boolean, text)
  to service_role;

commit;

-- Limit new department shipping-operator grants to published, configured ledger operations.
begin;

set local lock_timeout = '5s';
lock table public.roles in share mode;
lock table public.user_roles in share row exclusive mode;

-- These bindings were dormant under the old scope evaluator. Review them before
-- enabling this path rather than changing an existing employee's authorization.
do $$
begin
  if exists (
    select 1 from public.user_roles as binding
    join public.roles as definition on definition.id = binding.role_id
    where definition.code = 'SHIPPING_OPERATOR' and binding.scope_type in ('department', 'space')
  ) then
    raise exception 'review existing scoped shipping operator bindings before applying this migration'
      using errcode = '23514', detail = 'LEGACY_SHIPPING_OPERATOR_SCOPE_PRESENT';
  end if;
end;
$$;

create function private.shipping_role_scope_catalog_v1()
returns table (code text, supported_scope_types text[])
language sql stable set search_path = ''
as $$
  select point.code, point.supported_scope_types
  from public.permission_points as point
  where point.status = 'published' and point.kind = 'atomic'
    and point.resource = 'shipping' and point.category = 'shipping'
    and point.action = split_part(point.code, ':', 2)
    and (
      (point.code = 'shipping:record_return'
        and cardinality(point.supported_scope_types) = 2
        and point.supported_scope_types @> array['org','department']
        and point.dependencies = array['shipping:ledger_view']
        and point.enforcement_consumer = 'lib/shipping/http.ts')
      or (point.code = 'shipping:ledger_view'
        and (point.supported_scope_types = array['org']
          or (cardinality(point.supported_scope_types) = 2
            and point.supported_scope_types @> array['org','department']))
        and point.dependencies = array[]::text[]
        and point.enforcement_consumer = 'lib/shipping/http.ts')
      or (point.code = 'shipping:operate'
        and point.supported_scope_types = array['org']
        and point.dependencies = array[]::text[]
        and point.enforcement_consumer = 'lib/shipping/operator-access.ts#requireShippingOperator')
    )
$$;

create function private.shipping_role_effective_scope_permissions_v1(
  p_role_code text, p_role_id uuid, p_settings jsonb, p_template jsonb
)
returns jsonb language sql immutable set search_path = ''
as $$
  select case
    when p_role_code = 'SUPER_ADMIN' then '["*"]'::jsonb
    when p_settings is not null and jsonb_typeof(p_settings) not in ('object','null')
      then '[]'::jsonb
    when overrides.value is not null and jsonb_typeof(overrides.value) <> 'object'
      then '[]'::jsonb
    when override.value is not null then
      case when jsonb_typeof(override.value) = 'array' then
        case when not exists (
          select 1 from jsonb_array_elements(override.value) as permission(value)
          where jsonb_typeof(permission.value) <> 'string' or permission.value = '""'::jsonb
        ) then override.value else '[]'::jsonb end
      else '[]'::jsonb end
    when jsonb_typeof(p_template) = 'array' then p_template
    else '[]'::jsonb
  end
  from (values (p_settings->'role_permission_overrides')) as overrides(value)
  cross join lateral (values (overrides.value->p_role_id::text)) as override(value);
$$;

revoke all on function private.shipping_role_scope_catalog_v1(),
  private.shipping_role_effective_scope_permissions_v1(text, uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;

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
  if p_action = 'assign' and p_scope_type = 'space'
    and exists (select 1 from public.roles where id = p_role_id and code = 'SHIPPING_OPERATOR') then
    raise exception 'legacy space assignments can only be revoked'
      using errcode = '23514', detail = 'LEGACY_SCOPE_ASSIGNMENT_FORBIDDEN';
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
    if exists (select 1 from public.roles where id = p_role_id and code = 'SHIPPING_OPERATOR') then
      perform 1 from public.user_organizations as membership
      join public.users as person on person.id = membership.user_id
      where membership.user_id = p_user_id and membership.org_id = p_org_id and membership.is_default
        and membership.status = 'active' and membership.employment_status = 'active' and membership.left_at is null
        and person.status = 'active' and person.login_enabled is true
      for share of membership, person;
      if not found then return false; end if;

      perform private.assert_org_role_references_v1(p_org_id, array[p_role_id]);
      if not exists (
        select 1 from private.shipping_role_scope_catalog_v1() as point
        where point.code = 'shipping:ledger_view' and 'department' = any(point.supported_scope_types)
      ) or not exists (
        select 1 from public.organizations as organization
        join public.roles as definition on definition.id = p_role_id
        where organization.id = p_org_id
          and definition.code = 'SHIPPING_OPERATOR' and definition.name <> ''
          and private.shipping_role_effective_scope_permissions_v1(
            definition.code, definition.id, organization.settings, definition.permissions
          ) ? 'shipping:ledger_view'
      ) then
        raise exception 'a department shipping operator requires the published ledger permission'
          using errcode = '23514', detail = 'SHIPPING_DEPARTMENT_LEDGER_PERMISSION_REQUIRED';
      end if;
    end if;
  end if;
  return private.admin_set_role_scope_assignment_v1(
    p_actor_id, p_org_id, p_user_id, p_role_id, p_scope_type, p_scope_id, p_action, p_reason, p_request_id
  );
end;
$$;

create or replace function private.shipping_employee_permission_scope_projection_v1(
  p_org_id uuid, p_actor_id uuid, p_pending_revision text
)
returns table (
  permission_code text, base_organization_wide boolean, base_department_ids uuid[],
  organization_wide boolean, department_ids uuid[], base_sources jsonb
)
language sql stable set search_path = ''
as $$
  with recursive
  member_org as (
    select organization.settings
    from public.organizations as organization
    where organization.id = p_org_id and organization.status = 'active'
      and (
        (p_pending_revision is null
          and private.org_super_admin_active_member_v1(p_actor_id, p_org_id)
          and (
            select count(*) from public.user_organizations as membership
            where membership.user_id = p_actor_id and membership.is_default
          ) = 1)
        or exists (
          select 1 from private.employee_prelogin_target_v1(p_org_id, p_actor_id) as target
          where target.target_revision = p_pending_revision
        )
      )
  ),
  catalog as (
    select * from private.shipping_role_scope_catalog_v1()
  ),
  role_bindings as (
    select binding.role_id, binding.scope_type, binding.scope_id
    from member_org
    join public.user_roles as binding on binding.org_id = p_org_id and binding.user_id = p_actor_id
    where p_pending_revision is null
    union all
    select pending.role_id, 'org', p_org_id
    from member_org
    cross join private.employee_prelogin_role_ids_v1(p_org_id, p_actor_id) as pending(role_id)
    where p_pending_revision is not null
  ),
  role_assignments as (
    select binding.scope_type, binding.scope_id, definition.code,
      coalesce(metadata.name, definition.name) as role_name,
      private.shipping_role_effective_scope_permissions_v1(
        definition.code, definition.id, member_org.settings, definition.permissions
      ) as permissions
    from member_org
    cross join role_bindings as binding
    join public.roles as definition on definition.id = binding.role_id
    left join private.org_role_metadata as metadata
      on metadata.org_id = p_org_id and metadata.role_id = definition.id
    where definition.code not in ('ORG_SUPER_ADMIN', 'FXIAOKE_BASELINE')
      and definition.code <> '' and definition.name <> ''
      and (definition.owner_org_id is null or definition.owner_org_id = p_org_id)
      and metadata.archived_at is null
      and (
        (binding.scope_type = 'org' and binding.scope_id = p_org_id
          and (definition.code <> 'SUPER_ADMIN' or definition.owner_org_id is null))
        or (binding.scope_type = 'department'
          and definition.code <> 'SUPER_ADMIN')
      )
  ),
  active_tree as (
    select department.id, department.parent_id, department.leader_id, department.name
    from member_org
    join public.departments as department on department.org_id = p_org_id and department.status = 'active'
  ),
  role_action_sources as (
    select 'return'::text as action, grant_row.scope_type, grant_row.scope_id, grant_row.role_name
    from role_assignments as grant_row
    where exists (select 1 from catalog where code = 'shipping:record_return')
      and (grant_row.permissions ? 'shipping:record_return'
        or (grant_row.scope_type = 'org' and grant_row.code = 'SUPER_ADMIN'))
      and (grant_row.scope_type = 'org' or exists (
        select 1 from active_tree where id = grant_row.scope_id
      ))
      and (grant_row.scope_type <> 'department' or grant_row.code <> 'SHIPPING_OPERATOR'
        or (grant_row.permissions ? 'shipping:ledger_view' and exists (
          select 1 from catalog where code = 'shipping:ledger_view' and 'department' = any(supported_scope_types)
        )))
    union all
    select 'view', grant_row.scope_type, grant_row.scope_id, grant_row.role_name
    from role_assignments as grant_row
    where (grant_row.scope_type = 'org' and (
      (exists (select 1 from catalog where code = 'shipping:ledger_view')
        and grant_row.permissions ?| array['shipping:ledger_view','shipping:*','*'])
      or ((exists (select 1 from catalog where code = 'shipping:ledger_view') or not exists (
          select 1 from public.permission_points where code = 'shipping:ledger_view'
        )) and exists (select 1 from catalog where code = 'shipping:operate')
        and grant_row.permissions ?| array['shipping:operate','shipping:*','*'])
    )) or (grant_row.scope_type = 'department' and grant_row.permissions ? 'shipping:ledger_view'
      and exists (select 1 from active_tree where id = grant_row.scope_id)
      and exists (
        select 1 from catalog where code = 'shipping:ledger_view' and 'department' = any(supported_scope_types)
      ))
  ),
  org_grants as (
    select
      exists (select 1 from role_action_sources where action = 'return' and scope_type = 'org') as can_return,
      exists (select 1 from role_action_sources where action = 'view' and scope_type = 'org') as can_view
  ),
  direct_ledger_roots as (
    select department.id, department.name,
      (grant_value.value->'include_subdepartments') = 'true'::jsonb as with_children
    from member_org
    cross join active_tree as department
    cross join lateral (
      select member_org.settings->'department_permission_grants'->department.id::text as value
    ) as grant_value
    where grant_value.value->'permissions' = '["shipping:ledger_view"]'::jsonb
      and jsonb_typeof(grant_value.value->'include_subdepartments') = 'boolean'
      and exists (
        select 1 from catalog where code = 'shipping:ledger_view' and 'department' = any(supported_scope_types)
      )
      and (
        exists (select 1 from public.user_departments as membership
          where membership.org_id = p_org_id and membership.user_id = p_actor_id
            and membership.department_id = department.id)
        or (department.leader_id = p_actor_id and exists (select 1 from public.department_lead_access as lead
          where lead.org_id = p_org_id and lead.user_id = p_actor_id and lead.department_id = department.id))
      )
  ),
  scope_roots as (
    select action, scope_id as id, true as with_children
    from role_action_sources where scope_type = 'department'
    union
    select 'view', id, with_children from direct_ledger_roots
  ),
  department_scope(action, id, with_children) as (
    select action, id, with_children from scope_roots
    union
    select scope.action, child.id, true
    from department_scope as scope
    join active_tree as child on child.parent_id = scope.id
    where scope.with_children
  ),
  base_action_sources as (
    select action, 'role'::text as kind, role_name as name from role_action_sources
    union
    select 'view', 'department', name from direct_ledger_roots
  ),
  base_actions as (
    select action.permission_code, action.organization_wide, array(
      select distinct scope.id from department_scope as scope
      where scope.action = action.name and not action.organization_wide
      order by scope.id
    ) as department_ids,
    coalesce((
      select jsonb_agg(jsonb_build_object('kind', source.kind, 'name', source.name) order by source.kind, source.name)
      from base_action_sources as source where source.action = action.name
    ), '[]'::jsonb) as sources
    from org_grants
    cross join lateral (values
      ('shipping:ledger_view', 'view', org_grants.can_view),
      ('shipping:record_return', 'return', org_grants.can_return)
    ) as action(permission_code, name, organization_wide)
  ),
  employee_overrides as (
    select employee.* from public.employee_permission_overrides_v1(p_org_id, p_actor_id) as employee
    where p_pending_revision is null
    union all
    select exception.permission_code, exception.effect, exception.scope
    from member_org
    join private.employee_permission_overrides as exception
      on exception.org_id = p_org_id and exception.user_id = p_actor_id
        and exception.pending_target_revision = p_pending_revision
  ),
  personal as (
    select employee.permission_code, employee.effect, employee.scope, catalog.supported_scope_types
    from member_org
    cross join employee_overrides as employee
    left join catalog on catalog.code = employee.permission_code
    where employee.permission_code in ('shipping:ledger_view', 'shipping:record_return')
  ),
  personal_departments(permission_code, id, with_children) as (
    select personal.permission_code, root.id, selection.value->'include_subdepartments' = 'true'::jsonb
    from personal
    cross join lateral jsonb_array_elements(
      case when personal.effect = 'ALLOW' and personal.scope->>'type' = 'department'
        and 'department' = any(personal.supported_scope_types) then personal.scope->'departments'
        else '[]'::jsonb end
    ) as selection(value)
    join active_tree as root on root.id = (selection.value->>'department_id')::uuid
    union
    select parent.permission_code, child.id, true
    from personal_departments as parent
    join active_tree as child on child.parent_id = parent.id
    where parent.with_children
  )
  select base.permission_code, base.organization_wide, base.department_ids,
    case when personal.permission_code is null then base.organization_wide
      else coalesce(personal.effect = 'ALLOW' and personal.scope->>'type' = 'org'
        and 'org' = any(personal.supported_scope_types), false) end,
    case when personal.permission_code is null then base.department_ids else array(
      select distinct scope.id from personal_departments as scope
      where scope.permission_code = base.permission_code order by scope.id
    ) end,
    base.sources
  from base_actions as base
  left join personal on personal.permission_code = base.permission_code
  order by base.permission_code;
$$;

commit;

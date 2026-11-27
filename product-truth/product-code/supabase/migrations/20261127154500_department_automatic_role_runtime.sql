-- Compose live departmental role sources before the existing employee exception layer.
begin;

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
  automatic_role_action_sources as (
    select action.name as action, derived.affiliation_department_id as scope_id,
      rule_department.name || ' · ' || derived.role_name as source_name
    from member_org
    cross join lateral public.department_automatic_role_sources_v1(p_org_id, p_actor_id) as derived
    join active_tree as assigned_department on assigned_department.id = derived.affiliation_department_id
    join active_tree as rule_department on rule_department.id = derived.rule_department_id
    cross join (values ('shipping:ledger_view', 'view'), ('shipping:record_return', 'return'))
      as action(permission_code, name)
    join catalog on catalog.code = action.permission_code and 'department' = any(catalog.supported_scope_types)
    where p_pending_revision is null and action.permission_code = any(derived.permissions)
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
    select action, scope_id, true from automatic_role_action_sources
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
    select action, 'department', source_name from automatic_role_action_sources
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

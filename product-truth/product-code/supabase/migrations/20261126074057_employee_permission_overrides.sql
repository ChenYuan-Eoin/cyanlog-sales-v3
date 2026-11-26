-- Personal exceptions apply to existing actions after department and role grants.
begin;

create table private.employee_permission_overrides (
  org_id uuid not null,
  user_id uuid not null,
  permission_code text not null references public.permission_points(code),
  effect text not null check (effect in ('ALLOW', 'DENY')),
  scope jsonb,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id, permission_code),
  foreign key (user_id, org_id) references public.user_organizations(user_id, org_id) on delete cascade,
  check ((effect = 'DENY' and scope is null)
    or (effect = 'ALLOW' and scope is not null and jsonb_typeof(scope) = 'object'))
);
alter table private.employee_permission_overrides enable row level security;
revoke all on table private.employee_permission_overrides from public, anon, authenticated, service_role;

-- As with explicit role bindings, departure ends the grants from that employment.
-- A temporary login suspension is governed by the live membership check.
create function private.clear_departed_employee_permission_overrides_v1()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from private.employee_permission_overrides
    where org_id = new.org_id and user_id = new.user_id;
  return new;
end;
$$;
revoke all on function private.clear_departed_employee_permission_overrides_v1()
  from public, anon, authenticated, service_role;
create trigger clear_departed_employee_permission_overrides
  after update of status, employment_status, left_at on public.user_organizations
  for each row when (
    (new.status = 'ended' or new.employment_status = 'ended' or new.left_at is not null)
    and (old.status is distinct from new.status
      or old.employment_status is distinct from new.employment_status
      or old.left_at is distinct from new.left_at)
  ) execute function private.clear_departed_employee_permission_overrides_v1();

create function public.employee_permission_overrides_v1(p_org_id uuid, p_user_id uuid)
returns table (permission_code text, effect text, scope jsonb)
language sql stable security definer set search_path = ''
as $$
  select exception.permission_code, exception.effect, exception.scope
  from private.employee_permission_overrides as exception
  join public.organizations as organization on organization.id = exception.org_id
  where exception.org_id = p_org_id and exception.user_id = p_user_id
    and organization.status = 'active'
    and private.org_super_admin_active_member_v1(p_user_id, p_org_id)
    and not private.has_exact_org_role_v1(p_user_id, p_org_id, 'SUPER_ADMIN')
  order by exception.permission_code;
$$;

-- Use one canonical tuple for both optimistic concurrency and JSON readback.
-- Department existence is checked separately so an old selection can be cleared.
create function private.normalize_employee_permission_override_v1(p_permission_code text, p_value jsonb)
returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  v_scope jsonb;
  v_departments jsonb;
  v_kind text;
begin
  if p_value is null or p_value = 'null'::jsonb then return null; end if;
  if jsonb_typeof(p_value) <> 'object' then
    raise exception 'invalid employee permission override'
      using errcode = '22023', detail = 'EMPLOYEE_PERMISSION_OVERRIDE_INVALID';
  end if;
  if (p_value - array['effect','scope']::text[]) <> '{}'::jsonb
    or jsonb_typeof(p_value->'effect') is distinct from 'string'
    or (p_value->>'effect') not in ('ALLOW', 'DENY') then
    raise exception 'invalid employee permission override'
      using errcode = '22023', detail = 'EMPLOYEE_PERMISSION_OVERRIDE_INVALID';
  end if;

  v_scope := p_value->'scope';
  if p_value->>'effect' = 'DENY' then
    if v_scope is not distinct from 'null'::jsonb then return p_value; end if;
  elsif jsonb_typeof(v_scope) = 'object' and jsonb_typeof(v_scope->'type') = 'string' then
    v_kind := v_scope->>'type';
    if ((p_permission_code = 'shipping:owner_view' and v_kind = 'self')
      or (p_permission_code <> 'shipping:owner_view' and v_kind = 'org'))
      and v_scope = jsonb_build_object('type', v_kind) then
      return p_value;
    end if;
    if p_permission_code <> 'shipping:owner_view' and v_kind = 'department'
      and jsonb_typeof(v_scope->'departments') = 'array'
      and (v_scope - array['type','departments']::text[]) = '{}'::jsonb then
      v_departments := v_scope->'departments';
      if jsonb_array_length(v_departments) > 0
        and not exists (
          select 1 from jsonb_array_elements(v_departments) as department(value)
          where jsonb_typeof(department.value) <> 'object'
            or (case when jsonb_typeof(department.value) = 'object'
              then department.value - array['department_id','include_subdepartments']::text[] end) <> '{}'::jsonb
            or jsonb_typeof(department.value->'department_id') is distinct from 'string'
            or (department.value->>'department_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            or jsonb_typeof(department.value->'include_subdepartments') is distinct from 'boolean'
        )
        and jsonb_array_length(v_departments) = (
          select count(distinct (department.value->>'department_id')::uuid)
          from jsonb_array_elements(v_departments) as department(value)
        ) then
        return jsonb_build_object(
          'effect', 'ALLOW', 'scope', jsonb_build_object(
            'type', 'department',
            'departments', (
              select jsonb_agg(
                jsonb_build_object(
                  'department_id', (department.value->>'department_id')::uuid,
                  'include_subdepartments', department.value->'include_subdepartments'
                ) order by (department.value->>'department_id')::uuid
              )
              from jsonb_array_elements(v_departments) as department(value)
            )
          )
        );
      end if;
    end if;
  end if;
  raise exception 'invalid employee permission override scope'
    using errcode = '22023', detail = 'EMPLOYEE_PERMISSION_OVERRIDE_INVALID';
end;
$$;
revoke all on function private.normalize_employee_permission_override_v1(text, jsonb)
  from public, anon, authenticated, service_role;

create function public.admin_set_employee_permission_override_v1(
  p_actor_id uuid, p_org_id uuid, p_user_id uuid, p_permission_code text,
  p_expected_override jsonb, p_override jsonb
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_expected jsonb;
  v_override jsonb;
  v_current jsonb;
  v_scope jsonb;
  v_published_scope_types text[];
  v_department_count bigint;
begin
  if p_actor_id is null or p_org_id is null or p_user_id is null
    or p_permission_code is null
    or p_permission_code not in ('shipping:ledger_view', 'shipping:record_return', 'shipping:owner_view') then
    raise exception 'invalid employee permission override'
      using errcode = '22023', detail = 'EMPLOYEE_PERMISSION_OVERRIDE_INVALID';
  end if;

  perform private.assert_system_role_assignment_actor_v1(p_actor_id, p_org_id);

  perform 1 from public.user_organizations as membership
  join public.users as person on person.id = membership.user_id
  where membership.org_id = p_org_id and membership.user_id = p_user_id
    and membership.is_default and membership.status = 'active'
    and membership.employment_status = 'active' and membership.left_at is null
    and person.status = 'active' and person.login_enabled is true
  for share of membership, person;
  if not found then
    raise exception 'active employee not found in the current organization'
      using errcode = 'P0002', detail = 'EMPLOYEE_PERMISSION_OVERRIDE_TARGET_NOT_FOUND';
  end if;
  if private.has_exact_org_role_v1(p_user_id, p_org_id, 'SUPER_ADMIN') then
    raise exception 'cannot change the protected system administrator'
      using errcode = '42501', detail = 'EMPLOYEE_PERMISSION_OVERRIDE_PROTECTED';
  end if;

  v_expected := private.normalize_employee_permission_override_v1(p_permission_code, p_expected_override);
  v_override := private.normalize_employee_permission_override_v1(p_permission_code, p_override);
  v_scope := nullif(v_override->'scope', 'null'::jsonb);

  select jsonb_build_object('effect', exception.effect, 'scope', exception.scope) into v_current
  from private.employee_permission_overrides as exception
  where exception.org_id = p_org_id and exception.user_id = p_user_id and exception.permission_code = p_permission_code;
  if v_current is distinct from v_expected then
    raise exception 'employee permission override has changed'
      using errcode = '40001', detail = 'EMPLOYEE_PERMISSION_OVERRIDE_CONFLICT';
  end if;

  -- Clearing an existing row must also work after its definition was disabled.
  if v_override is not null then
    select point.supported_scope_types into v_published_scope_types
    from public.permission_points as point
    where point.code = p_permission_code and point.status = 'published' and point.kind = 'atomic'
      and point.resource = 'shipping' and point.category = 'shipping'
      and point.action = split_part(p_permission_code, ':', 2)
      and point.enforcement_consumer = 'lib/shipping/http.ts'
      and case p_permission_code
        when 'shipping:ledger_view' then point.dependencies = array[]::text[]
          and (point.supported_scope_types = array['org']
            or (cardinality(point.supported_scope_types) = 2
              and point.supported_scope_types @> array['org','department']))
        when 'shipping:record_return' then point.dependencies = array['shipping:ledger_view']
          and cardinality(point.supported_scope_types) = 2
          and point.supported_scope_types @> array['org','department']
        when 'shipping:owner_view' then point.dependencies = array[]::text[]
          and point.supported_scope_types = array['self']
      end
    for share;
    if not found then
      raise exception 'employee permission action is not published'
        using errcode = '23514', detail = 'EMPLOYEE_PERMISSION_OVERRIDE_NOT_PUBLISHED';
    end if;
    if v_scope is not null and not ((v_scope->>'type') = any(v_published_scope_types)) then
      raise exception 'employee permission scope is not supported by this action'
        using errcode = '22023', detail = 'EMPLOYEE_PERMISSION_OVERRIDE_INVALID';
    end if;
  end if;

  if v_scope->>'type' = 'department' then
    select count(*) into v_department_count
    from (
      select department.id
      from public.departments as department
      join jsonb_array_elements(v_scope->'departments') as selected(value)
        on department.id = (selected.value->>'department_id')::uuid
      where department.org_id = p_org_id and department.status = 'active'
      order by department.id for share of department
    ) as active_selected;
    if v_department_count <> jsonb_array_length(v_scope->'departments') then
      raise exception 'employee permission scope must use current organization departments'
        using errcode = '22023', detail = 'EMPLOYEE_PERMISSION_OVERRIDE_INVALID';
    end if;
  end if;

  if v_override is not null then
    update public.organizations
      set settings = coalesce(nullif(settings, 'null'::jsonb), '{}'::jsonb)
        || '{"employee_permission_overrides_enabled":true}'::jsonb
      where id = p_org_id
        and (settings is null or jsonb_typeof(settings) in ('object','null'))
        and settings->'employee_permission_overrides_enabled' is distinct from 'true'::jsonb;
    if not exists (
      select 1 from public.organizations
      where id = p_org_id and settings->'employee_permission_overrides_enabled' = 'true'::jsonb
    ) then
      raise exception 'invalid organization settings for employee permission override'
        using errcode = '22023', detail = 'EMPLOYEE_PERMISSION_OVERRIDE_INVALID';
    end if;
  end if;
  if v_current is not distinct from v_override then return coalesce(v_override, 'null'::jsonb); end if;

  if v_override is null then
    delete from private.employee_permission_overrides
      where org_id = p_org_id and user_id = p_user_id and permission_code = p_permission_code;
  else
    insert into private.employee_permission_overrides (org_id, user_id, permission_code, effect, scope, updated_by)
    values (p_org_id, p_user_id, p_permission_code, v_override->>'effect', v_scope, p_actor_id)
    on conflict (org_id, user_id, permission_code) do update
      set effect = excluded.effect, scope = excluded.scope, updated_by = excluded.updated_by, updated_at = now();
  end if;

  perform private.personnel_insert_event_v1(
    p_org_id, p_user_id, p_actor_id, 'set_employee_permission_override',
    jsonb_build_object('permission_code', p_permission_code, 'override', v_current),
    jsonb_build_object('permission_code', p_permission_code, 'override', v_override),
    null, null
  );
  return coalesce(v_override, 'null'::jsonb);
end;
$$;

revoke all on function public.employee_permission_overrides_v1(uuid, uuid),
  public.admin_set_employee_permission_override_v1(uuid, uuid, uuid, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.employee_permission_overrides_v1(uuid, uuid),
  public.admin_set_employee_permission_override_v1(uuid, uuid, uuid, text, jsonb, jsonb)
  to service_role;

-- Compute the base and final record scope once so UI readback and return
-- authorization agree. A personal result replaces the scope for that action.
create function private.shipping_employee_permission_scopes_v1(p_org_id uuid, p_actor_id uuid)
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
      and private.org_super_admin_active_member_v1(p_actor_id, p_org_id)
      and (
        select count(*) from public.user_organizations as membership
        where membership.user_id = p_actor_id and membership.is_default
      ) = 1
  ),
  catalog as (
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
  ),
  role_assignments as (
    select binding.scope_type, binding.scope_id, definition.code,
      coalesce(metadata.name, definition.name) as role_name, member_org.settings,
      definition.permissions as template,
      member_org.settings->'role_permission_overrides' as overrides,
      member_org.settings->'role_permission_overrides'->definition.id::text as override
    from member_org
    join public.user_roles as binding on binding.org_id = p_org_id and binding.user_id = p_actor_id
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
          and definition.code not in ('SUPER_ADMIN','SHIPPING_OPERATOR'))
      )
  ),
  role_grants as (
    select scope_type, scope_id, code, role_name,
      case
        when code = 'SUPER_ADMIN' then '["*"]'::jsonb
        when settings is not null and jsonb_typeof(settings) not in ('object','null')
          then '[]'::jsonb
        when overrides is not null and jsonb_typeof(overrides) <> 'object'
          then '[]'::jsonb
        when override is not null then
          case when jsonb_typeof(override) = 'array' then
            case when not exists (
              select 1 from jsonb_array_elements(override) as permission(value)
              where jsonb_typeof(permission.value) <> 'string' or permission.value = '""'::jsonb
            ) then override else '[]'::jsonb end
          else '[]'::jsonb end
        when jsonb_typeof(template) = 'array' then template
        else '[]'::jsonb
      end as permissions
    from role_assignments
  ),
  active_tree as (
    select department.id, department.parent_id, department.leader_id, department.name
    from member_org
    join public.departments as department on department.org_id = p_org_id and department.status = 'active'
  ),
  role_action_sources as (
    select 'return'::text as action, grant_row.scope_type, grant_row.scope_id, grant_row.role_name
    from role_grants as grant_row
    where exists (select 1 from catalog where code = 'shipping:record_return')
      and (grant_row.permissions ? 'shipping:record_return'
        or (grant_row.scope_type = 'org' and grant_row.code = 'SUPER_ADMIN'))
      and (grant_row.scope_type = 'org' or exists (
        select 1 from active_tree where id = grant_row.scope_id
      ))
    union all
    select 'view', grant_row.scope_type, grant_row.scope_id, grant_row.role_name
    from role_grants as grant_row
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
  personal as (
    select employee.permission_code, employee.effect, employee.scope, catalog.supported_scope_types
    from member_org
    cross join public.employee_permission_overrides_v1(p_org_id, p_actor_id) as employee
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

create function public.shipping_employee_permission_scopes_v1(p_org_id uuid, p_user_id uuid)
returns table (
  permission_code text, base_organization_wide boolean, base_department_ids uuid[],
  organization_wide boolean, department_ids uuid[], base_sources jsonb
)
language sql stable security definer set search_path = ''
as $$
  select * from private.shipping_employee_permission_scopes_v1(p_org_id, p_user_id);
$$;

-- Preserve the existing signature used by the transactional return command.
-- An unassigned department never turns a scoped result into organization scope.
create or replace function private.shipping_return_scope_v1(p_actor_id uuid, p_org_id uuid)
returns table (organization_wide boolean, department_ids uuid[])
language sql stable set search_path = ''
as $$
  with scopes as materialized (
    select * from private.shipping_employee_permission_scopes_v1(p_org_id, p_actor_id)
  )
  select ledger.organization_wide and return_action.organization_wide,
    case
      when ledger.organization_wide and return_action.organization_wide then array(
        select department.id from public.departments as department
        where department.org_id = p_org_id and department.status = 'active'
        order by department.id
      )
      when ledger.organization_wide then return_action.department_ids
      when return_action.organization_wide then ledger.department_ids
      else array(
        select id from unnest(ledger.department_ids) as allowed_view(id)
        intersect
        select id from unnest(return_action.department_ids) as allowed_return(id)
        order by 1
      )
    end
  from scopes as ledger cross join scopes as return_action
  where ledger.permission_code = 'shipping:ledger_view'
    and return_action.permission_code = 'shipping:record_return';
$$;

revoke all on function private.shipping_employee_permission_scopes_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.shipping_employee_permission_scopes_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.shipping_employee_permission_scopes_v1(uuid, uuid) to service_role;

commit;

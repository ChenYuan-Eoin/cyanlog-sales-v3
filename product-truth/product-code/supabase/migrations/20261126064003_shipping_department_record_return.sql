-- The internal return action is assigned to a named role and uses the ledger's data boundary.
begin;

with inserted as (
  insert into public.permission_points (
    code, name, description, resource, action, kind, status, category,
    semantic_version, lifecycle_version, supported_scope_types, dependencies,
    conflicts, implied_by, enforcement_consumer, published_at
  )
  values (
    'shipping:record_return', '退回寄件工单', '退回同一授权范围内待确认的寄件工单。',
    'shipping', 'record_return', 'atomic', 'published', 'shipping',
    '1.0.0', 1, array['org', 'department'], array['shipping:ledger_view'],
    array[]::text[], array[]::text[], 'lib/shipping/http.ts', now()
  )
  returning *
)
insert into public.permission_point_versions (
  permission_point_id, semantic_version, lifecycle_version, snapshot, status, published_at
)
select
  id, semantic_version, lifecycle_version,
  jsonb_build_object(
    'key', code, 'label', name, 'description', description, 'resource', resource,
    'action', action, 'kind', kind, 'category', category, 'semanticVersion', semantic_version,
    'scopeTypes', supported_scope_types, 'dependencies', dependencies,
    'conflicts', conflicts, 'enforcementConsumer', enforcement_consumer
  ),
  status, published_at
from inserted;

create function private.shipping_return_scope_v1(p_actor_id uuid, p_org_id uuid)
returns table (organization_wide boolean, department_ids uuid[])
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
    select binding.scope_type, binding.scope_id, definition.code, member_org.settings,
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
    select scope_type, scope_id, code,
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
  org_grants as (
    select
      exists (select 1 from catalog where code = 'shipping:record_return') and exists (
        select 1 from role_grants where scope_type = 'org'
          and (code = 'SUPER_ADMIN' or permissions ? 'shipping:record_return')
      ) as can_return,
      (exists (select 1 from catalog where code = 'shipping:ledger_view') and exists (
        select 1 from role_grants where scope_type = 'org'
          and permissions ?| array['shipping:ledger_view','shipping:*','*']
      )) or (
        (exists (select 1 from catalog where code = 'shipping:ledger_view') or not exists (
          select 1 from public.permission_points where code = 'shipping:ledger_view'
        )) and exists (select 1 from catalog where code = 'shipping:operate') and exists (
          select 1 from role_grants where scope_type = 'org'
            and permissions ?| array['shipping:operate','shipping:*','*']
        )
      ) as can_view
  ),
  active_tree as (
    select department.id, department.parent_id, department.leader_id
    from member_org
    join public.departments as department on department.org_id = p_org_id and department.status = 'active'
  ),
  direct_ledger_roots as (
    select department.id, (grant_value.value->'include_subdepartments') = 'true'::jsonb as with_children
    from member_org
    cross join active_tree as department
    cross join lateral (
      select member_org.settings->'department_permission_grants'->department.id::text as value
    ) as grant_value
    where grant_value.value->'permissions' = '["shipping:ledger_view"]'::jsonb
      and jsonb_typeof(grant_value.value->'include_subdepartments') = 'boolean'
      and (
        exists (select 1 from public.user_departments as membership
          where membership.org_id = p_org_id and membership.user_id = p_actor_id
            and membership.department_id = department.id)
        or (department.leader_id = p_actor_id and exists (select 1 from public.department_lead_access as lead
          where lead.org_id = p_org_id and lead.user_id = p_actor_id and lead.department_id = department.id))
      )
  ),
  scope_roots as (
    select 'return'::text as action, department.id, false as with_children
    from active_tree as department cross join org_grants where org_grants.can_return
    union
    select 'return', department.id, true
    from active_tree as department join role_grants on scope_type = 'department' and scope_id = department.id
    where role_grants.permissions ? 'shipping:record_return'
      and exists (select 1 from catalog where code = 'shipping:record_return')
    union
    select 'view', department.id, false
    from active_tree as department cross join org_grants where org_grants.can_view
    union
    select 'view', roots.id, roots.with_children
    from (
      select id, with_children from direct_ledger_roots
      union
      select department.id, true
      from active_tree as department join role_grants on scope_type = 'department' and scope_id = department.id
      where role_grants.permissions ? 'shipping:ledger_view'
    ) as roots
    where exists (
      select 1 from catalog where code = 'shipping:ledger_view' and 'department' = any(supported_scope_types)
    )
  ),
  department_scope(action, id, with_children) as (
    select action, id, with_children from scope_roots
    union
    select scope.action, child.id, true
    from department_scope as scope
    join active_tree as child on child.parent_id = scope.id
    where scope.with_children
  )
  select org_grants.can_return and org_grants.can_view,
    array(
      select scope.id from department_scope as scope where scope.action = 'return'
      intersect
      select scope.id from department_scope as scope where scope.action = 'view'
      order by 1
    )
  from org_grants;
$$;

create function public.shipping_department_return_scope_v1(p_actor_id uuid, p_org_id uuid)
returns uuid[] language sql stable security definer set search_path = ''
as $$
  select department_ids from private.shipping_return_scope_v1(p_actor_id, p_org_id);
$$;

create function public.shipping_return_department_record_v1(
  p_actor_id uuid, p_org_id uuid, p_order_id uuid, p_reason text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_organization_wide boolean;
  v_department_ids uuid[];
  v_reason text := btrim(p_reason);
  v_order public.shipping_orders%rowtype;
begin
  if p_actor_id is null or p_org_id is null or p_order_id is null
    or v_reason is null or char_length(v_reason) not between 2 and 300 then
    raise exception 'invalid shipment return input' using errcode = '22023';
  end if;

  -- Role, membership and authorization changes serialize on this same organization key.
  perform private.personnel_lock_org_v1(p_org_id);
  perform 1 from public.organizations where id = p_org_id for share;
  perform 1 from public.user_organizations as membership
    join public.users as person on person.id = membership.user_id
    where membership.user_id = p_actor_id and membership.is_default
    for share of membership, person;

  -- Directory reparent/status changes can also use direct row writes. Hold the existing
  -- organization's tree stable while reevaluating permissions and changing the order.
  perform 1 from public.departments where org_id = p_org_id order by id for share;
  perform 1 from public.permission_points
    where code in ('shipping:record_return','shipping:ledger_view','shipping:operate')
    order by code for share;

  select organization_wide, department_ids into v_organization_wide, v_department_ids
  from private.shipping_return_scope_v1(p_actor_id, p_org_id);

  if not v_organization_wide and cardinality(v_department_ids) = 0 then
    raise exception 'shipment return permission required' using errcode = '42501';
  end if;

  select orders.* into v_order
  from public.shipping_orders as orders
  where orders.id = p_order_id and orders.org_id = p_org_id
    and (v_organization_wide or orders.attributed_department_id = any(v_department_ids))
  for update;
  if not found then
    raise exception 'shipment record not found' using errcode = 'P0002';
  end if;
  if v_order.status is distinct from 'awaiting_confirmation' then
    raise exception 'shipment is no longer awaiting confirmation' using errcode = '23514';
  end if;

  update public.shipping_orders as orders
    set status = 'returned', returned_reason = v_reason, confirmed_by = p_actor_id, updated_at = now()
    where orders.id = v_order.id and orders.org_id = p_org_id
    returning orders.* into v_order;

  return jsonb_build_object(
    'id', v_order.id, 'order_no', v_order.order_no, 'status', v_order.status, 'returned_reason', v_order.returned_reason
  );
end;
$$;

revoke all on function private.shipping_return_scope_v1(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.shipping_department_return_scope_v1(uuid, uuid),
  public.shipping_return_department_record_v1(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.shipping_department_return_scope_v1(uuid, uuid),
  public.shipping_return_department_record_v1(uuid, uuid, uuid, text) to service_role;

commit;

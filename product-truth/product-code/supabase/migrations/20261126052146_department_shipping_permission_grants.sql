-- Publish read-only ledger access for the department subject, keeping org grants valid.
begin;

with definitions as (
  update public.permission_points
  set description = '查看授权范围内的寄件工单和系统已保存的物流。',
      supported_scope_types = array['org', 'department']::text[],
      semantic_version = '1.1.0', lifecycle_version = 2, published_at = now(), updated_at = now()
  where code = 'shipping:ledger_view' and action = 'ledger_view' and kind = 'atomic'
    and resource = 'shipping' and category = 'shipping' and status = 'published'
    and semantic_version = '1.0.0' and lifecycle_version = 1
    and supported_scope_types = array['org']::text[]
    and dependencies = array[]::text[] and conflicts = array[]::text[] and implied_by = array[]::text[]
    and enforcement_consumer = 'lib/shipping/http.ts'
  returning *
)
insert into public.permission_point_versions (
  permission_point_id, semantic_version, lifecycle_version, snapshot, status, published_at
)
select id, semantic_version, lifecycle_version,
  jsonb_build_object(
    'key', code, 'label', name, 'description', description,
    'resource', resource, 'action', action, 'kind', kind, 'category', category,
    'semanticVersion', semantic_version, 'scopeTypes', supported_scope_types,
    'dependencies', dependencies, 'conflicts', conflicts, 'enforcementConsumer', enforcement_consumer
  ), status, published_at
from definitions;

create function private.department_permission_state_v1(p_settings jsonb, p_department_id uuid)
returns jsonb language plpgsql immutable set search_path = ''
as $$
declare
  v_grants jsonb := p_settings->'department_permission_grants';
  v_state jsonb := v_grants->p_department_id::text;
  v_empty constant jsonb := '{"permissions":[],"include_subdepartments":false}';
begin
  if (p_settings is not null and p_settings <> 'null'::jsonb and jsonb_typeof(p_settings) <> 'object')
    or (v_grants is not null and jsonb_typeof(v_grants) <> 'object') then
    raise exception 'invalid department permissions storage' using errcode = '22000';
  end if;
  if v_state is null then return v_empty; end if;
  if v_state = v_empty or v_state in (
    '{"permissions":["shipping:ledger_view"],"include_subdepartments":false}'::jsonb,
    '{"permissions":["shipping:ledger_view"],"include_subdepartments":true}'::jsonb
  ) then
    return v_state;
  end if;
  raise exception 'invalid department permission state' using errcode = '22000';
end;
$$;

create function public.admin_get_department_permissions_v1(p_actor_id uuid, p_org_id uuid, p_department_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_settings jsonb;
begin
  if not private.personnel_is_org_control_admin_v1(p_actor_id, p_org_id) then
    raise exception 'department permission administration denied' using errcode = '42501';
  end if;
  select organization.settings into v_settings
  from public.organizations as organization
  join public.departments as department on department.org_id = organization.id
  where organization.id = p_org_id and department.id = p_department_id and department.status = 'active';
  if not found then raise exception 'active department not found' using errcode = 'P0002'; end if;
  return private.department_permission_state_v1(v_settings, p_department_id);
end;
$$;

create function public.admin_set_department_permissions_v1(
  p_actor_id uuid, p_org_id uuid, p_department_id uuid, p_expected_org_id uuid,
  p_expected_permissions text[], p_expected_include_subdepartments boolean,
  p_permissions text[], p_include_subdepartments boolean
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_settings jsonb;
  v_grants jsonb;
  v_current jsonb;
  v_next jsonb;
begin
  if p_org_id is null or p_actor_id is null or p_department_id is null
    or p_expected_include_subdepartments is null or p_include_subdepartments is null
    or p_expected_permissions is null or p_permissions is null
    or p_expected_permissions not in (array[]::text[], array['shipping:ledger_view']::text[])
    or p_permissions not in (array[]::text[], array['shipping:ledger_view']::text[])
    or (cardinality(p_expected_permissions) = 0 and p_expected_include_subdepartments)
    or (cardinality(p_permissions) = 0 and p_include_subdepartments) then
    raise exception 'invalid department permission request' using errcode = '22023';
  end if;
  if p_expected_org_id is distinct from p_org_id then
    raise exception 'current organization changed' using errcode = '40001';
  end if;

  perform private.personnel_lock_org_v1(p_org_id);
  select settings into v_settings from public.organizations where id = p_org_id for no key update;
  if not private.personnel_is_org_control_admin_v1(p_actor_id, p_org_id) then
    raise exception 'department permission administration denied' using errcode = '42501';
  end if;
  perform 1 from public.departments
  where id = p_department_id and org_id = p_org_id and status = 'active'
  for share;
  if not found then raise exception 'active department not found' using errcode = 'P0002'; end if;

  v_current := private.department_permission_state_v1(v_settings, p_department_id);
  if v_current is distinct from jsonb_build_object(
    'permissions', p_expected_permissions, 'include_subdepartments', p_expected_include_subdepartments
  ) then
    raise exception 'department permissions changed' using errcode = '40001';
  end if;
  if cardinality(p_permissions) > 0 then
    perform 1 from public.permission_points
    where code = 'shipping:ledger_view' and action = 'ledger_view' and kind = 'atomic'
      and resource = 'shipping' and category = 'shipping' and status = 'published'
      and cardinality(supported_scope_types) = 2
      and supported_scope_types @> array['org', 'department']::text[]
      and dependencies = array[]::text[]
      and enforcement_consumer = 'lib/shipping/http.ts'
    for share;
    if not found then raise exception 'department permission is not published' using errcode = '23514'; end if;
  end if;

  v_next := jsonb_build_object('permissions', p_permissions, 'include_subdepartments', p_include_subdepartments);
  if v_current = v_next then return v_current; end if;

  v_grants := coalesce(v_settings->'department_permission_grants', '{}'::jsonb);
  if cardinality(p_permissions) > 0 then
    v_grants := jsonb_set(v_grants, array[p_department_id::text], v_next);
  else
    v_grants := v_grants - p_department_id::text;
  end if;
  update public.organizations
  set settings = jsonb_set(coalesce(nullif(v_settings, 'null'::jsonb), '{}'::jsonb),
    array['department_permission_grants'], v_grants)
  where id = p_org_id;
  return v_next;
end;
$$;

revoke all on function private.department_permission_state_v1(jsonb, uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_get_department_permissions_v1(uuid, uuid, uuid),
  public.admin_set_department_permissions_v1(uuid, uuid, uuid, uuid, text[], boolean, text[], boolean)
  from public, anon, authenticated;
grant execute on function public.admin_get_department_permissions_v1(uuid, uuid, uuid),
  public.admin_set_department_permissions_v1(uuid, uuid, uuid, uuid, text[], boolean, text[], boolean)
  to service_role;

commit;

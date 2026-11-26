-- Extend sparse employee overrides to published organization administration actions.
begin;

create function public.admin_set_employee_org_permission_override_v1(
  p_actor_id uuid, p_org_id uuid, p_user_id uuid, p_permission_code text,
  p_expected_override jsonb, p_override jsonb
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_consumer text;
  v_capability_level text;
  v_dependencies text[];
  v_expected jsonb;
  v_override jsonb;
  v_current jsonb;
begin
  select editable.consumer, editable.capability_level, editable.dependencies
    into v_consumer, v_capability_level, v_dependencies
  from (values
    ('user:view', 'lib/permissions.ts#canAccessOrgAdmin', 'L3', array[]::text[]),
    ('user:edit_profile', 'lib/admin/member-actions.ts', 'L3', array['user:view']),
    ('user:invite', 'lib/admin/member-actions.ts', 'L3', array['user:view']),
    ('user:manage_login', 'lib/admin/member-actions.ts', 'L3', array['user:view']),
    ('user:manage_employment', 'lib/admin/member-actions.ts', 'L3', array['user:view']),
    ('user:remove_membership', 'lib/admin/member-actions.ts', 'L3', array['user:view']),
    ('dept:directory_view', 'lib/admin/department-actions.ts', 'L3', array[]::text[]),
    ('dept:edit_structure', 'lib/admin/department-actions.ts', 'L4', array['dept:directory_view']),
    ('dept:delete_structure', 'lib/admin/department-actions.ts', 'L4', array['dept:directory_view']),
    ('role:view', 'lib/permissions.ts#canReadRoleDirectory', 'L4', array['user:view'])
  ) as editable(code, consumer, capability_level, dependencies)
  where editable.code = p_permission_code;
  if not found or p_actor_id is null or p_org_id is null or p_user_id is null then
    raise exception 'invalid organization employee permission override'
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

  v_expected := private.normalize_employee_permission_override_v1(array['org'], p_expected_override);
  v_override := private.normalize_employee_permission_override_v1(array['org'], p_override);

  select jsonb_build_object('effect', exception.effect, 'scope', exception.scope) into v_current
  from private.employee_permission_overrides as exception
  where exception.org_id = p_org_id and exception.user_id = p_user_id and exception.permission_code = p_permission_code;
  if v_current is distinct from v_expected then
    raise exception 'employee permission override has changed'
      using errcode = '40001', detail = 'EMPLOYEE_PERMISSION_OVERRIDE_CONFLICT';
  end if;

  -- The older member directory definition advertised additional scope types.
  -- Its personal override supports only org scope, like the current consumers.
  -- A removed publication can still have its existing override cleared.
  if v_override is not null then
    perform 1 from public.permission_points as point
    where point.code = p_permission_code and point.status = 'published' and point.kind = 'atomic'
      and point.category = 'org' and point.module_key = 'config'
      and 'role' = any(point.grant_subject_types)
      and point.capability_level = v_capability_level
      and point.resource = split_part(p_permission_code, ':', 1)
      and point.action = split_part(p_permission_code, ':', 2)
      and point.enforcement_consumer = v_consumer and point.dependencies = v_dependencies
      and (point.supported_scope_types = array['org']
        or (p_permission_code = 'user:view' and cardinality(point.supported_scope_types) = 4
          and point.supported_scope_types @> array['org','department','space','self']))
    for share;
    if not found then
      raise exception 'organization employee permission action is not published'
        using errcode = '23514', detail = 'EMPLOYEE_PERMISSION_OVERRIDE_NOT_PUBLISHED';
    end if;

    update public.organizations
      set settings = coalesce(nullif(settings, 'null'::jsonb), '{}'::jsonb)
        || '{"employee_organization_permission_overrides_enabled":true}'::jsonb
      where id = p_org_id
        and (settings is null or jsonb_typeof(settings) in ('object','null'))
        and settings->'employee_organization_permission_overrides_enabled' is distinct from 'true'::jsonb;
    if not exists (
      select 1 from public.organizations
      where id = p_org_id and settings->'employee_organization_permission_overrides_enabled' = 'true'::jsonb
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
    values (p_org_id, p_user_id, p_permission_code, v_override->>'effect', nullif(v_override->'scope', 'null'::jsonb), p_actor_id)
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

revoke all on function public.admin_set_employee_org_permission_override_v1(uuid, uuid, uuid, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_set_employee_org_permission_override_v1(uuid, uuid, uuid, text, jsonb, jsonb)
  to service_role;

commit;

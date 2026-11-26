-- Store only explicitly edited employee differences, including verified prelogin intent.
begin;

alter table private.employee_permission_overrides
  add column pending_target_revision text;

create function private.employee_prelogin_target_revision_v1(
  p_org_id uuid, p_user_id uuid, p_source_id uuid, p_identity_id uuid, p_external_user_id text
)
returns text language sql immutable strict set search_path = ''
as $$
  select encode(sha256(convert_to(jsonb_build_array(
    p_org_id, p_user_id, p_source_id, p_identity_id, p_external_user_id
  )::text, 'UTF8')), 'hex');
$$;

create function private.employee_prelogin_target_v1(p_org_id uuid, p_user_id uuid)
returns table (source_id uuid, identity_id uuid, external_user_id text, target_revision text)
language sql stable set search_path = ''
as $$
  select target.source_id, target.identity_id, target.external_user_id,
    private.employee_prelogin_target_revision_v1(
      p_org_id, target.user_id, target.source_id, target.identity_id, target.external_user_id
    )
  from public.fxiaoke_prelogin_role_targets_v1(p_org_id, p_user_id) as target
  join public.user_organizations as membership
    on membership.org_id = p_org_id and membership.user_id = target.user_id and membership.left_at is null
  where p_user_id is not null;
$$;

create function private.employee_prelogin_role_ids_v1(p_org_id uuid, p_user_id uuid)
returns setof uuid language sql stable set search_path = ''
as $$
  select pending.role_id
  from private.employee_prelogin_target_v1(p_org_id, p_user_id) as target
  join public.fxiaoke_pending_org_roles as pending
    on pending.org_id = p_org_id and pending.user_id = p_user_id
      and pending.source_id = target.source_id and pending.external_identity_id = target.identity_id
      and pending.external_user_id = target.external_user_id
  join public.admin_list_org_roles_v1(p_org_id) as role on role.id = pending.role_id
  where role.code not in ('ORG_SUPER_ADMIN', 'FXIAOKE_BASELINE')
  order by pending.role_id;
$$;

create function private.assert_employee_override_target_v1(p_org_id uuid, p_user_id uuid, p_target_revision text)
returns void language plpgsql set search_path = ''
as $$
declare
  v_target record;
begin
  if p_target_revision is null then
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
  else
    -- The caller holds the organization lock, also used by first login and role writes.
    select * into v_target from private.employee_prelogin_target_v1(p_org_id, p_user_id);

    if not found or v_target.target_revision is distinct from p_target_revision then
      raise exception 'employee permission target has changed'
        using errcode = '40001', detail = 'EMPLOYEE_PERMISSION_OVERRIDE_CONFLICT';
    end if;

    perform 1 from public.organization_sources as source
    where source.id = v_target.source_id for share;
    perform 1 from public.external_identities as identity
    where identity.id = v_target.identity_id for share;
    perform 1 from public.users as person where person.id = p_user_id for share;
    perform 1 from public.user_organizations as membership
    where membership.org_id = p_org_id and membership.user_id = p_user_id for share;

    if not exists (
      select 1 from private.employee_prelogin_target_v1(p_org_id, p_user_id) as target
      where target.target_revision = p_target_revision
    ) then
      raise exception 'employee permission target has changed'
        using errcode = '40001', detail = 'EMPLOYEE_PERMISSION_OVERRIDE_CONFLICT';
    end if;
  end if;

  if private.has_exact_org_role_v1(p_user_id, p_org_id, 'SUPER_ADMIN')
    or (p_target_revision is not null and exists (
      select 1 from private.employee_prelogin_role_ids_v1(p_org_id, p_user_id) as pending(role_id)
      join public.roles as role on role.id = pending.role_id and role.code = 'SUPER_ADMIN'
    )) then
    raise exception 'cannot change the protected system administrator'
      using errcode = '42501', detail = 'EMPLOYEE_PERMISSION_OVERRIDE_PROTECTED';
  end if;
end;
$$;

revoke all on function private.employee_prelogin_target_revision_v1(uuid, uuid, uuid, uuid, text),
  private.employee_prelogin_target_v1(uuid, uuid), private.employee_prelogin_role_ids_v1(uuid, uuid),
  private.assert_employee_override_target_v1(uuid, uuid, text)
  from public, anon, authenticated, service_role;

create or replace function public.employee_permission_overrides_v1(p_org_id uuid, p_user_id uuid)
returns table (permission_code text, effect text, scope jsonb)
language sql stable security definer set search_path = ''
as $$
  select exception.permission_code, exception.effect, exception.scope
  from private.employee_permission_overrides as exception
  join public.organizations as organization on organization.id = exception.org_id
  where exception.org_id = p_org_id and exception.user_id = p_user_id
    and exception.pending_target_revision is null
    and organization.status = 'active'
    and private.org_super_admin_active_member_v1(p_user_id, p_org_id)
    and not private.has_exact_org_role_v1(p_user_id, p_org_id, 'SUPER_ADMIN')
  order by exception.permission_code;
$$;

create function private.admin_set_employee_permission_override_v1(
  p_actor_id uuid, p_org_id uuid, p_user_id uuid, p_permission_code text,
  p_expected_override jsonb, p_override jsonb, p_target_revision text
)
returns jsonb
language plpgsql set search_path = ''
as $$
declare
  v_expected jsonb;
  v_override jsonb;
  v_current jsonb;
  v_scope jsonb;
  v_allowed_scope_types text[];
  v_expected_dependencies text[];
  v_published_scope_types text[];
  v_department_count bigint;
begin
  select editable.scope_types, editable.dependencies into v_allowed_scope_types, v_expected_dependencies
  from (values
    ('shipping:ledger_view', array['org','department'], array[]::text[]),
    ('shipping:record_return', array['org','department'], array['shipping:ledger_view']),
    ('shipping:record_create', array['org'], array['shipping:ledger_view']),
    ('shipping:record_review', array['org'], array['shipping:ledger_view']),
    ('shipping:order_confirm', array['org'], array['shipping:ledger_view']),
    ('shipping:order_reconcile', array['org'], array['shipping:ledger_view']),
    ('shipping:tracking_refresh', array['org'], array['shipping:ledger_view']),
    ('shipping:order_cancel', array['org'], array['shipping:ledger_view']),
    ('shipping:order_change', array['org'], array['shipping:ledger_view']),
    ('shipping:owner_view', array['self'], array[]::text[]),
    ('shipping:owner_submit', array['self'], array['shipping:owner_view']),
    ('shipping:owner_address_write', array['self'], array['shipping:owner_view']),
    ('shipping:owner_resubmit', array['self'], array['shipping:owner_view']),
    ('shipping:owner_tracking_refresh', array['self'], array['shipping:owner_view']),
    ('shipping:owner_cancel', array['self'], array['shipping:owner_view']),
    ('shipping:owner_change', array['self'], array['shipping:owner_view']),
    ('shipping:settings_view', array['org'], array[]::text[]),
    ('shipping:connection_write', array['org'], array['shipping:settings_view']),
    ('shipping:billing_write', array['org'], array['shipping:settings_view']),
    ('shipping:intake_write', array['org'], array['shipping:settings_view']),
    ('shipping:intercept_enable', array['org'], array['shipping:settings_view'])
  ) as editable(code, scope_types, dependencies)
  where editable.code = p_permission_code;
  if not found or p_actor_id is null or p_org_id is null or p_user_id is null then
    raise exception 'invalid employee permission override'
      using errcode = '22023', detail = 'EMPLOYEE_PERMISSION_OVERRIDE_INVALID';
  end if;

  perform private.assert_system_role_assignment_actor_v1(p_actor_id, p_org_id);

  perform private.assert_employee_override_target_v1(p_org_id, p_user_id, p_target_revision);

  v_expected := private.normalize_employee_permission_override_v1(v_allowed_scope_types, p_expected_override);
  v_override := private.normalize_employee_permission_override_v1(v_allowed_scope_types, p_override);
  v_scope := nullif(v_override->'scope', 'null'::jsonb);

  select jsonb_build_object('effect', exception.effect, 'scope', exception.scope) into v_current
  from private.employee_permission_overrides as exception
  where exception.org_id = p_org_id and exception.user_id = p_user_id and exception.permission_code = p_permission_code
    and exception.pending_target_revision is not distinct from p_target_revision;
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
      and point.dependencies = v_expected_dependencies
      and ((cardinality(point.supported_scope_types) = cardinality(v_allowed_scope_types)
          and point.supported_scope_types @> v_allowed_scope_types)
        or (p_permission_code = 'shipping:ledger_view' and point.supported_scope_types = array['org']))
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
      where org_id = p_org_id and user_id = p_user_id and permission_code = p_permission_code
        and pending_target_revision is not distinct from p_target_revision;
  else
    insert into private.employee_permission_overrides
      (org_id, user_id, permission_code, effect, scope, updated_by, pending_target_revision)
    values (p_org_id, p_user_id, p_permission_code, v_override->>'effect', v_scope, p_actor_id, p_target_revision)
    on conflict (org_id, user_id, permission_code) do update
      set effect = excluded.effect, scope = excluded.scope, updated_by = excluded.updated_by,
        pending_target_revision = excluded.pending_target_revision, updated_at = now();
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

create function private.admin_set_employee_org_permission_override_v1(
  p_actor_id uuid, p_org_id uuid, p_user_id uuid, p_permission_code text,
  p_expected_override jsonb, p_override jsonb, p_target_revision text
)
returns jsonb
language plpgsql set search_path = ''
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

  perform private.assert_employee_override_target_v1(p_org_id, p_user_id, p_target_revision);

  v_expected := private.normalize_employee_permission_override_v1(array['org'], p_expected_override);
  v_override := private.normalize_employee_permission_override_v1(array['org'], p_override);

  select jsonb_build_object('effect', exception.effect, 'scope', exception.scope) into v_current
  from private.employee_permission_overrides as exception
  where exception.org_id = p_org_id and exception.user_id = p_user_id and exception.permission_code = p_permission_code
    and exception.pending_target_revision is not distinct from p_target_revision;
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
      where org_id = p_org_id and user_id = p_user_id and permission_code = p_permission_code
        and pending_target_revision is not distinct from p_target_revision;
  else
    insert into private.employee_permission_overrides
      (org_id, user_id, permission_code, effect, scope, updated_by, pending_target_revision)
    values (p_org_id, p_user_id, p_permission_code, v_override->>'effect', nullif(v_override->'scope', 'null'::jsonb), p_actor_id, p_target_revision)
    on conflict (org_id, user_id, permission_code) do update
      set effect = excluded.effect, scope = excluded.scope, updated_by = excluded.updated_by,
        pending_target_revision = excluded.pending_target_revision, updated_at = now();
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

create or replace function public.admin_set_employee_permission_override_v1(
  p_actor_id uuid, p_org_id uuid, p_user_id uuid, p_permission_code text,
  p_expected_override jsonb, p_override jsonb
)
returns jsonb language sql security definer set search_path = ''
as $$
  select private.admin_set_employee_permission_override_v1(
    p_actor_id, p_org_id, p_user_id, p_permission_code, p_expected_override, p_override, null
  );
$$;

create or replace function public.admin_set_employee_org_permission_override_v1(
  p_actor_id uuid, p_org_id uuid, p_user_id uuid, p_permission_code text,
  p_expected_override jsonb, p_override jsonb
)
returns jsonb language sql security definer set search_path = ''
as $$
  select private.admin_set_employee_org_permission_override_v1(
    p_actor_id, p_org_id, p_user_id, p_permission_code, p_expected_override, p_override, null
  );
$$;

revoke all on function private.admin_set_employee_permission_override_v1(uuid, uuid, uuid, text, jsonb, jsonb, text),
  private.admin_set_employee_org_permission_override_v1(uuid, uuid, uuid, text, jsonb, jsonb, text)
  from public, anon, authenticated, service_role;

create function public.admin_set_employee_prelogin_permission_override_v1(
  p_actor_id uuid, p_org_id uuid, p_user_id uuid, p_permission_code text,
  p_expected_override jsonb, p_override jsonb, p_target_revision text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if p_target_revision is null or p_target_revision !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid employee permission target revision'
      using errcode = '22023', detail = 'EMPLOYEE_PERMISSION_OVERRIDE_INVALID';
  end if;
  if split_part(p_permission_code, ':', 1) = 'shipping' then
    return private.admin_set_employee_permission_override_v1(
      p_actor_id, p_org_id, p_user_id, p_permission_code, p_expected_override, p_override, p_target_revision
    );
  end if;
  return private.admin_set_employee_org_permission_override_v1(
    p_actor_id, p_org_id, p_user_id, p_permission_code, p_expected_override, p_override, p_target_revision
  );
end;
$$;

create function private.shipping_employee_permission_scope_projection_v1(
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
      coalesce(metadata.name, definition.name) as role_name, member_org.settings,
      definition.permissions as template,
      member_org.settings->'role_permission_overrides' as overrides,
      member_org.settings->'role_permission_overrides'->definition.id::text as override
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

-- Business authorization evaluates only the effective active account.
create or replace function private.shipping_employee_permission_scopes_v1(p_org_id uuid, p_actor_id uuid)
returns table (
  permission_code text, base_organization_wide boolean, base_department_ids uuid[],
  organization_wide boolean, department_ids uuid[], base_sources jsonb
)
language sql stable set search_path = ''
as $$
  select * from private.shipping_employee_permission_scope_projection_v1(p_org_id, p_actor_id, null);
$$;

revoke all on function private.shipping_employee_permission_scope_projection_v1(uuid, uuid, text)
  from public, anon, authenticated, service_role;

create function public.admin_employee_prelogin_permission_projection_v1(
  p_actor_id uuid, p_org_id uuid, p_user_id uuid
)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_target_revision text;
begin
  if not private.personnel_is_org_control_admin_v1(p_actor_id, p_org_id) then
    raise exception 'only the current system administrator can view pending employee permissions'
      using errcode = '42501';
  end if;

  select target.target_revision into v_target_revision
  from private.employee_prelogin_target_v1(p_org_id, p_user_id) as target;
  if not found then return null; end if;

  return jsonb_build_object(
    'target_revision', v_target_revision,
    'pending_role_ids', array(select * from private.employee_prelogin_role_ids_v1(p_org_id, p_user_id)),
    'overrides', coalesce((
      select jsonb_agg(jsonb_build_object(
        'permission_code', exception.permission_code, 'effect', exception.effect, 'scope', exception.scope
      ) order by exception.permission_code)
      from private.employee_permission_overrides as exception
      where exception.org_id = p_org_id and exception.user_id = p_user_id
        and exception.pending_target_revision = v_target_revision
    ), '[]'::jsonb),
    'shipping_scopes', coalesce((
      select jsonb_agg(to_jsonb(scope) order by scope.permission_code)
      from private.shipping_employee_permission_scope_projection_v1(p_org_id, p_user_id, v_target_revision) as scope
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_employee_prelogin_permission_projection_v1(uuid, uuid, uuid),
  public.admin_set_employee_prelogin_permission_override_v1(uuid, uuid, uuid, text, jsonb, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.admin_employee_prelogin_permission_projection_v1(uuid, uuid, uuid),
  public.admin_set_employee_prelogin_permission_override_v1(uuid, uuid, uuid, text, jsonb, jsonb, text)
  to service_role;

create or replace function public.activate_fxiaoke_sso_member_v1(
  p_org_id uuid,
  p_external_user_id text,
  p_expected_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.organization_sources%rowtype;
  v_identity public.external_identities%rowtype;
  v_person public.users%rowtype;
  v_membership public.user_organizations%rowtype;
  v_source_count integer;
  v_applied uuid[];
  v_override_target_revision text;
begin
  perform private.personnel_lock_org_v1(p_org_id);
  select count(*) into v_source_count from public.organization_sources
   where system_org_id = p_org_id and provider = 'fxiaoke';
  if v_source_count <> 1 then return null; end if;

  select * into v_source from public.organization_sources
   where system_org_id = p_org_id and provider = 'fxiaoke' for update;
  if v_source.status <> 'active' or v_source.connection_state <> 'verified'
    or v_source.effective_revision is null
    or v_source.authority_scope->>'identity' <> 'authoritative'
    or v_source.authority_scope->>'directory' <> 'authoritative'
  then return null; end if;

  select * into v_identity from public.external_identities
   where source_id = v_source.id and system_org_id = p_org_id
     and external_user_id = p_external_user_id and match_status = 'matched'
     and canonical_user_id = p_expected_user_id for update;
  if not found or v_identity.canonical_user_id is null
    or v_identity.profile_snapshot->>'provisionedMemberId' <> v_identity.canonical_user_id::text
    or v_identity.profile_snapshot->>'status' <> 'active'
    or v_identity.profile_snapshot->>'loginDisabled' = 'true'
  then return null; end if;

  select * into v_person from public.users
   where id = v_identity.canonical_user_id and org_id = p_org_id for update;
  if not found then return null; end if;
  select * into v_membership from public.user_organizations
   where user_id = v_person.id and org_id = p_org_id for update;
  if not found or v_membership.employment_status <> 'active'
    or v_membership.is_default is distinct from true
  then return null; end if;

  if v_person.status = 'active' and v_person.login_enabled = true
    and v_membership.status = 'active' then return v_person.id; end if;
  -- Revalidate the directory reservation under the same lock as administrative edits.
  if not exists (
    select 1 from public.fxiaoke_prelogin_role_targets_v1(p_org_id, v_person.id) target
    where target.source_id = v_source.id and target.identity_id = v_identity.id
      and target.external_user_id = p_external_user_id
  ) then return null; end if;

  update public.users set status = 'active', login_enabled = true, updated_at = now()
   where id = v_person.id and org_id = p_org_id;
  update public.user_organizations set status = 'active', updated_at = now()
   where user_id = v_person.id and org_id = p_org_id;
  -- The existing effective-role trigger now sees an active membership in this transaction.
  with applied as (
    insert into public.user_roles (user_id, role_id, org_id, scope_type, scope_id, granted_by)
    select pending.user_id, pending.role_id, pending.org_id, 'org', pending.org_id, pending.granted_by
    from public.fxiaoke_pending_org_roles pending
    where pending.org_id = p_org_id and pending.user_id = v_person.id
      and pending.source_id = v_source.id and pending.external_identity_id = v_identity.id
      and pending.external_user_id = p_external_user_id
    on conflict (user_id, role_id, scope_type, scope_id) do nothing
    returning role_id
  )
  select coalesce(array_agg(role_id order by role_id), array[]::uuid[]) into v_applied from applied;
  delete from public.fxiaoke_pending_org_roles where org_id = p_org_id and user_id = v_person.id;
  -- Activate only differences written for this verified login identity.
  v_override_target_revision := private.employee_prelogin_target_revision_v1(
    p_org_id, v_person.id, v_source.id, v_identity.id, p_external_user_id
  );
  delete from private.employee_permission_overrides
  where org_id = p_org_id and user_id = v_person.id and pending_target_revision is not null
    and pending_target_revision <> v_override_target_revision;

  update private.employee_permission_overrides
  set pending_target_revision = null
  where org_id = p_org_id and user_id = v_person.id and pending_target_revision = v_override_target_revision;

  perform private.personnel_insert_event_v1(
    p_org_id, v_person.id, v_person.id, 'fxiaoke_sso_account_enabled',
    jsonb_build_object('account_status', v_person.status, 'membership_status', v_membership.status),
    jsonb_build_object('account_status', 'active', 'membership_status', 'active', 'role_granted', cardinality(v_applied) > 0,
      'preassigned_role_ids', v_applied),
    'verified Fxiaoke identity prepared for first login', null
  );
  return v_person.id;
end;
$$;

commit;

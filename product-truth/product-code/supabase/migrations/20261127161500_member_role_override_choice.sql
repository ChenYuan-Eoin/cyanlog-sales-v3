begin;

create table private.member_role_override_reviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid not null references public.users(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  revision bytea not null,
  expires_at timestamptz not null,
  unique (org_id, actor_id, user_id)
);
alter table private.member_role_override_reviews enable row level security;
revoke all on private.member_role_override_reviews from public, anon, authenticated, service_role;

create function private.member_role_override_baseline_v1(p_org_id uuid, p_user_id uuid, p_pending_revision text)
returns jsonb language sql stable set search_path = '' as $$
  with recursive owner_codes as (
    select unnest(array['shipping:owner_view', 'shipping:owner_submit', 'shipping:owner_address_write',
      'shipping:owner_resubmit', 'shipping:owner_tracking_refresh', 'shipping:owner_cancel', 'shipping:owner_change']) as code
  ), org_roles as (
    select catalog.id, catalog.code, organization.settings,
      private.shipping_role_effective_scope_permissions_v1(catalog.code, catalog.id, organization.settings, catalog.permissions) as permissions
    from public.organizations as organization
    cross join private.org_role_catalog_v1(p_org_id, false) as catalog
    where organization.id = p_org_id and (
      (p_pending_revision is null and exists (
        select 1 from public.user_roles as binding
        where binding.org_id = p_org_id and binding.user_id = p_user_id and binding.role_id = catalog.id
          and binding.scope_type = 'org' and binding.scope_id = p_org_id
      )) or (p_pending_revision is not null and catalog.id in (
        select pending.role_id
        from private.fxiaoke_prelogin_directory_members_v1(p_org_id, p_user_id) as subject
        join public.fxiaoke_pending_org_roles as pending on pending.org_id = p_org_id and pending.user_id = p_user_id
          and pending.source_id = subject.source_id and pending.external_identity_id = subject.identity_id
          and pending.external_user_id = subject.external_user_id
        where private.employee_prelogin_target_revision_v1(
          p_org_id, p_user_id, subject.source_id, subject.identity_id, subject.external_user_id
        ) = p_pending_revision
      ))
    )
  ), grants as (
    select array(select distinct permission#>>'{}' from org_roles
      cross join jsonb_array_elements(permissions) as permission order by 1) as role_permissions,
      array(select distinct owner_codes.code from owner_codes
        cross join org_roles as role
        cross join lateral (select role.settings->'shipping_owner_permission_overrides'->role.id::text as configured) as source
        where role.code = 'SUPER_ADMIN' or (jsonb_typeof(source.configured) = 'array'
          and source.configured ? 'shipping:owner_view' and source.configured ? owner_codes.code
          and not exists (select 1 from jsonb_array_elements(
            case when jsonb_typeof(source.configured) = 'array' then source.configured else '[]'::jsonb end
          ) as item where not exists (select 1 from owner_codes as known where known.code = item#>>'{}')))
        order by 1) as owner_permissions
  ), exception_keys as (
    select permission_code from private.employee_permission_overrides
    where org_id = p_org_id and user_id = p_user_id and pending_target_revision is not distinct from p_pending_revision
  ), relevant as (
    select permission_code as code from exception_keys
    union select unnest(array['shipping:ledger_view','shipping:settings_view','shipping:operate','shipping:manage_connections',
      'user:view','org:write','user:write','admin:access','dept:directory_view','dept:write','role:manage'])
  ), granted as (
    select coalesce(jsonb_object_agg(relevant.code,
      (grants.role_permissions && array[relevant.code, split_part(relevant.code, ':', 1) || ':*', '*'])), '{}'::jsonb) as matches,
      grants.role_permissions, grants.owner_permissions
    from relevant cross join grants group by grants.role_permissions, grants.owner_permissions
  ), published as (
    select coalesce(jsonb_object_agg(point.code, point.status = 'published' and point.kind = 'atomic'), '{}'::jsonb) as codes
    from public.permission_points as point
    where point.code in (select code from relevant) or point.code = 'shipping:owner_view'
  ), organization_context as (
    select (granted.matches->'user:view' = 'true'::jsonb or granted.matches->'admin:access' = 'true'::jsonb
      or granted.matches->'user:write' = 'true'::jsonb or granted.matches->'org:write' = 'true'::jsonb) as member_view,
      granted.matches->'user:write' = 'true'::jsonb or granted.matches->'org:write' = 'true'::jsonb as legacy_user_write,
      granted.matches->'dept:write' = 'true'::jsonb or granted.matches->'org:write' = 'true'::jsonb as legacy_department_write,
      granted.matches->'dept:directory_view' = 'true'::jsonb as direct_department_view
    from granted
  ), shipping_keys as (
    select relevant.code, case when relevant.code = any(array[
        'shipping:record_create','shipping:record_review','shipping:order_confirm','shipping:order_reconcile',
        'shipping:tracking_refresh','shipping:order_cancel','shipping:order_change','shipping:ledger_view'
      ]) then 'shipping:operate'
      when relevant.code = any(array['shipping:settings_view','shipping:connection_write',
        'shipping:billing_write','shipping:intake_write','shipping:intercept_enable']) then 'shipping:manage_connections'
      end as legacy
    from relevant where relevant.code like 'shipping:%'
  ), shipping_base as (
    select shipping_keys.code, (
      (published.codes->shipping_keys.code = 'true'::jsonb
        and (shipping_keys.code = any(granted.role_permissions) or granted.role_permissions && array['shipping:*','*']))
      or ((not (published.codes ? shipping_keys.code) or published.codes->shipping_keys.code = 'true'::jsonb)
        and published.codes->shipping_keys.legacy = 'true'::jsonb
        and (shipping_keys.legacy = any(granted.role_permissions) or granted.role_permissions && array['shipping:*','*']))
    ) as enabled
    from shipping_keys cross join granted cross join published
  ), configured_department_roles as (
    select binding.scope_id, role.code,
      private.shipping_role_effective_scope_permissions_v1(role.code, role.id, organization.settings, role.permissions) as permissions
    from public.user_roles as binding
    join private.org_role_catalog_v1(p_org_id, false) as role on role.id = binding.role_id
    join public.organizations as organization on organization.id = binding.org_id and organization.status = 'active'
    where p_pending_revision is null and binding.org_id = p_org_id and binding.user_id = p_user_id
      and binding.scope_type = 'department' and role.code not in ('SUPER_ADMIN', 'ORG_SUPER_ADMIN', 'FXIAOKE_BASELINE')
  ), department_catalog as (
    select point.code from private.shipping_role_scope_catalog_v1() as point
    where point.code in ('shipping:ledger_view','shipping:record_return') and 'department' = any(point.supported_scope_types)
  ), configured_department_coverage(permission_code, department_id) as (
    -- The runtime only grants access to active departments. Keep the configured
    -- role footprint here as well so removing a dormant binding is detectable.
    select point.code, department.id
    from configured_department_roles as role
    join public.departments as department on department.id = role.scope_id and department.org_id = p_org_id
    join department_catalog as point on role.permissions ? point.code
    where point.code <> 'shipping:record_return' or role.code <> 'SHIPPING_OPERATOR'
      or (role.permissions ? 'shipping:ledger_view' and exists (
        select 1 from department_catalog where code = 'shipping:ledger_view'
      ))
    union
    select parent.permission_code, child.id
    from configured_department_coverage as parent
    join public.departments as child on child.org_id = p_org_id and child.parent_id = parent.department_id
  ), final_flags as (
    select exception.permission_code, case
      when exception.permission_code like 'shipping:owner_%' then
        published.codes->'shipping:owner_view' = 'true'::jsonb
        and published.codes->exception.permission_code = 'true'::jsonb and exception.permission_code = any(granted.owner_permissions)
      when exception.permission_code like 'shipping:%' then
        shipping.enabled and case shipping_key.legacy
          when 'shipping:operate' then (select enabled from shipping_base where code = 'shipping:ledger_view')
          when 'shipping:manage_connections' then (select enabled from shipping_base where code = 'shipping:settings_view')
          else true end
      when exception.permission_code = 'user:view' then organization_context.member_view
      when exception.permission_code like 'user:%' then organization_context.legacy_user_write
        or granted.matches->exception.permission_code = 'true'::jsonb
      when exception.permission_code = 'dept:directory_view' then organization_context.direct_department_view
        or organization_context.legacy_department_write or organization_context.member_view
      when exception.permission_code in ('dept:edit_structure','dept:delete_structure') then organization_context.legacy_department_write
        or (organization_context.direct_department_view and granted.matches->exception.permission_code = 'true'::jsonb)
      when exception.permission_code = 'role:view' then granted.matches->'role:manage' = 'true'::jsonb
        or (granted.matches->'user:view' = 'true'::jsonb and granted.matches->'role:view' = 'true'::jsonb)
      else false end as enabled
    from exception_keys as exception
    cross join granted cross join published cross join organization_context
    left join shipping_base as shipping on shipping.code = exception.permission_code
    left join shipping_keys as shipping_key on shipping_key.code = exception.permission_code
  )
  select coalesce(jsonb_object_agg(final_flags.permission_code, jsonb_build_object(
    'organization_wide', coalesce(projection.base_organization_wide, final_flags.enabled, false),
    'department_ids', coalesce(projection.base_department_ids, array[]::uuid[]),
    'configured_department_ids', array(
      select distinct scope.department_id from configured_department_coverage as scope
      where scope.permission_code = final_flags.permission_code order by scope.department_id
    )
  )), '{}'::jsonb)
  from final_flags
  left join private.shipping_employee_permission_scope_projection_v1(p_org_id, p_user_id, p_pending_revision) as projection
    on projection.permission_code = final_flags.permission_code and (p_pending_revision is null or exists (
      select 1 from private.employee_prelogin_target_v1(p_org_id, p_user_id)
    ));
$$;

create function private.member_role_override_plan_v1(
  p_org_id uuid, p_user_id uuid, p_before jsonb, p_after jsonb, p_pending_revision text
)
returns jsonb language sql stable set search_path = '' as $$
  with recursive department_tree as (
    select id, parent_id, status from public.departments where org_id = p_org_id
  ), affected as (
    select exception.permission_code, exception.effect, exception.scope, exception.updated_at,
      p_before->exception.permission_code as before_state, p_after->exception.permission_code as after_state
    from private.employee_permission_overrides as exception
    where exception.org_id = p_org_id and exception.user_id = p_user_id
      and exception.pending_target_revision is not distinct from p_pending_revision
      and p_before->exception.permission_code is distinct from p_after->exception.permission_code
  ), personal_scope(permission_code, id, descendants, available) as (
    select affected.permission_code, stored.department_id, stored.include_subdepartments,
      department_tree.status is not distinct from 'active'
    from affected
    cross join jsonb_to_recordset(case when affected.scope->>'type' = 'department'
      then affected.scope->'departments' else '[]'::jsonb end) as stored(department_id uuid, include_subdepartments boolean)
    left join department_tree on department_tree.id = stored.department_id
    union
    select parent.permission_code, child.id, true, parent.available and child.status is not distinct from 'active'
    from personal_scope as parent
    join department_tree as child on child.parent_id = parent.id where parent.descendants
  ), coverage as (
    select permission_code, id, bool_or(available) as available
    from personal_scope group by permission_code, id
  ), scope_coverage as (
    select affected.*, evidence.departments, evidence.can_retain, evidence.scope_changed
    from affected cross join lateral (
      select jsonb_agg(to_jsonb(department) - 'permission_code' order by department.id) as departments,
        bool_and(department.available and matching.after_live) as can_retain,
        bool_or(
          (matching.before_live or (not department.available
            and coalesce(affected.before_state->'configured_department_ids' ? department.id::text, false)))
          is distinct from
          (matching.after_live or (not department.available
            and coalesce(affected.after_state->'configured_department_ids' ? department.id::text, false)))
        ) as scope_changed
      from coverage as department
      cross join lateral (select
        coalesce(affected.before_state->'organization_wide' = 'true'::jsonb, false)
          or coalesce(affected.before_state->'department_ids' ? department.id::text, false) as before_live,
        coalesce(affected.after_state->'organization_wide' = 'true'::jsonb, false)
          or coalesce(affected.after_state->'department_ids' ? department.id::text, false) as after_live
      ) as matching
      where department.permission_code = affected.permission_code
    ) as evidence
  )
  select coalesce(jsonb_agg(to_jsonb(scope_coverage) || jsonb_build_object(
    'retainable', effect = 'DENY' or coalesce(case when scope->>'type' = 'department' then can_retain
      else after_state->'organization_wide' = 'true'::jsonb end, false)
  ) order by permission_code), '[]'::jsonb)
  from scope_coverage
  where scope->>'type' is distinct from 'department' or scope_changed;
$$;

create function public.admin_apply_member_role_change_v1(
  p_actor_id uuid, p_org_id uuid, p_user_id uuid, p_change jsonb,
  p_review_id uuid default null, p_choice text default null, p_request_id text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_pending_revision text;
  v_before jsonb;
  v_after jsonb;
  v_plan jsonb;
  v_revision bytea;
  v_review_id uuid;
  v_result jsonb;
  v_roles uuid[];
  v_expected uuid[];
  v_system_change boolean := false;
begin
  perform private.assert_member_department_transfer_actor_v1(p_org_id, p_actor_id);
  if (p_review_id is null) <> (p_choice is null)
    or (p_choice is not null and p_choice not in ('new_baseline', 'retain_eligible')) then
    raise exception 'invalid personal permission decision' using errcode = '22023';
  end if;
  if p_change->>'kind' in ('member_org','replace_org','replace_org_if_current','add_org') then
    select array(select id::uuid from jsonb_array_elements_text(p_change->'role_ids') as role(id)) into v_roles;
    select array(select id::uuid from jsonb_array_elements_text(p_change->'expected_role_ids') as role(id)) into v_expected;
    v_system_change := p_change->>'kind' = 'member_org'
      and p_change->'system_admin' is distinct from p_change->'expected_system_admin';
  end if;
  select private.employee_prelogin_target_revision_v1(
    p_org_id, p_user_id, subject.source_id, subject.identity_id, subject.external_user_id
  ) into v_pending_revision
  from private.fxiaoke_prelogin_directory_members_v1(p_org_id, p_user_id) as subject;
  if not v_system_change and not private.has_exact_org_role_v1(p_user_id, p_org_id, 'SUPER_ADMIN')
    and exists (select 1 from private.employee_permission_overrides where org_id = p_org_id and user_id = p_user_id
      and pending_target_revision is not distinct from v_pending_revision) then
    v_before := private.member_role_override_baseline_v1(p_org_id, p_user_id, v_pending_revision);
  end if;

  -- Reuse the same mutation and live baseline that will take effect on save.
  -- Returning a review rolls the inner mutation, triggers and audit back together.
  begin
    case p_change->>'kind'
      when 'member_org' then
        v_result := to_jsonb(public.admin_save_member_org_roles_v1(p_actor_id, p_org_id, p_user_id, v_roles, v_expected,
          (p_change->>'system_admin')::boolean, (p_change->>'expected_system_admin')::boolean, p_request_id));
      when 'replace_org' then
        v_result := to_jsonb(public.admin_replace_org_roles_v1(p_actor_id, p_org_id, p_user_id, v_roles,
          'tenant role assignment', p_request_id));
      when 'replace_org_if_current' then
        v_result := to_jsonb(public.admin_replace_org_roles_if_current_v1(p_actor_id, p_org_id, p_user_id, v_roles,
          v_expected, 'tenant role assignment', p_request_id));
      when 'scope' then
        v_result := to_jsonb(public.admin_set_role_scope_assignment_v1(p_actor_id, p_org_id, p_user_id,
          (p_change->>'role_id')::uuid, p_change->>'scope_type', (p_change->>'scope_id')::uuid,
          p_change->>'action', p_change->>'reason', p_request_id));
      when 'add_org' then
        select to_jsonb(outcome) into v_result from public.admin_apply_org_member_batch_v1(
          p_actor_id, p_org_id, array[p_user_id], 'assign_roles', v_roles, p_request_id
        );
      else
        raise exception 'invalid role change' using errcode = '22023';
    end case;
    if v_result is null or v_result not in ('true'::jsonb, '"saved"'::jsonb, '"pending"'::jsonb) then
      return jsonb_build_object('result', v_result);
    end if;
    if v_before is not null then
      v_after := private.member_role_override_baseline_v1(p_org_id, p_user_id, v_pending_revision);
      v_plan := private.member_role_override_plan_v1(p_org_id, p_user_id, v_before, v_after, v_pending_revision);
    end if;
    if coalesce(jsonb_array_length(v_plan), 0) = 0 then
      if p_review_id is not null then
        raise exception 'role override review changed' using errcode = '40001', detail = 'ROLE_OVERRIDE_REVIEW_CHANGED';
      end if;
      return jsonb_build_object('result', v_result);
    end if;
    v_revision := sha256(convert_to(jsonb_build_array(p_actor_id,p_org_id,p_user_id,
      p_change, v_pending_revision, v_before, v_after, v_plan)::text, 'UTF8'));
    if p_review_id is not null then
      if not exists (select 1 from private.member_role_override_reviews
        where id = p_review_id and org_id = p_org_id and actor_id = p_actor_id and user_id = p_user_id
          and revision = v_revision and expires_at > clock_timestamp()) then
        raise exception 'role override review changed' using errcode = '40001', detail = 'ROLE_OVERRIDE_REVIEW_CHANGED';
      end if;
      perform private.apply_employee_department_override_choice_v1(p_org_id, p_actor_id, p_user_id, v_plan, p_choice, clock_timestamp());
      delete from private.member_role_override_reviews where id = p_review_id;
      return jsonb_build_object('result', v_result);
    end if;
    raise sqlstate 'PZ001' using message = 'member role override review required';
  exception when sqlstate 'PZ001' then
    insert into private.member_role_override_reviews(org_id, actor_id, user_id, revision, expires_at)
    values(p_org_id, p_actor_id, p_user_id, v_revision, clock_timestamp() + interval '10 minutes')
    on conflict (org_id, actor_id, user_id) do update
      set id = gen_random_uuid(), revision = excluded.revision, expires_at = excluded.expires_at
    returning id into v_review_id;
    return jsonb_build_object('review_revision', v_review_id, 'affected_permissions', (
      select jsonb_agg(jsonb_build_object('permission_code', item.permission_code, 'retainable', item.retainable) order by item.permission_code)
      from jsonb_to_recordset(v_plan) as item(permission_code text, retainable boolean)
    ));
  end;
end;
$$;

revoke all on function private.member_role_override_baseline_v1(uuid, uuid, text),
  private.member_role_override_plan_v1(uuid, uuid, jsonb, jsonb, text),
  public.admin_apply_member_role_change_v1(uuid, uuid, uuid, jsonb, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_apply_member_role_change_v1(uuid, uuid, uuid, jsonb, uuid, text, text)
  to service_role;

commit;

-- Routine membership changes take effect immediately. Ask for a decision only
-- when the new department range changes an existing personal scoped difference.
begin;

create table private.member_department_change_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid not null references public.users(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null check (kind in ('primary', 'secondary')),
  request_id text not null,
  intent jsonb not null,
  revision bytea not null,
  applied_choice text,
  outcome jsonb,
  expires_at timestamptz not null,
  unique (org_id, actor_id, user_id, kind, request_id)
);
create index member_department_change_requests_expiry
  on private.member_department_change_requests(org_id, expires_at);
alter table private.member_department_change_requests enable row level security;
revoke all on private.member_department_change_requests from public, anon, authenticated, service_role;

create function private.expand_employee_department_selection_v1(p_org_id uuid, p_scope jsonb)
returns table (active_ids uuid[], potential_ids uuid[]) language sql stable set search_path = '' as $$
  with recursive selected(id, with_children, is_active_path) as (
    select department.id, selection.include_subdepartments, department.status = 'active'
    from jsonb_to_recordset(p_scope) as selection(department_id uuid, include_subdepartments boolean)
    join public.departments as department on department.org_id = p_org_id and department.id = selection.department_id
    union
    select child.id, true, parent.is_active_path and child.status = 'active'
    from selected as parent
    join public.departments as child on child.org_id = p_org_id and child.parent_id = parent.id
    where parent.with_children
  )
  select array(select distinct id from selected where is_active_path order by id),
    array(select distinct id from selected order by id);
$$;

create function private.employee_department_override_impact_v1(
  p_org_id uuid, p_user_id uuid, p_before_active_ids uuid[], p_after_active_ids uuid[],
  p_before_potential_ids uuid[], p_after_potential_ids uuid[], p_permission_codes text[] default null
)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'permission_code', exception.permission_code,
    'retainable', scoped.active_ids <@ p_after_active_ids and scoped.potential_ids <@ p_after_potential_ids and exists (
      select 1 from private.shipping_role_scope_catalog_v1() as point
      where point.code = exception.permission_code and 'department' = any(point.supported_scope_types)
    ) and not exists (
      select 1
      from jsonb_to_recordset(exception.scope->'departments') as root(department_id uuid)
      where not root.department_id = any(scoped.active_ids)
    ),
    'scope_department_ids', scoped.active_ids, 'potential_department_ids', scoped.potential_ids, 'original', to_jsonb(exception)
  ) order by exception.permission_code), '[]'::jsonb)
  from private.employee_permission_overrides as exception
  cross join lateral private.expand_employee_department_selection_v1(p_org_id,
    case when exception.scope->>'type' = 'department' then exception.scope->'departments' else '[]'::jsonb end
  ) as scoped
  where exception.org_id = p_org_id and exception.user_id = p_user_id
    and exception.effect = 'ALLOW' and exception.scope->>'type' = 'department'
    and (p_permission_codes is null or exception.permission_code = any(p_permission_codes))
    and (
      exists (
        select 1 from unnest(scoped.active_ids) as data_scope(id)
        where (data_scope.id = any(p_before_active_ids)) is distinct from (data_scope.id = any(p_after_active_ids))
      )
      or exists (
        select 1 from unnest(scoped.potential_ids) as data_scope(id)
        where (data_scope.id = any(p_before_potential_ids)) is distinct from (data_scope.id = any(p_after_potential_ids))
      )
    );
$$;

create function private.apply_employee_department_override_choice_v1(
  p_org_id uuid, p_actor_id uuid, p_user_id uuid, p_plan jsonb, p_choice text, p_effective_at timestamptz
)
returns void language plpgsql set search_path = '' as $$
begin
  if jsonb_array_length(p_plan) = 0 then return; end if;
  if coalesce(p_choice, '') not in ('new_baseline', 'retain_eligible') then
    raise exception 'personal permission choice is required'
      using errcode = '22023', detail = 'DEPARTMENT_OVERRIDE_INVALID_CHOICE';
  end if;

  insert into private.department_transfer_review_items(org_id, user_id, actor_id, effective_at, kind, previous_grant)
  select p_org_id, p_user_id, p_actor_id, p_effective_at, 'personal_override', to_jsonb(exception)
  from private.employee_permission_overrides as exception
  join jsonb_to_recordset(p_plan) as decision(permission_code text, retainable boolean)
    on exception.permission_code = decision.permission_code
  where exception.org_id = p_org_id and exception.user_id = p_user_id and (
    p_choice = 'new_baseline' or (decision.retainable is not true and exception.effect = 'ALLOW')
  );

  if p_choice = 'new_baseline' then
    delete from private.employee_permission_overrides as exception
    using jsonb_to_recordset(p_plan) as decision(permission_code text)
    where exception.org_id = p_org_id and exception.user_id = p_user_id and exception.permission_code = decision.permission_code;
  else
    update private.employee_permission_overrides as exception
    set effect = 'DENY', scope = null, updated_by = p_actor_id, updated_at = p_effective_at
    from jsonb_to_recordset(p_plan) as decision(permission_code text, retainable boolean)
    where exception.org_id = p_org_id and exception.user_id = p_user_id
      and exception.permission_code = decision.permission_code and exception.effect = 'ALLOW'
      and decision.retainable is not true;
  end if;
end;
$$;

-- Preserve the existing directory review policy. The member save uses the
-- same non-personal reconciliation and passes its checked personal choice.
create or replace function private.apply_department_change_impact_v1(
  p_org_id uuid, p_actor_id uuid, p_user_id uuid, p_impact jsonb, p_effective_at timestamptz
)
returns void
language plpgsql set search_path = '' as $$
begin
  with roles_pending_review as (
    delete from public.user_roles as binding
    using jsonb_to_recordset(p_impact->'roles_for_review') as review(role_id uuid, scope_type text, scope_id uuid)
    where binding.org_id = p_org_id and binding.user_id = p_user_id
      and binding.role_id = review.role_id and binding.scope_type = review.scope_type and binding.scope_id = review.scope_id
    returning to_jsonb(binding) as prior
  ), pending_roles_on_hold as (
    delete from public.fxiaoke_pending_org_roles as binding
    using jsonb_to_recordset(p_impact->'pending_roles_for_review') as review(role_id uuid)
    where binding.org_id = p_org_id and binding.user_id = p_user_id and binding.role_id = review.role_id
    returning to_jsonb(binding) as prior
  ), retained_roles as (
    select to_jsonb(binding) as prior
    from public.user_roles as binding
    join jsonb_to_recordset(p_impact->'retained_roles_for_review') as review(role_id uuid, scope_type text, scope_id uuid)
      on binding.role_id = review.role_id and binding.scope_type = review.scope_type and binding.scope_id = review.scope_id
    where binding.org_id = p_org_id and binding.user_id = p_user_id
  ), leads_pending_review as (
    delete from public.department_lead_access as lead
    using jsonb_array_elements_text(p_impact->'lead_departments_for_review') as review(id)
    where lead.org_id = p_org_id and lead.user_id = p_user_id and lead.department_id = review.id::uuid
    returning to_jsonb(lead) as prior
  ), spaces_pending_review as (
    delete from public.sales_space_members as membership
    using jsonb_to_recordset(p_impact->'spaces_for_review') as review(space_id uuid)
    where membership.org_id = p_org_id and membership.user_id = p_user_id and membership.space_id = review.space_id
    returning to_jsonb(membership) as prior
  ), personal_review as materialized (
    select to_jsonb(exception) as prior
    from private.employee_permission_overrides as exception
    where exception.org_id = p_org_id and exception.user_id = p_user_id
      and p_impact->>'personal_policy' is distinct from 'managed'
  ), block_personal_allow as (
    -- An ALLOW also replaces its data scope and can be narrower than the base
    -- grant. Suspending it must not accidentally enable that broader grant.
    update private.employee_permission_overrides as exception
    set effect = 'DENY', scope = null, updated_by = p_actor_id, updated_at = p_effective_at
    where exception.org_id = p_org_id and exception.user_id = p_user_id and exception.effect = 'ALLOW'
      and p_impact->>'personal_policy' is distinct from 'managed'
    returning exception.permission_code
  ), review_rows as (
    select 'role' as kind, prior from roles_pending_review
    union all select 'retained_role', prior from retained_roles
    union all select 'pending_role', prior from pending_roles_on_hold
    union all select 'department_lead', prior from leads_pending_review
    union all select 'space_membership', prior from spaces_pending_review
    union all select 'personal_override', prior from personal_review
  )
  insert into private.department_transfer_review_items(org_id, user_id, actor_id, effective_at, kind, previous_grant)
  select p_org_id, p_user_id, p_actor_id, p_effective_at, review.kind, review.prior from review_rows as review;
end;
$$;

create function private.execute_member_department_transfer_v1(
  p_org_id uuid, p_actor_id uuid, p_user_id uuid, p_department_id uuid, p_keep_previous boolean,
  p_snapshot jsonb, p_plan jsonb, p_override_choice text, p_request_id text
)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_previous uuid;
  v_effective_at timestamptz;
  v_result jsonb;
begin
  v_previous := (p_snapshot->>'previous_department_id')::uuid;
  v_effective_at := clock_timestamp();
  perform private.apply_department_change_impact_v1(
    p_org_id, p_actor_id, p_user_id, (p_snapshot->'impact') || '{"personal_policy":"managed"}'::jsonb, v_effective_at
  );
  perform private.apply_employee_department_override_choice_v1(
    p_org_id, p_actor_id, p_user_id, p_plan, p_override_choice, v_effective_at
  );

  update public.users
  set primary_dept_id = p_department_id, updated_at = v_effective_at
  where id = p_user_id and org_id = p_org_id;

  update public.user_organizations
  set primary_department_id = p_department_id, membership_version = membership_version + 1,
    updated_at = v_effective_at, updated_by = p_actor_id
  where user_id = p_user_id and org_id = p_org_id;

  if v_previous is not null then
    if p_keep_previous then
      insert into public.user_departments (user_id, department_id, org_id, is_primary, joined_at)
      values (p_user_id, v_previous, p_org_id, false, v_effective_at)
      on conflict (user_id, department_id) do update set is_primary = false;
    else
      delete from public.user_departments
      where user_id = p_user_id and org_id = p_org_id and department_id = v_previous;
    end if;
  end if;

  insert into public.user_departments (user_id, department_id, org_id, is_primary, joined_at)
  values (p_user_id, p_department_id, p_org_id, true, v_effective_at)
  on conflict (user_id, department_id) do update set is_primary = true;

  update public.personnel_employment_periods
  set department_id = p_department_id, updated_at = v_effective_at
  where user_id = p_user_id and org_id = p_org_id and status in ('active', 'suspended');

  v_result := jsonb_build_object(
    'department_id', p_department_id, 'secondary_department_ids', p_snapshot->'secondary_department_ids',
    'status', 'applied', 'effective_at', v_effective_at, 'impact', p_snapshot->'impact'
  );
  perform private.personnel_insert_event_v1(
    p_org_id, p_user_id, p_actor_id, 'confirm_department_transfer',
    jsonb_build_object('primary_department_id', v_previous, 'affiliations', p_snapshot->'affiliations'),
    v_result || jsonb_build_object(
      'keep_previous_as_secondary', p_keep_previous, 'personal_override_choice', p_override_choice,
      'affiliations', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'department_id', membership.department_id, 'is_primary', membership.is_primary,
          'source', membership.source, 'joined_at', membership.joined_at
        ) order by membership.department_id), '[]'::jsonb)
        from public.user_departments as membership
        where membership.org_id = p_org_id and membership.user_id = p_user_id
      )
    ),
    'saved department transfer', p_request_id
  );

  return v_result;
end;
$$;

create function private.execute_member_secondary_department_change_v1(
  p_org_id uuid, p_actor_id uuid, p_user_id uuid, p_action text,
  p_snapshot jsonb, p_plan jsonb, p_override_choice text, p_request_id text
)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_affected uuid[];
  v_written bigint;
  v_effective_at timestamptz;
begin
  v_effective_at := clock_timestamp();
  select array(select id::uuid from jsonb_array_elements_text(p_snapshot->'affected_department_ids') as changed(id)) into v_affected;
  perform private.apply_department_change_impact_v1(
    p_org_id, p_actor_id, p_user_id, (p_snapshot->'impact') || '{"personal_policy":"managed"}'::jsonb, v_effective_at
  );
  perform private.apply_employee_department_override_choice_v1(
    p_org_id, p_actor_id, p_user_id, p_plan, p_override_choice, v_effective_at
  );
  if p_action = 'add' then
    insert into public.user_departments(org_id, user_id, department_id, is_primary, source, joined_at)
    select p_org_id, p_user_id, id, false, 'manual', v_effective_at from unnest(v_affected) as changed(id);
  else
    delete from public.user_departments
    where org_id = p_org_id and user_id = p_user_id and department_id = any(v_affected)
      and is_primary is false and source = 'manual';
  end if;
  get diagnostics v_written = row_count;
  if v_written <> cardinality(v_affected) then
    raise exception 'secondary affiliations changed concurrently'
      using errcode = '40001', detail = 'SECONDARY_DEPARTMENT_STALE';
  end if;

  update public.user_organizations
  set membership_version = membership_version + 1, updated_at = v_effective_at, updated_by = p_actor_id
  where org_id = p_org_id and user_id = p_user_id;
  perform private.personnel_insert_event_v1(
    p_org_id, p_user_id, p_actor_id, 'confirm_secondary_department_change',
    jsonb_build_object('department_ids', p_snapshot->'before_department_ids'),
    jsonb_build_object(
      'department_ids', p_snapshot->'after_department_ids', 'action', p_action,
      'affected_department_ids', v_affected, 'effective_at', v_effective_at, 'personal_override_choice', p_override_choice
    ),
    'saved manual secondary department change', p_request_id
  );
  return jsonb_build_object(
    'status', 'applied', 'action', p_action, 'affected_department_ids', v_affected, 'effective_at', v_effective_at,
    'impact', p_snapshot->'impact'
  );
end;
$$;

create function private.save_member_department_change_v1(
  p_org_id uuid, p_actor_id uuid, p_user_id uuid, p_kind text, p_intent jsonb,
  p_override_choice text, p_choice_id uuid, p_request_id text
)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_request private.member_department_change_requests%rowtype;
  v_snapshot jsonb;
  v_plan jsonb;
  v_links record;
  v_department_id uuid := (p_intent->>'department_id')::uuid;
  v_keep_previous boolean := (p_intent->>'keep_previous')::boolean;
  v_action text := p_intent->>'action';
  v_department_ids uuid[];
  v_before_scope record;
  v_after_scope record;
  v_revision bytea;
  v_result jsonb;
  v_retainable integer;
  v_stale text := case when p_kind = 'primary' then 'DEPARTMENT_TRANSFER_STALE' else 'SECONDARY_DEPARTMENT_STALE' end;
begin
  perform private.assert_member_department_transfer_actor_v1(p_org_id, p_actor_id);
  if (p_override_choice is null) <> (p_choice_id is null)
    or (p_override_choice is not null and p_override_choice not in ('new_baseline', 'retain_eligible'))
    or (p_request_id is not null and char_length(p_request_id) not between 1 and 128) then
    raise exception 'invalid personal permission choice'
      using errcode = '22023', detail = 'DEPARTMENT_OVERRIDE_INVALID_CHOICE';
  end if;

  delete from private.member_department_change_requests
  where org_id = p_org_id and expires_at <= clock_timestamp();
  select * into v_request from private.member_department_change_requests
  where org_id = p_org_id and actor_id = p_actor_id and user_id = p_user_id and kind = p_kind
    and ((p_choice_id is not null and id = p_choice_id and (p_request_id is null or request_id = p_request_id))
      or (p_choice_id is null and request_id = p_request_id))
  for update;
  if (p_choice_id is not null and not found) or (found and v_request.intent is distinct from p_intent) then
    raise exception 'department permission choice no longer matches the request'
      using errcode = '40001', detail = v_stale;
  end if;
  if v_request.outcome is not null then
    if p_override_choice is not null and v_request.applied_choice is distinct from p_override_choice then
      raise exception 'department permission choice was already used'
        using errcode = '40001', detail = v_stale;
    end if;
    return v_request.outcome;
  end if;

  -- Same lock as personnel role, relationship and external directory updates.
  -- A row lock also prevents ordinary hierarchy writes changing scope mid-save.
  perform 1 from public.departments where org_id = p_org_id order by id for share;
  begin
    if p_kind = 'primary' then
      v_snapshot := private.member_department_transfer_snapshot_v1(p_org_id, p_actor_id, p_user_id,
        v_department_id, v_keep_previous);
      select * into v_links from private.department_transfer_affiliations_v1(
        p_org_id, p_user_id, (v_snapshot->>'previous_department_id')::uuid, v_department_id, v_keep_previous
      );
    else
      v_department_ids := array(select value::uuid from jsonb_array_elements_text(p_intent->'department_ids') as requested(value));
      v_snapshot := private.secondary_department_snapshot_v1(p_org_id, p_actor_id, p_user_id,
        v_department_ids, v_action);
      if jsonb_array_length(v_snapshot->'affected_department_ids') = 0 and v_request.id is null then
        return v_snapshot || jsonb_build_object('status', 'unchanged');
      end if;
      select array(select value::uuid from jsonb_array_elements_text(v_snapshot->'before_department_ids') as link(value)) as before_ids,
        array(select value::uuid from jsonb_array_elements_text(v_snapshot->'after_department_ids') as link(value)) as after_ids
      into v_links;
    end if;
  exception when no_data_found or invalid_parameter_value then
    if v_request.id is null then raise; end if;
    raise exception 'department relationships changed after the permission choice'
      using errcode = '40001', detail = v_stale;
  end;

  select * into v_before_scope from private.expand_employee_department_selection_v1(p_org_id, (
    select coalesce(jsonb_agg(jsonb_build_object(
    'department_id', department, 'include_subdepartments', true
    )), '[]'::jsonb) from unnest(v_links.before_ids) as scope(department)
  ));
  select * into v_after_scope from private.expand_employee_department_selection_v1(p_org_id, (
    select coalesce(jsonb_agg(jsonb_build_object(
    'department_id', department, 'include_subdepartments', true
    )), '[]'::jsonb) from unnest(v_links.after_ids) as scope(department)
  ));
  v_plan := private.employee_department_override_impact_v1(p_org_id, p_user_id,
    v_before_scope.active_ids, v_after_scope.active_ids, v_before_scope.potential_ids, v_after_scope.potential_ids);
  v_revision := sha256(convert_to(jsonb_build_array(v_snapshot, v_before_scope, v_after_scope, v_plan)::text, 'UTF8'));

  if v_request.id is not null and (
    v_request.expires_at <= clock_timestamp() or v_request.revision is distinct from v_revision
  ) then
    raise exception 'department permissions changed after the permission choice'
      using errcode = '40001', detail = v_stale;
  end if;
  if jsonb_array_length(v_plan) > 0 and p_override_choice is null then
    if v_request.id is null then
      insert into private.member_department_change_requests (org_id, actor_id, user_id, kind, request_id, intent, revision, expires_at)
      values (p_org_id, p_actor_id, p_user_id, p_kind, coalesce(p_request_id, gen_random_uuid()::text),
        p_intent, v_revision, clock_timestamp() + interval '10 minutes')
      returning * into v_request;
    end if;
    select count(*)::integer into v_retainable from jsonb_to_recordset(v_plan) as item(retainable boolean)
    where item.retainable;
    return jsonb_build_object('status', 'override_choice_required', 'choice_id', v_request.id,
      'impact', jsonb_build_object('affected_count', jsonb_array_length(v_plan), 'retainable_count', v_retainable,
        'blocked_count', jsonb_array_length(v_plan) - v_retainable));
  end if;

  v_snapshot := jsonb_set(v_snapshot, '{impact,overrides_for_review}', coalesce((
    select jsonb_agg(case when p_override_choice = 'new_baseline' then
      override.value || '{"resolution":"reset_to_baseline"}'::jsonb else override.value end
      order by decision.permission_code)
    from jsonb_array_elements(v_snapshot->'impact'->'overrides_for_review') as override(value)
    join jsonb_to_recordset(v_plan) as decision(permission_code text, retainable boolean)
      on decision.permission_code = override.value->>'permission_code'
    where p_override_choice = 'new_baseline' or decision.retainable is not true
  ), '[]'::jsonb));
  if p_kind = 'primary' then
    v_result := private.execute_member_department_transfer_v1(p_org_id, p_actor_id, p_user_id, v_department_id,
      v_keep_previous, v_snapshot, v_plan, p_override_choice, p_request_id);
  else
    v_result := private.execute_member_secondary_department_change_v1(p_org_id, p_actor_id, p_user_id, v_action,
      v_snapshot, v_plan, p_override_choice, p_request_id);
  end if;

  if v_request.id is not null then
    update private.member_department_change_requests
    set outcome = v_result, applied_choice = p_override_choice, expires_at = clock_timestamp() + interval '10 minutes'
    where id = v_request.id;
  elsif p_request_id is not null then
    insert into private.member_department_change_requests (
      org_id, actor_id, user_id, kind, request_id, intent, revision, outcome, expires_at
    ) values (p_org_id, p_actor_id, p_user_id, p_kind, p_request_id, p_intent, v_revision, v_result,
      clock_timestamp() + interval '10 minutes');
  end if;
  return v_result;
end;
$$;

create function public.save_member_department_transfer_v1(
  p_org_id uuid, p_actor_id uuid, p_user_id uuid, p_department_id uuid, p_keep_previous boolean,
  p_override_choice text default null, p_choice_id uuid default null, p_request_id text default null
)
returns jsonb language sql security definer set search_path = '' as $$
  select private.save_member_department_change_v1(p_org_id, p_actor_id, p_user_id, 'primary',
    jsonb_build_object('department_id', p_department_id, 'keep_previous', p_keep_previous),
    p_override_choice, p_choice_id, p_request_id);
$$;

create function public.save_member_secondary_department_change_v1(
  p_org_id uuid, p_actor_id uuid, p_user_id uuid, p_department_ids uuid[], p_action text,
  p_override_choice text default null, p_choice_id uuid default null, p_request_id text default null
)
returns jsonb language sql security definer set search_path = '' as $$
  select private.save_member_department_change_v1(p_org_id, p_actor_id, p_user_id, 'secondary',
    jsonb_build_object('department_ids', p_department_ids, 'action', p_action),
    p_override_choice, p_choice_id, p_request_id);
$$;

revoke all on function private.expand_employee_department_selection_v1(uuid, jsonb),
  private.employee_department_override_impact_v1(uuid, uuid, uuid[], uuid[], uuid[], uuid[], text[]),
  private.apply_employee_department_override_choice_v1(uuid, uuid, uuid, jsonb, text, timestamptz),
  private.execute_member_department_transfer_v1(uuid, uuid, uuid, uuid, boolean, jsonb, jsonb, text, text),
  private.execute_member_secondary_department_change_v1(uuid, uuid, uuid, text, jsonb, jsonb, text, text),
  private.save_member_department_change_v1(uuid, uuid, uuid, text, jsonb, text, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.preview_member_department_transfer_v1(uuid, uuid, uuid, uuid, boolean),
  public.confirm_member_department_transfer_v1(uuid, uuid, uuid, uuid, text),
  public.preview_member_secondary_department_change_v1(uuid, uuid, uuid, uuid[], text),
  public.confirm_member_secondary_department_change_v1(uuid, uuid, uuid, uuid, text),
  public.save_member_department_transfer_v1(uuid, uuid, uuid, uuid, boolean, text, uuid, text),
  public.save_member_secondary_department_change_v1(uuid, uuid, uuid, uuid[], text, text, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.save_member_department_transfer_v1(uuid, uuid, uuid, uuid, boolean, text, uuid, text),
  public.save_member_secondary_department_change_v1(uuid, uuid, uuid, uuid[], text, text, uuid, text)
  to service_role;

commit;

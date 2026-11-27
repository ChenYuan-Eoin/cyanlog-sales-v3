begin;

create table private.fxiaoke_directory_permission_reviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  source_id uuid not null,
  external_tenant_id text not null,
  plan_id uuid not null references public.organization_directory_cutover_plans(id) on delete restrict,
  user_id uuid not null references public.users(id) on delete restrict,
  revision text not null check (revision ~ '^[a-f0-9]{64}$'),
  choices jsonb not null check (jsonb_typeof(choices) = 'array'),
  decided_by uuid not null references public.users(id) on delete restrict,
  decided_at timestamptz not null default clock_timestamp(),
  foreign key (source_id, org_id) references public.organization_sources(id, system_org_id) on delete restrict,
  unique (plan_id, user_id)
);
alter table private.fxiaoke_directory_permission_reviews enable row level security;
revoke all on private.fxiaoke_directory_permission_reviews from public, anon, authenticated, service_role;
create index fxiaoke_directory_permission_reviews_lookup on private.fxiaoke_directory_permission_reviews
  (org_id, source_id, external_tenant_id, user_id, revision, decided_at desc, id desc);

-- Same active/potential expansion as the single-member command, with the tree
-- supplied by the directory transaction for each side of the comparison.
create function private.fxiaoke_directory_department_coverage_v1(p_tree jsonb, p_scope jsonb)
returns table (active_ids uuid[], potential_ids uuid[]) language sql stable set search_path = '' as $$
  with recursive departments as (
    select * from jsonb_to_recordset(p_tree) as item(id uuid, parent_id uuid, status text)
  ), selected(id, with_children, is_active_path) as (
    select dept.id, item.include_subdepartments, dept.status = 'active'
    from jsonb_to_recordset(p_scope) as item(department_id uuid, include_subdepartments boolean)
    join departments as dept on dept.id = item.department_id
    union
    select child.id, true, parent.is_active_path and child.status = 'active'
    from selected as parent join departments as child on child.parent_id = parent.id
    where parent.with_children
  )
  select array(select distinct id from selected where is_active_path order by id),
    array(select distinct id from selected order by id);
$$;

create function private.fxiaoke_directory_permission_impact_v1(p_org_id uuid, p_projection jsonb)
returns jsonb language sql stable set search_path = '' as $$
  with members as (
    select old.id,
      private.directory_transfer_ids_v1(old.primary_id, old.links) as old_ids,
      private.directory_transfer_ids_v1(proposed.primary_id, proposed.links) as next_ids
    from jsonb_to_recordset(p_projection->'before_links') as old(id uuid, primary_id uuid, links jsonb)
    join jsonb_to_recordset(p_projection->'after_links') as proposed(id uuid, primary_id uuid, links jsonb) using (id)
    where old.primary_id is distinct from proposed.primary_id or old.links is distinct from proposed.links
      or p_projection->'before_tree' is distinct from p_projection->'after_tree'
  ), effects as (
    select member.id, person.display_name, member.old_ids, member.next_ids,
      exception.permission_code, to_jsonb(exception) as original,
      to_jsonb(old_scope) as old_scope, to_jsonb(next_scope) as next_scope,
      to_jsonb(old_coverage) as old_coverage, to_jsonb(next_coverage) as next_coverage,
      next_scope.active_ids <@ next_coverage.active_ids
        and next_scope.potential_ids <@ next_coverage.potential_ids
        and next_scope.active_ids <@ old_scope.active_ids
        and next_scope.potential_ids <@ old_scope.potential_ids
        and not exists (
          select 1 from jsonb_to_recordset(exception.scope->'departments') as root(department_id uuid)
          where not (root.department_id = any(next_scope.active_ids))
        )
        and exists (
          select 1 from private.shipping_role_scope_catalog_v1() as point
          where point.code = exception.permission_code and 'department' = any(point.supported_scope_types)
        ) as retainable
    from members as member
    join public.users as person on person.id = member.id and person.org_id = p_org_id
    join private.employee_permission_overrides as exception
      on exception.org_id = p_org_id and exception.user_id = member.id
    cross join lateral private.fxiaoke_directory_department_coverage_v1(p_projection->'before_tree', (
      select coalesce(jsonb_agg(jsonb_build_object('department_id', id, 'include_subdepartments', true)), '[]'::jsonb)
      from unnest(member.old_ids) as affiliation(id)
    )) as old_coverage
    cross join lateral private.fxiaoke_directory_department_coverage_v1(p_projection->'after_tree', (
      select coalesce(jsonb_agg(jsonb_build_object('department_id', id, 'include_subdepartments', true)), '[]'::jsonb)
      from unnest(member.next_ids) as affiliation(id)
    )) as next_coverage
    cross join lateral private.fxiaoke_directory_department_coverage_v1(p_projection->'before_tree',
      case when exception.scope->>'type' = 'department' then exception.scope->'departments' else '[]'::jsonb end
    ) as old_scope
    cross join lateral private.fxiaoke_directory_department_coverage_v1(p_projection->'after_tree',
      case when exception.scope->>'type' = 'department' then exception.scope->'departments' else '[]'::jsonb end
    ) as next_scope
    where exception.effect = 'ALLOW' and exception.scope->>'type' = 'department'
      and exception.pending_target_revision is null
      and (
        old_scope.active_ids is distinct from next_scope.active_ids
        or old_scope.potential_ids is distinct from next_scope.potential_ids
        or exists (
          select 1 from unnest(old_scope.active_ids || next_scope.active_ids) as candidate(id)
          where (candidate.id = any(old_coverage.active_ids)) is distinct from (candidate.id = any(next_coverage.active_ids))
        )
        or exists (
          select 1 from unnest(old_scope.potential_ids || next_scope.potential_ids) as candidate(id)
          where (candidate.id = any(old_coverage.potential_ids)) is distinct from (candidate.id = any(next_coverage.potential_ids))
        )
      )
  ), grouped as (
    select id, jsonb_build_object(
      'userId', id, 'displayName', display_name,
      'revision', private.directory_transfer_digest_v1(jsonb_agg(to_jsonb(effect) - 'display_name' order by permission_code)),
      'permissions', jsonb_agg(jsonb_build_object('permissionCode', permission_code, 'retainable', retainable) order by permission_code)
    ) as review
    from effects as effect group by id, display_name
  )
  select coalesce(jsonb_agg(review order by id), '[]'::jsonb) from grouped;
$$;

create function private.fxiaoke_directory_permission_anchor_v1(p_org_id uuid, p_user_id uuid)
returns text language sql stable set search_path = '' as $$
  select private.directory_transfer_digest_v1(jsonb_build_array(
    private.directory_transfer_tree_v1(p_org_id),
    (select item from jsonb_array_elements(private.directory_transfer_links_v1(p_org_id)) as item
      where item->>'id' = p_user_id::text),
    (select jsonb_agg(to_jsonb(exception) order by exception.permission_code)
      from private.employee_permission_overrides as exception
      where exception.org_id = p_org_id and exception.user_id = p_user_id
        and exception.effect = 'ALLOW' and exception.scope->>'type' = 'department'
        and exception.pending_target_revision is null)
  ));
$$;

create function private.fxiaoke_directory_permission_choices_v1(
  p_org_id uuid, p_source_id uuid, p_external_tenant_id text, p_impacts jsonb
)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'userId', impact.user_id, 'revision', impact.revision, 'choices', saved.choices
  ) order by impact.user_id), '[]'::jsonb)
  from (
    select "userId" as user_id, revision
    from jsonb_to_recordset(p_impacts) as item("userId" uuid, revision text)
  ) as impact
  cross join lateral (
    select review.choices
    from private.fxiaoke_directory_permission_reviews as review
    where review.org_id = p_org_id and review.source_id = p_source_id
      and review.external_tenant_id = p_external_tenant_id
      and review.user_id = impact.user_id and review.revision = impact.revision
    order by review.decided_at desc, review.id desc limit 1
  ) as saved;
$$;

create function private.fxiaoke_directory_permission_projection_v1(p_org_id uuid, p_payload jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_anchor_departments jsonb;
  v_projection jsonb;
begin
  if p_payload->'permissionTreeHeld' is distinct from 'true'::jsonb then
    return private.directory_transfer_projection_v1(p_org_id, p_payload);
  end if;
  -- The legacy projection looks up proposed members' departments only in the
  -- proposal. Supply current source IDs here without sending department writes
  -- to the native apply delegate.
  select coalesce(jsonb_agg(jsonb_build_object(
    'externalId', dept.external_id, 'parentExternalId', parent.external_id,
    'existingDepartmentId', dept.id, 'status', dept.status
  ) order by dept.id), '[]'::jsonb) into v_anchor_departments
  from public.departments as dept
  left join public.departments as parent on parent.org_id = dept.org_id
    and parent.id = dept.parent_id and parent.source = 'fxiaoke'
  where dept.org_id = p_org_id and dept.source = 'fxiaoke' and dept.external_id is not null;

  v_projection := private.directory_transfer_projection_v1(
    p_org_id, p_payload || jsonb_build_object('departmentChanges', v_anchor_departments)
  );
  return jsonb_set(v_projection, '{after_tree}', v_projection->'before_tree');
end;
$$;

create function private.fxiaoke_directory_permission_tree_dependencies_v1(p_projection jsonb)
returns text[] language sql stable set search_path = '' as $$
  with recursive current_tree as (
    select * from jsonb_to_recordset(p_projection->'before_tree') as dept(id uuid, parent_id uuid, status text, source text, external_id text)
  ), proposed_tree as (
    select * from jsonb_to_recordset(p_projection->'after_tree') as dept(id uuid, parent_id uuid, status text, source text, external_id text)
  ), relations as (
    select id, parent_id, source, external_id from current_tree
    union select id, parent_id, source, external_id from proposed_tree
  ), changed as (
    select coalesce(old.id, proposed.id) as id
    from current_tree as old full join proposed_tree as proposed using (id)
    where old.id is null or proposed.id is null or old.parent_id is distinct from proposed.parent_id
      or old.status is distinct from proposed.status
    union
    select child.id from changed join relations as child on child.parent_id = changed.id
  )
  select array(select distinct relation.external_id from changed join relations as relation using (id)
    where relation.source = 'fxiaoke' and relation.external_id is not null order by relation.external_id);
$$;

create function private.fxiaoke_directory_permission_filter_v1(
  p_payload jsonb, p_blocked text[], p_hold_tree boolean
) returns jsonb language sql stable set search_path = '' as $$
  with identities as (
    select item as value, ordinal
    from jsonb_array_elements(p_payload->'identityChanges') with ordinality as selected(item, ordinal)
    where not coalesce((item->>'canonicalUserId') = any(p_blocked), false)
  ), memberships as (
    select item as value, ordinal
    from jsonb_array_elements(p_payload->'userDepartmentChanges') with ordinality as selected(item, ordinal)
    where not coalesce((item->>'userId') = any(p_blocked), false)
  ), kept_users as (
    select value->>'userId' as id from memberships
    union select value->>'canonicalUserId' from identities
      where value->'createsMember' is distinct from 'true'::jsonb
  ), before_state as (
    select p_payload->'beforeState' || jsonb_build_object(
      'users', coalesce((select jsonb_agg(item order by ordinal)
        from jsonb_array_elements(p_payload->'beforeState'->'users') with ordinality as selected(item, ordinal)
        where item->>'id' in (select id from kept_users)), '[]'::jsonb),
      'memberships', coalesce((select jsonb_agg(item order by ordinal)
        from jsonb_array_elements(p_payload->'beforeState'->'memberships') with ordinality as selected(item, ordinal)
        where item->>'userId' in (select id from kept_users)), '[]'::jsonb),
      'organizationMemberships', coalesce((select jsonb_agg(item order by ordinal)
        from jsonb_array_elements(p_payload->'beforeState'->'organizationMemberships') with ordinality as selected(item, ordinal)
        where item->>'userId' in (select id from kept_users)), '[]'::jsonb)
    ) as state
  )
  select p_payload || jsonb_build_object(
    'identityChanges', coalesce((select jsonb_agg(value order by ordinal) from identities), '[]'::jsonb),
    'userDepartmentChanges', coalesce((select jsonb_agg(value order by ordinal) from memberships), '[]'::jsonb),
    'departmentChanges', case when p_hold_tree then '[]'::jsonb else p_payload->'departmentChanges' end,
    'staleTargetDepartmentIds', case when p_hold_tree then '[]'::jsonb else p_payload->'staleTargetDepartmentIds' end,
    'permissionTreeHeld', p_hold_tree,
    'beforeState', before_state.state
  ) from before_state;
$$;

create function private.fxiaoke_directory_permission_summary_v1(p_payload jsonb, p_projection jsonb)
returns jsonb language sql stable set search_path = '' as $$
  select p_payload->'summary' || jsonb_build_object(
    'departmentsAdded', (select count(*) from jsonb_array_elements(p_payload->'departmentChanges') as item where item->>'kind' = 'added'),
    'departmentsUpdated', (select count(*) from jsonb_array_elements(p_payload->'departmentChanges') as item where item->>'kind' = 'updated'),
    'departmentsUnchanged', (select count(*) from jsonb_array_elements(p_payload->'departmentChanges') as item where item->>'kind' = 'unchanged'),
    'departmentsToDeactivate', jsonb_array_length(coalesce(p_payload->'staleTargetDepartmentIds', '[]'::jsonb)),
    'identitiesAdded', (select count(*) from jsonb_array_elements(p_payload->'identityChanges') as item where item->>'kind' = 'added'),
    'identitiesUpdated', (select count(*) from jsonb_array_elements(p_payload->'identityChanges') as item where item->>'kind' = 'updated'),
    'identitiesUnchanged', (select count(*) from jsonb_array_elements(p_payload->'identityChanges') as item where item->>'kind' = 'unchanged'),
    'membersAdded', (select count(*) from jsonb_array_elements(p_payload->'identityChanges') as item
      where item->'createsMember' = 'true'::jsonb and item->'active' = 'true'::jsonb),
    'membersLinked', (select count(*) from jsonb_array_elements(p_payload->'identityChanges') as item
      where item->'createsMember' is distinct from 'true'::jsonb and item->>'kind' = 'added'
        and item->>'matchMethod' in ('phone', 'manual')),
    'membersMoved', (select count(*) from jsonb_to_recordset(p_projection->'before_links') as old(id uuid, primary_id uuid)
      join jsonb_to_recordset(p_projection->'after_links') as proposed(id uuid, primary_id uuid) using (id)
      join jsonb_to_recordset(p_payload->'userDepartmentChanges') as move("userId" uuid, active boolean) on move."userId" = old.id
      where proposed.primary_id is distinct from old.primary_id and move.active),
    'membersOffboarded', (select count(*) from jsonb_to_recordset(p_payload->'userDepartmentChanges') as change("userId" uuid, active boolean)
      join jsonb_to_recordset(p_payload->'beforeState'->'organizationMemberships') as old("userId" uuid, "employmentStatus" text)
        on old."userId" = change."userId"
      where not change.active and old."employmentStatus" = 'active'),
    'conflicts', coalesce((p_payload->'summary'->>'conflicts')::integer, 0) + jsonb_array_length(p_payload->'permissionReviews')
  );
$$;

create function private.prepare_fxiaoke_directory_permission_reviews_v1(
  p_org_id uuid, p_source_id uuid, p_payload jsonb
) returns jsonb language plpgsql set search_path = '' as $$
declare
  v_original_projection jsonb := private.directory_transfer_projection_v1(p_org_id, p_payload);
  v_original_impacts jsonb := private.fxiaoke_directory_permission_impact_v1(p_org_id, v_original_projection);
  v_original_choices jsonb := private.fxiaoke_directory_permission_choices_v1(
    p_org_id, p_source_id, p_payload->>'targetExternalTenantId', v_original_impacts
  );
  v_unresolved jsonb;
  v_anchors jsonb;
  v_blocked text[];
  v_tree_hold boolean;
  v_dependencies text[];
  v_selected jsonb;
  v_projection jsonb;
  v_hold_only_impacts jsonb;
  v_selected_impacts jsonb;
  v_selected_choices jsonb;
  v_new_blockers text[];
begin
  select coalesce(jsonb_agg(impact order by impact->>'userId'), '[]'::jsonb) into v_unresolved
  from jsonb_array_elements(v_original_impacts) as impact
  where not exists (select 1 from jsonb_array_elements(v_original_choices) as choice
    where choice->>'userId' = impact->>'userId');
  v_blocked := array(select impact->>'userId' from jsonb_array_elements(v_unresolved) as impact);

  v_tree_hold := false;
  if cardinality(v_blocked) > 0 and v_original_projection->'before_tree' is distinct from v_original_projection->'after_tree' then
    v_hold_only_impacts := private.fxiaoke_directory_permission_impact_v1(p_org_id, jsonb_set(
      v_original_projection, '{after_links}', v_original_projection->'before_links'));
    v_tree_hold := exists (select 1 from jsonb_array_elements(v_hold_only_impacts) as impact
      where (impact->>'userId') = any(v_blocked));
  end if;

  if v_tree_hold then
    v_dependencies := private.fxiaoke_directory_permission_tree_dependencies_v1(v_original_projection);
    -- Independent rows may still be applied while holding the tree. Never
    -- carry a consent computed against a different proposed tree to them.
    v_blocked := array(
      select unnest(v_blocked)
      union select impact->>'userId' from jsonb_array_elements(v_original_impacts) as impact
      union select change->>'userId' from jsonb_array_elements(p_payload->'userDepartmentChanges') as change
        where (change->'departmentExternalIds') ?| v_dependencies
      union select change->>'canonicalUserId' from jsonb_array_elements(p_payload->'identityChanges') as change
        where (change->'departmentExternalIds') ?| v_dependencies
    );
  end if;

  v_selected := private.fxiaoke_directory_permission_filter_v1(p_payload, v_blocked, v_tree_hold);
  v_projection := private.fxiaoke_directory_permission_projection_v1(p_org_id, v_selected);
  v_selected_impacts := private.fxiaoke_directory_permission_impact_v1(p_org_id, v_projection);
  v_selected_choices := private.fxiaoke_directory_permission_choices_v1(
    p_org_id, p_source_id, p_payload->>'targetExternalTenantId', v_selected_impacts);
  if jsonb_array_length(v_selected_impacts) <> jsonb_array_length(v_selected_choices) then
    -- A held tree can expose a narrower plan than first projected. Freeze
    -- the additional affected rows and keep their review visible.
    select coalesce(jsonb_agg(impact order by impact->>'userId'), '[]'::jsonb) into v_hold_only_impacts
    from jsonb_array_elements(v_selected_impacts) as impact
    where not exists (select 1 from jsonb_array_elements(v_selected_choices) as choice
      where choice->>'userId' = impact->>'userId');
    v_new_blockers := array(select impact->>'userId' from jsonb_array_elements(v_hold_only_impacts) as impact);
    v_unresolved := v_unresolved || v_hold_only_impacts;
    v_selected := private.fxiaoke_directory_permission_filter_v1(p_payload, v_blocked || v_new_blockers, v_tree_hold);
    v_projection := private.fxiaoke_directory_permission_projection_v1(p_org_id, v_selected);
    v_selected_impacts := private.fxiaoke_directory_permission_impact_v1(p_org_id, v_projection);
    v_selected_choices := private.fxiaoke_directory_permission_choices_v1(
      p_org_id, p_source_id, p_payload->>'targetExternalTenantId', v_selected_impacts);
    if jsonb_array_length(v_selected_impacts) <> jsonb_array_length(v_selected_choices) then
      raise exception 'directory permission choices no longer match the proposed changes'
        using errcode = '40001', detail = 'DIRECTORY_PERMISSION_REVIEW_STALE';
    end if;
  end if;

  select coalesce(jsonb_object_agg(impact->>'userId', private.fxiaoke_directory_permission_anchor_v1(
    p_org_id, (impact->>'userId')::uuid)), '{}'::jsonb) into v_anchors
  from jsonb_array_elements(v_unresolved) as impact;

  v_selected := v_selected || jsonb_build_object(
    'permissionReviewVersion', 'fxiaoke-directory-permission-v1',
    'permissionReviews', v_unresolved,
    'permissionReviewAnchors', v_anchors,
    'permissionAppliedChoices', v_selected_choices,
    'applyable', p_payload->'applyable' = 'true'::jsonb and (
      jsonb_array_length(v_unresolved) = 0
      or jsonb_array_length(v_selected->'userDepartmentChanges') > 0
      or exists (select 1 from jsonb_array_elements(v_selected->'identityChanges') as item where item->>'kind' <> 'unchanged')
      or exists (select 1 from jsonb_array_elements(v_selected->'departmentChanges') as item where item->>'kind' <> 'unchanged')
      or jsonb_array_length(coalesce(v_selected->'staleTargetDepartmentIds', '[]'::jsonb)) > 0
    )
  );
  if v_tree_hold then
    v_selected := jsonb_set(v_selected, '{notices}', coalesce(v_selected->'notices', '[]'::jsonb)
      || '["部门结构变更及其依赖项等待人员权限核对。"]'::jsonb);
  end if;
  return jsonb_set(v_selected, '{summary}', private.fxiaoke_directory_permission_summary_v1(v_selected, v_projection));
end;
$$;

create function public.save_fxiaoke_directory_permission_review_v1(
  p_system_org_id uuid, p_plan_id uuid, p_plan_hash text, p_user_id uuid, p_choices jsonb, p_actor_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.organization_directory_cutover_plans%rowtype;
  v_source public.organization_sources%rowtype;
  v_review jsonb;
  v_choices jsonb;
  v_saved private.fxiaoke_directory_permission_reviews%rowtype;
begin
  if p_system_org_id is null or p_plan_id is null or p_user_id is null or p_actor_id is null
    or p_plan_hash is null or p_plan_hash !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_choices) is distinct from 'array' then
    raise exception 'invalid directory permission review input' using errcode = '22023';
  end if;
  if jsonb_array_length(p_choices) not between 1 and 200 or exists (
    select 1 from jsonb_array_elements(p_choices) as choice
    where jsonb_typeof(choice) is distinct from 'object'
      or coalesce(choice->>'permissionCode', '') !~ '^[a-zA-Z0-9_:-]{1,120}$'
      or coalesce(choice->>'choice', '') not in ('new_baseline', 'retain_eligible')
  ) or exists (
    select 1 from jsonb_array_elements(p_choices) as choice
    group by choice->>'permissionCode' having count(*) <> 1
  ) then
    raise exception 'invalid directory permission choices' using errcode = '22023';
  end if;

  select jsonb_agg(jsonb_build_object(
    'permissionCode', item->>'permissionCode', 'choice', item->>'choice'
  ) order by item->>'permissionCode') into v_choices from jsonb_array_elements(p_choices) as item;
  perform private.assert_member_department_transfer_actor_v1(p_system_org_id, p_actor_id);
  select * into v_plan from public.organization_directory_cutover_plans
    where id = p_plan_id and system_org_id = p_system_org_id for update;
  if not found then raise exception 'directory cutover plan not found' using errcode = 'P0002'; end if;
  if v_plan.plan_hash is distinct from p_plan_hash then
    raise exception 'directory permission review plan changed'
      using errcode = '40001', detail = 'DIRECTORY_PERMISSION_REVIEW_STALE';
  end if;

  select * into v_saved from private.fxiaoke_directory_permission_reviews
    where org_id = p_system_org_id and plan_id = p_plan_id and user_id = p_user_id;
  if found then
    if v_saved.choices is distinct from v_choices or v_saved.decided_by is distinct from p_actor_id then
      raise exception 'directory permission review was already recorded'
        using errcode = '40001', detail = 'DIRECTORY_PERMISSION_REVIEW_STALE';
    end if;
    return jsonb_build_object('userId', p_user_id, 'revision', v_saved.revision, 'choices', v_saved.choices,
      'decidedAt', v_saved.decided_at);
  end if;

  if v_plan.status <> 'planned' or v_plan.expires_at <= clock_timestamp()
    or v_plan.plan_payload->>'permissionReviewVersion' is distinct from 'fxiaoke-directory-permission-v1' then
    raise exception 'directory permission review expired'
      using errcode = '40001', detail = 'DIRECTORY_PERMISSION_REVIEW_STALE';
  end if;
  if v_plan.plan_payload #> '{snapshot,scopeVerified}' is distinct from 'true'::jsonb
    or jsonb_typeof(v_plan.plan_payload #> '{snapshot,scopeEvidence}') is distinct from 'string'
    or coalesce(v_plan.plan_payload #>> '{snapshot,scopeEvidence}', '') !~ '[^[:space:]]'
    or v_plan.plan_payload #> '{snapshot,connectionVerified}' is distinct from 'true'::jsonb
    or v_plan.plan_payload #> '{snapshot,complete}' is distinct from 'true'::jsonb
    or v_plan.plan_payload->'conflicts' is distinct from '[]'::jsonb then
    raise exception 'directory permission review scope is unverified'
      using errcode = '23514', detail = 'DIRECTORY_SCOPE_UNVERIFIED';
  end if;

  perform 1 from public.organization_sources where system_org_id = p_system_org_id order by id for update;
  select * into v_source from public.organization_sources
    where id = v_plan.target_source_id and system_org_id = p_system_org_id and provider = 'fxiaoke';
  if not found or v_source.status <> 'active' or v_source.connection_state <> 'verified'
    or v_source.effective_revision is distinct from v_plan.connection_revision
    or v_plan.plan_payload->>'organizationId' is distinct from p_system_org_id::text
    or v_plan.plan_payload->>'targetSourceId' is distinct from v_source.id::text
    or v_plan.plan_payload->>'targetExternalTenantId' is distinct from v_source.external_tenant_id
    or not private.organization_source_revisions_match_v1(p_system_org_id, v_plan.plan_payload->'sourceRevisions') then
    raise exception 'directory permission review source changed'
      using errcode = '40001', detail = 'DIRECTORY_PERMISSION_REVIEW_STALE';
  end if;

  select item into v_review from jsonb_array_elements(v_plan.plan_payload->'permissionReviews') as item
    where item->>'userId' = p_user_id::text;
  if not found or v_plan.plan_payload->'permissionReviewAnchors'->>p_user_id::text is distinct from
    private.fxiaoke_directory_permission_anchor_v1(p_system_org_id, p_user_id) then
    raise exception 'directory permission review facts changed'
      using errcode = '40001', detail = 'DIRECTORY_PERMISSION_REVIEW_STALE';
  end if;
  if jsonb_array_length(v_review->'permissions') <> jsonb_array_length(v_choices) or exists (
    select 1 from jsonb_array_elements(v_choices) as choice
    where not exists (
      select 1 from jsonb_array_elements(v_review->'permissions') as permission
      where permission->>'permissionCode' = choice->>'permissionCode'
        and (choice->>'choice' = 'new_baseline' or permission->'retainable' = 'true'::jsonb)
    )
  ) then
    raise exception 'directory permission review choices are incomplete or unavailable'
      using errcode = '22023', detail = 'DIRECTORY_PERMISSION_REVIEW_REQUIRED';
  end if;

  insert into private.fxiaoke_directory_permission_reviews (
    org_id, source_id, external_tenant_id, plan_id, user_id, revision, choices, decided_by
  ) values (
    p_system_org_id, v_source.id, v_source.external_tenant_id, p_plan_id, p_user_id,
    v_review->>'revision', v_choices, p_actor_id
  ) returning * into v_saved;
  return jsonb_build_object('userId', p_user_id, 'revision', v_saved.revision,
    'choices', v_saved.choices, 'decidedAt', v_saved.decided_at);
end;
$$;

create or replace function public.store_organization_directory_authority_plan_v1(
  p_system_org_id uuid, p_target_source_id uuid, p_connection_revision uuid,
  p_previous_primary_source_id uuid, p_directory_hash text, p_plan_payload jsonb,
  p_actor_id uuid, p_expires_at timestamptz
)
returns setof public.organization_directory_cutover_plans
language plpgsql security definer set search_path = '' as $$
declare
  v_projection jsonb;
  v_changes jsonb := '[]'::jsonb;
  v_payload jsonb := p_plan_payload - 'planHash';
  v_hash text;
begin
  perform private.personnel_lock_org_v1(p_system_org_id);
  if v_payload->'applyable' = 'true'::jsonb then
    if v_payload->>'targetProvider' = 'fxiaoke' then
      v_payload := private.prepare_fxiaoke_directory_permission_reviews_v1(
        p_system_org_id, p_target_source_id, v_payload);
      if v_payload->'applyable' = 'true'::jsonb then
        v_projection := private.fxiaoke_directory_permission_projection_v1(p_system_org_id, v_payload);
      end if;
    else
      v_projection := private.directory_transfer_projection_v1(p_system_org_id, v_payload);
    end if;
    if v_projection is not null then
      v_changes := private.directory_transfer_changes_v1(p_system_org_id, v_projection);
    end if;
  end if;
  v_payload := v_payload || jsonb_build_object('authorityReview',
    private.directory_transfer_commitment_v1(v_projection, v_changes));
  v_hash := private.directory_transfer_digest_v1(v_payload);
  return query select * from public.store_organization_directory_cutover_plan_v1(
    p_system_org_id, p_target_source_id, p_connection_revision, p_previous_primary_source_id,
    p_directory_hash, v_hash, v_payload || jsonb_build_object('planHash', v_hash), p_actor_id, p_expires_at);
end;
$$;

create function private.apply_fxiaoke_directory_permission_choices_v1(
  p_org_id uuid, p_actor_id uuid, p_impacts jsonb, p_choices jsonb
)
returns void language plpgsql set search_path = '' as $$
declare
  v_review record;
  v_choice text;
  v_selected jsonb;
  v_effective_at timestamptz := clock_timestamp();
begin
  for v_review in
    select impact."userId" as user_id, impact.permissions, saved.choices
    from jsonb_to_recordset(p_impacts) as impact("userId" uuid, permissions jsonb)
    join jsonb_to_recordset(p_choices) as saved("userId" uuid, choices jsonb) using ("userId")
  loop
    foreach v_choice in array array['new_baseline', 'retain_eligible'] loop
      select coalesce(jsonb_agg(jsonb_build_object(
        'permission_code', permission->>'permissionCode', 'retainable', permission->'retainable'
      ) order by permission->>'permissionCode'), '[]'::jsonb) into v_selected
      from jsonb_array_elements(v_review.permissions) as permission
      join jsonb_array_elements(v_review.choices) as choice
        on choice->>'permissionCode' = permission->>'permissionCode'
      where choice->>'choice' = v_choice;
      perform private.apply_employee_department_override_choice_v1(
        p_org_id, p_actor_id, v_review.user_id, v_selected, v_choice, v_effective_at);
    end loop;
    perform private.personnel_insert_event_v1(
      p_org_id, v_review.user_id, p_actor_id, 'directory_personal_permission_review',
      jsonb_build_object('permissionPoints', v_review.permissions),
      jsonb_build_object('choices', v_review.choices, 'effectiveAt', v_effective_at),
      'confirmed directory personal permission decisions', null
    );
  end loop;
end;
$$;

create or replace function public.apply_organization_directory_cutover_v1(
  p_system_org_id uuid, p_plan_id uuid, p_plan_hash text, p_connection_revision uuid,
  p_source_revisions jsonb, p_actor_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.organization_directory_cutover_plans%rowtype;
  v_provider text;
  v_had_controller boolean;
  v_projection jsonb;
  v_changes jsonb;
  v_permission_impacts jsonb;
  v_permission_choices jsonb;
  v_result jsonb;
begin
  perform private.personnel_lock_org_v1(p_system_org_id);
  perform 1 from public.organizations where id = p_system_org_id for no key update;
  select * into v_plan from public.organization_directory_cutover_plans
    where id = p_plan_id and system_org_id = p_system_org_id for update;
  if not found then raise exception 'directory cutover plan not found' using errcode = 'P0002'; end if;

  if v_plan.status = 'planned' then
    perform 1 from public.organization_sources
      where system_org_id = p_system_org_id order by id for update;
    select source.provider into v_provider from public.organization_sources as source
      where source.id = v_plan.target_source_id and source.system_org_id = p_system_org_id;
    if not found then raise exception 'directory cutover target source is missing' using errcode = '23514'; end if;
    if v_provider = 'fxiaoke' then
      if v_plan.plan_payload->>'organizationId' is distinct from p_system_org_id::text
        or v_plan.plan_payload->>'targetProvider' is distinct from v_provider then
        raise exception 'directory cutover plan target or organization mismatch' using errcode = '23514';
      end if;
      if v_plan.plan_payload #> '{snapshot,scopeVerified}' is distinct from 'true'::jsonb
        or jsonb_typeof(v_plan.plan_payload #> '{snapshot,scopeEvidence}') is distinct from 'string'
        or coalesce(v_plan.plan_payload #>> '{snapshot,scopeEvidence}', '') !~ '[^[:space:]]' then
        raise exception 'Fxiaoke directory scope is unverified'
          using errcode = '23514', detail = 'DIRECTORY_SCOPE_UNVERIFIED';
      end if;
    end if;
  end if;

  v_had_controller := private.has_effective_system_super_admin_v1(p_system_org_id);
  if v_plan.status = 'planned' and v_plan.plan_payload->'applyable' = 'true'::jsonb then
    if v_provider = 'fxiaoke' then
      if v_plan.plan_payload->>'permissionReviewVersion' is distinct from 'fxiaoke-directory-permission-v1' then
        raise exception 'generate a new directory permission review'
          using errcode = '40001', detail = 'DIRECTORY_PERMISSION_REVIEW_REQUIRED';
      end if;
      perform 1 from private.employee_permission_overrides
        where org_id = p_system_org_id order by user_id, permission_code for update;
      v_projection := private.fxiaoke_directory_permission_projection_v1(p_system_org_id, v_plan.plan_payload);
      v_permission_impacts := private.fxiaoke_directory_permission_impact_v1(p_system_org_id, v_projection);
      v_permission_choices := private.fxiaoke_directory_permission_choices_v1(
        p_system_org_id, v_plan.target_source_id, v_plan.plan_payload->>'targetExternalTenantId', v_permission_impacts);
      if jsonb_array_length(v_permission_impacts) <> jsonb_array_length(v_permission_choices)
        or v_plan.plan_payload->'permissionAppliedChoices' is distinct from v_permission_choices then
        raise exception 'directory personal permissions changed after review'
          using errcode = '40001', detail = 'DIRECTORY_PERMISSION_REVIEW_STALE';
      end if;
    else
      v_projection := private.directory_transfer_projection_v1(p_system_org_id, v_plan.plan_payload);
    end if;

    v_changes := private.directory_transfer_changes_v1(p_system_org_id, v_projection);
    if v_plan.plan_payload->'authorityReview' is distinct from
      private.directory_transfer_commitment_v1(v_projection, v_changes) then
      raise exception 'directory authority changed after preview'
        using errcode = '40001', detail = 'DIRECTORY_AUTHORITY_PREVIEW_STALE';
    end if;
  end if;

  if v_projection is not null then
    if v_provider = 'fxiaoke' then
      select coalesce(jsonb_agg(jsonb_set(change, '{impact,personal_policy}', '"managed"'::jsonb, true)
        order by ordinal), '[]'::jsonb) into v_changes
      from jsonb_array_elements(v_changes) with ordinality as row(change, ordinal);
      perform private.apply_fxiaoke_directory_permission_choices_v1(
        p_system_org_id, p_actor_id, v_permission_impacts, v_permission_choices);
    end if;
    perform private.apply_directory_transfer_review_v1(p_system_org_id, p_actor_id, v_changes);
  end if;
  v_result := private.apply_organization_directory_cutover_v1(
    p_system_org_id, p_plan_id, p_plan_hash, p_connection_revision, p_source_revisions, p_actor_id);
  if v_projection is not null then
    perform private.assert_directory_transfer_projection_v1(p_system_org_id, v_projection);
  end if;
  perform private.assert_system_super_admin_continuity_v1(p_system_org_id, v_had_controller);
  return v_result;
end;
$$;

revoke all on function private.fxiaoke_directory_department_coverage_v1(jsonb, jsonb),
  private.fxiaoke_directory_permission_impact_v1(uuid, jsonb),
  private.fxiaoke_directory_permission_anchor_v1(uuid, uuid),
  private.fxiaoke_directory_permission_choices_v1(uuid, uuid, text, jsonb),
  private.fxiaoke_directory_permission_projection_v1(uuid, jsonb),
  private.fxiaoke_directory_permission_tree_dependencies_v1(jsonb),
  private.fxiaoke_directory_permission_filter_v1(jsonb, text[], boolean),
  private.fxiaoke_directory_permission_summary_v1(jsonb, jsonb),
  private.prepare_fxiaoke_directory_permission_reviews_v1(uuid, uuid, jsonb),
  private.apply_fxiaoke_directory_permission_choices_v1(uuid, uuid, jsonb, jsonb),
  public.save_fxiaoke_directory_permission_review_v1(uuid, uuid, text, uuid, jsonb, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.save_fxiaoke_directory_permission_review_v1(uuid, uuid, text, uuid, jsonb, uuid)
  to service_role;

commit;

begin;

create or replace function private.department_automatic_role_change_impact_v1(
  p_org_id uuid, p_before_ids uuid[], p_after_ids uuid[],
  p_before_tree jsonb default null, p_after_tree jsonb default null
)
returns jsonb language sql stable set search_path = '' as $$
  with recursive before_sources as materialized (
    select * from private.department_automatic_role_sources_for_affiliations_v1(p_org_id, p_before_ids, p_before_tree)
  ), after_sources as materialized (
    select * from private.department_automatic_role_sources_for_affiliations_v1(p_org_id, p_after_ids, p_after_tree)
  ), added as (
    select * from after_sources as source where not exists (
      select 1 from before_sources as previous
      where previous.rule_department_id = source.rule_department_id
        and previous.affiliation_department_id = source.affiliation_department_id and previous.role_id = source.role_id
    )
  ), removed as (
    select * from before_sources as source where not exists (
      select 1 from after_sources as following
      where following.rule_department_id = source.rule_department_id
        and following.affiliation_department_id = source.affiliation_department_id and following.role_id = source.role_id
    )
  ), retained_sources as (
    select previous.*
    from before_sources as previous
    join after_sources using(rule_department_id, affiliation_department_id, role_id)
    where p_before_tree is distinct from p_after_tree
  ), active_tree as (
    select stage.phase, department.id, department.parent_id
    from (values ('before', p_before_tree), ('after', p_after_tree)) as stage(phase, tree)
    join public.departments as department on stage.tree is null and department.org_id = p_org_id and department.status = 'active'
    union all
    select stage.phase, department.id, department.parent_id
    from (values ('before', p_before_tree), ('after', p_after_tree)) as stage(phase, tree)
    cross join jsonb_to_recordset(stage.tree) as department(id uuid, parent_id uuid, status text)
    where department.status = 'active'
  ), retained_roots as (
    select distinct affiliation_department_id as id from retained_sources
  ), department_scope(phase, root_id, department_id) as (
    select department.phase, root.id, root.id
    from retained_roots as root join active_tree as department on department.id = root.id
    union
    select parent.phase, parent.root_id, child.id
    from department_scope as parent
    join active_tree as child on child.phase = parent.phase and child.parent_id = parent.department_id
  ), scope_by_department as (
    select root_id, department_id, bool_or(phase = 'before') as before_visible, bool_or(phase = 'after') as after_visible
    from department_scope
    group by root_id, department_id
  ), scope_changes as (
    select root_id,
      coalesce(array_agg(department_id order by department_id) filter (where after_visible), array[]::uuid[]) as added_department_ids,
      coalesce(array_agg(department_id order by department_id) filter (where before_visible), array[]::uuid[]) as removed_department_ids
    from scope_by_department
    where before_visible is distinct from after_visible
    group by root_id
  )
  select jsonb_build_object(
    'automatic_role_sources_added', coalesce((
      select jsonb_agg(to_jsonb(source) - 'permissions' order by rule_department_id, affiliation_department_id, role_id)
      from added as source
    ), '[]'::jsonb),
    'automatic_role_sources_removed', coalesce((
      select jsonb_agg(to_jsonb(source) - 'permissions' order by rule_department_id, affiliation_department_id, role_id)
      from removed as source
    ), '[]'::jsonb),
    'automatic_role_scope_changes', coalesce((
      select jsonb_agg((to_jsonb(source) - 'permissions') || jsonb_build_object(
        'added_department_ids', change.added_department_ids, 'removed_department_ids', change.removed_department_ids
      ) order by source.rule_department_id, source.affiliation_department_id, source.role_id)
      from retained_sources as source join scope_changes as change on change.root_id = source.affiliation_department_id
    ), '[]'::jsonb),
    'automatic_role_context_revision', encode(sha256(convert_to(jsonb_build_array(
      (select jsonb_agg(to_jsonb(source) order by rule_department_id, affiliation_department_id, role_id)
        from before_sources as source),
      (select jsonb_agg(to_jsonb(source) order by rule_department_id, affiliation_department_id, role_id)
        from after_sources as source)
    )::text, 'UTF8')), 'hex')
  );
$$;

create or replace function private.directory_transfer_changes_v1(p_org_id uuid, p_projection jsonb)
returns jsonb language sql stable set search_path = '' as $$
  with members as (
    select coalesce(previous.id, following.id) as id,
      previous.primary_id as before_primary_id, following.primary_id as after_primary_id,
      private.directory_transfer_ids_v1(previous.primary_id, previous.links) as before_ids,
      private.directory_transfer_ids_v1(following.primary_id, following.links) as after_ids,
      previous.id is not null and following.id is not null
        and (previous.primary_id is distinct from following.primary_id or previous.links is distinct from following.links) as affiliation_changed,
      coalesce(p_projection->'automatic_before_members' ? previous.id::text, false) as before_eligible,
      coalesce(p_projection->'automatic_after_members' ? following.id::text, false) as after_eligible
    from jsonb_to_recordset(p_projection->'before_links') as previous(id uuid, primary_id uuid, links jsonb)
    full join jsonb_to_recordset(p_projection->'after_links') as following(id uuid, primary_id uuid, links jsonb) using(id)
  ), impacts as materialized (
    select members.*, automatic.impact as automatic_impact
    from members
    cross join lateral (
      select private.department_automatic_role_change_impact_v1(p_org_id,
        case when members.before_eligible then members.before_ids else array[]::uuid[] end,
        case when members.after_eligible then members.after_ids else array[]::uuid[] end,
        p_projection->'before_tree', p_projection->'after_tree') as impact
    ) as automatic
    where members.affiliation_changed or members.before_eligible is distinct from members.after_eligible
      or ((members.before_eligible or members.after_eligible) and p_projection->'before_tree' is distinct from p_projection->'after_tree')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'before_primary_id', before_primary_id, 'after_primary_id', after_primary_id,
    'before_ids', before_ids, 'after_ids', after_ids,
    'automatic_only', not affiliation_changed,
    'impact', case when affiliation_changed then
      private.department_change_manual_impact_v1(p_org_id, id, before_ids, after_ids,
        p_projection->'before_tree', p_projection->'after_tree') || automatic_impact
      else automatic_impact end
  ) order by id), '[]'::jsonb)
  from impacts
  where affiliation_changed or jsonb_array_length(automatic_impact->'automatic_role_sources_added') > 0
    or jsonb_array_length(automatic_impact->'automatic_role_sources_removed') > 0
    or jsonb_array_length(automatic_impact->'automatic_role_scope_changes') > 0;
$$;

create or replace function private.directory_transfer_summary_v1(p_changes jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  with changes as (
    select item.automatic_only,
      jsonb_array_length(item.impact->'automatic_role_sources_added') as added_sources,
      jsonb_array_length(item.impact->'automatic_role_sources_removed') as removed_sources,
      exists (select 1 from jsonb_array_elements(item.impact->'automatic_role_scope_changes') as scope(value)
        where jsonb_array_length(scope.value->'added_department_ids') > 0) as scope_widened,
      exists (select 1 from jsonb_array_elements(item.impact->'automatic_role_scope_changes') as scope(value)
        where jsonb_array_length(scope.value->'removed_department_ids') > 0) as scope_narrowed,
      change.value
    from jsonb_array_elements(p_changes) as change(value)
    cross join jsonb_to_record(change.value) as item(automatic_only boolean, impact jsonb)
  )
  select private.directory_transfer_manual_summary_v1(coalesce(jsonb_agg(changes.value)
    filter (where changes.automatic_only is not true), '[]'::jsonb))
    || jsonb_build_object(
      'automaticRoleSourcesAdded', coalesce(sum(added_sources), 0),
      'automaticRoleSourcesRemoved', coalesce(sum(removed_sources), 0),
      'automaticRoleScopeWidenedMembers', count(*) filter (where scope_widened),
      'automaticRoleScopeNarrowedMembers', count(*) filter (where scope_narrowed),
      'automaticRoleAffectedMembers', count(*) filter (
        where added_sources > 0 or removed_sources > 0 or scope_widened or scope_narrowed)
    )
  from changes;
$$;

create function private.directory_department_authority_impact_v1(p_org_id uuid, p_before_tree jsonb, p_after_tree jsonb)
returns jsonb language sql stable set search_path = '' as $$
  with current_affiliations as (
    select private.directory_transfer_links_v1(p_org_id) as links,
      private.directory_automatic_role_eligibility_v1(p_org_id, '{}'::jsonb, false) as eligibility
  ), snapshot as (
    select jsonb_build_object(
      'before_tree', p_before_tree, 'after_tree', p_after_tree, 'before_links', links, 'after_links', links
    ) || eligibility as projection
    from current_affiliations
  )
  select private.directory_transfer_commitment_v1(projection, private.directory_transfer_changes_v1(p_org_id, projection))
  from snapshot;
$$;

create or replace function private.apply_directory_transfer_review_v1(p_org_id uuid, p_actor_id uuid, p_changes jsonb)
returns void language plpgsql set search_path = '' as $$
declare
  v_change record;
  v_effective_at timestamptz := now();
begin
  for v_change in
    select * from jsonb_to_recordset(p_changes) as item(id uuid, impact jsonb, automatic_only boolean)
  loop
    if v_change.automatic_only is not true then
      perform private.apply_department_change_impact_v1(p_org_id, p_actor_id, v_change.id, v_change.impact, v_effective_at);
    end if;
    if jsonb_array_length(v_change.impact->'automatic_role_sources_added') > 0
      or jsonb_array_length(v_change.impact->'automatic_role_sources_removed') > 0
      or jsonb_array_length(v_change.impact->'automatic_role_scope_changes') > 0 then
      perform private.personnel_insert_event_v1(
        p_org_id, v_change.id, p_actor_id, 'directory_department_automatic_roles',
        jsonb_build_object('ended_sources', v_change.impact->'automatic_role_sources_removed'),
        jsonb_build_object('added_sources', v_change.impact->'automatic_role_sources_added',
          'scope_changes', v_change.impact->'automatic_role_scope_changes', 'effective_at', v_effective_at),
        'confirmed directory authorization change', null
      );
    end if;
  end loop;
end;
$$;

revoke all on function private.directory_department_authority_impact_v1(uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;

commit;

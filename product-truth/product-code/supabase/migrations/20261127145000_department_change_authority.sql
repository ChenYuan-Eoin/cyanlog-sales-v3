-- Reconcile authorization tied to a changed department relationship. Existing
-- department grants are evaluated from the canonical current memberships.
begin;

create table private.department_transfer_review_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  actor_id uuid not null,
  effective_at timestamptz not null,
  kind text not null check (kind in ('role', 'retained_role', 'personal_override', 'pending_role', 'department_lead', 'space_membership')),
  previous_grant jsonb not null check (jsonb_typeof(previous_grant) = 'object'),
  foreign key (user_id, org_id) references public.user_organizations(user_id, org_id) on delete cascade
);
alter table private.department_transfer_review_items enable row level security;
revoke all on table private.department_transfer_review_items from public, anon, authenticated, service_role;
create index department_transfer_review_items_member
  on private.department_transfer_review_items(org_id, user_id, effective_at desc);

create function private.department_transfer_affiliations_v1(
  p_org_id uuid, p_user_id uuid, p_previous_department_id uuid, p_department_id uuid, p_keep_previous boolean
)
returns table(before_ids uuid[], after_ids uuid[])
language sql stable set search_path = '' as $$
  with before_links as (
    select membership.department_id
    from public.user_departments as membership
    where membership.org_id = p_org_id and membership.user_id = p_user_id
    union
    select p_previous_department_id where p_previous_department_id is not null
  ), after_links as (
    select department_id from before_links
    where coalesce(p_keep_previous, false) or department_id is distinct from p_previous_department_id
    union
    select p_department_id where p_department_id is not null
  )
  select array(select department_id from before_links order by department_id),
    array(select department_id from after_links order by department_id);
$$;

create function private.department_change_impact_v1(
  p_org_id uuid, p_user_id uuid, p_before_ids uuid[], p_after_ids uuid[],
  p_before_tree jsonb default null, p_after_tree jsonb default null
)
returns jsonb
language sql stable set search_path = '' as $$
  with recursive department_tree as (
    select stages.phase, live.id, live.parent_id, live.status, live.leader_id
    from (values ('before', p_before_tree), ('after', p_after_tree)) as stages(phase, state)
    join public.departments as live on live.org_id = p_org_id and stages.state is null
    union all
    select stages.phase, snapshot.id, snapshot.parent_id, snapshot.status, snapshot.leader_id
    from (values ('before', p_before_tree), ('after', p_after_tree)) as stages(phase, state)
    cross join lateral jsonb_to_recordset(stages.state) as snapshot(id uuid, parent_id uuid, status text, leader_id uuid)
  ), direct_membership as (
    select phase, id from department_tree
    where id = any(case when phase = 'before' then p_before_ids else p_after_ids end)
  ), ancestors as (
    select phase, id from direct_membership
    union
    select branch.phase, department.parent_id
    from ancestors as branch join department_tree as department on department.phase = branch.phase and department.id = branch.id
    where department.parent_id is not null
  ), descendants as (
    select phase, id from direct_membership
    union
    select branch.phase, child.id from descendants as branch
    join department_tree as child on child.phase = branch.phase and child.parent_id = branch.id
  ), related_departments as (
    select phase, id from ancestors
    union
    select phase, id from descendants
  ), lost as (
    (
      select id from descendants where phase = 'before'
      except
      select id from descendants where phase = 'after'
    )
    union
    (
      select id from related_departments where phase = 'before'
      except
      select id from related_departments where phase = 'after'
    )
  ), lost_spaces as (
    select space.id, space.name, space.department_id
    from public.sales_spaces as space
    join lost on lost.id = space.department_id
    where space.org_id = p_org_id
  ), role_rows as (
    select binding.role_id, role.name as role_name, binding.scope_type, binding.scope_id,
      binding.granted_at, binding.granted_by, role.permissions,
      organization.settings->'role_permission_overrides'->binding.role_id::text as effective_override,
      role.code in ('SUPER_ADMIN', 'ORG_SUPER_ADMIN') as protected_role,
      role.code not in ('SUPER_ADMIN', 'ORG_SUPER_ADMIN') and (
        (binding.scope_type = 'department' and exists (select 1 from lost where lost.id = binding.scope_id))
        or (binding.scope_type = 'space' and exists (select 1 from lost_spaces as space where space.id = binding.scope_id))
      ) as suspend
    from public.user_roles as binding
    join public.roles as role on role.id = binding.role_id
    join public.organizations as organization on organization.id = binding.org_id
    where binding.org_id = p_org_id and binding.user_id = p_user_id
  ), override_rows as (
    select exception.permission_code, exception.effect, exception.scope, exception.updated_at,
      exception.pending_target_revision,
      case when exception.effect = 'ALLOW' then 'blocked_pending_review' else 'deny_retained' end as resolution
    from private.employee_permission_overrides as exception
    where exception.org_id = p_org_id and exception.user_id = p_user_id
  ), pending_rows as (
    select binding.role_id, role.name as role_name, binding.granted_at, binding.granted_by, role.permissions,
      organization.settings->'role_permission_overrides'->binding.role_id::text as effective_override,
      role.code not in ('SUPER_ADMIN', 'ORG_SUPER_ADMIN') as suspend
    from public.fxiaoke_pending_org_roles as binding
    join public.roles as role on role.id = binding.role_id
    join public.organizations as organization on organization.id = binding.org_id
    where binding.org_id = p_org_id and binding.user_id = p_user_id
  ), lead_rows as (
    select lead.department_id, lead.confirmed_at, lead.confirmed_by, lost.id is not null as suspend
    from public.department_lead_access as lead left join lost on lost.id = lead.department_id
    where lead.org_id = p_org_id and lead.user_id = p_user_id
  ), space_rows as (
    select space.id as space_id, space.name as space_name, space.department_id,
      membership.space_role, membership.joined_at
    from public.sales_space_members as membership
    join lost_spaces as space on space.id = membership.space_id
    where membership.org_id = p_org_id and membership.user_id = p_user_id
  ), baseline_memberships as (
    select phase, id from direct_membership
    union
    select department.phase, department.id
    from lead_rows as lead
    join department_tree as department on department.id = lead.department_id and department.leader_id = p_user_id
    where department.phase = 'before' or not lead.suspend
  ), baseline as (
    select membership.phase, department.id,
      (grant_state.value->'include_subdepartments') = 'true'::jsonb as include_children
    from baseline_memberships as membership
    join department_tree as department on department.phase = membership.phase
      and department.id = membership.id and department.status = 'active'
    join public.organizations as organization on organization.id = p_org_id and organization.status = 'active'
    cross join lateral (
      select organization.settings->'department_permission_grants'->department.id::text as value
    ) as grant_state
    where grant_state.value->'permissions' = '["shipping:ledger_view"]'::jsonb
      and jsonb_typeof(grant_state.value->'include_subdepartments') = 'boolean'
      and exists (select 1 from private.shipping_role_scope_catalog_v1()
        where code = 'shipping:ledger_view' and 'department' = any(supported_scope_types))
    union
    select parent.phase, child.id, true from baseline as parent
    join department_tree as child on child.phase = parent.phase
      and child.parent_id = parent.id and child.status = 'active'
    where parent.include_children
  ), effects as (
    select
      array(select distinct id from baseline where phase = 'before' order by id) as before_department_ids,
      array(select distinct id from baseline where phase = 'after' order by id) as after_department_ids
  )
  select jsonb_build_object(
    'lost_department_ids', array(select id from lost order by id),
    'retained_department_ids', p_after_ids,
    'roles_for_review', coalesce((select jsonb_agg(
      jsonb_build_object('role_id', role_id, 'role_name', role_name, 'scope_type', scope_type, 'scope_id', scope_id)
      order by role_id, scope_type, scope_id) from role_rows where suspend), '[]'::jsonb),
    'retained_roles_for_review', coalesce((select jsonb_agg(
      jsonb_build_object('role_id', role_id, 'role_name', role_name, 'scope_type', scope_type, 'scope_id', scope_id)
      order by role_id, scope_type, scope_id) from role_rows where not suspend and not protected_role), '[]'::jsonb),
    'overrides_for_review', coalesce((select jsonb_agg(
      jsonb_build_object('permission_code', permission_code, 'effect', effect, 'scope', scope, 'resolution', resolution)
      order by permission_code) from override_rows), '[]'::jsonb),
    'pending_roles_for_review', coalesce((select jsonb_agg(jsonb_build_object('role_id', role_id, 'role_name', role_name)
      order by role_id) from pending_rows where suspend), '[]'::jsonb),
    'lead_departments_for_review', array(select department_id from lead_rows where suspend order by department_id),
    'spaces_for_review', coalesce((select jsonb_agg(jsonb_build_object('space_id', space_id, 'space_name', space_name,
      'department_id', department_id, 'space_role', space_role) order by space_id) from space_rows), '[]'::jsonb),
    'baseline_permission_changes', coalesce((select jsonb_agg(
      jsonb_build_object('permission_code', 'shipping:ledger_view', 'before_department_ids', before_department_ids,
        'after_department_ids', after_department_ids))
      from effects where before_department_ids is distinct from after_department_ids), '[]'::jsonb),
    'context_revision', encode(sha256(convert_to(jsonb_build_array(
      p_before_ids, p_after_ids,
      (select jsonb_agg(to_jsonb(row_state) order by role_id, scope_type, scope_id) from role_rows as row_state),
      (select jsonb_agg(to_jsonb(row_state) order by permission_code) from override_rows as row_state),
      (select jsonb_agg(to_jsonb(row_state) order by role_id) from pending_rows as row_state),
      (select jsonb_agg(to_jsonb(row_state) order by department_id) from lead_rows as row_state),
      (select jsonb_agg(to_jsonb(row_state) order by space_id) from space_rows as row_state),
      (select to_jsonb(effects) from effects)
    )::text, 'UTF8')), 'hex')
  );
$$;

create function private.department_transfer_impact_v1(
  p_org_id uuid, p_user_id uuid, p_previous_department_id uuid, p_department_id uuid, p_keep_previous boolean
)
returns jsonb
language sql stable set search_path = '' as $$
  select private.department_change_impact_v1(p_org_id, p_user_id, changes.before_ids, changes.after_ids)
      || jsonb_build_object('previous_department_id', p_previous_department_id, 'department_id', p_department_id,
        'keep_previous', p_keep_previous)
  from private.department_transfer_affiliations_v1(
    p_org_id, p_user_id, p_previous_department_id, p_department_id, p_keep_previous
  ) as changes;
$$;

create function private.apply_department_change_impact_v1(
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
  ), block_personal_allow as (
    -- An ALLOW also replaces its data scope and can be narrower than the base
    -- grant. Suspending it must not accidentally enable that broader grant.
    update private.employee_permission_overrides as exception
    set effect = 'DENY', scope = null, updated_by = p_actor_id, updated_at = p_effective_at
    where exception.org_id = p_org_id and exception.user_id = p_user_id and exception.effect = 'ALLOW'
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

create function private.reconcile_department_transfer_v1(
  p_org_id uuid, p_actor_id uuid, p_user_id uuid, p_previous_department_id uuid, p_department_id uuid,
  p_keep_previous boolean, p_effective_at timestamptz
)
returns void
language sql set search_path = '' as $$
  select private.apply_department_change_impact_v1(p_org_id, p_actor_id, p_user_id,
    private.department_transfer_impact_v1(p_org_id, p_user_id, p_previous_department_id, p_department_id, p_keep_previous),
    p_effective_at);
$$;

revoke all on function private.department_transfer_affiliations_v1(uuid, uuid, uuid, uuid, boolean),
  private.department_change_impact_v1(uuid, uuid, uuid[], uuid[], jsonb, jsonb),
  private.department_transfer_impact_v1(uuid, uuid, uuid, uuid, boolean),
  private.apply_department_change_impact_v1(uuid, uuid, uuid, jsonb, timestamptz),
  private.reconcile_department_transfer_v1(uuid, uuid, uuid, uuid, uuid, boolean, timestamptz)
  from public, anon, authenticated, service_role;

commit;

-- Restrict directory authorization changes to the relationships and effects
-- covered by the same immutable plan for either provider.
begin;

create function private.directory_transfer_tree_v1(p_org_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'parent_id', parent_id, 'status', status, 'leader_id', leader_id,
    'source', source, 'external_id', external_id
  ) order by id), '[]'::jsonb)
  from public.departments where org_id = p_org_id;
$$;

create function private.directory_transfer_links_v1(p_org_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', membership.user_id, 'primary_id', membership.primary_department_id,
    'links', coalesce(link_snapshot.links, '[]'::jsonb)
  ) order by membership.user_id), '[]'::jsonb)
  from public.user_organizations as membership
  left join lateral (
    select jsonb_agg(jsonb_build_object('id', link.department_id, 'source', link.source)
      order by link.department_id) as links
    from public.user_departments as link
    where link.user_id = membership.user_id and link.org_id = p_org_id
  ) as link_snapshot on true
  where membership.org_id = p_org_id and membership.left_at is null
    and membership.status in ('active','invited','suspended');
$$;

create function private.directory_transfer_projection_v1(p_org_id uuid, p_payload jsonb)
returns jsonb language sql stable set search_path = '' as $$
  with current_tree as (
    select department.* from jsonb_to_recordset(private.directory_transfer_tree_v1(p_org_id))
      as department(id uuid, parent_id uuid, status text, leader_id uuid, source text, external_id text)
  ), proposal as (
    select item."externalId" as external_id, item."parentExternalId" as parent_external_id,
      item.status, coalesce(item."existingDepartmentId", substr(encode(sha256(convert_to(
        jsonb_build_array(p_org_id, p_payload->>'targetSourceId', item."externalId")::text, 'UTF8')), 'hex'), 1, 32)::uuid) as id
    from jsonb_to_recordset(p_payload->'departmentChanges')
      as item("externalId" text, "existingDepartmentId" uuid, "parentExternalId" text, status text)
  ), current_links as (
    select * from jsonb_to_recordset(private.directory_transfer_links_v1(p_org_id))
      as member(id uuid, primary_id uuid, links jsonb)
  ), changes as (
    select item."userId" as user_id, item."primaryDepartmentExternalId" as primary_external_id,
      item."departmentExternalIds" as department_external_ids
    from jsonb_to_recordset(p_payload->'userDepartmentChanges')
      as item("userId" uuid, "primaryDepartmentExternalId" text, "departmentExternalIds" jsonb)
  ), next_tree as (
    select live.id, live.parent_id,
      case when p_payload->'staleTargetDepartmentIds' ? live.id::text then 'inactive' else live.status end as status,
      live.leader_id, live.source, live.external_id
    from current_tree as live where not exists (select 1 from proposal where id = live.id)
    union all
    select proposal.id, parent.id, proposal.status, live.leader_id, p_payload->>'targetProvider', proposal.external_id
    from proposal left join proposal as parent on parent.external_id = proposal.parent_external_id
    left join current_tree as live on live.id = proposal.id
  ), next_links as (
    select member.id, case when change.user_id is null then member.primary_id else primary_department.id end as primary_id,
      coalesce(merged.links, '[]'::jsonb) as links
    from current_links as member
    left join changes as change on change.user_id = member.id
    left join proposal as primary_department on primary_department.external_id = change.primary_external_id
    left join lateral (
      select jsonb_agg(jsonb_build_object('id', id, 'source', source) order by id) as links
      from (
        select old.id, old.source
        from jsonb_to_recordset(member.links) as old(id uuid, source text)
        left join current_tree as department on department.id = old.id
        where change.user_id is null
          or old.source is distinct from p_payload->>'targetProvider'
          or department.source is distinct from p_payload->>'targetProvider'
          or department.external_id is null
          or change.department_external_ids ? department.external_id
        union all
        select incoming.id, p_payload->>'targetProvider'
        from proposal as incoming
        where change.department_external_ids ? incoming.external_id
          and not exists (select 1 from jsonb_to_recordset(member.links) as old(id uuid) where old.id = incoming.id)
      ) as kept
    ) as merged on true
  )
  select jsonb_build_object(
    'before_tree', coalesce((select jsonb_agg(to_jsonb(department) order by id) from current_tree as department), '[]'::jsonb),
    'after_tree', coalesce((select jsonb_agg(to_jsonb(department) order by id) from next_tree as department), '[]'::jsonb),
    'before_links', coalesce((select jsonb_agg(to_jsonb(member) order by id) from current_links as member), '[]'::jsonb),
    'after_links', coalesce((select jsonb_agg(to_jsonb(member) order by id) from next_links as member), '[]'::jsonb)
  );
$$;

create function private.directory_transfer_ids_v1(p_primary_id uuid, p_links jsonb)
returns uuid[] language sql immutable set search_path = '' as $$
  select array(select id from (
    select item.id from jsonb_to_recordset(p_links) as item(id uuid)
    union select p_primary_id where p_primary_id is not null
  ) as affiliations order by id);
$$;

create function private.directory_transfer_changes_v1(p_org_id uuid, p_projection jsonb)
returns jsonb language sql stable set search_path = '' as $$
  with members as (
    select previous.id, previous.primary_id as before_primary_id, following.primary_id as after_primary_id,
      private.directory_transfer_ids_v1(previous.primary_id, previous.links) as before_ids,
      private.directory_transfer_ids_v1(following.primary_id, following.links) as after_ids
    from jsonb_to_recordset(p_projection->'before_links') as previous(id uuid, primary_id uuid, links jsonb)
    join jsonb_to_recordset(p_projection->'after_links') as following(id uuid, primary_id uuid, links jsonb) using(id)
    where previous.primary_id is distinct from following.primary_id or previous.links is distinct from following.links
  )
  select coalesce(jsonb_agg(to_jsonb(members) || jsonb_build_object(
    'impact', private.department_change_impact_v1(p_org_id, members.id, before_ids, after_ids,
      p_projection->'before_tree', p_projection->'after_tree')
  ) order by members.id), '[]'::jsonb) from members;
$$;

create function private.directory_transfer_summary_v1(p_changes jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'members', count(*), 'baselineChanges', count(*) filter (
      where jsonb_array_length(change.value->'impact'->'baseline_permission_changes') > 0
    ),
    'rolesForReview', coalesce(sum(jsonb_array_length(change.value->'impact'->'roles_for_review')
      + jsonb_array_length(change.value->'impact'->'retained_roles_for_review')
      + jsonb_array_length(change.value->'impact'->'pending_roles_for_review')), 0),
    'scopesForReview', coalesce(sum(jsonb_array_length(change.value->'impact'->'spaces_for_review')
      + jsonb_array_length(change.value->'impact'->'lead_departments_for_review')), 0),
    'personalExceptions', coalesce(sum(jsonb_array_length(change.value->'impact'->'overrides_for_review')), 0)
  ) from jsonb_array_elements(p_changes) as change(value);
$$;

create function private.directory_transfer_digest_v1(p_value jsonb)
returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(p_value::text, 'UTF8')), 'hex');
$$;

create function private.directory_transfer_commitment_v1(p_projection jsonb, p_changes jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('revision', private.directory_transfer_digest_v1(jsonb_build_array(p_projection, p_changes)),
    'summary', private.directory_transfer_summary_v1(p_changes));
$$;

create function private.assert_directory_transfer_projection_v1(p_org_id uuid, p_projection jsonb)
returns void language plpgsql set search_path = '' as $$
declare
  v_expected_tree jsonb := p_projection->'after_tree';
  v_expected_links jsonb := p_projection->'after_links';
  v_current_tree jsonb := private.directory_transfer_tree_v1(p_org_id);
  v_current_links jsonb := private.directory_transfer_links_v1(p_org_id);
  v_normalized_tree jsonb;
  v_normalized_links jsonb;
begin
  with planned as (
    select * from jsonb_to_recordset(v_expected_tree) as row_state(id uuid, source text, external_id text)
  ), actual as (
    select * from jsonb_to_recordset(v_current_tree)
      as row_state(id uuid, parent_id uuid, status text, leader_id uuid, source text, external_id text)
  ), aliases as (
    select actual.id as actual_id, planned.id as planned_id
    from actual join planned on actual.id = planned.id
      or (actual.source = planned.source and actual.external_id = planned.external_id)
  ), normalized_tree as (
    select mapped.planned_id as id, parent.planned_id as parent_id, actual.status, actual.leader_id, actual.source,
      actual.external_id
    from actual join aliases as mapped on mapped.actual_id = actual.id
    left join aliases as parent on parent.actual_id = actual.parent_id
  ), normalized_links as (
    select actual.id, primary_department.planned_id as primary_id, normalized.links
    from jsonb_to_recordset(v_current_links) as actual(id uuid, primary_id uuid, links jsonb)
    join jsonb_to_recordset(v_expected_links) as planned(id uuid) using(id)
    left join aliases as primary_department on primary_department.actual_id = actual.primary_id
    cross join lateral (
      select coalesce(jsonb_agg(jsonb_build_object('id', mapped.planned_id, 'source', link.source)
        order by mapped.planned_id), '[]'::jsonb) as links
      from jsonb_to_recordset(actual.links) as link(id uuid, source text)
      left join aliases as mapped on mapped.actual_id = link.id
    ) as normalized
  )
  select coalesce((select jsonb_agg(to_jsonb(branch) order by id) from normalized_tree branch), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(member) order by id) from normalized_links member), '[]'::jsonb)
  into v_normalized_tree, v_normalized_links;

  if v_normalized_links is distinct from v_expected_links or v_normalized_tree is distinct from v_expected_tree
    or jsonb_array_length(v_current_tree) <> jsonb_array_length(v_expected_tree) then
    raise exception 'directory relationships changed from the authority preview'
      using errcode = '40001', detail = 'DIRECTORY_AUTHORITY_PROJECTION_CHANGED';
  end if;
end;
$$;

create function private.apply_directory_transfer_review_v1(p_org_id uuid, p_actor_id uuid, p_changes jsonb)
returns void language plpgsql set search_path = '' as $$
declare
  v_change record;
  v_effective_at timestamptz := now();
begin
  for v_change in select * from jsonb_to_recordset(p_changes) as item(id uuid, impact jsonb) loop
    perform private.apply_department_change_impact_v1(p_org_id, p_actor_id, v_change.id, v_change.impact, v_effective_at);
  end loop;
end;
$$;

create function public.store_organization_directory_authority_plan_v1(
  p_system_org_id uuid, p_target_source_id uuid, p_connection_revision uuid,
  p_previous_primary_source_id uuid, p_directory_hash text, p_plan_payload jsonb,
  p_actor_id uuid, p_expires_at timestamptz
)
returns setof public.organization_directory_cutover_plans
language plpgsql security definer set search_path = '' as $$
declare
  v_projection jsonb;
  v_changes jsonb := '[]'::jsonb;
  v_payload jsonb;
  v_hash text;
begin
  perform private.personnel_lock_org_v1(p_system_org_id);
  if p_plan_payload->'applyable' = 'true'::jsonb then
    v_projection := private.directory_transfer_projection_v1(p_system_org_id, p_plan_payload);
    v_changes := private.directory_transfer_changes_v1(p_system_org_id, v_projection);
  end if;
  v_payload := (p_plan_payload - 'planHash') || jsonb_build_object(
    'authorityReview', private.directory_transfer_commitment_v1(v_projection, v_changes));
  v_hash := private.directory_transfer_digest_v1(v_payload);
  return query select * from public.store_organization_directory_cutover_plan_v1(
    p_system_org_id, p_target_source_id, p_connection_revision, p_previous_primary_source_id,
    p_directory_hash, v_hash, v_payload || jsonb_build_object('planHash', v_hash), p_actor_id, p_expires_at);
end;
$$;

create or replace function public.apply_organization_directory_cutover_v1(
  p_system_org_id uuid, p_plan_id uuid, p_plan_hash text, p_connection_revision uuid,
  p_source_revisions jsonb, p_actor_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.organization_directory_cutover_plans%rowtype;
  v_had_controller boolean;
  v_projection jsonb;
  v_changes jsonb;
  v_result jsonb;
begin
  perform private.personnel_lock_org_v1(p_system_org_id);
  perform 1 from public.organizations where id = p_system_org_id for no key update;
  select * into v_plan from public.organization_directory_cutover_plans
    where id = p_plan_id and system_org_id = p_system_org_id for update;
  if not found then raise exception 'directory cutover plan not found' using errcode = 'P0002'; end if;
  v_had_controller := private.has_effective_system_super_admin_v1(p_system_org_id);
  if v_plan.status = 'planned' and v_plan.plan_payload->'applyable' = 'true'::jsonb then
    v_projection := private.directory_transfer_projection_v1(p_system_org_id, v_plan.plan_payload);
    v_changes := private.directory_transfer_changes_v1(p_system_org_id, v_projection);
    if v_plan.plan_payload->'authorityReview' is distinct from
      private.directory_transfer_commitment_v1(v_projection, v_changes) then
      raise exception 'directory authority changed after preview'
        using errcode = '40001', detail = 'DIRECTORY_AUTHORITY_PREVIEW_STALE';
    end if;
  end if;
  if v_projection is not null then
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

create function private.directory_rollback_projection_v1(p_org_id uuid, p_payload jsonb)
returns jsonb language sql stable set search_path = '' as $$
  with current_tree as (
    select department.* from jsonb_to_recordset(private.directory_transfer_tree_v1(p_org_id))
      as department(id uuid, parent_id uuid, status text, leader_id uuid, source text, external_id text)
  ), current_links as (
    select * from jsonb_to_recordset(private.directory_transfer_links_v1(p_org_id))
      as member(id uuid, primary_id uuid, links jsonb)
  ), affected as (
    select item."userId" as user_id from jsonb_to_recordset(p_payload->'userDepartmentChanges') as item("userId" uuid)
  ), restored_tree as (
    select * from current_tree where source is distinct from p_payload->>'targetProvider'
    union all
    select previous.id, previous."parentId", previous.status, live.leader_id, previous.source, previous."externalId"
    from jsonb_to_recordset(p_payload->'beforeState'->'targetDepartments')
      as previous(id uuid, "parentId" uuid, status text, source text, "externalId" text)
    left join current_tree as live using(id)
  ), restored_links as (
    select current.* from current_links as current where not exists (
      select 1 from affected where user_id = current.id
    )
    union all
    select previous."userId", previous."primaryDepartmentId", coalesce(restored.links, '[]'::jsonb)
    from jsonb_to_recordset(p_payload->'beforeState'->'organizationMemberships')
      as previous("userId" uuid, "primaryDepartmentId" uuid)
    join affected on affected.user_id = previous."userId"
    cross join lateral (
      select jsonb_agg(jsonb_build_object('id', link."departmentId", 'source', coalesce(link.source, 'manual'))
        order by link."departmentId") as links
      from jsonb_to_recordset(p_payload->'beforeState'->'memberships')
        as link("userId" uuid, "departmentId" uuid, source text)
      where link."userId" = previous."userId"
    ) as restored
  )
  select jsonb_build_object(
    'before_tree', coalesce((select jsonb_agg(to_jsonb(department) order by id) from current_tree as department), '[]'::jsonb),
    'after_tree', coalesce((select jsonb_agg(to_jsonb(department) order by id) from restored_tree as department), '[]'::jsonb),
    'before_links', coalesce((select jsonb_agg(to_jsonb(member) order by id) from current_links as member), '[]'::jsonb),
    'after_links', coalesce((select jsonb_agg(to_jsonb(member) order by id) from restored_links as member), '[]'::jsonb)
  );
$$;

create table private.directory_rollback_previews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid not null references public.organization_directory_cutover_plans(id) on delete cascade,
  actor_id uuid not null,
  revision text not null,
  expires_at timestamptz not null,
  confirmed_at timestamptz
);
alter table private.directory_rollback_previews enable row level security;
revoke all on table private.directory_rollback_previews from public, anon, authenticated, service_role;
create index directory_rollback_previews_org_expiry on private.directory_rollback_previews(org_id, expires_at);

create function public.preview_organization_directory_rollback_v1(p_system_org_id uuid, p_plan_id uuid, p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.organization_directory_cutover_plans%rowtype;
  v_run public.organization_directory_cutover_runs%rowtype;
  v_preview private.directory_rollback_previews%rowtype;
  v_projection jsonb;
  v_changes jsonb;
begin
  perform private.personnel_lock_org_v1(p_system_org_id);
  select * into v_plan from public.organization_directory_cutover_plans
    where id = p_plan_id and system_org_id = p_system_org_id and status = 'applied';
  if not found then raise exception 'directory cutover plan not found' using errcode = 'P0002'; end if;
  select * into v_run from public.organization_directory_cutover_runs
    where plan_id = v_plan.id and system_org_id = p_system_org_id and status = 'applied';
  if not found then raise exception 'directory cutover run not found' using errcode = 'P0002'; end if;
  if not private.organization_directory_state_matches_v1(p_system_org_id, v_plan.target_source_id, v_run.after_state) then
    raise exception 'directory state changed since run' using errcode = '40001', detail = 'DIRECTORY_ROLLBACK_PREVIEW_STALE';
  end if;
  v_projection := private.directory_rollback_projection_v1(p_system_org_id, v_plan.plan_payload);
  v_changes := private.directory_transfer_changes_v1(p_system_org_id, v_projection);
  delete from private.directory_rollback_previews where org_id = p_system_org_id and expires_at < now();
  insert into private.directory_rollback_previews(org_id, plan_id, actor_id, revision, expires_at)
  values (p_system_org_id, v_plan.id, p_actor_id,
    private.directory_transfer_commitment_v1(v_projection, v_changes)->>'revision', now() + interval '10 minutes')
  returning * into v_preview;
  return jsonb_build_object('previewId', v_preview.id, 'expiresAt', v_preview.expires_at,
    'summary', private.directory_transfer_summary_v1(v_changes));
end;
$$;

create function public.confirm_organization_directory_rollback_v1(
  p_system_org_id uuid, p_plan_id uuid, p_actor_id uuid, p_preview_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.organization_directory_cutover_plans%rowtype;
  v_preview private.directory_rollback_previews%rowtype;
  v_had_controller boolean;
  v_projection jsonb;
  v_changes jsonb;
  v_result jsonb;
begin
  perform private.personnel_lock_org_v1(p_system_org_id);
  perform 1 from public.organizations where id = p_system_org_id for no key update;
  select * into v_preview from private.directory_rollback_previews
    where id = p_preview_id and org_id = p_system_org_id and plan_id = p_plan_id and actor_id = p_actor_id for update;
  if not found or v_preview.expires_at <= now() then
    raise exception 'directory rollback preview expired' using errcode = '40001', detail = 'DIRECTORY_ROLLBACK_PREVIEW_STALE';
  end if;
  if v_preview.confirmed_at is not null then
    return private.rollback_organization_directory_cutover_v1(p_system_org_id, p_plan_id, p_actor_id);
  end if;
  select * into v_plan from public.organization_directory_cutover_plans
    where id = p_plan_id and system_org_id = p_system_org_id and status = 'applied' for update;
  if not found then raise exception 'directory cutover plan not found' using errcode = 'P0002'; end if;
  v_projection := private.directory_rollback_projection_v1(p_system_org_id, v_plan.plan_payload);
  v_changes := private.directory_transfer_changes_v1(p_system_org_id, v_projection);
  if v_preview.revision is distinct from private.directory_transfer_commitment_v1(v_projection, v_changes)->>'revision' then
    raise exception 'directory authority changed after rollback preview'
      using errcode = '40001', detail = 'DIRECTORY_ROLLBACK_PREVIEW_STALE';
  end if;
  v_had_controller := private.has_effective_system_super_admin_v1(p_system_org_id);
  perform private.apply_directory_transfer_review_v1(p_system_org_id, p_actor_id, v_changes);
  v_result := private.rollback_organization_directory_cutover_v1(p_system_org_id, p_plan_id, p_actor_id);
  perform private.assert_directory_transfer_projection_v1(p_system_org_id, v_projection);
  perform private.assert_system_super_admin_continuity_v1(p_system_org_id, v_had_controller);
  update private.directory_rollback_previews set confirmed_at = now() where id = v_preview.id;
  return v_result;
end;
$$;

revoke all on function private.directory_transfer_tree_v1(uuid),
  private.directory_transfer_links_v1(uuid), private.directory_transfer_projection_v1(uuid, jsonb),
  private.directory_transfer_ids_v1(uuid, jsonb), private.directory_transfer_changes_v1(uuid, jsonb),
  private.directory_transfer_summary_v1(jsonb), private.directory_transfer_digest_v1(jsonb),
  private.directory_transfer_commitment_v1(jsonb, jsonb), private.assert_directory_transfer_projection_v1(uuid, jsonb),
  private.apply_directory_transfer_review_v1(uuid, uuid, jsonb), private.directory_rollback_projection_v1(uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.store_organization_directory_authority_plan_v1(uuid, uuid, uuid, uuid, text, jsonb, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.store_organization_directory_authority_plan_v1(uuid, uuid, uuid, uuid, text, jsonb, uuid, timestamptz)
  to service_role;
revoke all on function public.preview_organization_directory_rollback_v1(uuid, uuid, uuid),
  public.confirm_organization_directory_rollback_v1(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.preview_organization_directory_rollback_v1(uuid, uuid, uuid),
  public.confirm_organization_directory_rollback_v1(uuid, uuid, uuid, uuid) to service_role;
revoke execute on function public.rollback_organization_directory_cutover_v1(uuid, uuid, uuid) from service_role;

commit;

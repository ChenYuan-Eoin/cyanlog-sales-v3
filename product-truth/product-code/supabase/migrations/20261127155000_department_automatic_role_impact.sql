-- The effective authorization reads current affiliations after the confirmed
-- transaction commits. Preview the independent sources without changing grants.
begin;

create function private.department_automatic_role_change_impact_v1(
  p_org_id uuid, p_before_ids uuid[], p_after_ids uuid[],
  p_before_tree jsonb default null, p_after_tree jsonb default null
)
returns jsonb language sql stable set search_path = '' as $$
  with before_sources as materialized (
    select * from private.department_automatic_role_sources_for_affiliations_v1(p_org_id, p_before_ids, p_before_tree)
  ), after_sources as materialized (
    select * from private.department_automatic_role_sources_for_affiliations_v1(p_org_id, p_after_ids, p_after_tree)
  ), added as (
    select source.* from after_sources as source where not exists (
      select 1 from before_sources as previous
      where previous.rule_department_id = source.rule_department_id
        and previous.affiliation_department_id = source.affiliation_department_id and previous.role_id = source.role_id
    )
  ), removed as (
    select source.* from before_sources as source where not exists (
      select 1 from after_sources as following
      where following.rule_department_id = source.rule_department_id
        and following.affiliation_department_id = source.affiliation_department_id and following.role_id = source.role_id
    )
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
    'automatic_role_context_revision', encode(sha256(convert_to(jsonb_build_array(
      (select jsonb_agg(to_jsonb(source) order by rule_department_id, affiliation_department_id, role_id)
        from before_sources as source),
      (select jsonb_agg(to_jsonb(source) order by rule_department_id, affiliation_department_id, role_id)
        from after_sources as source)
    )::text, 'UTF8')), 'hex')
  );
$$;

alter function private.department_change_impact_v1(uuid, uuid, uuid[], uuid[], jsonb, jsonb)
  rename to department_change_manual_impact_v1;

create function private.department_change_impact_v1(
  p_org_id uuid, p_user_id uuid, p_before_ids uuid[], p_after_ids uuid[],
  p_before_tree jsonb default null, p_after_tree jsonb default null
)
returns jsonb language sql stable set search_path = '' as $$
  with eligible as (
    select exists (
      select 1
      from public.user_organizations as membership
      join public.users as person on person.id = membership.user_id
      where membership.org_id = p_org_id and membership.user_id = p_user_id and membership.is_default
        and membership.status = 'active' and membership.employment_status = 'active' and membership.left_at is null
        and person.status = 'active' and person.login_enabled is true
    ) as active
  )
  select private.department_change_manual_impact_v1(p_org_id, p_user_id, p_before_ids, p_after_ids, p_before_tree, p_after_tree)
    || private.department_automatic_role_change_impact_v1(p_org_id,
      case when eligible.active then p_before_ids else array[]::uuid[] end,
      case when eligible.active then p_after_ids else array[]::uuid[] end, p_before_tree, p_after_tree)
  from eligible;
$$;

-- Directory synchronization changes employment for existing links and may
-- activate an existing account's first membership. Provisioned people have
-- inactive accounts and require the separate verified first-login flow.
create function private.directory_automatic_role_eligibility_v1(
  p_org_id uuid, p_payload jsonb, p_rollback boolean
)
returns jsonb language sql stable set search_path = '' as $$
  with changes as (
    select change."userId" as user_id, change.active
    from jsonb_to_recordset(p_payload->'userDepartmentChanges') as change("userId" uuid, active boolean)
  ), previous as (
    select saved."userId" as user_id, saved."employmentStatus" as employment_status,
      old_account.status as account_status
    from jsonb_to_recordset(p_payload->'beforeState'->'organizationMemberships')
      as saved("userId" uuid, "employmentStatus" text)
    left join jsonb_to_recordset(p_payload->'beforeState'->'users')
      as old_account(id uuid, status text) on old_account.id = saved."userId"
  ), candidate_members as (
    select membership.user_id from public.user_organizations as membership where membership.org_id = p_org_id
    union select changes.user_id from changes
  ), state as (
    select person.id,
      membership.status = 'active' and membership.employment_status = 'active'
        and membership.is_default and membership.left_at is null
        and person.status = 'active' and person.login_enabled is true as before_eligible,
      case
        when change.user_id is null then membership.status = 'active' and membership.employment_status = 'active'
          and membership.is_default and membership.left_at is null
          and person.status = 'active' and person.login_enabled is true
        when p_rollback then membership.status = 'active' and previous.employment_status = 'active'
          and membership.is_default and membership.left_at is null
          and previous.account_status = 'active' and person.login_enabled is true
        else ((membership.user_id is null and person.org_id = p_org_id)
              or (membership.status = 'active' and membership.is_default and membership.left_at is null))
          and change.active is true and person.status = 'active' and person.login_enabled is true
      end as after_eligible
    from candidate_members as candidate
    join public.users as person on person.id = candidate.user_id
    left join public.user_organizations as membership on membership.user_id = person.id and membership.org_id = p_org_id
    left join changes as change on change.user_id = person.id
    left join previous on previous.user_id = person.id
  )
  select jsonb_build_object(
    'automatic_before_members', coalesce(jsonb_agg(id order by id) filter (where before_eligible is true), '[]'::jsonb),
    'automatic_after_members', coalesce(jsonb_agg(id order by id) filter (where after_eligible is true), '[]'::jsonb)
  ) from state;
$$;

alter function private.directory_transfer_projection_v1(uuid, jsonb) rename to directory_transfer_affiliation_projection_v1;
alter function private.directory_rollback_projection_v1(uuid, jsonb) rename to directory_rollback_affiliation_projection_v1;

create function private.directory_transfer_projection_v1(p_org_id uuid, p_payload jsonb)
returns jsonb language sql stable set search_path = '' as $$
  with base as materialized (
    select private.directory_transfer_affiliation_projection_v1(p_org_id, p_payload) as projection,
      private.directory_automatic_role_eligibility_v1(p_org_id, p_payload, false) as eligibility
  ), additional_links as (
    select change."userId" as id, primary_department.id as primary_id, coalesce(secondary_departments.links, '[]'::jsonb) as links
    from base
    cross join jsonb_to_recordset(p_payload->'userDepartmentChanges')
      as change("userId" uuid, "primaryDepartmentExternalId" text, "departmentExternalIds" jsonb)
    left join lateral (
      select proposed.id from jsonb_to_recordset(base.projection->'after_tree') as proposed(id uuid, source text, external_id text)
      where proposed.source = p_payload->>'targetProvider' and proposed.external_id = change."primaryDepartmentExternalId"
    ) as primary_department on true
    cross join lateral (
      select jsonb_agg(jsonb_build_object('id', proposed.id, 'source', proposed.source) order by proposed.id) as links
      from jsonb_to_recordset(base.projection->'after_tree') as proposed(id uuid, source text, external_id text)
      where proposed.source = p_payload->>'targetProvider' and change."departmentExternalIds" ? proposed.external_id
    ) as secondary_departments
    where base.eligibility->'automatic_after_members' ? change."userId"::text
      and not exists (select 1 from jsonb_to_recordset(base.projection->'after_links') as member(id uuid) where member.id = change."userId")
  ), after_links as (
    select member.id, member.primary_id, member.links from base
    cross join jsonb_to_recordset(base.projection->'after_links') as member(id uuid, primary_id uuid, links jsonb)
    union all
    select id, primary_id, links from additional_links
  )
  select base.projection || base.eligibility || jsonb_build_object(
    'after_links', coalesce((select jsonb_agg(to_jsonb(member) order by id) from after_links as member), '[]'::jsonb)
  ) from base;
$$;

create function private.directory_rollback_projection_v1(p_org_id uuid, p_payload jsonb)
returns jsonb language sql stable set search_path = '' as $$
  select private.directory_rollback_affiliation_projection_v1(p_org_id, p_payload)
    || private.directory_automatic_role_eligibility_v1(p_org_id, p_payload, true);
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
  ), impacts as (
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
    or jsonb_array_length(automatic_impact->'automatic_role_sources_removed') > 0;
$$;

alter function private.directory_transfer_summary_v1(jsonb) rename to directory_transfer_manual_summary_v1;
create function private.directory_transfer_summary_v1(p_changes jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select private.directory_transfer_manual_summary_v1(coalesce(jsonb_agg(change.value)
    filter (where change.value->'automatic_only' is distinct from 'true'::jsonb), '[]'::jsonb))
    || jsonb_build_object(
    'automaticRoleSourcesAdded', coalesce(sum(jsonb_array_length(change.value->'impact'->'automatic_role_sources_added')), 0),
    'automaticRoleSourcesRemoved', coalesce(sum(jsonb_array_length(change.value->'impact'->'automatic_role_sources_removed')), 0)
  ) from jsonb_array_elements(p_changes) as change(value);
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
      or jsonb_array_length(v_change.impact->'automatic_role_sources_removed') > 0 then
      perform private.personnel_insert_event_v1(
        p_org_id, v_change.id, p_actor_id, 'directory_department_automatic_roles',
        jsonb_build_object('ended_sources', v_change.impact->'automatic_role_sources_removed'),
        jsonb_build_object('added_sources', v_change.impact->'automatic_role_sources_added', 'effective_at', v_effective_at),
        'confirmed directory authorization change', null
      );
    end if;
  end loop;
end;
$$;

revoke all on function private.department_automatic_role_change_impact_v1(uuid, uuid[], uuid[], jsonb, jsonb),
  private.department_change_impact_v1(uuid, uuid, uuid[], uuid[], jsonb, jsonb),
  private.directory_automatic_role_eligibility_v1(uuid, jsonb, boolean),
  private.directory_transfer_projection_v1(uuid, jsonb), private.directory_rollback_projection_v1(uuid, jsonb),
  private.directory_transfer_summary_v1(jsonb)
  from public, anon, authenticated, service_role;

commit;

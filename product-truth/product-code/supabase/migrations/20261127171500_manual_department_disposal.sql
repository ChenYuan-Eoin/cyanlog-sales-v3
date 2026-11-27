begin;

-- Bulk disposal uses the existing secondary save transaction once for the
-- member's complete selection, including its combined authority review.
create or replace function private.secondary_department_snapshot_v1(
  p_org_id uuid, p_actor_id uuid, p_user_id uuid, p_department_ids uuid[], p_action text
) returns jsonb language plpgsql set search_path = ''
as $$
declare
  v_member record;
  v_requested uuid[];
  v_affected uuid[];
  v_before uuid[];
  v_after uuid[];
  v_affiliations jsonb;
  v_departments jsonb;
  v_impact jsonb;
begin
  if p_action is null or p_action not in ('add', 'remove')
    or coalesce(cardinality(p_department_ids), 0) not between 1 and (case when p_action = 'remove' then 1000 else 100 end)
    or array_position(p_department_ids, null) is not null then
    raise exception 'invalid secondary department change'
      using errcode = '22023', detail = 'SECONDARY_DEPARTMENT_INVALID';
  end if;
  select array(select distinct id from unnest(p_department_ids) as selected(id) order by id) into v_requested;
  if cardinality(v_requested) <> cardinality(p_department_ids) then
    raise exception 'duplicate secondary department selection'
      using errcode = '22023', detail = 'SECONDARY_DEPARTMENT_INVALID';
  end if;
  if p_user_id = p_actor_id then
    raise exception 'cannot change the current operator department affiliations'
      using errcode = '42501', detail = 'SECONDARY_DEPARTMENT_PROTECTED';
  end if;

  select member.primary_department_id, member.membership_version, person.primary_dept_id into v_member
  from public.user_organizations as member
  join public.users as person on person.id = member.user_id and person.org_id = member.org_id
  where member.org_id = p_org_id and member.user_id = p_user_id and member.status = 'active'
    and member.employment_status = 'active' and member.left_at is null
  for update of member, person;
  if not found then
    raise exception 'active member not found in organization'
      using errcode = 'P0002', detail = 'SECONDARY_DEPARTMENT_NOT_FOUND';
  end if;
  if private.has_exact_org_role_v1(p_user_id, p_org_id, 'SUPER_ADMIN') then
    raise exception 'cannot change a protected system administrator department affiliations'
      using errcode = '42501', detail = 'SECONDARY_DEPARTMENT_PROTECTED';
  end if;
  if v_member.primary_department_id = any(v_requested) or v_member.primary_dept_id = any(v_requested)
    or exists(
      select 1 from public.user_departments where org_id = p_org_id and user_id = p_user_id
        and is_primary and department_id = any(v_requested)
    ) then
    raise exception 'primary department must use the primary transfer command'
      using errcode = '22023', detail = 'SECONDARY_DEPARTMENT_PRIMARY';
  end if;

  perform 1 from public.departments where org_id = p_org_id and id = any(v_requested) order by id for share;
  if (select count(*) from public.departments where org_id = p_org_id and id = any(v_requested)) <> cardinality(v_requested) then
    raise exception 'secondary department is outside the organization'
      using errcode = '22023', detail = 'SECONDARY_DEPARTMENT_INVALID';
  end if;
  select array(
    select department_id from public.user_departments where org_id = p_org_id and user_id = p_user_id
    union select v_member.primary_department_id where v_member.primary_department_id is not null
    union select v_member.primary_dept_id where v_member.primary_dept_id is not null
    order by 1
  ) into v_before;

  if p_action = 'add' then
    select array(select id from unnest(v_requested) as requested(id) where not id = any(v_before) order by id) into v_affected;
    if exists(
      select 1 from public.departments where org_id = p_org_id and id = any(v_affected) and status is distinct from 'active'
    ) then
      raise exception 'an inactive secondary department cannot be assigned'
        using errcode = '22023', detail = 'SECONDARY_DEPARTMENT_INVALID';
    end if;
    if exists(
      select 1 from public.departments as department
      join public.organization_sources as source on source.system_org_id = department.org_id
        and source.provider = department.source and source.authority_scope->>'directory' in ('authoritative', 'true')
      join public.external_identities as identity on identity.system_org_id = department.org_id
        and identity.source_id = source.id and identity.canonical_user_id = p_user_id and identity.match_status = 'matched'
      where department.org_id = p_org_id and department.id = any(v_affected)
    ) then
      raise exception 'cannot create a conflicting affiliation in the authoritative directory'
        using errcode = '42501', detail = 'SECONDARY_DEPARTMENT_EXTERNAL_SOURCE';
    end if;
    select array(select distinct id from unnest(v_before || v_affected) as member(id) order by id) into v_after;
  else
    select array(
      select department_id from public.user_departments where org_id = p_org_id and user_id = p_user_id
        and department_id = any(v_requested) and is_primary is false
      order by department_id
    ) into v_affected;
    if exists(
      select 1 from public.user_departments where org_id = p_org_id and user_id = p_user_id
        and department_id = any(v_affected) and source is distinct from 'manual'
    ) then
      raise exception 'the source owns this secondary department relationship'
        using errcode = '42501', detail = 'SECONDARY_DEPARTMENT_EXTERNAL_SOURCE';
    end if;
    select array(select id from unnest(v_before) as member(id) where not id = any(v_affected) order by id) into v_after;
  end if;

  if cardinality(v_affected) = 0 then
    return jsonb_build_object('action', p_action, 'affected_department_ids', v_affected, 'impact', '{}'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_array(department.id, department.is_primary, department.source, department.joined_at)
    order by department.id), '[]'::jsonb) into v_affiliations
  from (
    select department_id as id, is_primary, source, joined_at
    from public.user_departments where org_id = p_org_id and user_id = p_user_id
  ) as department;

  with recursive ancestors(id, parent_id, status) as (
    select id, parent_id, status from public.departments where org_id = p_org_id and id = any(v_before || v_after)
    union
    select parent.id, parent.parent_id, parent.status from ancestors as child
    join public.departments as parent on parent.id = child.parent_id and parent.org_id = p_org_id
  )
  select jsonb_agg(to_jsonb(ancestors) order by id) into v_departments from ancestors;
  v_impact := private.department_change_impact_v1(p_org_id, p_user_id, v_before, v_after);
  return jsonb_build_object(
    'action', p_action, 'affected_department_ids', v_affected, 'impact', v_impact,
    'before_department_ids', v_before, 'after_department_ids', v_after,
    'affiliations', v_affiliations, 'membership_version', v_member.membership_version,
    'departments', v_departments, 'settings', (select settings from public.organizations where id = p_org_id)
  );
end;
$$;

create table private.manual_department_disposal_plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  actor_id uuid not null references public.users(id) on delete restrict,
  selected_ids uuid[] not null,
  include_children boolean not null,
  employment_filter text not null,
  command jsonb not null,
  subjects jsonb not null,
  plan_hash text not null,
  expires_at timestamptz not null,
  outcome jsonb
);
create index manual_department_disposal_plan_expiry
  on private.manual_department_disposal_plans(org_id, expires_at);
alter table private.manual_department_disposal_plans enable row level security;
revoke all on private.manual_department_disposal_plans from public, anon, authenticated, service_role;

create table private.manual_department_archive_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  department_id uuid not null references public.departments(id) on delete restrict,
  prior_department jsonb not null,
  prior_authority jsonb not null,
  archived_by uuid not null references public.users(id) on delete restrict,
  archived_at timestamptz not null default clock_timestamp(),
  restored_by uuid references public.users(id) on delete restrict,
  restored_at timestamptz,
  restored_parent_id uuid,
  check ((restored_at is null) = (restored_by is null))
);
create unique index manual_department_archive_events_active
  on private.manual_department_archive_events(org_id, department_id) where restored_at is null;
create index manual_department_archive_events_history
  on private.manual_department_archive_events(org_id, archived_at desc) where restored_at is not null;
alter table private.manual_department_archive_events enable row level security;
revoke all on private.manual_department_archive_events from public, anon, authenticated, service_role;

create function private.manual_department_scope_v1(p_org_id uuid, p_ids uuid[], p_include_children boolean)
returns setof uuid language sql stable set search_path = '' as $$
  with recursive departments(id) as (
    select dept.id from public.departments as dept where dept.org_id = p_org_id and dept.id = any(p_ids)
    union
    select child.id from departments
    join public.departments as child on child.org_id = p_org_id and child.parent_id = departments.id
    where p_include_children and child.status = 'active'
  ) select id from departments;
$$;

-- A stopped account retains its department while its organization
-- membership remains effective. Compare both current primary fields with the
-- affiliation table so partially migrated records cannot bypass archiving.
create function private.manual_department_disposal_links_v1(p_org_id uuid, p_ids uuid[], p_user_id uuid default null)
returns table (user_id uuid, department_id uuid, source text, is_primary boolean, inconsistent boolean)
language sql stable set search_path = '' as $$
  with members as (
    select member.user_id, member.primary_department_id,
      case when person.org_id = p_org_id then person.primary_dept_id end as legacy_primary
    from public.user_organizations as member
    join public.users as person on person.id = member.user_id
    where member.org_id = p_org_id and member.left_at is null
      and (p_user_id is null or member.user_id = p_user_id)
      and member.status in ('active', 'invited', 'suspended') and member.employment_status in ('active', 'suspended')
  ), links as (
    select affiliation.user_id, affiliation.department_id, affiliation.source, affiliation.is_primary
    from public.user_departments as affiliation join members using (user_id)
    where affiliation.org_id = p_org_id and affiliation.department_id = any(p_ids)
  ), primaries as (
    select members.user_id, primary_id.department_id, null::text as source, true as is_primary
    from members cross join lateral unnest(array[members.primary_department_id, members.legacy_primary]) as primary_id(department_id)
    where primary_id.department_id = any(p_ids)
  ), combined as (
    select * from links union all select * from primaries
  )
  select link.user_id, link.department_id, coalesce(max(link.source), dept.source, 'manual'), bool_or(link.is_primary),
    (members.primary_department_id is not null and members.legacy_primary is not null
      and members.primary_department_id is distinct from members.legacy_primary)
      or (coalesce(members.primary_department_id, members.legacy_primary) is not null
        and bool_or(link.is_primary)
        and coalesce(members.primary_department_id, members.legacy_primary) is distinct from link.department_id)
  from combined as link join members using (user_id)
  join public.departments as dept on dept.id = link.department_id and dept.org_id = p_org_id
  group by link.user_id, link.department_id, dept.source, members.primary_department_id, members.legacy_primary;
$$;

create function private.manual_department_disposal_person_revision_v1(p_org_id uuid, p_user_id uuid)
returns text language sql stable set search_path = '' as $$
  select private.directory_transfer_digest_v1(jsonb_build_array(
    to_jsonb(member), person.status, person.login_enabled, person.primary_dept_id, person.updated_at,
    (select jsonb_agg(to_jsonb(relation) order by relation.department_id) from public.user_departments as relation
      where relation.org_id = p_org_id and relation.user_id = p_user_id)
  ))
  from public.user_organizations as member join public.users as person on person.id = member.user_id
  where member.org_id = p_org_id and member.user_id = p_user_id;
$$;

create function private.manual_department_disposal_dept_revision_v1(p_org_id uuid, p_id uuid)
returns text language sql stable set search_path = '' as $$
  select private.directory_transfer_digest_v1(jsonb_build_array(
    to_jsonb(dept)-'member_count',
    (select jsonb_agg(jsonb_build_array(child.id, child.source, child.status) order by child.id)
      from public.departments as child
      where child.org_id = p_org_id and child.parent_id = p_id and child.status = 'active')
  ))
  from public.departments as dept where dept.org_id = p_org_id and dept.id = p_id;
$$;

create function private.manual_department_archive_probe_v1(p_org_id uuid, p_id uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_department public.departments%rowtype;
  v_existing uuid;
  v_links jsonb;
  v_children jsonb;
begin
  select * into v_department from public.departments where org_id = p_org_id and id = p_id;
  if not found then return jsonb_build_object('departmentId', p_id, 'status','blocked','code','DEPARTMENT_NOT_FOUND'); end if;
  if v_department.source is distinct from 'manual' then
    return jsonb_build_object('departmentId',p_id,'status','blocked','code','DEPARTMENT_SOURCE_PROTECTED',
      'details',jsonb_build_object('source',v_department.source));
  end if;
  if v_department.status <> 'active' then
    select id into v_existing from private.manual_department_archive_events
      where org_id = p_org_id and department_id = p_id and restored_at is null;
    if found then return jsonb_build_object('departmentId',p_id,'status','unchanged','code','ALREADY_ARCHIVED',
      'details',jsonb_build_object('archiveId',v_existing)); end if;
    return jsonb_build_object('departmentId',p_id,'status','blocked','code','LEGACY_INACTIVE_REVIEW');
  end if;
  if exists (select 1 from public.organizations where id = p_org_id and settings->>'root_department_id' = p_id::text)
    or (v_department.parent_id is null and not exists (
      select 1 from public.departments as root where root.org_id = p_org_id
        and root.status = 'active' and root.parent_id is null and root.id <> p_id
    )) then
    return jsonb_build_object('departmentId',p_id,'status','blocked','code','DEPARTMENT_ROOT_PROTECTED');
  end if;
  select jsonb_agg(jsonb_build_object('userId', relation.user_id, 'displayName', person.display_name,
    'kind',case when relation.is_primary then 'primary' else 'secondary' end,'source',relation.source)
    order by relation.user_id)
  into v_links
  from private.manual_department_disposal_links_v1(p_org_id, array[p_id]) as relation
  join public.users as person on person.id = relation.user_id;
  select jsonb_agg(jsonb_build_object('departmentId',d.id,'name',d.name,'source',d.source) order by d.id)
  into v_children from public.departments as d where d.org_id = p_org_id and d.parent_id = p_id and d.status = 'active';
  if v_links is not null or v_children is not null then
    return jsonb_build_object('departmentId',p_id,'status','blocked','code',case when v_links is not null
      then 'DEPARTMENT_HAS_MEMBER_BINDINGS' else 'DEPARTMENT_HAS_ACTIVE_CHILDREN' end,
      'details',jsonb_build_object('members',coalesce(v_links,'[]'::jsonb),'activeChildren',coalesce(v_children,'[]'::jsonb)));
  end if;
  if exists(select 1 from public.sales_spaces where org_id = p_org_id and department_id = p_id and status = 'active') then
    return jsonb_build_object('departmentId',p_id,'status','blocked','code','DEPARTMENT_HAS_ACTIVE_SALES_SPACE');
  end if;
  return jsonb_build_object('departmentId',p_id,'status','ready');
end;
$$;

create function private.manual_department_disposal_view_v1(
  p_org_id uuid, p_actor_id uuid, p_ids uuid[], p_include_children boolean, p_employment_filter text
)
returns jsonb language sql stable set search_path = '' as $$
  with scope as (
    select array(select * from private.manual_department_scope_v1(p_org_id,p_ids,p_include_children)) as ids
  ), links as materialized (
    select relation.*, dept.name, dept.status, dept.source as dept_source
    from scope cross join lateral private.manual_department_disposal_links_v1(p_org_id,scope.ids) as relation
    join public.departments as dept on dept.id = relation.department_id and dept.org_id = p_org_id
  ), members as (
    select person.id, person.display_name, person.status as account_status, person.login_enabled,
      membership.employment_status,
      coalesce(membership.primary_department_id, case when person.org_id = p_org_id then person.primary_dept_id end) as primary_id,
      (membership.employment_status = 'active' and person.status = 'active') as shown_active,
      (person.org_id = p_org_id and membership.is_default and person.id <> p_actor_id
        and not private.has_exact_org_role_v1(person.id,p_org_id,'SUPER_ADMIN')) as editable
    from (select distinct user_id from links) as affected
    join public.users as person on person.id = affected.user_id
    join public.user_organizations as membership on membership.user_id = person.id and membership.org_id = p_org_id
  ), member_rows as (
    select member.id, member.shown_active, jsonb_build_object(
      'userId',member.id,'displayName',member.display_name,'employmentStatus',member.employment_status,
      'accountStatus',member.account_status,'loginEnabled',member.login_enabled,'primaryDepartmentId',member.primary_id,
      'canTransfer',member.editable and member.employment_status = 'active' and bool_or(
        link.is_primary and link.source = 'manual' and link.dept_source = 'manual'
        and link.status = 'active' and not link.inconsistent),
      'canSuspend',member.editable and member.login_enabled is true,
      'canOffboard',member.editable,
      'relations',jsonb_agg(jsonb_build_object(
        'departmentId',link.department_id,'name',link.name,'source',link.source,
        'kind',case when link.is_primary then 'primary' else 'secondary' end,
        'manageable',member.editable and member.employment_status = 'active' and link.status = 'active'
          and link.source = 'manual' and link.dept_source = 'manual' and not link.inconsistent,
        'blockedReason',case
          when link.inconsistent then 'DEPARTMENT_RELATION_STALE'
          when link.source <> 'manual' or link.dept_source <> 'manual' then 'DEPARTMENT_SOURCE_PROTECTED'
          when not member.editable or member.employment_status <> 'active' then 'MEMBER_NOT_ELIGIBLE'
          when link.status <> 'active' then 'DEPARTMENT_INACTIVE' end
      ) order by link.department_id)
    ) as row_data
    from members as member join links as link on link.user_id = member.id
    group by member.id,member.display_name,member.employment_status,member.account_status,member.login_enabled,
      member.primary_id,member.editable,member.shown_active
  ), dept_rows as (
    select dept.id, dept.sort_order, jsonb_build_object(
      'departmentId',dept.id,'parentDepartmentId',dept.parent_id,'name',dept.name,'code',dept.code,
      'source',dept.source,'status',dept.status,'selected',dept.id = any(p_ids),
      'activeChildIds',array(select child.id from public.departments as child
        where child.org_id = p_org_id and child.parent_id = dept.id and child.status = 'active' order by child.id),
      'memberCount',(select count(*) from links where department_id = dept.id),
      'blockedReason',private.manual_department_archive_probe_v1(p_org_id,dept.id)->>'code'
    ) as row_data
    from scope join public.departments as dept on dept.org_id = p_org_id and dept.id = any(scope.ids)
  )
  select jsonb_build_object(
    'departments',coalesce((select jsonb_agg(row_data order by sort_order,id) from dept_rows),'[]'::jsonb),
    'members',coalesce((select jsonb_agg(row_data order by row_data->>'displayName',id)
      from member_rows where p_employment_filter = 'all' or shown_active),'[]'::jsonb),
    'hiddenMemberCount',(select count(*) from member_rows where not shown_active and p_employment_filter = 'active'),
    'summary',jsonb_build_object('departmentCount',(select count(*) from dept_rows),'memberCount',(select count(*) from member_rows),
      'visibleMemberCount',(select count(*) from member_rows where p_employment_filter = 'all' or shown_active),
      'relationCount',(select count(*) from links))
  );
$$;

-- Capture exact direct grants so archiving can invalidate them atomically.
-- Ancestor grants remain configured and follow the current hierarchy.
create function private.manual_department_archive_authority_v1(p_org_id uuid, p_department_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'departmentGrant', (select settings->'department_permission_grants'->p_department_id::text
      from public.organizations where id = p_org_id),
    'roles', (select jsonb_agg(to_jsonb(binding)) from public.user_roles as binding
      where binding.org_id = p_org_id and binding.scope_type = 'department' and binding.scope_id = p_department_id),
    'automaticRoleRules', (select jsonb_agg(to_jsonb(rule)) from private.department_automatic_role_rules as rule
      where rule.org_id = p_org_id and rule.department_id = p_department_id),
    'departmentLeader', (select to_jsonb(lead) from public.department_lead_access as lead
      where lead.org_id = p_org_id and lead.department_id = p_department_id),
    'personalOverrides', (select jsonb_agg(to_jsonb(exception)) from private.employee_permission_overrides as exception
      where exception.org_id = p_org_id and exception.scope->>'type' = 'department'
        and exception.scope->'departments' @> jsonb_build_array(jsonb_build_object('department_id',p_department_id))),
    'shippingIntake', (select rules->'allowedDepartmentIds' from public.shipping_intake_settings
      where org_id = p_org_id and (rules->'allowedDepartmentIds') ? p_department_id::text)
  );
$$;

create function private.lock_manual_department_disposal_org_v1(p_org_id uuid, p_actor_id uuid, p_require_admin boolean)
returns void language plpgsql set search_path = '' as $$
begin
  perform private.personnel_lock_org_v1(p_org_id);
  perform 1 from public.organizations where id = p_org_id and status = 'active' for no key update;
  if not found then raise exception 'organization unavailable' using errcode = '42501'; end if;
  perform 1 from public.users as person
  join public.user_organizations as member on member.user_id = person.id and member.org_id = p_org_id
  where person.id = p_actor_id and person.status = 'active' and person.login_enabled
    and member.is_default and member.status = 'active' and member.employment_status = 'active' and member.left_at is null
  for share of person,member;
  if not found or (p_require_admin and not private.personnel_is_org_control_admin_v1(p_actor_id,p_org_id)) then
    raise exception 'department disposal is forbidden' using errcode = '42501', detail = 'DEPARTMENT_DISPOSAL_FORBIDDEN';
  end if;
  perform 1 from public.departments where org_id = p_org_id order by id for update;
end;
$$;

create function private.apply_manual_department_archive_v1(p_org_id uuid,p_actor_id uuid,p_department_id uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_probe jsonb;
  v_authority jsonb;
  v_department public.departments%rowtype;
  v_archive_id uuid;
begin
  v_probe := private.manual_department_archive_probe_v1(p_org_id,p_department_id);
  if v_probe->>'status' <> 'ready' then return v_probe || '{"action":"archive"}'::jsonb; end if;
  select * into v_department from public.departments where org_id = p_org_id and id = p_department_id;
  v_authority := private.manual_department_archive_authority_v1(p_org_id,p_department_id);
  -- The service-only direct route has already checked delegated delete
  -- permission. Exact grant revocation uses the stronger system authority.
  if (jsonb_strip_nulls(v_authority) <> '{}'::jsonb or v_department.leader_id is not null)
    and not private.personnel_is_org_control_admin_v1(p_actor_id,p_org_id) then
    return jsonb_build_object('departmentId',p_department_id,'status','blocked','action','archive',
      'code','DEPARTMENT_ARCHIVE_AUTHORITY_PROTECTED');
  end if;

  update public.organizations set settings = jsonb_set(settings,'{department_permission_grants}',
    (settings->'department_permission_grants') - p_department_id::text)
  where id = p_org_id and jsonb_typeof(settings->'department_permission_grants') = 'object'
    and (settings->'department_permission_grants') ? p_department_id::text;
  delete from public.user_roles where org_id = p_org_id and scope_type = 'department' and scope_id = p_department_id;
  delete from private.department_automatic_role_rules where org_id = p_org_id and department_id = p_department_id;
  delete from public.department_lead_access where org_id = p_org_id and department_id = p_department_id;
  with affected as (
    select exception.user_id, exception.permission_code, scope.next
    from private.employee_permission_overrides as exception
    cross join lateral (
      select coalesce(jsonb_agg(root order by ordinal) filter(where root->>'department_id' is distinct from p_department_id::text),
        '[]'::jsonb) as next
      from jsonb_array_elements(exception.scope->'departments') with ordinality as selected(root,ordinal)
    ) as scope
    where exception.org_id = p_org_id and exception.scope->>'type' = 'department'
      and exception.scope->'departments' @> jsonb_build_array(jsonb_build_object('department_id',p_department_id))
  )
  update private.employee_permission_overrides as exception
  set effect = case when affected.next = '[]'::jsonb then 'DENY' else exception.effect end,
    scope = case when affected.next = '[]'::jsonb then null
      else jsonb_set(exception.scope,'{departments}',affected.next) end,
    updated_by = p_actor_id, updated_at = clock_timestamp()
  from affected where exception.org_id = p_org_id and exception.user_id = affected.user_id
    and exception.permission_code = affected.permission_code;

  -- Retain an explicit empty set if the archived department was the only
  -- allowed option. Removing the property would reopen unrestricted intake.
  update public.shipping_intake_settings
  set rules = jsonb_set(rules,'{allowedDepartmentIds}',(rules->'allowedDepartmentIds') - p_department_id::text),
    updated_by=p_actor_id, updated_at=clock_timestamp()
  where org_id = p_org_id and jsonb_typeof(rules->'allowedDepartmentIds') = 'array'
    and (rules->'allowedDepartmentIds') ? p_department_id::text;

  update public.departments set status='inactive',leader_id=null,updated_at=clock_timestamp()
  where org_id=p_org_id and id=p_department_id;
  insert into private.manual_department_archive_events(org_id,department_id,prior_department,prior_authority,archived_by)
  values(p_org_id,p_department_id,to_jsonb(v_department),v_authority,p_actor_id) returning id into v_archive_id;
  return jsonb_build_object('departmentId',p_department_id,'status','applied','action','archive',
    'details',jsonb_build_object('archiveId',v_archive_id));
end;
$$;

create function public.archive_manual_department_v1(p_org_id uuid,p_actor_id uuid,p_department_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  perform private.lock_manual_department_disposal_org_v1(p_org_id,p_actor_id,false);
  v_result := private.apply_manual_department_archive_v1(p_org_id,p_actor_id,p_department_id);
  if not private.personnel_is_org_control_admin_v1(p_actor_id,p_org_id) then
    return v_result #- '{details,members}';
  end if;
  return v_result;
end;
$$;

create function public.list_manual_department_archives_v1(p_org_id uuid,p_actor_id uuid,p_query text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_query text := lower(btrim(coalesce(p_query,'')));
begin
  if char_length(v_query)>120 then raise exception 'invalid archive search' using errcode = '22023'; end if;
  if not exists (
    select 1 from public.organizations as organization
    join public.user_organizations as member on member.org_id=organization.id
    join public.users as person on person.id=member.user_id
    where organization.id=p_org_id and organization.status='active' and person.id=p_actor_id
      and person.status='active' and person.login_enabled and member.is_default
      and member.status='active' and member.employment_status='active' and member.left_at is null
  ) then
    raise exception 'archive listing is forbidden' using errcode='42501',detail='DEPARTMENT_DISPOSAL_FORBIDDEN';
  end if;
  return jsonb_build_object(
    'archivedDepartments',coalesce((
      select jsonb_agg(jsonb_build_object('archiveId',event.id,'departmentId',dept.id,'name',dept.name,'code',dept.code,
        'parentDepartmentId',event.prior_department->>'parent_id','archivedAt',event.archived_at)
        order by event.archived_at desc,event.id)
      from private.manual_department_archive_events as event
      join public.departments as dept on dept.id = event.department_id and dept.org_id = event.org_id
      where event.org_id=p_org_id and event.restored_at is null and dept.source='manual' and dept.status='inactive'
        and position(v_query in lower(dept.name || ' ' || coalesce(dept.code,'')))>0
    ),'[]'::jsonb),
    'archiveHistory',coalesce((
      select jsonb_agg(jsonb_build_object('archiveId',event.id,'departmentId',event.department_id,
        'name',event.prior_department->>'name','code',event.prior_department->>'code',
        'parentDepartmentId',event.prior_department->>'parent_id','archivedAt',event.archived_at,'restoredAt',event.restored_at)
        order by event.archived_at desc,event.id)
      from private.manual_department_archive_events as event
      where event.org_id=p_org_id and event.restored_at is not null
        and position(v_query in lower((event.prior_department->>'name') || ' ' || coalesce(event.prior_department->>'code','')))>0
    ),'[]'::jsonb),
    'legacyInactive',coalesce((
      select jsonb_agg(jsonb_build_object('departmentId',dept.id,'name',dept.name,'code',dept.code,
        'parentDepartmentId',dept.parent_id,'source',dept.source,'blockedReason',case when dept.source='manual'
          then 'LEGACY_INACTIVE_REVIEW' else 'DEPARTMENT_SOURCE_PROTECTED' end)
        order by dept.name,dept.id)
      from public.departments as dept
      where dept.org_id=p_org_id and dept.status='inactive'
        and position(v_query in lower(dept.name || ' ' || coalesce(dept.code,'')))>0
        and not exists(select 1 from private.manual_department_archive_events as event
          where event.org_id=p_org_id and event.department_id=dept.id and event.restored_at is null)
    ),'[]'::jsonb)
  );
end;
$$;

create function public.restore_manual_department_v1(
  p_org_id uuid,p_actor_id uuid,p_department_id uuid,p_parent_department_id uuid,p_archive_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_event private.manual_department_archive_events%rowtype;
  v_dept public.departments%rowtype;
  v_parent public.departments%rowtype;
begin
  perform private.lock_manual_department_disposal_org_v1(p_org_id,p_actor_id,true);
  select * into v_event from private.manual_department_archive_events
  where org_id=p_org_id and id=p_archive_id and department_id=p_department_id for update;
  if not found then raise exception 'archive receipt not found' using errcode='P0002',detail='ARCHIVE_NOT_FOUND'; end if;
  select * into v_dept from public.departments where org_id=p_org_id and id=p_department_id;
  if v_event.restored_at is not null and v_event.restored_parent_id is not distinct from p_parent_department_id
    and v_dept.status='active' and v_dept.parent_id is not distinct from p_parent_department_id then
    return jsonb_build_object('departmentId',p_department_id,'archiveId',p_archive_id,'status','unchanged');
  end if;
  if v_event.restored_at is not null or v_dept.status is distinct from 'inactive' or v_dept.source is distinct from 'manual' then
    raise exception 'archive state changed' using errcode='40001',detail='ARCHIVE_CHANGED';
  end if;
  select * into v_parent from public.departments where org_id=p_org_id and id=p_parent_department_id and status='active';
  if not found or p_parent_department_id=p_department_id or exists(
    select 1 from public.departments where org_id=p_org_id and status='active' and parent_id=p_parent_department_id
      and lower(btrim(name))=lower(btrim(v_dept.name)) and id<>p_department_id
  ) then
    raise exception 'invalid or conflicted active parent' using errcode='23514',detail='ARCHIVE_RESTORE_PARENT_INVALID';
  end if;
  if exists(select 1 from private.manual_department_disposal_links_v1(p_org_id,array[p_department_id]))
    or jsonb_strip_nulls(private.manual_department_archive_authority_v1(p_org_id,p_department_id)) <> '{}'::jsonb
    or v_dept.leader_id is not null then
    raise exception 'archived department acquired members or direct permissions'
      using errcode='40001',detail='ARCHIVE_RESTORE_BINDINGS_CHANGED';
  end if;
  update public.departments set status='active',updated_at=clock_timestamp() where org_id=p_org_id and id=p_department_id;
  if v_dept.parent_id is distinct from p_parent_department_id then
    perform public.admin_save_department_parent_change_v1(p_org_id,p_actor_id,p_department_id,
      jsonb_build_object('parent_id',p_parent_department_id),v_dept.parent_id);
  end if;
  update private.manual_department_archive_events set restored_by=p_actor_id,restored_at=clock_timestamp(),
    restored_parent_id=p_parent_department_id where org_id=p_org_id and id=p_archive_id;
  return jsonb_build_object('departmentId',p_department_id,'archiveId',p_archive_id,'status','restored');
end;
$$;

create function private.manual_department_command_rows_v1(p_command jsonb)
returns table(category text, action text, id uuid, args jsonb)
language sql immutable set search_path = '' as $$
  select 'member','transfer',(item->>'userId')::uuid,item from jsonb_array_elements(p_command->'transfers') as item
  union all select 'member','remove_secondary',(item->>'userId')::uuid,item
    from jsonb_array_elements(p_command->'secondaryRemovals') as item
  union all select 'member','suspend',item::uuid,'{}'::jsonb
    from jsonb_array_elements_text(p_command->'suspendUserIds') as item
  union all select 'member','offboard',item::uuid,'{}'::jsonb
    from jsonb_array_elements_text(p_command->'offboardUserIds') as item
  union all select 'department','reparent',(item->>'departmentId')::uuid,item
    from jsonb_array_elements(p_command->'reparent') as item
  union all select distinct 'department','archive',item::uuid,'{}'::jsonb
    from jsonb_array_elements_text(p_command->'archiveDepartmentIds') as item;
$$;

create function private.manual_department_command_status_v1(
  p_org_id uuid,p_actor_id uuid,p_scope uuid[],p_archives uuid[],p_category text,p_action text,p_id uuid,p_args jsonb
) returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_status text := 'ready';
  v_code text;
  v_target uuid;
  v_ids uuid[];
  v_dept public.departments%rowtype;
  v_data jsonb;
begin
  if p_category = 'member' then
    if p_id is null or not exists (select 1 from private.manual_department_disposal_links_v1(p_org_id,p_scope,p_id)) then
      v_status := 'blocked'; v_code := 'MEMBER_OUTSIDE_DEPARTMENT_SCOPE';
    elsif p_id = p_actor_id or private.has_exact_org_role_v1(p_id,p_org_id,'SUPER_ADMIN') then
      v_status := 'blocked'; v_code := 'MEMBER_MUTATION_PROTECTED';
    elsif p_action = 'transfer' then
      v_target := (p_args->>'departmentId')::uuid;
      if not exists (
        select 1 from private.manual_department_disposal_links_v1(p_org_id,p_scope,p_id) as link
        join public.departments as dept on dept.id=link.department_id and dept.org_id=p_org_id
        where link.is_primary and link.source='manual' and dept.source='manual'
          and dept.status='active' and not link.inconsistent
      ) then
        v_status := 'blocked'; v_code := 'DEPARTMENT_SOURCE_OR_PRIMARY_PROTECTED';
      elsif not exists (select 1 from public.departments where org_id=p_org_id and id=v_target and status='active')
        or exists(select 1 from private.manual_department_scope_v1(p_org_id,p_archives,true) as branch(id) where branch.id=v_target) then
        v_status := 'blocked'; v_code := 'DEPARTMENT_TRANSFER_INVALID_TARGET';
      elsif exists(select 1 from public.user_organizations where org_id=p_org_id and user_id=p_id and primary_department_id=v_target) then
        v_status := 'unchanged'; v_code := 'ALREADY_IN_DESTINATION';
      end if;
    elsif p_action = 'remove_secondary' then
      v_ids := array(select distinct item::uuid from jsonb_array_elements_text(p_args->'departmentIds') as item);
      if cardinality(v_ids)=0 or exists (
        select 1 from unnest(v_ids) as selected(id)
        where not exists(
          select 1 from private.manual_department_disposal_links_v1(p_org_id,p_scope,p_id) as link
          join public.departments as dept on dept.id=link.department_id and dept.org_id=p_org_id
          where link.department_id=selected.id and not link.is_primary
            and not link.inconsistent and link.source='manual' and dept.source='manual' and dept.status='active'
        )
      ) then
        v_status := 'blocked'; v_code := 'SECONDARY_RELATION_PROTECTED';
      end if;
    end if;
    return jsonb_build_object('userId',p_id,'action',p_action,'status',v_status,'code',v_code);
  end if;

  if p_action = 'archive' then
    if not (p_id = any(p_scope)) then
      return jsonb_build_object('departmentId',p_id,'action',p_action,'status','blocked','code','DEPARTMENT_OUTSIDE_SCOPE');
    end if;
    return private.manual_department_archive_probe_v1(p_org_id,p_id) || '{"action":"archive"}'::jsonb;
  end if;

  v_target := (p_args->>'parentDepartmentId')::uuid;
  select * into v_dept from public.departments where org_id=p_org_id and id=p_id and status='active';
  if not found or not (p_id = any(p_scope) or coalesce(v_dept.parent_id = any(p_scope),false)) then
    v_status := 'blocked'; v_code := 'DEPARTMENT_OUTSIDE_SCOPE';
  elsif v_dept.source is distinct from 'manual' then
    v_status := 'blocked'; v_code := 'DEPARTMENT_SOURCE_PROTECTED';
    v_data := jsonb_build_object('source',v_dept.source);
  elsif not exists(select 1 from public.departments where org_id=p_org_id and id=v_target and status='active')
    or exists(select 1 from private.manual_department_scope_v1(p_org_id,p_archives,true) as branch(id) where branch.id=v_target)
    or exists(select 1 from private.manual_department_scope_v1(p_org_id,array[p_id],true) as branch(id) where branch.id=v_target) then
    v_status := 'blocked'; v_code := 'DEPARTMENT_PARENT_INVALID';
  elsif v_dept.parent_id is not distinct from v_target then
    v_status := 'unchanged'; v_code := 'DEPARTMENT_PARENT_UNCHANGED';
  end if;
  return jsonb_build_object('departmentId',p_id,'action',p_action,'status',v_status,'code',v_code,'details',v_data);
end;
$$;

create function public.preview_manual_department_disposal_v1(
  p_org_id uuid,p_actor_id uuid,p_department_ids uuid[],p_include_children boolean,p_employment_filter text,p_command jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
  v_scope uuid[];
  v_archives uuid[];
  v_command jsonb := coalesce(p_command,'{}'::jsonb);
  v_subjects jsonb;
  v_plan private.manual_department_disposal_plans%rowtype;
  v_item record;
  v_result jsonb;
  v_related jsonb;
  v_error_detail text;
  v_member_results jsonb := '[]'::jsonb;
  v_dept_results jsonb := '[]'::jsonb;
begin
  if p_department_ids is null or cardinality(p_department_ids)>1000 or array_position(p_department_ids,null) is not null
    or p_include_children is null or p_employment_filter is null or p_employment_filter not in ('active','all')
    or jsonb_typeof(v_command) is distinct from 'object'
    or v_command - array['transfers','secondaryRemovals','suspendUserIds','offboardUserIds','reparent','archiveDepartmentIds'] <> '{}'::jsonb
    or exists(select 1 from jsonb_each(v_command) as field where jsonb_typeof(field.value)<>'array'
      or jsonb_array_length(field.value)>1000) then
    raise exception 'invalid department disposal preview' using errcode='22023';
  end if;
  if not private.personnel_is_org_control_admin_v1(p_actor_id,p_org_id) then
    raise exception 'department disposal is forbidden' using errcode='42501',detail='DEPARTMENT_DISPOSAL_FORBIDDEN';
  end if;
  if v_command <> '{}'::jsonb then
    perform private.lock_manual_department_disposal_org_v1(p_org_id,p_actor_id,true);
  end if;

  v_ids := array(select distinct id from unnest(p_department_ids) as requested(id) order by id);
  v_scope := array(select * from private.manual_department_scope_v1(p_org_id,v_ids,p_include_children));
  if not (v_ids <@ v_scope) then
    raise exception 'department outside current organization' using errcode='42501',detail='DEPARTMENT_OUTSIDE_SCOPE';
  end if;
  if exists(
    select 1 from private.manual_department_command_rows_v1(v_command) as item
    group by item.category,item.action,item.id having count(*)>1 or item.id is null
  ) then raise exception 'duplicate or missing disposal target' using errcode='22023'; end if;
  v_archives := array(select id from private.manual_department_command_rows_v1(v_command) where action='archive');

  select jsonb_build_object(
    'members',coalesce((
      select jsonb_object_agg(item.id::text,private.manual_department_disposal_person_revision_v1(p_org_id,item.id))
      from (select distinct id from private.manual_department_command_rows_v1(v_command) where category='member') as item
    ),'{}'::jsonb),
    'departments',coalesce((
      select jsonb_object_agg(item.id::text,private.manual_department_disposal_dept_revision_v1(p_org_id,item.id))
      from (
        select id from private.manual_department_command_rows_v1(v_command) where category='department'
        union select (args->>'departmentId')::uuid from private.manual_department_command_rows_v1(v_command)
          where action='transfer' and args->>'departmentId' is not null
        union select (args->>'parentDepartmentId')::uuid from private.manual_department_command_rows_v1(v_command)
          where action='reparent' and args->>'parentDepartmentId' is not null
      ) as item
    ),'{}'::jsonb)
  ) into v_subjects;

  for v_item in
    select item.* from private.manual_department_command_rows_v1(v_command) as item
    order by case item.category when 'member' then 0 else 1 end,
      case when item.action='archive' then 1 else 0 end,
      case when item.action='archive' then (select count(*) from private.manual_department_scope_v1(p_org_id,array[item.id],true)) else 0 end,
      item.id
  loop
    v_result := private.manual_department_command_status_v1(p_org_id,p_actor_id,v_scope,v_archives,
      v_item.category,v_item.action,v_item.id,v_item.args);
    if v_item.category='member' then
      if v_result->>'status'='ready' and v_item.action in ('transfer','remove_secondary') then
        -- Use exactly the same source, scope and personnel constraints as
        -- a single save. The two snapshots below perform reads only.
        begin
          if v_item.action='transfer' then
            perform private.member_department_transfer_snapshot_v1(p_org_id,p_actor_id,v_item.id,
              (v_item.args->>'departmentId')::uuid,false);
          else
            perform private.secondary_department_snapshot_v1(p_org_id,p_actor_id,v_item.id,
              array(select distinct item::uuid from jsonb_array_elements_text(v_item.args->'departmentIds') as item),'remove');
          end if;
        exception when no_data_found or invalid_parameter_value or check_violation or insufficient_privilege or serialization_failure then
          get stacked diagnostics v_error_detail=pg_exception_detail;
          v_result := v_result || jsonb_build_object('status','blocked','code',
            coalesce(nullif(v_error_detail,''),'DEPARTMENT_MEMBER_ACTION_BLOCKED'));
        end;
      end if;
      v_member_results := v_member_results || jsonb_build_array(v_result);
    else
      if v_item.action='archive' and v_result->>'code' in ('DEPARTMENT_HAS_MEMBER_BINDINGS','DEPARTMENT_HAS_ACTIVE_CHILDREN') then
        select jsonb_build_object(
          'members',coalesce((select jsonb_agg(member) from jsonb_array_elements(v_result#>'{details,members}') as member
            where not exists (
              select 1 from private.manual_department_command_rows_v1(v_command) as needed
              where needed.id::text=member->>'userId' and (
                needed.action='offboard'
                or (needed.action='transfer' and member->>'kind'='primary')
                or (needed.action='remove_secondary' and member->>'kind'='secondary'
                  and needed.args->'departmentIds' ? v_item.id::text)
              )
              and exists (select 1 from jsonb_array_elements(v_member_results) as result
                where result->>'userId'=member->>'userId'
                  and result->>'action'=needed.action and result->>'status'='ready')
            )),'[]'::jsonb),
          'activeChildren',coalesce((select jsonb_agg(child) from jsonb_array_elements(v_result#>'{details,activeChildren}') as child
            where child->>'source'<>'manual' or not exists (
              select 1 from jsonb_array_elements(v_dept_results) as result
              where result->>'departmentId'=child->>'departmentId'
                and result->>'action' in ('archive','reparent') and result->>'status'='ready'
            )),'[]'::jsonb)
        ) into v_related;
        if v_related='{"members":[],"activeChildren":[]}'::jsonb then
          if exists(select 1 from public.sales_spaces where org_id=p_org_id and department_id=v_item.id and status='active') then
            v_result := v_result || jsonb_build_object('code','DEPARTMENT_HAS_ACTIVE_SALES_SPACE','details',v_related);
          else
            v_result := (v_result-'code') || jsonb_build_object('status','ready',
              'details',v_result->'details' || '{"dependsOnSelectedActions":true}'::jsonb);
          end if;
        else
          v_result := v_result || jsonb_build_object('code',case when jsonb_array_length(v_related->'members')>0
            then 'DEPARTMENT_HAS_MEMBER_BINDINGS' else 'DEPARTMENT_HAS_ACTIVE_CHILDREN' end,'details',v_related);
        end if;
      end if;
      v_dept_results := v_dept_results || jsonb_build_array(v_result);
    end if;
  end loop;
  delete from private.manual_department_disposal_plans
    where org_id=p_org_id and actor_id=p_actor_id and expires_at<=clock_timestamp() and outcome is null;
  insert into private.manual_department_disposal_plans(
    org_id,actor_id,selected_ids,include_children,employment_filter,command,subjects,plan_hash,expires_at
  ) values (
    p_org_id,p_actor_id,v_ids,p_include_children,p_employment_filter,v_command,v_subjects,
    private.directory_transfer_digest_v1(jsonb_build_array(p_org_id,p_actor_id,v_ids,p_include_children,
      p_employment_filter,v_command,v_subjects)),clock_timestamp()+interval '15 minutes'
  ) returning * into v_plan;
  return private.manual_department_disposal_view_v1(p_org_id,p_actor_id,v_ids,p_include_children,p_employment_filter)
    || jsonb_build_object('planId',v_plan.id,'planHash',v_plan.plan_hash,'expiresAt',v_plan.expires_at,
      'memberResults',v_member_results,'departmentResults',v_dept_results);
end;
$$;

create function public.apply_manual_department_disposal_v1(
  p_org_id uuid,p_actor_id uuid,p_plan_id uuid,p_plan_hash text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_plan private.manual_department_disposal_plans%rowtype;
  v_scope uuid[];
  v_archives uuid[];
  v_member_fresh jsonb;
  v_department_fresh jsonb;
  v_item record;
  v_result jsonb;
  v_native jsonb;
  v_target uuid;
  v_choice_id uuid;
  v_previous_parent uuid;
  v_request_id text;
  v_error_detail text;
  v_lifecycle_outcome text;
  v_department_ids uuid[];
  v_outcome jsonb;
  v_member_results jsonb := '[]'::jsonb;
  v_dept_results jsonb := '[]'::jsonb;
begin
  perform private.lock_manual_department_disposal_org_v1(p_org_id,p_actor_id,true);
  select * into v_plan from private.manual_department_disposal_plans
    where id=p_plan_id and org_id=p_org_id and actor_id=p_actor_id for update;
  if not found then raise exception 'disposal plan not found' using errcode='P0002',detail='DEPARTMENT_DISPOSAL_NOT_FOUND'; end if;
  if p_plan_hash is distinct from v_plan.plan_hash then
    raise exception 'disposal review changed' using errcode='40001',detail='DEPARTMENT_DISPOSAL_STALE';
  end if;
  if v_plan.outcome is not null then return v_plan.outcome; end if;
  if v_plan.expires_at<=clock_timestamp() then
    raise exception 'disposal review expired' using errcode='40001',detail='DEPARTMENT_DISPOSAL_STALE';
  end if;

  v_scope := array(select * from private.manual_department_scope_v1(p_org_id,v_plan.selected_ids,v_plan.include_children));
  v_archives := array(select id from private.manual_department_command_rows_v1(v_plan.command) where action='archive');
  select coalesce(jsonb_object_agg(subject.id,
    private.manual_department_disposal_person_revision_v1(p_org_id,subject.id::uuid) is not distinct from subject.revision
  ),'{}'::jsonb) into v_member_fresh
    from jsonb_each_text(v_plan.subjects->'members') as subject(id,revision);
  select coalesce(jsonb_object_agg(subject.id,
    private.manual_department_disposal_dept_revision_v1(p_org_id,subject.id::uuid) is not distinct from subject.revision
  ),'{}'::jsonb) into v_department_fresh
    from jsonb_each_text(v_plan.subjects->'departments') as subject(id,revision);

  for v_item in
    select * from private.manual_department_command_rows_v1(v_plan.command) where category='member'
    order by case action when 'transfer' then 1 when 'remove_secondary' then 2 when 'suspend' then 3 else 4 end,id
  loop
    v_target := null;
    if v_item.action='transfer' then v_target := (v_item.args->>'departmentId')::uuid; end if;
    v_result := private.manual_department_command_status_v1(p_org_id,p_actor_id,v_scope,v_archives,
      v_item.category,v_item.action,v_item.id,v_item.args);

    if v_member_fresh->v_item.id::text is distinct from 'true'::jsonb
      or (v_target is not null and v_department_fresh->v_target::text is distinct from 'true'::jsonb) then
      v_result := v_result || '{"status":"blocked","code":"DEPARTMENT_DISPOSAL_STALE"}'::jsonb;
    elsif v_result->>'status'='ready' then
      begin
        v_choice_id := (v_item.args->>'choiceId')::uuid;
        v_request_id := case when v_choice_id is null then v_plan.id::text||':'||v_item.action||':'||v_item.id::text end;
        if v_item.action='transfer' then
          v_native := public.save_member_department_transfer_v1(p_org_id,p_actor_id,v_item.id,v_target,false,
            v_item.args->>'overrideChoice',v_choice_id,v_request_id);
        elsif v_item.action='remove_secondary' then
          v_department_ids := array(select distinct item::uuid
            from jsonb_array_elements_text(v_item.args->'departmentIds') as item order by item::uuid);
          v_native := public.save_member_secondary_department_change_v1(p_org_id,p_actor_id,v_item.id,v_department_ids,'remove',
            v_item.args->>'overrideChoice',v_choice_id,v_request_id);
        else
          select outcome into v_lifecycle_outcome from public.admin_apply_org_member_batch_v1(
            p_actor_id,p_org_id,array[v_item.id],v_item.action,array[]::uuid[],v_request_id);
          v_native := jsonb_build_object('status',case when v_lifecycle_outcome='saved' then 'applied' else 'blocked' end,
            'code',case when v_lifecycle_outcome<>'saved' then v_lifecycle_outcome end);
        end if;
        v_result := v_result || jsonb_build_object(
          'status',case v_native->>'status'
            when 'override_choice_required' then 'needs_review'
            when 'unchanged' then 'unchanged'
            when 'applied' then 'applied'
            else 'blocked' end,
          'code',case when v_native->>'status'='override_choice_required' then 'DEPARTMENT_OVERRIDE_CHOICE_REQUIRED'
            else v_native->>'code' end,
          'details',v_native
        );
      exception when no_data_found or invalid_parameter_value or check_violation or insufficient_privilege or serialization_failure then
        get stacked diagnostics v_error_detail=pg_exception_detail;
        v_result := v_result || jsonb_build_object('status','blocked','code',
          coalesce(nullif(v_error_detail,''),'DEPARTMENT_MEMBER_ACTION_BLOCKED'));
      end;
    end if;
    v_member_results := v_member_results || jsonb_build_array(v_result);
  end loop;

  for v_item in
    select * from private.manual_department_command_rows_v1(v_plan.command) where action='reparent' order by id
  loop
    v_target := (v_item.args->>'parentDepartmentId')::uuid;
    v_result := private.manual_department_command_status_v1(p_org_id,p_actor_id,v_scope,v_archives,
      v_item.category,v_item.action,v_item.id,v_item.args);
    if v_department_fresh->v_item.id::text is distinct from 'true'::jsonb
      or v_department_fresh->v_target::text is distinct from 'true'::jsonb then
      v_result := v_result || '{"status":"blocked","code":"DEPARTMENT_DISPOSAL_STALE"}'::jsonb;
    elsif v_result->>'status'='ready' then
      begin
        select parent_id into v_previous_parent from public.departments where org_id=p_org_id and id=v_item.id;
        v_native := public.admin_save_department_parent_change_v1(p_org_id,p_actor_id,v_item.id,
          jsonb_build_object('parent_id',v_target),v_previous_parent);
        v_result := v_result || jsonb_build_object('status','applied','details',v_native);
      exception when no_data_found or invalid_parameter_value or check_violation or insufficient_privilege or serialization_failure then
        get stacked diagnostics v_error_detail=pg_exception_detail;
        v_result := v_result || jsonb_build_object('status','blocked','code',
          coalesce(nullif(v_error_detail,''),'DEPARTMENT_REPARENT_BLOCKED'));
      end;
    end if;
    v_dept_results := v_dept_results || jsonb_build_array(v_result);
  end loop;

  -- A parent is visited after all selected active descendants, even if the
  -- old stored depth was stale. A rejected child keeps the parent blocked.
  for v_item in
    select item.* from private.manual_department_command_rows_v1(v_plan.command) as item where item.action='archive'
    order by (select count(*) from private.manual_department_scope_v1(p_org_id,array[item.id],true)),item.id
  loop
    if not (v_item.id = any(v_scope)) then
      v_result := jsonb_build_object('departmentId',v_item.id,'action','archive','status','blocked','code','DEPARTMENT_OUTSIDE_SCOPE');
    elsif v_department_fresh->v_item.id::text is distinct from 'true'::jsonb
      and private.manual_department_archive_probe_v1(p_org_id,v_item.id)->>'status' <> 'unchanged' then
      v_result := jsonb_build_object('departmentId',v_item.id,'action','archive','status','blocked','code','DEPARTMENT_DISPOSAL_STALE');
    else
      v_result := private.apply_manual_department_archive_v1(p_org_id,p_actor_id,v_item.id);
    end if;
    v_dept_results := v_dept_results || jsonb_build_array(v_result);
  end loop;

  v_outcome := private.manual_department_disposal_view_v1(p_org_id,p_actor_id,
    v_plan.selected_ids,v_plan.include_children,v_plan.employment_filter)
    || jsonb_build_object('planId',v_plan.id,'memberResults',v_member_results,'departmentResults',v_dept_results);
  update private.manual_department_disposal_plans set outcome=v_outcome where id=v_plan.id and org_id=p_org_id;
  return v_outcome;
end;
$$;

revoke all on function private.manual_department_scope_v1(uuid,uuid[],boolean),
  private.manual_department_disposal_links_v1(uuid,uuid[],uuid),
  private.manual_department_disposal_person_revision_v1(uuid,uuid),
  private.manual_department_disposal_dept_revision_v1(uuid,uuid),
  private.manual_department_archive_probe_v1(uuid,uuid),
  private.manual_department_disposal_view_v1(uuid,uuid,uuid[],boolean,text),
  private.manual_department_archive_authority_v1(uuid,uuid),
  private.lock_manual_department_disposal_org_v1(uuid,uuid,boolean),
  private.apply_manual_department_archive_v1(uuid,uuid,uuid),
  private.manual_department_command_rows_v1(jsonb),
  private.manual_department_command_status_v1(uuid,uuid,uuid[],uuid[],text,text,uuid,jsonb),
  public.archive_manual_department_v1(uuid,uuid,uuid),
  public.list_manual_department_archives_v1(uuid,uuid,text),
  public.restore_manual_department_v1(uuid,uuid,uuid,uuid,uuid),
  public.preview_manual_department_disposal_v1(uuid,uuid,uuid[],boolean,text,jsonb),
  public.apply_manual_department_disposal_v1(uuid,uuid,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.archive_manual_department_v1(uuid,uuid,uuid),
  public.list_manual_department_archives_v1(uuid,uuid,text),
  public.restore_manual_department_v1(uuid,uuid,uuid,uuid,uuid),
  public.preview_manual_department_disposal_v1(uuid,uuid,uuid[],boolean,text,jsonb),
  public.apply_manual_department_disposal_v1(uuid,uuid,uuid,text)
  to service_role;

commit;

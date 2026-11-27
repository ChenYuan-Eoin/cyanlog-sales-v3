-- A secondary relationship changes the employee's departmental authorization
-- context. Keep invitation initialization and legacy requests with no delta.
begin;

create table private.member_secondary_department_previews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid not null references public.users(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  action text not null check (action in ('add', 'remove')),
  department_ids uuid[] not null,
  snapshot_hash bytea not null,
  expires_at timestamptz not null,
  unique (org_id, actor_id, user_id)
);
create index member_secondary_department_previews_expiry
  on private.member_secondary_department_previews (org_id, expires_at);
alter table private.member_secondary_department_previews enable row level security;
revoke all on private.member_secondary_department_previews from public, anon, authenticated, service_role;

create function private.secondary_department_snapshot_v1(
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
    or coalesce(cardinality(p_department_ids), 0) not between 1 and 100
    or array_position(p_department_ids, null) is not null
    or (p_action = 'remove' and cardinality(p_department_ids) <> 1) then
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

create function public.preview_member_secondary_department_change_v1(
  p_org_id uuid, p_actor_id uuid, p_user_id uuid, p_department_ids uuid[], p_action text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_snapshot jsonb;
  v_preview_id uuid;
  v_expires_at timestamptz;
begin
  perform private.assert_member_department_transfer_actor_v1(p_org_id, p_actor_id);
  v_snapshot := private.secondary_department_snapshot_v1(p_org_id, p_actor_id, p_user_id, p_department_ids, p_action);
  if jsonb_array_length(v_snapshot->'affected_department_ids') = 0 then
    return v_snapshot || jsonb_build_object('preview_id', null, 'expires_at', null);
  end if;
  v_expires_at := clock_timestamp() + interval '10 minutes';
  delete from private.member_secondary_department_previews
    where org_id = p_org_id and expires_at <= clock_timestamp();
  insert into private.member_secondary_department_previews as preview (
    org_id, actor_id, user_id, department_ids, action, snapshot_hash, expires_at
  ) values (
    p_org_id, p_actor_id, p_user_id, p_department_ids, p_action,
    sha256(convert_to(v_snapshot::text, 'UTF8')), v_expires_at
  )
  on conflict (org_id, actor_id, user_id) do update
    set id = gen_random_uuid(), department_ids = excluded.department_ids, action = excluded.action,
      snapshot_hash = excluded.snapshot_hash, expires_at = excluded.expires_at
  returning preview.id into v_preview_id;
  return jsonb_build_object(
    'action', p_action, 'affected_department_ids', v_snapshot->'affected_department_ids', 'impact', v_snapshot->'impact',
    'preview_id', v_preview_id, 'expires_at', v_expires_at
  );
end;
$$;

create function public.confirm_member_secondary_department_change_v1(
  p_org_id uuid, p_actor_id uuid, p_user_id uuid, p_preview_id uuid, p_request_id text default null
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_preview private.member_secondary_department_previews%rowtype;
  v_snapshot jsonb;
  v_affected uuid[];
  v_written bigint;
  v_effective_at timestamptz;
begin
  perform private.assert_member_department_transfer_actor_v1(p_org_id, p_actor_id);
  select * into v_preview from private.member_secondary_department_previews
    where id = p_preview_id and org_id = p_org_id and actor_id = p_actor_id
      and user_id = p_user_id and expires_at > clock_timestamp()
    for update;
  if not found then
    raise exception 'secondary department preview is unavailable'
      using errcode = '40001', detail = 'SECONDARY_DEPARTMENT_STALE';
  end if;
  v_snapshot := private.secondary_department_snapshot_v1(
    p_org_id, p_actor_id, p_user_id, v_preview.department_ids, v_preview.action
  );
  if v_preview.expires_at <= clock_timestamp()
    or v_preview.snapshot_hash <> sha256(convert_to(v_snapshot::text, 'UTF8')) then
    raise exception 'secondary department affiliation or authorization changed after review'
      using errcode = '40001', detail = 'SECONDARY_DEPARTMENT_STALE';
  end if;

  v_effective_at := clock_timestamp();
  select array(select id::uuid from jsonb_array_elements_text(v_snapshot->'affected_department_ids') as changed(id)) into v_affected;
  perform private.apply_department_change_impact_v1(
    p_org_id, p_actor_id, p_user_id, v_snapshot->'impact', v_effective_at
  );
  if v_preview.action = 'add' then
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
    jsonb_build_object('department_ids', v_snapshot->'before_department_ids'),
    jsonb_build_object(
      'department_ids', v_snapshot->'after_department_ids', 'action', v_preview.action,
      'affected_department_ids', v_affected, 'effective_at', v_effective_at
    ),
    'confirmed manual secondary department change', p_request_id
  );
  delete from private.member_secondary_department_previews where id = v_preview.id;
  return jsonb_build_object(
    'action', v_preview.action, 'affected_department_ids', v_affected, 'effective_at', v_effective_at,
    'impact', v_snapshot->'impact'
  );
end;
$$;

alter function public.admin_change_manual_department_membership_v1(uuid, uuid, uuid, uuid[], text) set schema private;
revoke all on function private.admin_change_manual_department_membership_v1(uuid, uuid, uuid, uuid[], text)
  from public, anon, authenticated, service_role;

create function public.admin_change_manual_department_membership_v1(
  p_actor_id uuid, p_org_id uuid, p_user_id uuid, p_department_ids uuid[], p_action text
) returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  v_primary uuid;
begin
  if p_action = 'initialize' then
    return private.admin_change_manual_department_membership_v1(
      p_actor_id, p_org_id, p_user_id, p_department_ids, p_action
    );
  end if;
  if p_action is null or p_action not in ('add', 'remove')
    or coalesce(cardinality(p_department_ids), 0) = 0
    or (p_action = 'remove' and cardinality(p_department_ids) <> 1) then
    raise exception 'invalid legacy secondary department change' using errcode = '22023';
  end if;

  perform private.personnel_lock_org_v1(p_org_id);
  select primary_dept_id into v_primary from public.users
    where id = p_user_id and org_id = p_org_id for update;
  if not found or v_primary = any(p_department_ids)
    or (select count(*) from public.departments where id = any(p_department_ids) and org_id = p_org_id)
      <> cardinality(p_department_ids) then
    return false;
  end if;
  if (p_action = 'add' and not exists (
    select 1 from unnest(p_department_ids) as requested(id)
    where not exists (
      select 1 from public.user_departments where org_id = p_org_id and user_id = p_user_id and department_id = requested.id
    )
  )) or (p_action = 'remove' and not exists (
    select 1 from public.user_departments where org_id = p_org_id and user_id = p_user_id
      and department_id = p_department_ids[1] and is_primary is false
  )) then
    return true;
  end if;
  raise exception 'secondary department changes require a confirmed preview'
    using errcode = '40001', detail = 'SECONDARY_DEPARTMENT_PREVIEW_REQUIRED';
end;
$$;

revoke all on function private.secondary_department_snapshot_v1(uuid, uuid, uuid, uuid[], text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_change_manual_department_membership_v1(uuid, uuid, uuid, uuid[], text),
  public.preview_member_secondary_department_change_v1(uuid, uuid, uuid, uuid[], text),
  public.confirm_member_secondary_department_change_v1(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.admin_change_manual_department_membership_v1(uuid, uuid, uuid, uuid[], text),
  public.preview_member_secondary_department_change_v1(uuid, uuid, uuid, uuid[], text),
  public.confirm_member_secondary_department_change_v1(uuid, uuid, uuid, uuid, text)
  to service_role;

commit;

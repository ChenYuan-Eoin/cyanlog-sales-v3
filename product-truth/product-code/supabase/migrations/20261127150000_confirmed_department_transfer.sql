-- A confirmed transfer is bound to a fresh before/after preview for one actor and tenant.
begin;

create table private.member_department_transfer_previews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  actor_id uuid not null references public.users (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  department_id uuid not null references public.departments (id) on delete cascade,
  keep_previous boolean not null,
  snapshot_hash bytea not null,
  expires_at timestamptz not null,
  unique (org_id, actor_id, user_id)
);

create index member_department_transfer_previews_expiry
  on private.member_department_transfer_previews (org_id, expires_at);

alter table private.member_department_transfer_previews enable row level security;
revoke all on private.member_department_transfer_previews from public, anon, authenticated, service_role;

create function private.assert_member_department_transfer_actor_v1(p_org_id uuid, p_actor_id uuid)
returns void language plpgsql set search_path = ''
as $$
begin
  perform private.personnel_lock_org_v1(p_org_id);
  perform 1 from public.organizations as organization
  where organization.id = p_org_id and organization.status = 'active'
  for no key update;

  if not found or not private.personnel_is_org_control_admin_v1(p_actor_id, p_org_id) then
    raise exception 'system authorization is required for a department transfer'
      using errcode = '42501', detail = 'DEPARTMENT_TRANSFER_FORBIDDEN';
  end if;
end;
$$;

create function private.member_department_transfer_snapshot_v1(
  p_org_id uuid, p_actor_id uuid, p_user_id uuid, p_department_id uuid, p_keep_previous boolean
)
returns jsonb language plpgsql set search_path = ''
as $$
declare
  v_member record;
  v_target record;
  v_previous uuid;
  v_primary_rows uuid[];
  v_affiliations jsonb;
  v_secondary uuid[];
  v_authority jsonb;
begin
  if p_user_id is null or p_department_id is null or p_keep_previous is null then
    raise exception 'department transfer selection is required'
      using errcode = '22023', detail = 'DEPARTMENT_TRANSFER_INVALID_TARGET';
  end if;
  if p_user_id = p_actor_id then
    raise exception 'cannot transfer the current operator'
      using errcode = '42501', detail = 'DEPARTMENT_TRANSFER_PROTECTED';
  end if;

  select member.primary_department_id, member.membership_version, person.primary_dept_id
    into v_member
  from public.user_organizations as member
  join public.users as person on person.id = member.user_id and person.org_id = member.org_id
  where member.org_id = p_org_id and member.user_id = p_user_id and member.status = 'active'
    and member.employment_status = 'active' and member.left_at is null
  for update of member, person;

  if not found then
    raise exception 'active member not found in organization'
      using errcode = 'P0002', detail = 'DEPARTMENT_TRANSFER_NOT_FOUND';
  end if;
  if private.has_exact_org_role_v1(p_user_id, p_org_id, 'SUPER_ADMIN') then
    raise exception 'cannot transfer a protected system administrator'
      using errcode = '42501', detail = 'DEPARTMENT_TRANSFER_PROTECTED';
  end if;

  select department.id, department.name, department.parent_id, department.source, department.updated_at
    into v_target
  from public.departments as department
  where department.org_id = p_org_id and department.id = p_department_id and department.status = 'active'
  for share of department;

  if not found then
    raise exception 'active destination is not in the organization'
      using errcode = '22023', detail = 'DEPARTMENT_TRANSFER_INVALID_TARGET';
  end if;

  select
    coalesce(array_agg(membership.department_id order by membership.department_id)
      filter (where membership.is_primary), array[]::uuid[]),
    coalesce(jsonb_agg(jsonb_build_object(
      'department_id', membership.department_id, 'is_primary', membership.is_primary,
      'source', membership.source, 'joined_at', membership.joined_at
    ) order by membership.department_id), '[]'::jsonb)
    into v_primary_rows, v_affiliations
  from public.user_departments as membership
  where membership.org_id = p_org_id and membership.user_id = p_user_id;

  v_previous := coalesce(v_member.primary_department_id, v_member.primary_dept_id, v_primary_rows[1]);
  if cardinality(v_primary_rows) > 1
    or (v_member.primary_department_id is not null and v_member.primary_department_id is distinct from v_previous)
    or (v_member.primary_dept_id is not null and v_member.primary_dept_id is distinct from v_previous)
    or (v_primary_rows[1] is not null and v_primary_rows[1] is distinct from v_previous) then
    raise exception 'existing primary affiliations disagree'
      using errcode = '40001', detail = 'DEPARTMENT_TRANSFER_STALE';
  end if;

  if exists (
    select 1
    from public.organization_sources as source
    where source.system_org_id = p_org_id
      and source.authority_scope->>'directory' in ('authoritative', 'true')
      and (
        exists (
          select 1 from public.external_identities as identity
          where identity.system_org_id = p_org_id and identity.source_id = source.id
            and identity.canonical_user_id = p_user_id and identity.match_status = 'matched'
        )
        or exists (
          select 1 from public.user_departments as membership
          where membership.org_id = p_org_id and membership.user_id = p_user_id
            and membership.source = source.provider
            and membership.department_id in (v_previous, p_department_id)
        )
      )
  ) then
    raise exception 'the authoritative directory owns this department relationship'
      using errcode = '42501', detail = 'DEPARTMENT_TRANSFER_EXTERNAL_SOURCE';
  end if;

  if v_previous = p_department_id then
    raise exception 'the department has not changed'
      using errcode = '22023', detail = 'DEPARTMENT_TRANSFER_NO_CHANGE';
  end if;

  select array(
    select membership.department_id
    from public.user_departments as membership
    where membership.org_id = p_org_id and membership.user_id = p_user_id
      and membership.department_id <> p_department_id
      and (membership.department_id is distinct from v_previous or p_keep_previous)
    union
    select v_previous where v_previous is not null and p_keep_previous
    order by 1
  ) into v_secondary;

  -- Bind department ancestry and role definitions so a changed data range
  -- or role definition cannot be approved using an earlier preview.
  with recursive ancestors(id, parent_id, path) as (
    select department.id, department.parent_id, array[department.id]
    from public.departments as department
    where department.org_id = p_org_id
      and (department.id in (v_previous, p_department_id) or department.id = any(v_secondary))
    union all
    select parent.id, parent.parent_id, child.path || parent.id
    from ancestors as child
    join public.departments as parent on parent.id = child.parent_id
    where parent.org_id = p_org_id and not parent.id = any(child.path)
  )
  select jsonb_build_object(
    'organization_settings', (select settings from public.organizations where id = p_org_id),
    'department_ancestry', (select jsonb_agg(to_jsonb(branch) order by branch.id)
      from (select distinct id, parent_id from ancestors) as branch),
    'role_definitions', (
      select jsonb_agg(jsonb_build_array(role.id, role.permissions, assignment.scope_type, assignment.scope_id)
        order by role.id, assignment.scope_type, assignment.scope_id)
      from public.user_roles as assignment
      join public.roles as role on role.id = assignment.role_id
      where assignment.org_id = p_org_id and assignment.user_id = p_user_id
    )
  ) into v_authority;

  return jsonb_build_object(
    'previous_department_id', v_previous, 'department_id', p_department_id,
    'secondary_department_ids', to_jsonb(v_secondary),
    'impact', private.department_transfer_impact_v1(p_org_id, p_user_id, v_previous, p_department_id, p_keep_previous),
    'affiliations', v_affiliations, 'membership_version', v_member.membership_version,
    'destination', to_jsonb(v_target), 'authority', v_authority
  );
end;
$$;

create function public.preview_member_department_transfer_v1(
  p_org_id uuid, p_actor_id uuid, p_user_id uuid, p_department_id uuid, p_keep_previous boolean
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_preview_id uuid;
  v_expires_at timestamptz;
  v_snapshot jsonb;
begin
  perform private.assert_member_department_transfer_actor_v1(p_org_id, p_actor_id);
  v_snapshot := private.member_department_transfer_snapshot_v1(
    p_org_id, p_actor_id, p_user_id, p_department_id, p_keep_previous
  );
  v_expires_at := clock_timestamp() + interval '10 minutes';

  delete from private.member_department_transfer_previews as preview
  where preview.org_id = p_org_id and preview.expires_at <= clock_timestamp();

  insert into private.member_department_transfer_previews as preview (
    org_id, actor_id, user_id, department_id, keep_previous, snapshot_hash, expires_at
  ) values (
    p_org_id, p_actor_id, p_user_id, p_department_id, p_keep_previous,
    sha256(convert_to(v_snapshot::text, 'UTF8')), v_expires_at
  )
  on conflict (org_id, actor_id, user_id) do update
    set id = gen_random_uuid(), department_id = excluded.department_id,
      keep_previous = excluded.keep_previous, snapshot_hash = excluded.snapshot_hash, expires_at = excluded.expires_at
  returning preview.id into v_preview_id;

  return (v_snapshot - array['affiliations', 'membership_version', 'destination', 'authority'])
    || jsonb_build_object('preview_id', v_preview_id, 'expires_at', v_expires_at);
end;
$$;

create function public.confirm_member_department_transfer_v1(
  p_org_id uuid, p_actor_id uuid, p_user_id uuid, p_preview_id uuid, p_request_id text default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_preview private.member_department_transfer_previews%rowtype;
  v_snapshot jsonb;
  v_previous uuid;
  v_effective_at timestamptz;
  v_result jsonb;
begin
  perform private.assert_member_department_transfer_actor_v1(p_org_id, p_actor_id);
  select * into v_preview
  from private.member_department_transfer_previews as preview
  where preview.id = p_preview_id and preview.org_id = p_org_id
    and preview.actor_id = p_actor_id and preview.user_id = p_user_id and preview.expires_at > clock_timestamp()
  for update;
  if not found then
    raise exception 'the department transfer preview is unavailable'
      using errcode = '40001', detail = 'DEPARTMENT_TRANSFER_STALE';
  end if;

  v_snapshot := private.member_department_transfer_snapshot_v1(
    p_org_id, p_actor_id, p_user_id, v_preview.department_id, v_preview.keep_previous
  );
  if v_preview.expires_at <= clock_timestamp()
    or v_preview.snapshot_hash <> sha256(convert_to(v_snapshot::text, 'UTF8')) then
    raise exception 'organization membership or authorization changed after the preview'
      using errcode = '40001', detail = 'DEPARTMENT_TRANSFER_STALE';
  end if;

  v_previous := (v_snapshot->>'previous_department_id')::uuid;
  v_effective_at := clock_timestamp();
  perform private.reconcile_department_transfer_v1(
    p_org_id, p_actor_id, p_user_id, v_previous, v_preview.department_id, v_preview.keep_previous, v_effective_at
  );

  update public.users
  set primary_dept_id = v_preview.department_id, updated_at = v_effective_at
  where id = p_user_id and org_id = p_org_id;

  update public.user_organizations
  set primary_department_id = v_preview.department_id, membership_version = membership_version + 1,
    updated_at = v_effective_at, updated_by = p_actor_id
  where user_id = p_user_id and org_id = p_org_id;

  if v_previous is not null then
    if v_preview.keep_previous then
      insert into public.user_departments (user_id, department_id, org_id, is_primary, joined_at)
      values (p_user_id, v_previous, p_org_id, false, v_effective_at)
      on conflict (user_id, department_id) do update set is_primary = false;
    else
      delete from public.user_departments
      where user_id = p_user_id and org_id = p_org_id and department_id = v_previous;
    end if;
  end if;

  insert into public.user_departments (user_id, department_id, org_id, is_primary, joined_at)
  values (p_user_id, v_preview.department_id, p_org_id, true, v_effective_at)
  on conflict (user_id, department_id) do update set is_primary = true;

  update public.personnel_employment_periods
  set department_id = v_preview.department_id, updated_at = v_effective_at
  where user_id = p_user_id and org_id = p_org_id and status in ('active', 'suspended');

  v_result := jsonb_build_object(
    'department_id', v_preview.department_id, 'secondary_department_ids', v_snapshot->'secondary_department_ids',
    'effective_at', v_effective_at, 'impact', v_snapshot->'impact'
  );
  perform private.personnel_insert_event_v1(
    p_org_id, p_user_id, p_actor_id, 'confirm_department_transfer',
    jsonb_build_object('primary_department_id', v_previous, 'affiliations', v_snapshot->'affiliations'),
    v_result || jsonb_build_object(
      'keep_previous_as_secondary', v_preview.keep_previous,
      'affiliations', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'department_id', membership.department_id, 'is_primary', membership.is_primary,
          'source', membership.source, 'joined_at', membership.joined_at
        ) order by membership.department_id), '[]'::jsonb)
        from public.user_departments as membership
        where membership.org_id = p_org_id and membership.user_id = p_user_id
      )
    ),
    'confirmed department transfer', p_request_id
  );

  -- Consuming the token is committed with the transfer. A rollback leaves the
  -- preview available without an applied transfer or a partial authorization change.
  delete from private.member_department_transfer_previews where id = v_preview.id;
  return v_result;
end;
$$;

-- Older profile clients submit the saved department again with profile fields.
-- Leave that no-op usable during rollout and require preview for a real change.
create or replace function public.admin_transfer_primary_department_v1(
  p_actor_id uuid, p_org_id uuid, p_user_id uuid, p_department_id uuid,
  p_reason text default null, p_request_id text default null
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  v_current uuid;
begin
  perform private.personnel_lock_org_v1(p_org_id);
  select person.primary_dept_id into v_current
  from public.users as person
  join public.user_organizations as member on member.user_id = person.id and member.org_id = person.org_id
  where person.id = p_user_id and person.org_id = p_org_id and member.status = 'active'
  for update of person, member;
  if not found then return false; end if;
  if v_current is distinct from p_department_id then
    raise exception 'preview and confirmation are required for a department change'
      using errcode = '40001', detail = 'DEPARTMENT_TRANSFER_PREVIEW_REQUIRED';
  end if;
  return true;
end;
$$;

revoke all on function private.assert_member_department_transfer_actor_v1(uuid, uuid),
  private.member_department_transfer_snapshot_v1(uuid, uuid, uuid, uuid, boolean)
  from public, anon, authenticated, service_role;

revoke all on function public.admin_transfer_primary_department_v1(uuid, uuid, uuid, uuid, text, text),
  public.preview_member_department_transfer_v1(uuid, uuid, uuid, uuid, boolean),
  public.confirm_member_department_transfer_v1(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.admin_transfer_primary_department_v1(uuid, uuid, uuid, uuid, text, text),
  public.preview_member_department_transfer_v1(uuid, uuid, uuid, uuid, boolean),
  public.confirm_member_department_transfer_v1(uuid, uuid, uuid, uuid, text)
  to service_role;

commit;

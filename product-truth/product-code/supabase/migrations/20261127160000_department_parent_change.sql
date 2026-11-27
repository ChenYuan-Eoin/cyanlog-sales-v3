-- Apply a department parent change atomically against the current authorized tree.
begin;

create table private.department_parent_change_audit (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  department_id uuid not null,
  actor_id uuid not null,
  before_state jsonb not null,
  after_state jsonb not null,
  impact jsonb not null,
  effective_at timestamptz not null default clock_timestamp()
);
create index department_parent_change_audit_department
  on private.department_parent_change_audit (org_id, department_id, effective_at desc);

alter table private.department_parent_change_audit enable row level security;
revoke all on private.department_parent_change_audit
  from public, anon, authenticated, service_role;

-- Authorization-changing commands serialize on the same organization lock.
-- A direct PostgREST update must use the reviewed path. Directory jobs already
-- use their own confirmed SECURITY DEFINER commands under the same lock.
create function private.guard_direct_department_parent_update_v1()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated', 'service_role') then
    raise exception 'department parent changes require the controlled command'
      using errcode = '42501', detail = 'DEPARTMENT_PARENT_CHANGE_COMMAND_REQUIRED';
  end if;
  return new;
end;
$$;

create trigger guard_direct_department_parent_update
before update of parent_id on public.departments
for each row when (old.parent_id is distinct from new.parent_id)
execute function private.guard_direct_department_parent_update_v1();

create function private.department_parent_change_snapshot_v1(
  p_org_id uuid, p_department_id uuid, p_changes jsonb, p_expected_parent_id uuid
)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_current record;
  v_parent_id uuid;
  v_leader_id uuid;
  v_ancestors uuid[] := array[]::uuid[];
  v_before_tree jsonb;
  v_after_tree jsonb;
  v_before_state jsonb;
  v_authority jsonb;
begin
  if jsonb_typeof(p_changes) is distinct from 'object' then
    raise exception 'invalid department parent change' using errcode = '22023';
  end if;
  if not (p_changes ? 'parent_id')
    or (p_changes - array['parent_id', 'name', 'code', 'leader_id', 'sort_order']) <> '{}'::jsonb
    or jsonb_typeof(p_changes->'parent_id') not in ('null', 'string')
    or (p_changes ? 'leader_id' and jsonb_typeof(p_changes->'leader_id') not in ('null', 'string'))
    or (p_changes ? 'name' and (jsonb_typeof(p_changes->'name') <> 'string'
      or char_length(btrim(p_changes->>'name')) not between 1 and 80))
    or (p_changes ? 'code' and (jsonb_typeof(p_changes->'code') <> 'string'
      or char_length(btrim(p_changes->>'code')) not between 1 and 50))
    or (p_changes ? 'sort_order' and (jsonb_typeof(p_changes->'sort_order') <> 'number'
      or (p_changes->>'sort_order') !~ '^[0-9]{1,10}$')) then
    raise exception 'invalid department parent change' using errcode = '22023';
  end if;
  if p_changes ? 'sort_order' and (p_changes->>'sort_order')::bigint > 2147483647 then
    raise exception 'invalid department order' using errcode = '22023';
  end if;
  begin
    v_parent_id := (p_changes->>'parent_id')::uuid;
    v_leader_id := (p_changes->>'leader_id')::uuid;
  exception when invalid_text_representation then
    raise exception 'invalid department parent or leader ID' using errcode = '22023';
  end;

  -- Keep ordinary edits and inserts through an existing parent from changing
  -- the affected hierarchy after the snapshot has been checked.
  perform 1 from public.departments where org_id = p_org_id order by id for update;
  select id, parent_id, name, code, sort_order, leader_id into v_current
  from public.departments where org_id = p_org_id and id = p_department_id and status = 'active';
  if not found then raise exception 'active department not found' using errcode = 'P0002'; end if;
  if v_current.parent_id is distinct from p_expected_parent_id then
    raise exception 'department parent changed'
      using errcode = '40001', detail = 'DEPARTMENT_PARENT_CHANGED';
  end if;
  if v_current.parent_id is not distinct from v_parent_id then
    raise exception 'department parent has not changed' using errcode = '22023', detail = 'DEPARTMENT_PARENT_UNCHANGED';
  end if;
  if v_parent_id is not null then
    if not exists (select 1 from public.departments where org_id = p_org_id and id = v_parent_id and status = 'active') then
      raise exception 'active parent department not found' using errcode = '23514', detail = 'INVALID_DEPARTMENT_PARENT';
    end if;
    with recursive ancestors as (
      select id, parent_id, array[id] as visited
      from public.departments where org_id = p_org_id and id = v_parent_id
      union all
      select parent.id, parent.parent_id, child.visited || parent.id
      from ancestors as child
      join public.departments as parent on parent.org_id = p_org_id and parent.id = child.parent_id
      where parent.id <> all(child.visited)
    )
    select visited into v_ancestors from ancestors where parent_id is null;
    if v_ancestors is null or p_department_id = any(v_ancestors) then
      raise exception 'invalid department hierarchy' using errcode = '23514', detail = 'DEPARTMENT_PARENT_CYCLE';
    end if;
  end if;
  if v_leader_id is not null then
    perform 1 from public.users
    where id = v_leader_id and org_id = p_org_id and status <> 'inactive' for share;
    if not found then
      raise exception 'department leader not found' using errcode = '23514', detail = 'INVALID_LEADER';
    end if;
  end if;
  if p_changes ? 'code' and exists (
    select 1 from public.departments
    where org_id = p_org_id and id <> p_department_id and code = btrim(p_changes->>'code')
  ) then
    raise exception 'department code already exists' using errcode = '23505', detail = 'DEPARTMENT_CODE_EXISTS';
  end if;

  v_before_state := to_jsonb(v_current);
  v_before_tree := private.directory_transfer_tree_v1(p_org_id);
  select jsonb_agg(
    case when item->>'id' = p_department_id::text then item || jsonb_build_object(
      'parent_id', v_parent_id,
      'leader_id', case when p_changes ? 'leader_id' then v_leader_id else v_current.leader_id end
    ) else item end order by item->>'id'
  ) into v_after_tree from jsonb_array_elements(v_before_tree) as tree(item);
  v_authority := private.directory_department_authority_impact_v1(p_org_id, v_before_tree, v_after_tree);
  if jsonb_typeof(v_authority->'summary') is distinct from 'object'
    or v_authority->'revision' is null then
    raise exception 'department authorization impact unavailable' using errcode = '55000';
  end if;
  return jsonb_build_object(
    'before_state', v_before_state,
    'ancestors', to_jsonb(v_ancestors),
    'impact', v_authority->'summary'
  );
end;
$$;

create function public.admin_save_department_parent_change_v1(
  p_org_id uuid, p_actor_id uuid, p_department_id uuid, p_changes jsonb, p_expected_parent_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_snapshot jsonb;
  v_updated record;
  v_row record;
  v_path text := '/';
  v_depth integer := 0;
begin
  perform private.personnel_lock_org_v1(p_org_id);
  if not coalesce(private.personnel_is_org_control_admin_v1(p_actor_id, p_org_id), false) then
    raise exception 'department parent changes require system authorization' using errcode = '42501';
  end if;
  v_snapshot := private.department_parent_change_snapshot_v1(p_org_id, p_department_id, p_changes, p_expected_parent_id);

  -- Correct any old stored paths before using the normal path trigger. Walk
  -- parents first so each trigger always reads a canonical parent path.
  for v_row in
    select value::uuid as id from jsonb_array_elements_text(v_snapshot->'ancestors') with ordinality as ancestor(value, position)
    order by position desc
  loop
    v_path := v_path || v_row.id::text || '/';
    update public.departments set path = v_path, depth = v_depth
    where org_id = p_org_id and id = v_row.id and (path is distinct from v_path or depth is distinct from v_depth);
    v_depth := v_depth + 1;
  end loop;

  update public.departments
    set parent_id = (p_changes->>'parent_id')::uuid,
      name = case when p_changes ? 'name' then btrim(p_changes->>'name') else name end,
      code = case when p_changes ? 'code' then btrim(p_changes->>'code') else code end,
      leader_id = case when p_changes ? 'leader_id' then (p_changes->>'leader_id')::uuid else leader_id end,
      sort_order = case when p_changes ? 'sort_order' then (p_changes->>'sort_order')::integer else sort_order end,
      updated_at = clock_timestamp()
  where org_id = p_org_id and id = p_department_id
  returning id, name, code, depth, parent_id, sort_order, member_count, leader_id, path into v_updated;

  for v_row in
    with recursive branch as (
      select v_updated.id as id, v_updated.path as path, v_updated.depth as depth
      union all
      select child.id, branch.path || child.id::text || '/', branch.depth + 1
      from branch join public.departments as child on child.org_id = p_org_id and child.parent_id = branch.id
    )
    select * from branch where id <> p_department_id order by depth, id
  loop
    update public.departments set path = v_row.path, depth = v_row.depth
    where org_id = p_org_id and id = v_row.id and (path is distinct from v_row.path or depth is distinct from v_row.depth);
  end loop;

  insert into private.department_parent_change_audit (org_id, department_id, actor_id, before_state, after_state, impact)
  values (p_org_id, p_department_id, p_actor_id, v_snapshot->'before_state', to_jsonb(v_updated) - 'path', v_snapshot->'impact');
  return jsonb_build_object('department', to_jsonb(v_updated) - 'path');
end;
$$;

revoke all on function private.guard_direct_department_parent_update_v1(),
  private.department_parent_change_snapshot_v1(uuid, uuid, jsonb, uuid),
  public.admin_save_department_parent_change_v1(uuid, uuid, uuid, jsonb, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_save_department_parent_change_v1(uuid, uuid, uuid, jsonb, uuid) to service_role;

commit;

-- WP46: a confirmed department leader can use department-scoped workspace views.
begin;

create table public.department_lead_access (
  org_id uuid not null,
  department_id uuid not null references public.departments(id) on delete cascade,
  user_id uuid not null,
  confirmed_by uuid references public.users(id) on delete set null,
  confirmed_at timestamptz not null default now(),
  primary key (org_id, department_id),
  foreign key (user_id, org_id)
    references public.user_organizations(user_id, org_id) on delete cascade
);

create index department_lead_access_org_user_idx
  on public.department_lead_access(org_id, user_id);
create index department_lead_access_department_idx
  on public.department_lead_access(department_id);

alter table public.department_lead_access enable row level security;
revoke all on table public.department_lead_access from public, anon, authenticated, service_role;
grant select on table public.department_lead_access to service_role;

create function private.can_manage_department_lead_access_v1(p_actor_id uuid, p_org_id uuid)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_role_id uuid;
  v_settings jsonb;
  v_overrides jsonb;
  v_permissions jsonb;
begin
  select r.id, org.settings into v_role_id, v_settings
    from public.user_organizations as membership
    join public.users as actor on actor.id = membership.user_id
    join public.organizations as org on org.id = membership.org_id
    join public.user_roles as assignment
      on assignment.user_id = membership.user_id and assignment.org_id = membership.org_id
      and assignment.scope_type = 'org' and assignment.scope_id = membership.org_id
    join public.roles as r on r.id = assignment.role_id and r.code = 'SUPER_ADMIN'
   where membership.user_id = p_actor_id and membership.org_id = p_org_id
     and membership.is_default and membership.status = 'active'
     and membership.employment_status = 'active' and membership.left_at is null
     and actor.status = 'active' and actor.login_enabled = true and org.status = 'active';
  if not found then return false; end if;

  -- The original organization-root role has the template wildcard. Match the
  -- application policy for overrides, including fail-closed malformed settings.
  if v_settings is null or v_settings = 'null'::jsonb then return true; end if;
  if jsonb_typeof(v_settings) <> 'object' then return false; end if;
  if not (v_settings ? 'role_permission_overrides') then return true; end if;
  v_overrides := v_settings->'role_permission_overrides';
  if jsonb_typeof(v_overrides) <> 'object' then return false; end if;
  if not (v_overrides ? v_role_id::text) then return true; end if;
  v_permissions := v_overrides->v_role_id::text;
  if jsonb_typeof(v_permissions) <> 'array' then return false; end if;
  if exists (
    select 1 from jsonb_array_elements(v_permissions) as permission(value)
     where jsonb_typeof(permission.value) <> 'string' or permission.value = '""'::jsonb
  ) then return false; end if;
  return v_permissions ?| array['*', 'role:*', 'role:manage'];
end;
$$;
revoke all on function private.can_manage_department_lead_access_v1(uuid, uuid)
  from public, anon, authenticated;

create function public.admin_get_department_lead_access_v1(
  p_actor_id uuid,
  p_org_id uuid,
  p_department_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.can_manage_department_lead_access_v1(p_actor_id, p_org_id) then
    raise exception 'department leadership access administration denied' using errcode = '42501';
  end if;
  select jsonb_build_object('leaderId', dept.leader_id, 'userId', access.user_id)
    into v_result
    from public.departments as dept
    left join public.department_lead_access as access
      on access.org_id = dept.org_id and access.department_id = dept.id
      and access.user_id = dept.leader_id
   where dept.id = p_department_id and dept.org_id = p_org_id and dept.status = 'active';
  if not found then
    raise exception 'active department not found' using errcode = 'P0002';
  end if;
  return v_result;
end;
$$;

create function public.admin_set_department_lead_access_v1(
  p_actor_id uuid,
  p_org_id uuid,
  p_department_id uuid,
  p_user_id uuid,
  p_expected_user_id uuid,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_leader_id uuid;
  v_before_user_id uuid;
begin
  perform private.personnel_lock_org_v1(p_org_id);
  -- Role permission overrides also have callers which update organization
  -- settings outside the personnel lock. Recheck the locked settings.
  perform 1 from public.organizations where id = p_org_id for share;
  if not private.can_manage_department_lead_access_v1(p_actor_id, p_org_id) then
    raise exception 'department leadership access administration denied' using errcode = '42501';
  end if;

  select dept.leader_id into v_leader_id from public.departments as dept
   where dept.id = p_department_id and dept.org_id = p_org_id and dept.status = 'active'
   for update;
  if not found then
    raise exception 'active department not found' using errcode = 'P0002';
  end if;

  if p_user_id is not null then
    if v_leader_id is distinct from p_user_id then
      raise exception 'target is not the current department leader' using errcode = '23514';
    end if;
    perform 1
      from public.user_organizations as membership
      join public.users as target on target.id = membership.user_id
     where membership.user_id = p_user_id and membership.org_id = p_org_id
       and membership.status = 'active' and membership.employment_status = 'active'
       and membership.left_at is null and target.status = 'active'
     for share of membership, target;
    if not found then
      raise exception 'department leader is not an active organization member' using errcode = '23514';
    end if;
  end if;

  select access.user_id into v_before_user_id from public.department_lead_access as access
   where access.org_id = p_org_id and access.department_id = p_department_id;
  if v_before_user_id is not distinct from p_user_id then
    return jsonb_build_object('status', 'unchanged', 'userId', p_user_id);
  end if;
  if v_before_user_id is distinct from p_expected_user_id then
    raise exception 'department leadership access changed' using errcode = '40001';
  end if;

  if p_user_id is null then
    delete from public.department_lead_access
     where org_id = p_org_id and department_id = p_department_id;
  else
    insert into public.department_lead_access(org_id, department_id, user_id, confirmed_by)
      values (p_org_id, p_department_id, p_user_id, p_actor_id)
    on conflict (org_id, department_id) do update
      set user_id = excluded.user_id, confirmed_by = excluded.confirmed_by, confirmed_at = excluded.confirmed_at;
  end if;

  perform private.personnel_insert_event_v1(
    p_org_id, coalesce(p_user_id, v_before_user_id), p_actor_id,
    case when p_user_id is null then 'revoke_department_lead_access' else 'confirm_department_lead_access' end,
    jsonb_build_object('department_id', p_department_id, 'user_id', v_before_user_id),
    jsonb_build_object('department_id', p_department_id, 'user_id', p_user_id),
    'department workspace access', p_request_id
  );
  return jsonb_build_object('status', 'saved', 'userId', p_user_id);
end;
$$;

revoke all on function public.admin_get_department_lead_access_v1(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.admin_set_department_lead_access_v1(uuid, uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.admin_get_department_lead_access_v1(uuid, uuid, uuid) to service_role;
grant execute on function public.admin_set_department_lead_access_v1(uuid, uuid, uuid, uuid, uuid, text) to service_role;

-- Authority changes clear old confirmations, including changes made by an
-- established personnel or directory operation. Those paths keep their own
-- validation and audit; this trigger does not reject or rewrite their updates.
create function private.clear_department_lead_access_on_department_change_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.department_lead_access where org_id = old.org_id and department_id = old.id;
  return new;
end;
$$;
create trigger clear_department_lead_access_on_department_change
after update of leader_id, org_id, status on public.departments
for each row when (
  old.leader_id is distinct from new.leader_id or old.org_id is distinct from new.org_id
  or (old.status is distinct from new.status and new.status is distinct from 'active')
)
execute function private.clear_department_lead_access_on_department_change_v1();

create function private.clear_department_lead_access_on_membership_end_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.department_lead_access where org_id = old.org_id and user_id = old.user_id;
  return new;
end;
$$;
create trigger clear_department_lead_access_on_membership_end
after update of status, employment_status, left_at on public.user_organizations
for each row when (
  (old.status is distinct from new.status
    or old.employment_status is distinct from new.employment_status
    or old.left_at is distinct from new.left_at)
  and (new.status is distinct from 'active' or new.employment_status is distinct from 'active' or new.left_at is not null)
)
execute function private.clear_department_lead_access_on_membership_end_v1();

revoke all on function private.clear_department_lead_access_on_department_change_v1() from public, anon, authenticated;
revoke all on function private.clear_department_lead_access_on_membership_end_v1() from public, anon, authenticated;

commit;

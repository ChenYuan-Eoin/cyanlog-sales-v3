-- Manual department edits must not confer or revoke explicitly scoped ledger access
-- without system authorization. Directory sync keeps its authoritative workflow.
begin;

create function private.assert_manual_ledger_department_membership_v1(
  p_actor_id uuid, p_org_id uuid, p_department_ids uuid[]
)
returns void language plpgsql set search_path = ''
as $$
declare
  v_settings jsonb;
begin
  if cardinality(p_department_ids) = 0 then return; end if;
  -- Both callers already hold the organization advisory lock and row lock.
  select settings into v_settings from public.organizations where id = p_org_id;
  if exists (
    select 1
    from unnest(p_department_ids) as touched(department_id)
    cross join lateral (values (v_settings->'department_permission_grants'->touched.department_id::text)) as entry(state)
    where entry.state->'permissions' = '["shipping:ledger_view"]'::jsonb
      and jsonb_typeof(entry.state->'include_subdepartments') = 'boolean'
  ) and not private.personnel_is_org_control_admin_v1(p_actor_id, p_org_id) then
    raise exception 'system authorization is required to change membership in a shipping ledger department'
      using errcode = '42501', detail = 'DEPARTMENT_LEDGER_MEMBERSHIP_FORBIDDEN';
  end if;
end;
$$;

alter function public.admin_transfer_primary_department_v1(uuid, uuid, uuid, uuid, text, text) set schema private;
revoke all on function private.admin_transfer_primary_department_v1(uuid, uuid, uuid, uuid, text, text)
  from public, anon, authenticated, service_role;

create function public.admin_transfer_primary_department_v1(
  p_actor_id uuid, p_org_id uuid, p_user_id uuid, p_department_id uuid,
  p_reason text default null, p_request_id text default null
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  v_current_department uuid;
  v_affected uuid[];
begin
  perform private.personnel_lock_org_v1(p_org_id);
  -- Match grant writes and directory apply lock order before locking user rows.
  perform 1 from public.organizations where id = p_org_id for no key update;
  select primary_dept_id into v_current_department
  from public.users where id = p_user_id and org_id = p_org_id for update;
  if not found then return false; end if;
  select array(
    select department_id from public.user_departments
    where user_id = p_user_id and org_id = p_org_id and is_primary is true
      and department_id is distinct from p_department_id
    union
    select v_current_department where v_current_department is distinct from p_department_id
    union
    select p_department_id where p_department_id is not null and (
      v_current_department is distinct from p_department_id or not exists (
        select 1 from public.user_departments where user_id = p_user_id and org_id = p_org_id
          and department_id = p_department_id
      )
    )
  ) into v_affected;
  perform private.assert_manual_ledger_department_membership_v1(p_actor_id, p_org_id, v_affected);
  return private.admin_transfer_primary_department_v1(
    p_actor_id, p_org_id, p_user_id, p_department_id, p_reason, p_request_id
  );
end;
$$;

create function public.admin_update_member_profile_and_primary_department_v1(
  p_actor_id uuid, p_org_id uuid, p_user_id uuid, p_department_id uuid, p_profile jsonb,
  p_reason text default null, p_request_id text default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_member jsonb;
begin
  if coalesce(jsonb_typeof(p_profile), '') <> 'object' or p_profile = '{}'::jsonb
    or p_profile - array['display_name', 'phone', 'title', 'report_to_user_id'] <> '{}'::jsonb then
    raise exception 'invalid member profile update' using errcode = '22023';
  end if;
  if not public.admin_transfer_primary_department_v1(
    p_actor_id, p_org_id, p_user_id, p_department_id, p_reason, p_request_id
  ) then return null; end if;

  update public.users as member
  set display_name = case when p_profile ? 'display_name' then p_profile->>'display_name' else member.display_name end,
      phone = case when p_profile ? 'phone' then p_profile->>'phone' else member.phone end,
      title = case when p_profile ? 'title' then p_profile->>'title' else member.title end,
      report_to_user_id = case when p_profile ? 'report_to_user_id'
        then (p_profile->>'report_to_user_id')::uuid else member.report_to_user_id end
  where member.id = p_user_id and member.org_id = p_org_id
  returning jsonb_build_object(
    'id', member.id, 'email', member.email, 'phone', member.phone, 'display_name', member.display_name,
    'title', member.title, 'primary_dept_id', member.primary_dept_id, 'status', member.status,
    'login_enabled', member.login_enabled, 'report_to_user_id', member.report_to_user_id
  ) into v_member;
  return v_member;
end;
$$;

create function public.admin_change_manual_department_membership_v1(
  p_actor_id uuid, p_org_id uuid, p_user_id uuid, p_department_ids uuid[], p_action text
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  v_primary_department uuid;
  v_status text;
  v_affected uuid[];
begin
  if p_action is null or p_action not in ('add', 'remove', 'initialize')
    or coalesce(cardinality(p_department_ids), 0) = 0
    or (p_action in ('remove', 'initialize') and cardinality(p_department_ids) <> 1) then
    raise exception 'invalid manual department membership action' using errcode = '22023';
  end if;

  perform private.personnel_lock_org_v1(p_org_id);
  perform 1 from public.organizations where id = p_org_id for no key update;
  select primary_dept_id, status into v_primary_department, v_status
  from public.users where id = p_user_id and org_id = p_org_id for update;
  if not found then return false; end if;
  if (select count(*) from public.departments where org_id = p_org_id and id = any(p_department_ids))
    <> cardinality(p_department_ids) then return false; end if;

  if p_action = 'initialize' then
    if v_status is distinct from 'inactive' or v_primary_department is distinct from p_department_ids[1]
      or not exists (
        select 1 from public.user_organizations
        where user_id = p_user_id and org_id = p_org_id and status = 'invited'
      )
      or exists (
        select 1 from public.user_departments
        where user_id = p_user_id and org_id = p_org_id and is_primary is true
          and department_id <> v_primary_department
      ) then return false; end if;
  elsif v_primary_department = any(p_department_ids) then
    return false;
  end if;

  if p_action = 'remove' then
    select array(
      select department_id from public.user_departments
      where user_id = p_user_id and org_id = p_org_id and department_id = p_department_ids[1] and is_primary = false
    ) into v_affected;
    perform private.assert_manual_ledger_department_membership_v1(p_actor_id, p_org_id, v_affected);
    delete from public.user_departments
    where user_id = p_user_id and org_id = p_org_id and department_id = p_department_ids[1] and is_primary = false;
  else
    select array(
      select id from unnest(p_department_ids) as wanted(id)
      where not exists (
        select 1 from public.user_departments where user_id = p_user_id and org_id = p_org_id
          and department_id = wanted.id
      )
    ) into v_affected;
    perform private.assert_manual_ledger_department_membership_v1(p_actor_id, p_org_id, v_affected);
    if p_action = 'initialize' then
      insert into public.user_departments (user_id, department_id, org_id, is_primary)
      values (p_user_id, p_department_ids[1], p_org_id, true)
      on conflict (user_id, department_id) do update set is_primary = true, org_id = excluded.org_id;
    else
      insert into public.user_departments (user_id, department_id, org_id, is_primary)
      select p_user_id, id, p_org_id, false from unnest(v_affected) as wanted(id)
      on conflict (user_id, department_id) do nothing;
    end if;
  end if;
  return true;
end;
$$;

revoke all on function private.assert_manual_ledger_department_membership_v1(uuid, uuid, uuid[])
  from public, anon, authenticated, service_role;
revoke all on function public.admin_transfer_primary_department_v1(uuid, uuid, uuid, uuid, text, text),
  public.admin_update_member_profile_and_primary_department_v1(uuid, uuid, uuid, uuid, jsonb, text, text),
  public.admin_change_manual_department_membership_v1(uuid, uuid, uuid, uuid[], text)
  from public, anon, authenticated;
grant execute on function public.admin_transfer_primary_department_v1(uuid, uuid, uuid, uuid, text, text),
  public.admin_update_member_profile_and_primary_department_v1(uuid, uuid, uuid, uuid, jsonb, text, text),
  public.admin_change_manual_department_membership_v1(uuid, uuid, uuid, uuid[], text)
  to service_role;

commit;

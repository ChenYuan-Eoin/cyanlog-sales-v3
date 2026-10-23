-- WP47: explicit personnel lifecycle commands with atomic audit and last-admin guards.

begin;

create schema if not exists private;

alter table public.user_organizations
  add column if not exists primary_department_id uuid references public.departments(id),
  add column if not exists employment_status text not null default 'active',
  add column if not exists employment_started_at timestamptz not null default now(),
  add column if not exists employment_ended_at timestamptz,
  add column if not exists offboard_reason text;

update public.user_organizations as membership
set primary_department_id = user_row.primary_dept_id
from public.users as user_row
where membership.user_id = user_row.id
  and membership.org_id = user_row.org_id
  and membership.primary_department_id is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.user_organizations'::regclass
      and conname = 'user_organizations_employment_status_check'
  ) then
    alter table public.user_organizations
      add constraint user_organizations_employment_status_check
      check (employment_status in ('active', 'suspended', 'ended'));
  end if;
end
$$;

create table if not exists public.personnel_employment_periods (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  source_id uuid references public.organization_sources(id),
  source_priority integer not null default 1,
  status text not null check (status in ('active', 'suspended', 'ended')),
  department_id uuid references public.departments(id),
  manager_user_id uuid references public.users(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text,
  created_by uuid references public.users(id),
  updated_at timestamptz not null default now(),
  check ((status = 'ended' and ended_at is not null) or (status <> 'ended' and ended_at is null)),
  unique (user_id, org_id, started_at)
);

create index if not exists idx_personnel_employment_active
  on public.personnel_employment_periods(org_id, status, user_id);
create index if not exists idx_personnel_employment_source
  on public.personnel_employment_periods(source_id, source_priority, status);

insert into public.personnel_employment_periods (
  org_id, user_id, source_priority, status, department_id, manager_user_id,
  started_at, created_by
)
select
  membership.org_id,
  membership.user_id,
  1,
  case membership.employment_status
    when 'ended' then 'ended'
    when 'suspended' then 'suspended'
    else 'active'
  end,
  membership.primary_department_id,
  user_row.report_to_user_id,
  membership.employment_started_at,
  membership.created_by
from public.user_organizations as membership
join public.users as user_row
  on user_row.id = membership.user_id
 and user_row.org_id = membership.org_id
where not exists (
  select 1
  from public.personnel_employment_periods as employment
  where employment.user_id = membership.user_id
    and employment.org_id = membership.org_id
    and employment.status in ('active', 'suspended')
);

create table if not exists public.personnel_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  target_user_id uuid not null references public.users(id) on delete restrict,
  actor_id uuid not null references public.users(id) on delete restrict,
  command text not null,
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  reason text,
  request_id text,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_personnel_lifecycle_events_target
  on public.personnel_lifecycle_events(org_id, target_user_id, occurred_at desc);

create table if not exists public.personnel_invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  role_ids uuid[] not null default array[]::uuid[],
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  delivery_method text not null default 'manual_handoff' check (delivery_method in ('manual_handoff', 'email')),
  expires_at timestamptz not null,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  last_sent_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz
);

create index if not exists idx_personnel_invitations_pending
  on public.personnel_invitations(org_id, user_id, status, expires_at);

alter table public.personnel_employment_periods enable row level security;
alter table public.personnel_lifecycle_events enable row level security;
alter table public.personnel_invitations enable row level security;

create or replace function private.personnel_lock_org_v1(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text, 0));
end;
$$;

create or replace function private.personnel_is_org_control_admin_v1(
  p_user_id uuid,
  p_org_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users as user_row
    join public.user_organizations as membership
      on membership.user_id = user_row.id
     and membership.org_id = user_row.org_id
    join public.user_roles as assignment
      on assignment.user_id = user_row.id
     and assignment.org_id = user_row.org_id
     and assignment.scope_type = 'org'
     and assignment.scope_id = user_row.org_id
    join public.roles as role
      on role.id = assignment.role_id
    where user_row.id = p_user_id
      and user_row.org_id = p_org_id
      and user_row.status = 'active'
      and coalesce(user_row.login_enabled, false) = true
      and membership.status = 'active'
      and membership.employment_status = 'active'
      and role.code = 'SUPER_ADMIN'
  );
$$;

create or replace function private.personnel_assert_last_admin_safe_v1(
  p_user_id uuid,
  p_org_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active_admins integer;
begin
  if not private.personnel_is_org_control_admin_v1(p_user_id, p_org_id) then
    return;
  end if;

  select count(distinct user_row.id)
  into v_active_admins
  from public.users as user_row
  join public.user_organizations as membership
    on membership.user_id = user_row.id
   and membership.org_id = user_row.org_id
  join public.user_roles as assignment
    on assignment.user_id = user_row.id
   and assignment.org_id = user_row.org_id
   and assignment.scope_type = 'org'
   and assignment.scope_id = user_row.org_id
  join public.roles as role
    on role.id = assignment.role_id
  where user_row.org_id = p_org_id
    and user_row.status = 'active'
    and coalesce(user_row.login_enabled, false) = true
    and membership.status = 'active'
    and membership.employment_status = 'active'
    and role.code = 'SUPER_ADMIN';

  if v_active_admins <= 1 then
    raise exception 'cannot remove the last active organization control administrator'
      using errcode = '23514';
  end if;
end;
$$;

create or replace function private.personnel_insert_event_v1(
  p_org_id uuid,
  p_target_user_id uuid,
  p_actor_id uuid,
  p_command text,
  p_before_state jsonb,
  p_after_state jsonb,
  p_reason text,
  p_request_id text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.personnel_lifecycle_events (
    org_id, target_user_id, actor_id, command,
    before_state, after_state, reason, request_id
  ) values (
    p_org_id, p_target_user_id, p_actor_id, p_command,
    coalesce(p_before_state, '{}'::jsonb), coalesce(p_after_state, '{}'::jsonb),
    p_reason, p_request_id
  );
$$;

create or replace function public.admin_set_account_state_v1(
  p_actor_id uuid,
  p_org_id uuid,
  p_user_id uuid,
  p_status text,
  p_login_enabled boolean,
  p_reason text default null,
  p_request_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_applied boolean;
begin
  perform private.personnel_lock_org_v1(p_org_id);
  if coalesce(p_status = 'active', false) or p_login_enabled = true then
    if exists (
      select 1 from public.user_organizations
      where user_id = p_user_id and org_id = p_org_id and status = 'ended'
    ) then
      raise exception 'ended membership must use the rehire command' using errcode = '23514';
    end if;
  else
    perform private.personnel_assert_last_admin_safe_v1(p_user_id, p_org_id);
  end if;

  select jsonb_build_object(
    'status', user_row.status,
    'login_enabled', user_row.login_enabled,
    'membership_status', membership.status,
    'employment_status', membership.employment_status
  )
  into v_before
  from public.users as user_row
  join public.user_organizations as membership
    on membership.user_id = user_row.id and membership.org_id = user_row.org_id
  where user_row.id = p_user_id and user_row.org_id = p_org_id
  for update of user_row, membership;

  if v_before is null then
    return false;
  end if;

  v_applied := public.set_org_user_account_state_and_revoke_sessions_v1(
    p_user_id, p_org_id, p_status, p_login_enabled
  );
  if v_applied is not true then
    return false;
  end if;

  if p_status = 'suspended' then
    update public.user_organizations
    set status = 'suspended', employment_status = 'suspended', updated_at = now()
    where user_id = p_user_id and org_id = p_org_id and status <> 'ended';
    update public.personnel_employment_periods
    set status = 'suspended', updated_at = now()
    where user_id = p_user_id and org_id = p_org_id and status = 'active';
  elsif p_status = 'active' then
    update public.user_organizations
    set status = 'active', employment_status = 'active', updated_at = now()
    where user_id = p_user_id and org_id = p_org_id and status = 'suspended';
    update public.personnel_employment_periods
    set status = 'active', updated_at = now()
    where user_id = p_user_id and org_id = p_org_id and status = 'suspended';
  end if;

  select jsonb_build_object(
    'status', user_row.status,
    'login_enabled', user_row.login_enabled,
    'membership_status', membership.status,
    'employment_status', membership.employment_status
  )
  into v_after
  from public.users as user_row
  join public.user_organizations as membership
    on membership.user_id = user_row.id and membership.org_id = user_row.org_id
  where user_row.id = p_user_id and user_row.org_id = p_org_id;

  perform private.personnel_insert_event_v1(
    p_org_id, p_user_id, p_actor_id, 'set_account_state',
    v_before, v_after, p_reason, p_request_id
  );
  return true;
end;
$$;

create or replace function public.admin_reset_password_v1(
  p_actor_id uuid,
  p_org_id uuid,
  p_user_id uuid,
  p_password_hash text,
  p_request_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_applied boolean;
begin
  v_applied := public.reset_org_user_password_and_revoke_sessions_v1(
    p_user_id, p_org_id, p_password_hash
  );
  if v_applied is not true then
    return false;
  end if;

  perform private.personnel_insert_event_v1(
    p_org_id, p_user_id, p_actor_id, 'reset_password',
    '{}'::jsonb, jsonb_build_object('password_reset', true, 'sessions_revoked', true),
    'tenant administrator password reset', p_request_id
  );
  return true;
end;
$$;

create or replace function public.accept_personnel_invitation_v1(
  p_token_hash text,
  p_password_hash text,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.personnel_invitations%rowtype;
  v_role_id uuid;
  v_after jsonb;
begin
  if p_token_hash is null or length(p_token_hash) = 0
    or p_password_hash is null or length(p_password_hash) = 0 then
    raise exception 'token and password hash are required' using errcode = '22023';
  end if;

  select invitation.*
  into v_invitation
  from public.personnel_invitations as invitation
  where invitation.token_hash = p_token_hash
    and invitation.status = 'pending'
    and invitation.expires_at > now()
  for update;

  if v_invitation.id is null then
    return null;
  end if;

  perform private.personnel_lock_org_v1(v_invitation.org_id);

  update public.users
  set
    password_hash = p_password_hash,
    must_change_password = false,
    status = 'active',
    login_enabled = true,
    updated_at = now()
  where id = v_invitation.user_id and org_id = v_invitation.org_id;

  update public.user_organizations
  set
    status = 'active',
    employment_status = 'active',
    joined_at = now(),
    left_at = null,
    employment_started_at = now(),
    employment_ended_at = null,
    membership_version = membership_version + 1,
    updated_by = v_invitation.created_by,
    updated_at = now()
  where user_id = v_invitation.user_id and org_id = v_invitation.org_id;

  delete from public.auth_tokens where user_id = v_invitation.user_id;
  delete from public.user_roles
  where user_id = v_invitation.user_id
    and org_id = v_invitation.org_id
    and scope_type = 'org'
    and scope_id = v_invitation.org_id;

  foreach v_role_id in array v_invitation.role_ids loop
    insert into public.user_roles (
      user_id, role_id, org_id, scope_type, scope_id, granted_by
    ) values (
      v_invitation.user_id, v_role_id, v_invitation.org_id,
      'org', v_invitation.org_id, v_invitation.created_by
    );
  end loop;

  update public.personnel_invitations
  set status = 'accepted', accepted_at = now()
  where id = v_invitation.id;

  v_after := jsonb_build_object(
    'user_status', 'active',
    'login_enabled', true,
    'membership_status', 'active',
    'role_ids', to_jsonb(v_invitation.role_ids)
  );
  perform private.personnel_insert_event_v1(
    v_invitation.org_id,
    v_invitation.user_id,
    v_invitation.created_by,
    'activate_membership',
    jsonb_build_object('membership_status', 'invited'),
    v_after,
    'invitation accepted',
    p_request_id
  );

  return jsonb_build_object(
    'org_id', v_invitation.org_id,
    'user_id', v_invitation.user_id
  );
end;
$$;

create or replace function public.admin_transfer_primary_department_v1(
  p_actor_id uuid,
  p_org_id uuid,
  p_user_id uuid,
  p_department_id uuid,
  p_reason text default null,
  p_request_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  perform private.personnel_lock_org_v1(p_org_id);

  select jsonb_build_object(
    'primary_department_id', user_row.primary_dept_id,
    'membership_status', membership.status,
    'employment_status', membership.employment_status
  )
  into v_before
  from public.users as user_row
  join public.user_organizations as membership
    on membership.user_id = user_row.id
   and membership.org_id = user_row.org_id
  where user_row.id = p_user_id
    and user_row.org_id = p_org_id
    and membership.status = 'active'
  for update of user_row, membership;

  if v_before is null then
    return false;
  end if;

  if p_department_id is not null and not exists (
    select 1 from public.departments
    where id = p_department_id and org_id = p_org_id
  ) then
    raise exception 'department does not belong to tenant' using errcode = '23514';
  end if;

  update public.users
  set primary_dept_id = p_department_id, updated_at = now()
  where id = p_user_id and org_id = p_org_id;

  update public.user_organizations
  set
    primary_department_id = p_department_id,
    membership_version = membership_version + 1,
    updated_at = now()
  where user_id = p_user_id and org_id = p_org_id;

  delete from public.user_departments
  where user_id = p_user_id and org_id = p_org_id and is_primary = true;

  if p_department_id is not null then
    insert into public.user_departments (user_id, department_id, org_id, is_primary)
    values (p_user_id, p_department_id, p_org_id, true)
    on conflict (user_id, department_id)
    do update set is_primary = true, org_id = excluded.org_id;

    with recursive department_chain as (
      select id, parent_id, 0 as depth
      from public.departments
      where id = p_department_id and org_id = p_org_id
      union all
      select parent.id, parent.parent_id, child.depth + 1
      from public.departments as parent
      join department_chain as child on child.parent_id = parent.id
      where parent.org_id = p_org_id and child.depth < 32
    ),
    target_spaces as (
      select space.id
      from public.sales_spaces as space
      join department_chain as department on department.id = space.department_id
      where space.org_id = p_org_id
    )
    insert into public.sales_space_members (space_id, user_id, org_id, space_role)
    select id, p_user_id, p_org_id, 'MEMBER'
    from target_spaces
    on conflict (space_id, user_id) do nothing;
  end if;

  update public.personnel_employment_periods
  set department_id = p_department_id, updated_at = now()
  where user_id = p_user_id
    and org_id = p_org_id
    and status in ('active', 'suspended');

  select jsonb_build_object(
    'primary_department_id', user_row.primary_dept_id,
    'membership_status', membership.status,
    'employment_status', membership.employment_status
  )
  into v_after
  from public.users as user_row
  join public.user_organizations as membership
    on membership.user_id = user_row.id
   and membership.org_id = user_row.org_id
  where user_row.id = p_user_id and user_row.org_id = p_org_id;

  perform private.personnel_insert_event_v1(
    p_org_id, p_user_id, p_actor_id, 'assign_primary_department',
    v_before, v_after, p_reason, p_request_id
  );
  return true;
end;
$$;

create or replace function public.admin_set_reporting_manager_v1(
  p_actor_id uuid,
  p_org_id uuid,
  p_user_id uuid,
  p_manager_user_id uuid,
  p_reason text default null,
  p_request_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before uuid;
  v_cycle boolean;
begin
  perform private.personnel_lock_org_v1(p_org_id);

  select user_row.report_to_user_id
  into v_before
  from public.users as user_row
  join public.user_organizations as membership
    on membership.user_id = user_row.id and membership.org_id = user_row.org_id
  where user_row.id = p_user_id
    and user_row.org_id = p_org_id
    and membership.status = 'active'
    and membership.employment_status = 'active'
  for update of user_row, membership;

  if not found then
    return false;
  end if;

  if p_manager_user_id is not null then
    if p_manager_user_id = p_user_id or not exists (
      select 1
      from public.users as manager
      join public.user_organizations as membership
        on membership.user_id = manager.id and membership.org_id = manager.org_id
      where manager.id = p_manager_user_id
        and manager.org_id = p_org_id
        and manager.status = 'active'
        and membership.status = 'active'
        and membership.employment_status = 'active'
    ) then
      raise exception 'invalid reporting manager' using errcode = '23514';
    end if;

    with recursive manager_chain as (
      select manager.id, manager.report_to_user_id, 0 as depth
      from public.users as manager
      where manager.id = p_manager_user_id and manager.org_id = p_org_id
      union all
      select parent.id, parent.report_to_user_id, child.depth + 1
      from public.users as parent
      join manager_chain as child on child.report_to_user_id = parent.id
      where parent.org_id = p_org_id and child.depth < 128
    )
    select exists(select 1 from manager_chain where id = p_user_id)
    into strict v_cycle;

    if v_cycle then
      raise exception 'reporting manager would create a cycle' using errcode = '23514';
    end if;
  end if;

  select report_to_user_id into v_before
  from public.users where id = p_user_id and org_id = p_org_id;

  update public.users
  set report_to_user_id = p_manager_user_id, updated_at = now()
  where id = p_user_id and org_id = p_org_id;

  update public.personnel_employment_periods
  set manager_user_id = p_manager_user_id, updated_at = now()
  where user_id = p_user_id and org_id = p_org_id and status = 'active';

  perform private.personnel_insert_event_v1(
    p_org_id, p_user_id, p_actor_id, 'set_reporting_manager',
    jsonb_build_object('report_to_user_id', v_before),
    jsonb_build_object('report_to_user_id', p_manager_user_id),
    p_reason, p_request_id
  );
  return true;
end;
$$;

create or replace function public.admin_offboard_member_v1(
  p_actor_id uuid,
  p_org_id uuid,
  p_user_id uuid,
  p_reason text,
  p_request_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_is_root boolean;
begin
  perform private.personnel_lock_org_v1(p_org_id);
  perform private.personnel_assert_last_admin_safe_v1(p_user_id, p_org_id);

  select jsonb_build_object(
    'user_status', user_row.status,
    'login_enabled', user_row.login_enabled,
    'primary_department_id', user_row.primary_dept_id,
    'membership_status', membership.status,
    'employment_status', membership.employment_status,
    'role_ids', coalesce((
      select jsonb_agg(assignment.role_id)
      from public.user_roles as assignment
      where assignment.user_id = user_row.id and assignment.org_id = user_row.org_id
    ), '[]'::jsonb),
    'department_ids', coalesce((
      select jsonb_agg(department.department_id)
      from public.user_departments as department
      where department.user_id = user_row.id and department.org_id = user_row.org_id
    ), '[]'::jsonb),
    'space_ids', coalesce((
      select jsonb_agg(space.space_id)
      from public.sales_space_members as space
      where space.user_id = user_row.id and space.org_id = user_row.org_id
    ), '[]'::jsonb)
  )
  into v_before
  from public.users as user_row
  join public.user_organizations as membership
    on membership.user_id = user_row.id
   and membership.org_id = user_row.org_id
  where user_row.id = p_user_id
    and user_row.org_id = p_org_id
  for update of user_row, membership;

  if v_before is null then
    return false;
  end if;

  select exists (
    select 1
    from public.user_roles as assignment
    join public.roles as role on role.id = assignment.role_id
    where assignment.user_id = p_user_id
      and assignment.org_id = p_org_id
      and assignment.scope_type = 'org'
      and assignment.scope_id = p_org_id
      and role.code = 'SUPER_ADMIN'
  ) into v_is_root;

  if v_is_root then
    raise exception 'protected platform root administrator' using errcode = '42501';
  end if;

  update public.users
  set
    status = 'inactive',
    login_enabled = false,
    primary_dept_id = null,
    report_to_user_id = null,
    updated_at = now()
  where id = p_user_id and org_id = p_org_id;

  update public.user_organizations
  set
    status = 'ended',
    employment_status = 'ended',
    left_at = now(),
    employment_ended_at = now(),
    offboard_reason = p_reason,
    primary_department_id = null,
    membership_version = membership_version + 1,
    updated_at = now()
  where user_id = p_user_id and org_id = p_org_id;

  update public.personnel_employment_periods
  set
    status = 'ended',
    ended_at = now(),
    end_reason = p_reason,
    department_id = null,
    manager_user_id = null,
    updated_at = now()
  where user_id = p_user_id
    and org_id = p_org_id
    and status in ('active', 'suspended');

  delete from public.auth_tokens where user_id = p_user_id;
  delete from public.user_roles where user_id = p_user_id and org_id = p_org_id;
  delete from public.user_permission_assignments where user_id = p_user_id and org_id = p_org_id;
  delete from public.user_departments where user_id = p_user_id and org_id = p_org_id;
  delete from public.sales_space_members where user_id = p_user_id and org_id = p_org_id;

  v_after := jsonb_build_object(
    'user_status', 'inactive',
    'login_enabled', false,
    'membership_status', 'ended',
    'employment_status', 'ended',
    'left_at', now(),
    'role_ids', '[]'::jsonb,
    'department_ids', '[]'::jsonb,
    'space_ids', '[]'::jsonb
  );

  perform private.personnel_insert_event_v1(
    p_org_id, p_user_id, p_actor_id, 'offboard_member',
    v_before, v_after, p_reason, p_request_id
  );
  return true;
end;
$$;

create or replace function public.admin_restore_membership_v1(
  p_actor_id uuid,
  p_org_id uuid,
  p_user_id uuid,
  p_reason text default null,
  p_request_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  perform private.personnel_lock_org_v1(p_org_id);

  select jsonb_build_object(
    'user_status', user_row.status,
    'login_enabled', user_row.login_enabled,
    'membership_status', membership.status,
    'employment_status', membership.employment_status
  )
  into v_before
  from public.users as user_row
  join public.user_organizations as membership
    on membership.user_id = user_row.id
   and membership.org_id = user_row.org_id
  where user_row.id = p_user_id
    and user_row.org_id = p_org_id
    and membership.status in ('invited', 'suspended', 'ended')
  for update of user_row, membership;

  if v_before is null then
    return false;
  end if;

  update public.users
  set status = 'active', login_enabled = false, updated_at = now()
  where id = p_user_id and org_id = p_org_id;

  update public.user_organizations
  set
    status = 'active',
    employment_status = 'active',
    joined_at = case when status = 'ended' then now() else joined_at end,
    left_at = null,
    employment_started_at = case when employment_status = 'ended' then now() else employment_started_at end,
    employment_ended_at = null,
    offboard_reason = null,
    membership_version = membership_version + 1,
    updated_by = p_actor_id,
    updated_at = now()
  where user_id = p_user_id and org_id = p_org_id;

  delete from public.auth_tokens where user_id = p_user_id;

  insert into public.personnel_employment_periods (
    org_id, user_id, source_priority, status, department_id, manager_user_id,
    started_at, created_by
  )
  select
    p_org_id, user_row.id, 1, 'active', user_row.primary_dept_id, user_row.report_to_user_id,
    now(), p_actor_id
  from public.users as user_row
  where user_row.id = p_user_id and user_row.org_id = p_org_id
  on conflict (user_id, org_id, started_at) do nothing;

  v_after := jsonb_build_object(
    'user_status', 'active',
    'login_enabled', false,
    'membership_status', 'active',
    'employment_status', 'active'
  );

  perform private.personnel_insert_event_v1(
    p_org_id, p_user_id, p_actor_id, 'rehire_member',
    v_before, v_after, p_reason, p_request_id
  );
  return true;
end;
$$;

create or replace function public.admin_replace_org_roles_v1(
  p_actor_id uuid,
  p_org_id uuid,
  p_user_id uuid,
  p_role_ids uuid[],
  p_reason text default null,
  p_request_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_role_id uuid;
  v_valid_count integer;
begin
  perform private.personnel_lock_org_v1(p_org_id);
  perform private.personnel_assert_last_admin_safe_v1(p_user_id, p_org_id);

  if not exists (
    select 1 from public.user_organizations
    where user_id = p_user_id and org_id = p_org_id and status = 'active'
  ) then
    return false;
  end if;

  select count(*) into v_valid_count
  from public.roles
  where id = any(coalesce(p_role_ids, array[]::uuid[]));

  if v_valid_count <> cardinality(coalesce(p_role_ids, array[]::uuid[])) then
    raise exception 'role does not exist' using errcode = '23503';
  end if;

  select coalesce(jsonb_agg(role_id), '[]'::jsonb)
  into v_before
  from public.user_roles
  where user_id = p_user_id
    and org_id = p_org_id
    and scope_type = 'org'
    and scope_id = p_org_id;

  delete from public.user_roles
  where user_id = p_user_id
    and org_id = p_org_id
    and scope_type = 'org'
    and scope_id = p_org_id;

  foreach v_role_id in array coalesce(p_role_ids, array[]::uuid[]) loop
    insert into public.user_roles (
      user_id, role_id, org_id, scope_type, scope_id, granted_by
    ) values (
      p_user_id, v_role_id, p_org_id, 'org', p_org_id, p_actor_id
    );
  end loop;

  select coalesce(jsonb_agg(role_id), '[]'::jsonb)
  into v_after
  from public.user_roles
  where user_id = p_user_id
    and org_id = p_org_id
    and scope_type = 'org'
    and scope_id = p_org_id;

  perform private.personnel_insert_event_v1(
    p_org_id, p_user_id, p_actor_id, 'assign_org_roles',
    jsonb_build_object('role_ids', v_before), jsonb_build_object('role_ids', v_after),
    p_reason, p_request_id
  );
  return true;
end;
$$;

revoke all on function public.admin_transfer_primary_department_v1(uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_set_reporting_manager_v1(uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_offboard_member_v1(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_restore_membership_v1(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_replace_org_roles_v1(uuid, uuid, uuid, uuid[], text, text) from public, anon, authenticated;
revoke all on function public.admin_set_account_state_v1(uuid, uuid, uuid, text, boolean, text, text) from public, anon, authenticated;
revoke all on function public.admin_reset_password_v1(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.accept_personnel_invitation_v1(text, text, text) from public, anon, authenticated;

grant execute on function public.admin_transfer_primary_department_v1(uuid, uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.admin_set_reporting_manager_v1(uuid, uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.admin_offboard_member_v1(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.admin_restore_membership_v1(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.admin_replace_org_roles_v1(uuid, uuid, uuid, uuid[], text, text) to service_role;
grant execute on function public.admin_set_account_state_v1(uuid, uuid, uuid, text, boolean, text, text) to service_role;
grant execute on function public.admin_reset_password_v1(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.accept_personnel_invitation_v1(text, text, text) to service_role;

comment on table public.personnel_lifecycle_events is
  'Append-only before/after audit for tenant personnel lifecycle commands.';
comment on table public.personnel_employment_periods is
  'Employment periods preserve transfer and rehire history without deleting person accounts.';

commit;

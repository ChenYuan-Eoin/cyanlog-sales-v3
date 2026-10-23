-- WP58: make the organization-admin aggregate read explicit live memberships
-- instead of falling back to users.org_id, and expose pending invitations.

begin;

create or replace function public.get_org_admin_payload_v1(
  p_org_id uuid
)
returns jsonb
language sql
security invoker
set search_path = public
as $$
with department_rows as (
  select
    d.id,
    d.name,
    d.code,
    coalesce(d.depth, 0) as depth,
    coalesce(d.member_count, 0) as member_count,
    d.parent_id,
    parent.name as parent_name,
    d.leader_id,
    leader.display_name as leader_name,
    coalesce(d.sort_order, 0) as sort_order
  from departments d
  left join departments parent
    on parent.id = d.parent_id
   and coalesce(parent.status, 'active') = 'active'
  left join users leader
    on leader.id = d.leader_id
   and coalesce(leader.status, 'active') <> 'inactive'
  where d.org_id = p_org_id
    and coalesce(d.status, 'active') = 'active'
),
space_rows as (
  select
    s.id,
    s.name,
    s.description,
    s.department_id,
    d.name as department_name,
    s.owner_id
  from sales_spaces s
  left join departments d
    on d.id = s.department_id
   and coalesce(d.status, 'active') = 'active'
  where s.org_id = p_org_id
),
org_memberships as (
  select
    uo.user_id,
    uo.org_id,
    uo.status,
    uo.primary_department_id,
    uo.employment_status
  from user_organizations uo
  where uo.org_id = p_org_id
    and uo.status in ('invited', 'active', 'suspended')
),
user_rows as (
  select
    u.id,
    u.email,
    u.display_name,
    u.title,
    u.status,
    u.must_change_password,
    coalesce(m.primary_department_id, u.primary_dept_id) as primary_dept_id,
    u.login_enabled,
    u.report_to_user_id,
    u.created_at,
    m.status as membership_status,
    m.employment_status,
    pd.name as primary_dept_name,
    manager.display_name as report_to_user_name
  from users u
  join org_memberships m on m.user_id = u.id
  left join departments pd
    on pd.id = coalesce(m.primary_department_id, u.primary_dept_id)
   and coalesce(pd.status, 'active') = 'active'
  left join users manager on manager.id = u.report_to_user_id
),
current_role_rows as (
  select
    ur.user_id,
    ur.scope_type,
    ur.scope_id,
    ur.granted_at,
    r.id as role_id,
    r.name as role_name,
    r.code as role_code,
    coalesce(r.sort_order, 0) as sort_order,
    case
      when ur.scope_type = 'department' then coalesce(d.name, '部门')
      when ur.scope_type = 'space' then coalesce(s.name, '销售空间')
      else '组织'
    end as scope_name
  from user_roles ur
  join roles r on r.id = ur.role_id
  left join departments d
    on ur.scope_type = 'department'
   and d.id = ur.scope_id
   and d.org_id = p_org_id
   and coalesce(d.status, 'active') = 'active'
  left join sales_spaces s
    on ur.scope_type = 'space'
   and s.id = ur.scope_id
   and s.org_id = p_org_id
  where ur.org_id = p_org_id
    and ur.user_id in (select id from user_rows)
    and (
      (ur.scope_type = 'org' and (ur.scope_id is null or ur.scope_id = p_org_id))
      or (ur.scope_type = 'department' and d.id is not null)
      or (ur.scope_type = 'space' and s.id is not null)
    )
),
role_payload as (
  select
    crr.user_id,
    coalesce(
      string_agg(
        case
          when crr.scope_type = 'org' then crr.role_name
          else crr.role_name || '(' || crr.scope_name || ')'
        end,
        ', '
        order by crr.sort_order, crr.role_name, crr.scope_name
      ),
      ''
    ) as role_names,
    coalesce(
      jsonb_agg(crr.role_id order by crr.sort_order, crr.role_name)
        filter (where crr.scope_type = 'org'),
      '[]'::jsonb
    ) as role_ids,
    coalesce(
      jsonb_agg(crr.role_code order by crr.sort_order, crr.role_name)
        filter (where crr.scope_type = 'org'),
      '[]'::jsonb
    ) as role_codes,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'roleId', crr.role_id,
          'roleName', crr.role_name,
          'roleCode', crr.role_code,
          'scopeType', crr.scope_type,
          'scopeId', crr.scope_id,
          'scopeName', crr.scope_name,
          'grantedAt', crr.granted_at
        )
        order by crr.sort_order, crr.role_name, crr.scope_name
      ),
      '[]'::jsonb
    ) as scoped_roles
  from current_role_rows crr
  group by crr.user_id
)
select jsonb_build_object(
  'organization',
  (
    select jsonb_build_object(
      'id', o.id,
      'name', o.name,
      'slug', o.slug
    )
    from organizations o
    where o.id = p_org_id
    limit 1
  ),
  'users',
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', u.id,
          'email', coalesce(u.email, ''),
          'display_name', u.display_name,
          'title', coalesce(u.title, ''),
          'primary_dept_id', u.primary_dept_id,
          'primary_dept_name', coalesce(u.primary_dept_name, '-'),
          'role_names', coalesce(rp.role_names, ''),
          'role_ids', coalesce(rp.role_ids, '[]'::jsonb),
          'role_codes', coalesce(rp.role_codes, '[]'::jsonb),
          'scoped_roles', coalesce(rp.scoped_roles, '[]'::jsonb),
          'status', u.status,
          'membership_status', u.membership_status,
          'employment_status', u.employment_status,
          'must_change_password', coalesce(u.must_change_password, false),
          'login_enabled', coalesce(u.login_enabled, true),
          'report_to_user_id', u.report_to_user_id,
          'report_to_user_name', u.report_to_user_name
        )
        order by u.created_at desc nulls last
      )
      from user_rows u
      left join role_payload rp on rp.user_id = u.id
    ),
    '[]'::jsonb
  ),
  'departments',
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', d.id,
          'name', d.name,
          'code', d.code,
          'depth', d.depth,
          'member_count', d.member_count,
          'parent_id', d.parent_id,
          'parent_name', d.parent_name,
          'leader_id', d.leader_id,
          'leader_name', d.leader_name
        )
        order by d.depth, d.sort_order, d.name
      )
      from department_rows d
    ),
    '[]'::jsonb
  ),
  'roles',
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'code', r.code,
          'name', r.name
        )
        order by coalesce(r.sort_order, 0), r.name
      )
      from roles r
    ),
    '[]'::jsonb
  ),
  'spaces',
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'name', s.name,
          'description', s.description,
          'department_id', s.department_id,
          'department_name', coalesce(s.department_name, ''),
          'owner_id', s.owner_id
        )
        order by s.name
      )
      from space_rows s
    ),
    '[]'::jsonb
  )
);
$$;

revoke execute on function public.get_org_admin_payload_v1(uuid) from public;
revoke execute on function public.get_org_admin_payload_v1(uuid) from anon;
revoke execute on function public.get_org_admin_payload_v1(uuid) from authenticated;
grant execute on function public.get_org_admin_payload_v1(uuid) to service_role;

commit;

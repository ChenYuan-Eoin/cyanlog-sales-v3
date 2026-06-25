create or replace function public.get_dashboard_payload_v1(
  p_user_id uuid,
  p_org_id uuid default null,
  p_requested_space_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org_id uuid;
  v_role_codes text[] := '{}';
  v_permissions text[] := '{}';
  v_can_manage_org boolean := false;
  v_active_space_id uuid;
  v_payload jsonb;
begin
  select coalesce(
    p_org_id,
    (
      select uo.org_id
      from user_organizations uo
      where uo.user_id = p_user_id
        and uo.is_default = true
      limit 1
    ),
    (
      select u.org_id
      from users u
      where u.id = p_user_id
      limit 1
    )
  )
  into v_org_id;

  if v_org_id is null then
    return jsonb_build_object(
      'spaces', '[]'::jsonb,
      'activeSpace', null,
      'opportunities', '[]'::jsonb,
      'milestones', '[]'::jsonb,
      'reminders', '[]'::jsonb,
      'agenda', '[]'::jsonb
    );
  end if;

  with role_rows as (
    select
      ur.scope_type,
      r.code,
      coalesce(r.permissions, '[]'::jsonb) as permissions
    from user_roles ur
    join roles r on r.id = ur.role_id
    where ur.user_id = p_user_id
  )
  select
    coalesce(array_agg(distinct code) filter (where scope_type = 'org'), '{}'),
    coalesce(
      (
        select array_agg(distinct permission)
        from role_rows rr
        cross join lateral jsonb_array_elements_text(rr.permissions) as permission
        where rr.scope_type = 'org'
      ),
      '{}'
    )
  into v_role_codes, v_permissions
  from role_rows;

  v_can_manage_org := (
    v_role_codes && array['SUPER_ADMIN', 'SALES_OPS', 'ADMIN']
    or v_permissions && array['*', 'admin:access', 'admin:*', 'org:write', 'org:*', 'user:view', 'user:write', 'user:*']
  );

  with role_rows as (
    select ur.scope_type, ur.scope_id
    from user_roles ur
    where ur.user_id = p_user_id
  ),
  department_scope as (
    select distinct d.id
    from departments d
    join role_rows rr
      on rr.scope_type = 'department'
     and rr.scope_id is not null
     and (
       d.id = rr.scope_id
       or d.path like ('%/' || rr.scope_id::text || '/%')
     )
    where d.org_id = v_org_id
  ),
  accessible_spaces as (
    select distinct
      s.id,
      s.name,
      s.description,
      s.department_id,
      s.owner_id,
      coalesce(s.active_opportunities, 0) as active_opportunities,
      coalesce(s.pending_milestones, 0) as pending_milestones
    from sales_spaces s
    where s.org_id = v_org_id
      and (
        v_can_manage_org
        or exists (
          select 1
          from sales_space_members sm
          where sm.space_id = s.id
            and sm.user_id = p_user_id
        )
        or exists (
          select 1
          from role_rows rr
          where rr.scope_type = 'space'
            and rr.scope_id = s.id
        )
        or s.department_id in (select id from department_scope)
      )
  )
  select s.id
  into v_active_space_id
  from accessible_spaces s
  order by (s.id = p_requested_space_id) desc, s.name asc
  limit 1;

  with role_rows as (
    select ur.scope_type, ur.scope_id
    from user_roles ur
    where ur.user_id = p_user_id
  ),
  department_scope as (
    select distinct d.id
    from departments d
    join role_rows rr
      on rr.scope_type = 'department'
     and rr.scope_id is not null
     and (
       d.id = rr.scope_id
       or d.path like ('%/' || rr.scope_id::text || '/%')
     )
    where d.org_id = v_org_id
  ),
  spaces as (
    select distinct
      s.id,
      s.name,
      s.description,
      s.department_id,
      s.owner_id,
      coalesce(s.active_opportunities, 0) as active_opportunities,
      coalesce(s.pending_milestones, 0) as pending_milestones
    from sales_spaces s
    where s.org_id = v_org_id
      and (
        v_can_manage_org
        or exists (
          select 1
          from sales_space_members sm
          where sm.space_id = s.id
            and sm.user_id = p_user_id
        )
        or exists (
          select 1
          from role_rows rr
          where rr.scope_type = 'space'
            and rr.scope_id = s.id
        )
        or s.department_id in (select id from department_scope)
      )
  ),
  active_space as (
    select *
    from spaces
    where id = v_active_space_id
  ),
  opportunities_payload as (
    select
      o.id,
      o.space_id,
      o.customer_id,
      o.name,
      o.amount,
      o.status,
      o.stage,
      o.probability,
      o.owner_id,
      o.expected_close_date,
      case
        when c.id is null then null
        else jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'short_name', c.short_name
        )
      end as customer
    from opportunities o
    left join customers c on c.id = o.customer_id
    where v_active_space_id is not null
      and o.space_id = v_active_space_id
    order by o.expected_close_date asc nulls last
    limit 20
  ),
  milestones_payload as (
    select
      m.id,
      m.opportunity_id,
      m.name,
      m.type,
      m.status,
      m.priority,
      m.due_date,
      jsonb_build_object(
        'name', o.name,
        'customer_id', o.customer_id
      ) as opportunity
    from milestones m
    join opportunities_payload o on o.id = m.opportunity_id
    where m.status in ('PENDING', 'IN_PROGRESS')
      and m.due_date <= now() + interval '7 days'
    order by m.due_date asc
    limit 10
  ),
  reminders_payload as (
    select
      r.id,
      r.type,
      r.title,
      r.description,
      r.priority,
      r.read_at
    from reminders r
    where r.user_id = p_user_id
      and r.dismissed_at is null
    order by r.created_at desc
    limit 5
  ),
  agenda_payload as (
    select
      a.id,
      a.title,
      a.description,
      coalesce(a.start_at, a.start_time) as start_time,
      coalesce(a.end_at, a.end_time) as end_time
    from agenda_items a
    where a.agenda_date = current_date
      and (
        a.user_id = p_user_id
        or a.assignee_id = p_user_id
        or a.created_by = p_user_id
      )
    order by a.start_at asc nulls last
    limit 6
  )
  select jsonb_build_object(
    'spaces', coalesce((select jsonb_agg(to_jsonb(sp) order by sp.name) from spaces sp), '[]'::jsonb),
    'activeSpace', (select to_jsonb(a) from active_space a limit 1),
    'opportunities', coalesce((select jsonb_agg(to_jsonb(o)) from opportunities_payload o), '[]'::jsonb),
    'milestones', coalesce((select jsonb_agg(to_jsonb(m)) from milestones_payload m), '[]'::jsonb),
    'reminders', coalesce((select jsonb_agg(to_jsonb(r)) from reminders_payload r), '[]'::jsonb),
    'agenda', coalesce((select jsonb_agg(to_jsonb(a)) from agenda_payload a), '[]'::jsonb)
  )
  into v_payload;

  return v_payload;
end;
$$;

revoke execute on function public.get_dashboard_payload_v1(uuid, uuid, uuid) from public;
revoke execute on function public.get_dashboard_payload_v1(uuid, uuid, uuid) from anon;
revoke execute on function public.get_dashboard_payload_v1(uuid, uuid, uuid) from authenticated;
grant execute on function public.get_dashboard_payload_v1(uuid, uuid, uuid) to service_role;

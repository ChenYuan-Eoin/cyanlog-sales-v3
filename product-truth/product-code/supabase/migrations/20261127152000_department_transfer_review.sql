-- Acknowledging an impact records the review without restoring an old grant.
begin;

alter table private.department_transfer_review_items
  add column acknowledged_at timestamptz,
  add column acknowledged_by uuid,
  add constraint department_transfer_review_ack_complete
    check ((acknowledged_at is null) = (acknowledged_by is null));

create index department_transfer_review_pending
  on private.department_transfer_review_items (org_id, user_id, effective_at desc, id)
  where acknowledged_at is null;

create function private.assert_member_department_review_access_v1(p_org_id uuid, p_actor_id uuid, p_user_id uuid)
returns void language plpgsql stable set search_path = ''
as $$
begin
  if not private.personnel_is_org_control_admin_v1(p_actor_id, p_org_id) then
    raise exception 'system authorization is required to review a department transfer'
      using errcode = '42501', detail = 'DEPARTMENT_TRANSFER_REVIEW_FORBIDDEN';
  end if;

  if not exists (
    select 1 from public.user_organizations as member
    join public.users as person on person.id = member.user_id and person.org_id = member.org_id
    where member.org_id = p_org_id and member.user_id = p_user_id
      and member.status = 'active' and member.employment_status = 'active' and member.left_at is null
  ) then
    raise exception 'active member not found in organization'
      using errcode = 'P0002', detail = 'DEPARTMENT_TRANSFER_REVIEW_NOT_FOUND';
  end if;
end;
$$;

create function public.list_member_department_transfer_reviews_v1(p_org_id uuid, p_actor_id uuid, p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.assert_member_department_review_access_v1(p_org_id, p_actor_id, p_user_id);
  return (
    with pending as (
      select id, effective_at, kind, previous_grant
      from private.department_transfer_review_items
      where org_id = p_org_id and user_id = p_user_id and acknowledged_at is null
      order by effective_at desc, id
      limit 201
    ), review_ids as (
      select pending.*,
        (previous_grant->>'role_id')::uuid as role_id,
        case
          when kind = 'department_lead' then (previous_grant->>'department_id')::uuid
          when previous_grant->>'scope_type' = 'department' then (previous_grant->>'scope_id')::uuid
        end as department_id,
        case
          when kind = 'space_membership' then (previous_grant->>'space_id')::uuid
          when previous_grant->>'scope_type' = 'space' then (previous_grant->>'scope_id')::uuid
        end as space_id
      from pending
    )
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'review_id', item.id, 'effective_at', item.effective_at, 'kind', item.kind,
      'permission_code', item.previous_grant->>'permission_code',
      'effect', item.previous_grant->>'effect',
      'scope', item.previous_grant->'scope',
      'role_id', item.role_id, 'role_name', role.name,
      'scope_type', item.previous_grant->>'scope_type', 'scope_id', item.previous_grant->>'scope_id',
      'department_id', item.department_id, 'department_name', department.name,
      'space_id', item.space_id, 'space_name', space.name
    )) order by item.effective_at desc, item.id), '[]'::jsonb)
    from review_ids as item
    left join public.roles as role on role.id = item.role_id
      and (role.owner_org_id is null or role.owner_org_id = p_org_id)
    left join public.departments as department on department.id = item.department_id and department.org_id = p_org_id
    left join public.sales_spaces as space on space.id = item.space_id and space.org_id = p_org_id
  );
end;
$$;

create function public.acknowledge_member_department_transfer_review_v1(
  p_org_id uuid, p_actor_id uuid, p_user_id uuid, p_review_id uuid, p_request_id text default null
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  v_review private.department_transfer_review_items%rowtype;
  v_acknowledged_at timestamptz;
  v_audit jsonb;
begin
  perform private.assert_member_department_transfer_actor_v1(p_org_id, p_actor_id);
  perform private.assert_member_department_review_access_v1(p_org_id, p_actor_id, p_user_id);
  select * into v_review from private.department_transfer_review_items
    where org_id = p_org_id and user_id = p_user_id and id = p_review_id
    for update;
  if not found then
    raise exception 'department transfer review not found for member'
      using errcode = 'P0002', detail = 'DEPARTMENT_TRANSFER_REVIEW_NOT_FOUND';
  end if;
  if v_review.acknowledged_at is not null then
    if v_review.acknowledged_by = p_actor_id then return true; end if;
    raise exception 'department transfer review is no longer pending'
      using errcode = '40001', detail = 'DEPARTMENT_TRANSFER_REVIEW_STALE';
  end if;

  v_acknowledged_at := clock_timestamp();
  update private.department_transfer_review_items
  set acknowledged_at = v_acknowledged_at, acknowledged_by = p_actor_id
  where org_id = p_org_id and user_id = p_user_id and id = p_review_id;

  v_audit := jsonb_build_object('review_id', v_review.id, 'kind', v_review.kind, 'effective_at', v_review.effective_at);
  perform private.personnel_insert_event_v1(
    p_org_id, p_user_id, p_actor_id, 'acknowledge_department_transfer_review', v_audit,
    v_audit || jsonb_build_object('acknowledged_at', v_acknowledged_at, 'acknowledged_by', p_actor_id),
    'review acknowledged without changing grants', p_request_id
  );
  return true;
end;
$$;

revoke all on function private.assert_member_department_review_access_v1(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.list_member_department_transfer_reviews_v1(uuid, uuid, uuid),
  public.acknowledge_member_department_transfer_review_v1(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.list_member_department_transfer_reviews_v1(uuid, uuid, uuid),
  public.acknowledge_member_department_transfer_review_v1(uuid, uuid, uuid, uuid, text)
  to service_role;

commit;

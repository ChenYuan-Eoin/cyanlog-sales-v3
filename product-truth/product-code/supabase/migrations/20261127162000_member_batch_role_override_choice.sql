begin;

create function public.admin_assign_org_member_roles_batch_v1(
  p_actor_id uuid, p_org_id uuid, p_user_ids uuid[], p_role_ids uuid[],
  p_decisions jsonb default '[]'::jsonb, p_request_id text default null
)
returns table (user_id uuid, outcome text, review_revision uuid, affected_permissions jsonb)
language plpgsql security definer set search_path = ''
as $$
declare
  v_target uuid;
  v_role_ids uuid[];
  v_change jsonb;
  v_review_id uuid;
  v_choice text;
  v_result jsonb;
  v_error_detail text;
begin
  if p_actor_id is null or p_org_id is null
    or coalesce(cardinality(p_user_ids), 0) not between 1 and 200
    or array_position(p_user_ids, null) is not null
    or cardinality(p_user_ids) <> (select count(distinct member.id) from unnest(p_user_ids) as member(id))
    or coalesce(cardinality(p_role_ids), 0) not between 1 and 100
    or array_position(p_role_ids, null) is not null
    or jsonb_typeof(p_decisions) is distinct from 'array' then
    raise exception 'invalid member role batch input' using errcode = '22023';
  end if;
  if jsonb_array_length(p_decisions) > cardinality(p_user_ids) or exists (
    select 1 from jsonb_to_recordset(p_decisions) as decision(user_id uuid, review_revision uuid, choice text)
    where decision.user_id is null or not (decision.user_id = any(p_user_ids)) or decision.review_revision is null
      or decision.choice is null or decision.choice not in ('new_baseline', 'retain_eligible')
  ) or exists (
    select 1 from jsonb_to_recordset(p_decisions) as decision(user_id uuid)
    group by decision.user_id having count(*) > 1
  ) then
    raise exception 'invalid member role batch decisions' using errcode = '22023';
  end if;

  perform private.personnel_lock_org_v1(p_org_id);
  perform private.assert_system_role_assignment_actor_v1(p_actor_id, p_org_id);
  select array(select distinct id from unnest(p_role_ids) as role(id) order by id) into v_role_ids;
  if exists (
    select 1 from unnest(v_role_ids) as wanted(id)
    where not exists (
      select 1 from private.org_role_catalog_v1(p_org_id, false) as role
      where role.id = wanted.id and role.code not in ('SUPER_ADMIN', 'ORG_SUPER_ADMIN', 'FXIAOKE_BASELINE')
    )
  ) then
    raise exception 'batch roles are no longer assignable' using errcode = '23503', detail = 'ORG_ROLE_NOT_FOUND';
  end if;
  v_change := jsonb_build_object('kind', 'add_org', 'role_ids', v_role_ids);

  foreach v_target in array p_user_ids loop
    user_id := v_target;
    review_revision := null;
    affected_permissions := null;
    select decision.review_revision, decision.choice into v_review_id, v_choice
    from jsonb_to_recordset(p_decisions) as decision(user_id uuid, review_revision uuid, choice text)
    where decision.user_id = v_target;
    begin
      v_result := public.admin_apply_member_role_change_v1(
        p_actor_id, p_org_id, v_target, v_change, v_review_id, v_choice, p_request_id
      );
      if v_result ? 'review_revision' then
        outcome := 'ROLE_PERMISSION_REVIEW_REQUIRED';
        review_revision := (v_result->>'review_revision')::uuid;
        affected_permissions := v_result->'affected_permissions';
      else
        outcome := coalesce(v_result->>'result', 'MEMBER_UPDATE_FAILED');
      end if;
    exception when serialization_failure then
      get stacked diagnostics v_error_detail = pg_exception_detail;
      if v_error_detail is distinct from 'ROLE_OVERRIDE_REVIEW_CHANGED' then raise; end if;
      outcome := v_error_detail;
    end;
    return next;
  end loop;
end;
$$;

revoke all on function public.admin_assign_org_member_roles_batch_v1(uuid, uuid, uuid[], uuid[], jsonb, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_assign_org_member_roles_batch_v1(uuid, uuid, uuid[], uuid[], jsonb, text)
  to service_role;

commit;

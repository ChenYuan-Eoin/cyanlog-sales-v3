begin;

create function public.admin_set_shipping_intake_departments_v1(
  p_actor_id uuid, p_org_id uuid, p_expected_rules jsonb, p_allowed_department_ids uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_rules jsonb;
  v_saved_rules jsonb;
  v_active_departments integer;
  v_defaults constant jsonb := '{"companyName":{"enabled":true,"required":true,"minLength":4},"team":{"enabled":true,"required":true,"minLength":1},"teamOptions":[]}';
begin
  if p_org_id is null or p_actor_id is null or p_allowed_department_ids is null
    or cardinality(p_allowed_department_ids) > 500
    or (select count(distinct selected.id) from unnest(p_allowed_department_ids) as selected(id))
      <> cardinality(p_allowed_department_ids) then
    raise exception 'invalid shipping intake department selection' using errcode = '22023';
  end if;

  perform private.personnel_lock_org_v1(p_org_id);
  -- Serialize with appointments and keep the issuer's membership current until commit.
  perform 1 from public.organizations where id = p_org_id for no key update;
  perform 1 from public.users as person
  join public.user_organizations as membership on membership.user_id = person.id
  where membership.org_id = p_org_id and person.id = p_actor_id
  for share of person, membership;
  if not found or not private.personnel_is_org_control_admin_v1(p_actor_id, p_org_id) then
    raise exception 'shipping intake department administration denied' using errcode = '42501';
  end if;

  select rules into v_current_rules from public.shipping_intake_settings where org_id = p_org_id for update;
  if v_current_rules is distinct from p_expected_rules then
    raise exception 'shipping intake settings changed' using errcode = '40001';
  end if;
  if v_current_rules is not null and jsonb_typeof(v_current_rules) <> 'object' then
    raise exception 'invalid persisted shipping intake rules' using errcode = '22000';
  end if;

  perform department.id from public.departments as department
  where department.org_id = p_org_id and department.status = 'active'
    and department.id = any(p_allowed_department_ids)
  order by department.id for share;
  get diagnostics v_active_departments = row_count;
  if v_active_departments <> cardinality(p_allowed_department_ids) then
    raise exception 'shipping intake department is unavailable' using errcode = '23514';
  end if;

  v_saved_rules := jsonb_set(coalesce(v_current_rules, v_defaults), '{allowedDepartmentIds}', to_jsonb(p_allowed_department_ids));
  if v_current_rules is null then
    insert into public.shipping_intake_settings (org_id, rules, updated_by)
    values (p_org_id, v_saved_rules, p_actor_id)
    on conflict (org_id) do nothing;
    if not found then
      raise exception 'shipping intake settings changed' using errcode = '40001';
    end if;
  else
    update public.shipping_intake_settings
    set rules = v_saved_rules, updated_by = p_actor_id, updated_at = now()
    where org_id = p_org_id;
  end if;
  return v_saved_rules;
end;
$$;

revoke all on function public.admin_set_shipping_intake_departments_v1(uuid, uuid, jsonb, uuid[])
  from public, anon, authenticated;
grant execute on function public.admin_set_shipping_intake_departments_v1(uuid, uuid, jsonb, uuid[])
  to service_role;

commit;

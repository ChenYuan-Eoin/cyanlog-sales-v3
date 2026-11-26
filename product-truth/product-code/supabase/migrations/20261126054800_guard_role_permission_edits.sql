-- Role authorization settings and ordinary configuration use different write contracts.
begin;

create function public.admin_save_org_role_permissions_v1(
  p_actor_id uuid,
  p_org_id uuid,
  p_role_id uuid,
  p_expected_settings jsonb,
  p_expected_role_code text,
  p_expected_role_template jsonb,
  p_permissions text[],
  p_owner_permissions text[]
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings jsonb;
  v_code text;
  v_template jsonb;
  v_next jsonb;
begin
  if p_actor_id is null or p_org_id is null or p_role_id is null then
    raise exception 'role authorization requires an exact actor, organization and role' using errcode = '22023';
  end if;
  perform private.assert_system_role_assignment_actor_v1(p_actor_id, p_org_id);

  select settings into v_settings
  from public.organizations
  where id = p_org_id and status = 'active';
  if not found then return 'conflict'; end if;

  select code, permissions into v_code, v_template
  from public.roles
  where id = p_role_id
  for share;
  if not found then return 'not_found'; end if;
  if v_code in ('SUPER_ADMIN', 'ORG_SUPER_ADMIN') or (v_code = 'FXIAOKE_BASELINE' and p_permissions is not null) then
    return 'fixed_role';
  end if;
  if coalesce(v_settings, 'null'::jsonb) is distinct from coalesce(p_expected_settings, 'null'::jsonb)
    or v_code is distinct from p_expected_role_code
    or coalesce(v_template, 'null'::jsonb) is distinct from coalesce(p_expected_role_template, 'null'::jsonb) then
    return 'conflict';
  end if;

  v_next := coalesce(nullif(v_settings, 'null'::jsonb), '{}'::jsonb);
  if jsonb_typeof(v_next) <> 'object'
    or (v_next ? 'role_permission_overrides' and jsonb_typeof(v_next->'role_permission_overrides') <> 'object')
    or (v_next ? 'shipping_owner_permission_overrides' and jsonb_typeof(v_next->'shipping_owner_permission_overrides') <> 'object')
    or cardinality(p_permissions) > 300 or cardinality(p_owner_permissions) > 300
    or cardinality(p_permissions) <> (select count(distinct code) from unnest(p_permissions) as permission(code))
    or cardinality(p_owner_permissions) <> (select count(distinct code) from unnest(p_owner_permissions) as permission(code))
    or exists (
      select 1 from unnest(p_permissions) as permission(code)
      where code is null or length(code) not between 1 and 120 or left(code, 15) = 'shipping:owner_'
    )
    or exists (
      select 1 from unnest(p_owner_permissions) as permission(code)
      where code is null or length(code) not between 1 and 120 or left(code, 15) <> 'shipping:owner_'
    )
    or (cardinality(p_owner_permissions) > 0 and not ('shipping:owner_view' = any(p_owner_permissions))) then
    raise exception 'invalid role permissions' using errcode = '22023';
  end if;

  if p_permissions is not null then
    v_next := jsonb_set(v_next, '{role_permission_overrides}',
      coalesce(v_next->'role_permission_overrides', '{}'::jsonb) || jsonb_build_object(p_role_id, p_permissions));
  end if;
  if p_owner_permissions is not null then
    v_next := jsonb_set(v_next, '{shipping_owner_permission_overrides}',
      coalesce(v_next->'shipping_owner_permission_overrides', '{}'::jsonb) || jsonb_build_object(p_role_id, p_owner_permissions));
  end if;
  if p_permissions is not null or p_owner_permissions is not null then
    update public.organizations set settings = v_next
    where id = p_org_id and settings is distinct from v_next;
  end if;
  return 'saved';
end;
$$;

revoke all on function public.admin_save_org_role_permissions_v1(uuid, uuid, uuid, jsonb, text, jsonb, text[], text[])
  from public, anon, authenticated;
grant execute on function public.admin_save_org_role_permissions_v1(uuid, uuid, uuid, jsonb, text, jsonb, text[], text[])
  to service_role;

commit;

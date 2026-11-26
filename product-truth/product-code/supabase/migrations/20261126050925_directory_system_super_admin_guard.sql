-- Directory and identity operations must preserve an organization's effective controller.
begin;

create function private.has_effective_system_super_admin_v1(p_org_id uuid)
returns boolean language sql stable set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles as binding
    join public.roles as role on role.id = binding.role_id and role.code = 'SUPER_ADMIN'
    where binding.org_id = p_org_id and binding.scope_type = 'org' and binding.scope_id = p_org_id
      and private.personnel_is_org_control_admin_v1(binding.user_id, p_org_id)
  );
$$;

create function private.assert_system_super_admin_continuity_v1(p_org_id uuid, p_had_controller boolean)
returns void language plpgsql set search_path = ''
as $$
begin
  if p_had_controller and not private.has_effective_system_super_admin_v1(p_org_id) then
    raise exception 'cannot remove the last effective system administrator'
      using errcode = '23514', detail = 'LAST_SYSTEM_SUPER_ADMIN_PROTECTED';
  end if;
end;
$$;

alter function public.apply_organization_directory_cutover_v1(uuid, uuid, text, uuid, jsonb, uuid) set schema private;
alter function public.rollback_organization_directory_cutover_v1(uuid, uuid, uuid) set schema private;
alter function public.admin_merge_duplicate_identity_v1(uuid, uuid, uuid, uuid, text, text) set schema private;

revoke all on function private.has_effective_system_super_admin_v1(uuid),
  private.assert_system_super_admin_continuity_v1(uuid, boolean),
  private.apply_organization_directory_cutover_v1(uuid, uuid, text, uuid, jsonb, uuid),
  private.rollback_organization_directory_cutover_v1(uuid, uuid, uuid),
  private.admin_merge_duplicate_identity_v1(uuid, uuid, uuid, uuid, text, text)
  from public, anon, authenticated, service_role;

create function public.apply_organization_directory_cutover_v1(
  p_system_org_id uuid, p_plan_id uuid, p_plan_hash text, p_connection_revision uuid,
  p_source_revisions jsonb, p_actor_id uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_had_controller boolean;
  v_result jsonb;
begin
  -- Take the personnel lock before any directory row lock.
  perform private.personnel_lock_org_v1(p_system_org_id);
  perform 1 from public.organizations where id = p_system_org_id for no key update;
  v_had_controller := private.has_effective_system_super_admin_v1(p_system_org_id);
  v_result := private.apply_organization_directory_cutover_v1(
    p_system_org_id, p_plan_id, p_plan_hash, p_connection_revision, p_source_revisions, p_actor_id
  );
  perform private.assert_system_super_admin_continuity_v1(p_system_org_id, v_had_controller);
  return v_result;
end;
$$;

create function public.rollback_organization_directory_cutover_v1(
  p_system_org_id uuid, p_plan_id uuid, p_actor_id uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_had_controller boolean;
  v_result jsonb;
begin
  perform private.personnel_lock_org_v1(p_system_org_id);
  perform 1 from public.organizations where id = p_system_org_id for no key update;
  v_had_controller := private.has_effective_system_super_admin_v1(p_system_org_id);
  v_result := private.rollback_organization_directory_cutover_v1(p_system_org_id, p_plan_id, p_actor_id);
  perform private.assert_system_super_admin_continuity_v1(p_system_org_id, v_had_controller);
  return v_result;
end;
$$;

create function public.admin_merge_duplicate_identity_v1(
  p_actor_id uuid, p_org_id uuid, p_primary_user_id uuid, p_duplicate_user_id uuid,
  p_reason text, p_request_id text default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_initial_default_org uuid;
  v_current_default_org uuid;
  v_locked_org uuid;
  v_had_controller boolean;
  v_result jsonb;
begin
  if p_actor_id is null or p_org_id is null or p_primary_user_id is null or p_duplicate_user_id is null
    or p_primary_user_id = p_duplicate_user_id
    or nullif(btrim(coalesce(p_reason, '')), '') is null
    or char_length(btrim(p_reason)) > 1000 then
    raise exception 'invalid duplicate identity merge input' using errcode = '22023';
  end if;

  -- A merge disables the source account globally. Its default organization
  -- may differ from the organization where the account record was created.
  select org_id into v_initial_default_org from public.user_organizations
  where user_id = p_duplicate_user_id and is_default;

  for v_locked_org in
    select distinct org_id from unnest(array[p_org_id, v_initial_default_org]) as locked(org_id)
    where org_id is not null order by org_id
  loop
    perform private.personnel_lock_org_v1(v_locked_org);
  end loop;

  perform 1 from public.organizations where id = any(array[p_org_id, v_initial_default_org])
    order by id for no key update;
  if not private.personnel_is_org_control_admin_v1(p_actor_id, p_org_id) then
    raise exception 'only an effective system administrator may merge duplicate identities' using errcode = '42501';
  end if;

  -- The delegate also locks both accounts for update. Take that mode in a
  -- consistent order up front and confirm the default membership did not move.
  perform 1 from public.users where id in (p_primary_user_id, p_duplicate_user_id) and org_id = p_org_id
    order by id for update;
  perform 1 from public.user_organizations where user_id = p_duplicate_user_id
    order by org_id for no key update;
  select org_id into v_current_default_org from public.user_organizations
  where user_id = p_duplicate_user_id and is_default;
  if v_initial_default_org is distinct from v_current_default_org then
    raise exception 'duplicate identity default organization changed' using errcode = '40001';
  end if;

  if v_current_default_org <> p_org_id
    and private.personnel_is_org_control_admin_v1(p_duplicate_user_id, v_current_default_org) then
    raise exception 'cannot merge an effective system administrator of another organization'
      using errcode = '23514', detail = 'OTHER_ORG_SYSTEM_SUPER_ADMIN_PROTECTED';
  end if;

  v_had_controller := private.has_effective_system_super_admin_v1(p_org_id);
  v_result := private.admin_merge_duplicate_identity_v1(
    p_actor_id, p_org_id, p_primary_user_id, p_duplicate_user_id, p_reason, p_request_id
  );
  perform private.assert_system_super_admin_continuity_v1(p_org_id, v_had_controller);
  return v_result;
end;
$$;

revoke all on function public.apply_organization_directory_cutover_v1(uuid, uuid, text, uuid, jsonb, uuid),
  public.rollback_organization_directory_cutover_v1(uuid, uuid, uuid),
  public.admin_merge_duplicate_identity_v1(uuid, uuid, uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.apply_organization_directory_cutover_v1(uuid, uuid, text, uuid, jsonb, uuid),
  public.rollback_organization_directory_cutover_v1(uuid, uuid, uuid),
  public.admin_merge_duplicate_identity_v1(uuid, uuid, uuid, uuid, text, text)
  to service_role;

commit;

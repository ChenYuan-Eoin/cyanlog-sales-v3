-- Preserve historical assignments and their provenance while closing new grants.
begin;

create or replace function public.admin_replace_org_roles_v1(
  p_actor_id uuid, p_org_id uuid, p_user_id uuid, p_role_ids uuid[],
  p_reason text default null, p_request_id text default null
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  v_baseline_id uuid;
  v_legacy_admin_id uuid;
  v_other_roles uuid[];
  v_before jsonb;
  v_after jsonb;
begin
  perform private.assert_system_role_assignment_actor_v1(p_actor_id, p_org_id);
  select id into v_baseline_id from public.roles where code = 'FXIAOKE_BASELINE';
  if v_baseline_id is null or not coalesce(v_baseline_id = any(p_role_ids), false) then
    return private.admin_replace_org_roles_before_system_actor_v1(
      p_actor_id, p_org_id, p_user_id, p_role_ids, p_reason, p_request_id
    );
  end if;

  if not exists (
    select 1 from public.user_organizations
    where user_id = p_user_id and org_id = p_org_id and status = 'active'
  ) then
    -- Keeping an existing reservation must not retarget it to a new identity.
    if exists (
      select 1 from public.fxiaoke_pending_org_roles as pending
      join public.fxiaoke_prelogin_role_targets_v1(p_org_id, p_user_id) as target
        on target.user_id = pending.user_id and target.source_id = pending.source_id
        and target.identity_id = pending.external_identity_id and target.external_user_id = pending.external_user_id
      where pending.org_id = p_org_id and pending.user_id = p_user_id and pending.role_id = v_baseline_id
    ) then
      return private.admin_replace_org_roles_before_system_actor_v1(
        p_actor_id, p_org_id, p_user_id, p_role_ids, p_reason, p_request_id
      );
    end if;
    raise exception 'the historical baseline role cannot be newly assigned'
      using errcode = '42501', detail = 'LEGACY_BASELINE_ASSIGNMENT_FORBIDDEN';
  end if;

  if not private.has_exact_org_role_v1(p_user_id, p_org_id, 'FXIAOKE_BASELINE') then
    raise exception 'the historical baseline role cannot be newly assigned'
      using errcode = '42501', detail = 'LEGACY_BASELINE_ASSIGNMENT_FORBIDDEN';
  end if;

  -- The general replacement delegates rewrite all ordinary bindings. Keep the
  -- historical baseline row itself intact when an editor echoes it.
  select id into strict v_legacy_admin_id from public.roles where code = 'ORG_SUPER_ADMIN';
  if (v_legacy_admin_id = any(p_role_ids) and not private.has_exact_org_role_v1(p_user_id, p_org_id, 'ORG_SUPER_ADMIN'))
    or private.has_exact_org_role_v1(p_user_id, p_org_id, 'SUPER_ADMIN')
    or exists (select 1 from public.roles where code = 'SUPER_ADMIN' and id = any(p_role_ids)) then
    raise exception 'reserved administrator role mutation denied' using errcode = '42501';
  end if;
  v_other_roles := array_remove(array_remove(p_role_ids, v_baseline_id), v_legacy_admin_id);
  if (select count(*) from public.roles where id = any(v_other_roles)) <> cardinality(v_other_roles) then
    raise exception 'role does not exist' using errcode = '23503';
  end if;

  select coalesce(jsonb_agg(role_id order by role_id), '[]'::jsonb) into v_before
  from public.user_roles
  where user_id = p_user_id and org_id = p_org_id and scope_type = 'org' and scope_id = p_org_id
    and role_id <> v_legacy_admin_id;
  delete from public.fxiaoke_pending_org_roles where org_id = p_org_id and user_id = p_user_id;
  delete from public.user_roles
  where user_id = p_user_id and org_id = p_org_id and scope_type = 'org' and scope_id = p_org_id
    and role_id not in (v_baseline_id, v_legacy_admin_id);
  insert into public.user_roles (user_id, role_id, org_id, scope_type, scope_id, granted_by)
  select p_user_id, desired.role_id, p_org_id, 'org', p_org_id, p_actor_id
  from unnest(v_other_roles) as desired(role_id);
  select coalesce(jsonb_agg(role_id order by role_id), '[]'::jsonb) into v_after
  from public.user_roles
  where user_id = p_user_id and org_id = p_org_id and scope_type = 'org' and scope_id = p_org_id
    and role_id <> v_legacy_admin_id;
  perform private.personnel_insert_event_v1(
    p_org_id, p_user_id, p_actor_id, 'assign_org_roles',
    jsonb_build_object('role_ids', v_before), jsonb_build_object('role_ids', v_after), p_reason, p_request_id
  );
  return true;
end;
$$;

create or replace function public.admin_set_role_scope_assignment_v1(
  p_actor_id uuid, p_org_id uuid, p_user_id uuid, p_role_id uuid, p_scope_type text, p_scope_id uuid,
  p_action text, p_reason text default null, p_request_id text default null
)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  perform private.assert_system_role_assignment_actor_v1(p_actor_id, p_org_id);
  if p_action = 'assign' and p_scope_type = 'space' then
    raise exception 'legacy space assignments can only be revoked'
      using errcode = '23514', detail = 'LEGACY_SCOPE_ASSIGNMENT_FORBIDDEN';
  end if;
  if p_action = 'assign' and exists (select 1 from public.roles where id = p_role_id and code = 'FXIAOKE_BASELINE') then
    raise exception 'the historical baseline role cannot be newly assigned'
      using errcode = '42501', detail = 'LEGACY_BASELINE_ASSIGNMENT_FORBIDDEN';
  end if;
  return private.admin_set_role_scope_assignment_before_system_actor_v1(
    p_actor_id, p_org_id, p_user_id, p_role_id, p_scope_type, p_scope_id, p_action, p_reason, p_request_id
  );
end;
$$;

create function private.reject_fxiaoke_baseline_invitation_v1()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.roles where id = any(new.role_ids) and code = 'FXIAOKE_BASELINE') then
    raise exception 'the historical baseline role cannot be newly assigned'
      using errcode = '42501', detail = 'LEGACY_BASELINE_ASSIGNMENT_FORBIDDEN';
  end if;
  return new;
end;
$$;
revoke all on function private.reject_fxiaoke_baseline_invitation_v1() from public, anon, authenticated, service_role;
create trigger reject_fxiaoke_baseline_invitation before insert on public.personnel_invitations
  for each row execute function private.reject_fxiaoke_baseline_invitation_v1();

alter function public.admin_save_org_role_permissions_v1(uuid, uuid, uuid, jsonb, text, jsonb, text[], text[])
  rename to admin_save_org_role_permissions_before_baseline_retirement_v1;
alter function public.admin_save_org_role_permissions_before_baseline_retirement_v1(uuid, uuid, uuid, jsonb, text, jsonb, text[], text[])
  set schema private;
revoke all on function private.admin_save_org_role_permissions_before_baseline_retirement_v1(
  uuid, uuid, uuid, jsonb, text, jsonb, text[], text[]
) from public, anon, authenticated, service_role;

create function public.admin_save_org_role_permissions_v1(
  p_actor_id uuid, p_org_id uuid, p_role_id uuid, p_expected_settings jsonb, p_expected_role_code text,
  p_expected_role_template jsonb, p_permissions text[], p_owner_permissions text[]
)
returns text language plpgsql security definer set search_path = ''
as $$
begin
  if p_actor_id is null or p_org_id is null or p_role_id is null then
    raise exception 'role authorization requires an exact actor, organization and role' using errcode = '22023';
  end if;
  perform private.assert_system_role_assignment_actor_v1(p_actor_id, p_org_id);
  if exists (select 1 from public.roles where id = p_role_id and code = 'FXIAOKE_BASELINE') then
    return 'fixed_role';
  end if;
  return private.admin_save_org_role_permissions_before_baseline_retirement_v1(
    p_actor_id, p_org_id, p_role_id, p_expected_settings, p_expected_role_code,
    p_expected_role_template, p_permissions, p_owner_permissions
  );
end;
$$;
revoke all on function public.admin_save_org_role_permissions_v1(uuid, uuid, uuid, jsonb, text, jsonb, text[], text[])
  from public, anon, authenticated;
grant execute on function public.admin_save_org_role_permissions_v1(uuid, uuid, uuid, jsonb, text, jsonb, text[], text[])
  to service_role;

commit;

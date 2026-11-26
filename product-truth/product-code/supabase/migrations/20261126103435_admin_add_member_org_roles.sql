-- WP82. Apply a batch within the same organization as the selected members.
begin;

-- Dormant historical roles have no authority and do not lock personnel actions.
create or replace function private.personnel_assert_last_admin_safe_v1(p_user_id uuid, p_org_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform private.personnel_assert_last_platform_admin_safe_v1(p_user_id, p_org_id);
end;
$$;

create function private.clear_departed_pending_authorization_v1()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.fxiaoke_pending_org_roles
  where org_id = new.org_id and user_id = new.user_id;
  update public.personnel_invitations set status = 'revoked', revoked_at = now()
  where org_id = new.org_id and user_id = new.user_id and status = 'pending';
  return new;
end;
$$;

create trigger clear_departed_pending_authorization
  after update of status on public.user_organizations
  for each row when (new.status = 'ended' and old.status is distinct from new.status)
  execute function private.clear_departed_pending_authorization_v1();

-- Invitation acceptance must not reactivate an explicitly disabled or departed person.
alter function public.accept_personnel_invitation_v1(text, text)
  rename to accept_personnel_invitation_before_lifecycle_guard_v1;
alter function public.accept_personnel_invitation_before_lifecycle_guard_v1(text, text) set schema private;

create function public.accept_personnel_invitation_v1(p_token_hash text, p_request_id text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_org_id uuid;
begin
  select invitation.org_id into v_org_id from public.personnel_invitations as invitation
  where invitation.token_hash = p_token_hash and invitation.status = 'pending' and invitation.expires_at > now();
  if not found then return null; end if;

  perform private.personnel_lock_org_v1(v_org_id);
  perform 1
  from public.personnel_invitations as invitation
  join public.users as person on person.id = invitation.user_id and person.org_id = invitation.org_id
  join public.user_organizations as membership on membership.user_id = person.id and membership.org_id = person.org_id
  where invitation.token_hash = p_token_hash and invitation.org_id = v_org_id
    and invitation.status = 'pending' and invitation.expires_at > now()
    and membership.is_default and membership.status = 'invited'
    and membership.employment_status = 'active' and membership.left_at is null
    and person.status = 'inactive' and person.login_enabled is false
    and not coalesce((
      select event.after_state->>'login_enabled' = 'false' or event.after_state->>'status' in ('inactive','suspended')
      from public.personnel_lifecycle_events as event
      where event.org_id = v_org_id and event.target_user_id = person.id and event.command = 'set_account_state'
      order by event.occurred_at desc, event.id desc limit 1
    ), false)
  for update of invitation, person, membership;
  if not found then return null; end if;

  return private.accept_personnel_invitation_before_lifecycle_guard_v1(p_token_hash, p_request_id);
end;
$$;

create function private.admin_add_member_org_roles_v1(
  p_actor_id uuid, p_org_id uuid, p_user_id uuid, p_role_ids uuid[], p_effective boolean, p_request_id text
)
returns text language plpgsql set search_path = ''
as $$
declare
  v_target record;
  v_before uuid[];
  v_changed integer;
  v_result text;
  v_audit_key text;
  v_source_roles uuid[];
begin
  if p_effective then
    select array(
      select assignment.role_id from public.user_roles as assignment
      where assignment.user_id = p_user_id and assignment.org_id = p_org_id
        and assignment.scope_type = 'org' and assignment.scope_id = p_org_id
      order by assignment.role_id
    ) into v_before;

    insert into public.user_roles (org_id, user_id, role_id, scope_type, scope_id, granted_by)
    select p_org_id, p_user_id, wanted.role_id, 'org', p_org_id, p_actor_id
    from unnest(p_role_ids) as wanted(role_id)
    on conflict (user_id, role_id, scope_type, scope_id) do nothing;

    get diagnostics v_changed = row_count;
    v_result := 'saved';
    v_audit_key := 'role_ids';
  else
    select * into v_target from public.fxiaoke_prelogin_role_targets_v1(p_org_id, p_user_id);
    if not found then return 'MEMBER_NOT_ELIGIBLE'; end if;

    select array(
      select pending.role_id from public.fxiaoke_pending_org_roles as pending
      where pending.org_id = p_org_id and pending.user_id = p_user_id
        and pending.source_id = v_target.source_id and pending.external_identity_id = v_target.identity_id
        and pending.external_user_id = v_target.external_user_id
      order by pending.role_id
    ) into v_before;

    insert into public.fxiaoke_pending_org_roles as pending (
      org_id, user_id, role_id, source_id, external_identity_id, external_user_id, granted_by
    )
    select p_org_id, p_user_id, wanted.role_id, v_target.source_id, v_target.identity_id, v_target.external_user_id, p_actor_id
    from unnest(p_role_ids) as wanted(role_id)
    on conflict (org_id, user_id, role_id) do update
    set source_id = excluded.source_id, external_identity_id = excluded.external_identity_id,
      external_user_id = excluded.external_user_id, granted_by = excluded.granted_by, granted_at = excluded.granted_at
    where (pending.source_id, pending.external_identity_id, pending.external_user_id)
      is distinct from (excluded.source_id, excluded.external_identity_id, excluded.external_user_id);

    get diagnostics v_changed = row_count;
    v_result := 'pending';
    v_audit_key := 'pending_role_ids';
  end if;

  if v_changed > 0 then
    select array(select distinct id from unnest(v_before || p_role_ids) as assigned(id) order by id)
      into v_source_roles;
    perform private.personnel_insert_event_v1(
      p_org_id, p_user_id, p_actor_id, 'assign_org_roles',
      jsonb_build_object(v_audit_key, v_before), jsonb_build_object(v_audit_key, v_source_roles),
      'tenant batch role assignment', p_request_id
    );
  end if;
  return v_result;
end;
$$;

create function public.admin_apply_org_member_batch_v1(
  p_actor_id uuid, p_org_id uuid, p_user_ids uuid[], p_action text, p_role_ids uuid[], p_request_id text default null
)
returns table (user_id uuid, outcome text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id uuid;
  v_member record;
  v_role_ids uuid[];
  v_error_detail text;
begin
  if p_actor_id is null or p_org_id is null or coalesce(cardinality(p_user_ids), 0) not between 1 and 200
    or array_position(p_user_ids, null) is not null or p_action is null
    or p_action not in ('suspend', 'offboard', 'assign_roles') then
    raise exception 'invalid member batch input' using errcode = '22023';
  end if;

  perform private.personnel_lock_org_v1(p_org_id);
  perform 1 from public.organizations where id = p_org_id and status = 'active' for no key update;
  if not found then
    raise exception 'current organization is unavailable' using errcode = '42501';
  end if;
  perform 1 from public.users as person
  join public.user_organizations as membership on membership.user_id = person.id and membership.org_id = person.org_id
  where person.id = p_actor_id and person.org_id = p_org_id and person.status = 'active' and person.login_enabled is true
    and membership.is_default and membership.status = 'active' and membership.employment_status = 'active'
    and membership.left_at is null
  for share of person, membership;
  if not found then
    raise exception 'current organization member is unavailable' using errcode = '42501';
  end if;

  if p_action = 'assign_roles' then
    perform private.assert_system_role_assignment_actor_v1(p_actor_id, p_org_id);
    select array(select distinct id from unnest(p_role_ids) as roles(id) order by id) into v_role_ids;
    if cardinality(v_role_ids) not between 1 and 100 or exists (
      select 1 from unnest(v_role_ids) as wanted(id)
      where not exists (
        select 1 from private.org_role_catalog_v1(p_org_id, false) as role
        where role.id = wanted.id and role.code not in ('SUPER_ADMIN', 'ORG_SUPER_ADMIN', 'FXIAOKE_BASELINE')
      )
    ) then
      raise exception 'batch roles are no longer assignable' using errcode = '23503', detail = 'ORG_ROLE_NOT_FOUND';
    end if;
  end if;

  foreach v_user_id in array p_user_ids loop
    user_id := v_user_id;
    begin
      if v_user_id = p_actor_id then
        outcome := 'SELF_MUTATION_FORBIDDEN';
      else
        select person.status as account_status, person.login_enabled, membership.status, membership.employment_status
          into v_member
        from public.users as person
        join public.user_organizations as membership on membership.user_id = person.id and membership.org_id = person.org_id
        where person.id = v_user_id and person.org_id = p_org_id and membership.is_default
        for update of person, membership;

        if not found then
          outcome := 'MEMBER_NOT_ELIGIBLE';
        elsif p_action = 'assign_roles' then
          outcome := private.admin_add_member_org_roles_v1(
            p_actor_id, p_org_id, v_user_id, v_role_ids,
            v_member.account_status = 'active' and v_member.status = 'active' and v_member.employment_status = 'active',
            p_request_id
          );
        elsif v_member.status = 'ended' then
          outcome := case when p_action = 'offboard' then 'saved' else 'MEMBER_NOT_ELIGIBLE' end;
        elsif private.has_exact_org_role_v1(v_user_id, p_org_id, 'SUPER_ADMIN') then
          perform private.personnel_assert_last_platform_admin_safe_v1(v_user_id, p_org_id);
          outcome := 'PROTECTED_ROLE_MUTATION_FORBIDDEN';
        elsif p_action = 'offboard' then
          outcome := case when public.admin_offboard_member_v1(
            p_actor_id, p_org_id, v_user_id, 'tenant batch offboarding', p_request_id) is true
            then 'saved' else 'MEMBER_NOT_ELIGIBLE' end;
        elsif v_member.login_enabled is false and v_member.status <> 'invited' then
          outcome := 'saved';
        else
          outcome := case when public.admin_set_account_state_v1(
            p_actor_id, p_org_id, v_user_id, null, false, 'tenant batch login revocation', p_request_id) is true
            then 'saved' else 'MEMBER_NOT_ELIGIBLE' end;
        end if;
      end if;
    exception
      when check_violation then
        get stacked diagnostics v_error_detail = pg_exception_detail;
        if v_error_detail = 'LAST_SYSTEM_SUPER_ADMIN_PROTECTED' then
          outcome := 'LAST_SYSTEM_SUPER_ADMIN_PROTECTED';
        else
          raise log 'member batch action % failed with SQLSTATE %', p_action, sqlstate;
          outcome := 'MEMBER_UPDATE_FAILED';
        end if;
      when insufficient_privilege then
        outcome := 'MEMBER_UPDATE_FORBIDDEN';
      when others then
        raise log 'member batch action % failed with SQLSTATE %', p_action, sqlstate;
        outcome := 'MEMBER_UPDATE_FAILED';
    end;
    return next;
  end loop;
end;
$$;

revoke all on function private.clear_departed_pending_authorization_v1(),
  private.accept_personnel_invitation_before_lifecycle_guard_v1(text, text),
  public.accept_personnel_invitation_v1(text, text),
  private.admin_add_member_org_roles_v1(uuid, uuid, uuid, uuid[], boolean, text),
  public.admin_apply_org_member_batch_v1(uuid, uuid, uuid[], text, uuid[], text)
  from public, anon, authenticated, service_role;
grant execute on function public.accept_personnel_invitation_v1(text, text),
  public.admin_apply_org_member_batch_v1(uuid, uuid, uuid[], text, uuid[], text)
  to service_role;

commit;

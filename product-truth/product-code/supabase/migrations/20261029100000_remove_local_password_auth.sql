-- F003 / WP94. Destructive password-auth removal.
-- Apply only after production Fxiaoke SSO, the approved auxiliary login path,
-- and the audited administrator recovery path have all been verified. This
-- migration fails closed if any active super administrator lacks a stable
-- external identity mapping.
begin;

do $$
begin
  if exists (
    select 1
      from public.users as user_row
      join public.user_roles as assignment
        on assignment.user_id = user_row.id
       and assignment.org_id = user_row.org_id
       and assignment.scope_type = 'org'
       and assignment.scope_id = user_row.org_id
      join public.roles as role
        on role.id = assignment.role_id
     where user_row.status = 'active'
       and role.code = 'SUPER_ADMIN'
       and not exists (
         select 1
           from public.external_identities as identity
          where identity.canonical_user_id = user_row.id
            and identity.system_org_id = user_row.org_id
            and identity.match_status = 'matched'
       )
  ) then
    raise exception 'cannot remove local passwords before every active SUPER_ADMIN has a stable external identity'
      using errcode = '23514';
  end if;
end;
$$;

do $$
declare
  function_row record;
begin
  for function_row in
    select namespace.nspname as schema_name, procedure.proname as function_name,
           pg_get_function_identity_arguments(procedure.oid) as identity_arguments
      from pg_proc as procedure
      join pg_namespace as namespace
        on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'public'
       and procedure.proname in (
         'login_with_password_v1',
         'get_login_candidate_v1',
         'reset_org_user_password_and_revoke_sessions_v1',
         'admin_reset_password_v1',
         'accept_personnel_invitation_v1'
       )
  loop
    execute format(
      'drop function if exists %I.%I(%s)',
      function_row.schema_name,
      function_row.function_name,
      function_row.identity_arguments
    );
  end loop;
end;
$$;

create or replace function public.accept_personnel_invitation_v1(
  p_token_hash text,
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
  if p_token_hash is null or length(p_token_hash) = 0 then
    raise exception 'invitation token hash is required' using errcode = '22023';
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
    'user_id', v_invitation.user_id,
    'org_id', v_invitation.org_id
  );
end;
$$;

revoke all on function public.accept_personnel_invitation_v1(text, text)
  from public, anon, authenticated;
grant execute on function public.accept_personnel_invitation_v1(text, text)
  to service_role;

alter table public.users
  drop column if exists password_hash,
  drop column if exists must_change_password;

comment on table public.phone_history is
  'Non-overlapping phone ownership intervals. Local passwords are not part of authentication.';

commit;

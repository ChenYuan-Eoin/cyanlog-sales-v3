-- Recheck the enterprise-login actor under the current personnel lock before
-- the original connection and recovery checks or any source/session mutation.
begin;

alter function public.set_fxiaoke_identity_authority_v1(uuid, uuid, uuid, boolean)
  rename to set_fxiaoke_identity_authority_before_system_guard_v1;
alter function public.set_fxiaoke_identity_authority_before_system_guard_v1(uuid, uuid, uuid, boolean)
  set schema private;
revoke all on function private.set_fxiaoke_identity_authority_before_system_guard_v1(uuid, uuid, uuid, boolean)
  from public, anon, authenticated, service_role;

create function public.set_fxiaoke_identity_authority_v1(
  p_actor_id uuid, p_org_id uuid, p_connection_revision uuid, p_enabled boolean
)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  begin
    perform private.assert_system_role_assignment_actor_v1(p_actor_id, p_org_id);
  exception when insufficient_privilege then
    return false;
  end;

  return private.set_fxiaoke_identity_authority_before_system_guard_v1(
    p_actor_id, p_org_id, p_connection_revision, p_enabled
  );
end;
$$;

revoke all on function public.set_fxiaoke_identity_authority_v1(uuid, uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.set_fxiaoke_identity_authority_v1(uuid, uuid, uuid, boolean)
  to service_role;

commit;

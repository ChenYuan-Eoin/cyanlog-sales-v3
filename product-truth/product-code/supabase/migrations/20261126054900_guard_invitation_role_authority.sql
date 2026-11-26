-- A member invitation may reserve ordinary roles only while its creator is
-- the effective system administrator in the invitation's organization.
begin;

create or replace function private.reject_org_super_admin_invitation_v1()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    -- The original creator is historical data, not the actor of an update.
    -- Existing pending invitations may be reissued, accepted or revoked.
    if new.status = 'pending' and cardinality(new.role_ids) > 0 and (
      not (new.role_ids <@ old.role_ids)
      or new.org_id is distinct from old.org_id
      or new.user_id is distinct from old.user_id
      or old.status is distinct from 'pending'
    ) then
      raise exception 'new role reservations require a new invitation'
        using errcode = '42501', detail = 'PERSONNEL_INVITATION_ROLE_CHANGE_FORBIDDEN';
    end if;
    if new.role_ids is not distinct from old.role_ids then return new; end if;
  end if;

  if exists (select 1 from public.roles where code in ('SUPER_ADMIN', 'ORG_SUPER_ADMIN') and id = any(new.role_ids)) then
    raise exception 'system administrator cannot be appointed through an invitation' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and cardinality(new.role_ids) > 0 then
    begin
      perform private.assert_system_role_assignment_actor_v1(new.created_by, new.org_id);
    exception when insufficient_privilege then
      raise exception 'only the current system administrator can reserve roles on an invitation'
        using errcode = '42501', detail = 'PERSONNEL_INVITATION_ROLE_AUTHORITY_REQUIRED';
    end;
  end if;
  return new;
end;
$$;

drop trigger reject_org_super_admin_invitation on public.personnel_invitations;
create trigger reject_org_super_admin_invitation
  before insert or update of role_ids, org_id, user_id, status on public.personnel_invitations
  for each row execute function private.reject_org_super_admin_invitation_v1();

commit;

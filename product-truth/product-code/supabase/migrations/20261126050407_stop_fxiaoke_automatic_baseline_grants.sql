-- Keep the old login function callable during application rollback, but only
-- verify the identity and apply any roles that an administrator preassigned.
create or replace function public.ensure_fxiaoke_baseline_view_v1(
  p_org_id uuid,
  p_external_user_id text,
  p_expected_user_id uuid
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select coalesce(
    public.activate_fxiaoke_sso_member_v1(p_org_id, p_external_user_id, p_expected_user_id) = p_expected_user_id,
    false
  );
$$;

revoke all on function public.ensure_fxiaoke_baseline_view_v1(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.ensure_fxiaoke_baseline_view_v1(uuid, text, uuid)
  to service_role;

-- F003 / WP94: a verified Fxiaoke member with no ICU organization role gets
-- a dedicated, tightly checked read-only role. This never grants admin,
-- editing, shipping operation or carrier permissions.
insert into public.roles(code, name, permissions)
values ('FXIAOKE_BASELINE', '纷享基础查看', '["quote:view","contract:view","customer:view"]'::jsonb)
on conflict (code) do nothing;

create function public.ensure_fxiaoke_baseline_view_v1(
  p_org_id uuid,
  p_external_user_id text,
  p_expected_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_role_id uuid;
begin
  -- Reuse the existing locked identity, employment and source checks. A
  -- stopped or unmapped person cannot acquire a role via this function.
  v_user_id := public.activate_fxiaoke_sso_member_v1(
    p_org_id, p_external_user_id, p_expected_user_id
  );
  if v_user_id is distinct from p_expected_user_id then return false; end if;

  perform private.personnel_lock_org_v1(p_org_id);
  if exists (
    select 1 from public.user_roles
     where user_id = v_user_id and org_id = p_org_id
       and scope_type = 'org' and scope_id = p_org_id
  ) then return true; end if;

  -- Do not silently inherit a role after an administrator changes its
  -- permissions. A changed template requires a separately reviewed policy.
  select id into v_role_id from public.roles
   where code = 'FXIAOKE_BASELINE'
     and permissions @> '["quote:view","contract:view","customer:view"]'::jsonb
     and permissions <@ '["quote:view","contract:view","customer:view"]'::jsonb;
  if v_role_id is null then return false; end if;

  insert into public.user_roles(user_id, role_id, org_id, scope_type, scope_id)
  values (v_user_id, v_role_id, p_org_id, 'org', p_org_id);

  perform private.personnel_insert_event_v1(
    p_org_id, v_user_id, v_user_id, 'fxiaoke_baseline_view_granted',
    '{}'::jsonb, jsonb_build_object('role_code', 'FXIAOKE_BASELINE'),
    'verified Fxiaoke member baseline view', null
  );
  return true;
end;
$$;

revoke all on function public.ensure_fxiaoke_baseline_view_v1(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.ensure_fxiaoke_baseline_view_v1(uuid, text, uuid)
  to service_role;

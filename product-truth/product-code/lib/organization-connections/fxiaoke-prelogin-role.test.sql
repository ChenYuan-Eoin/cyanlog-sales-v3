-- Executed on the captured organization schema with real lifecycle and first-login functions.
do $$
declare
  org uuid := gen_random_uuid();
  other_org uuid := gen_random_uuid();
  actor uuid := gen_random_uuid();
  member uuid := gen_random_uuid();
  operator_role uuid := gen_random_uuid();
  source uuid := gen_random_uuid();
  revision uuid := gen_random_uuid();
  ids uuid[] := array[operator_role];
  second_role uuid := gen_random_uuid();
  row_snapshot jsonb;
  before_grant timestamptz;
begin
  insert into public.organizations(id,name) values (org,'Test organization'), (other_org,'Other organization');
  insert into public.roles(id,code,name,permissions) values (operator_role,'TEST_SHIP_OPERATOR','Test operator','[]');
  insert into public.roles(id,code,name,permissions) values (second_role,'TEST_ROLE_2','Test role 2','[]');
  insert into public.users(id,org_id,display_name,status,login_enabled,password_hash) values
    (actor,org,'Test administrator','active',true,'existing'), (member,org,'Test employee','inactive',false,null);
  insert into public.user_organizations(membership_id,user_id,org_id,status,employment_status,is_default) values
    (gen_random_uuid(),actor,org,'active','active',true), (gen_random_uuid(),member,org,'invited','active',true);
  insert into public.organization_sources(id,system_org_id,provider,external_tenant_id,priority,status,
    authority_scope,sync_mode,configuration_revision,connection_state,effective_revision)
  values (source,org,'fxiaoke','FSCID_test',100,'active','{"directory":"authoritative","identity":"authoritative"}',
    'enrichment',revision,'verified',revision);
  assert not public.admin_replace_org_roles_v1(actor,org,member,ids), 'Unmatched invitation must be refused';
  insert into public.external_identities(source_id,system_org_id,external_user_id,canonical_user_id,match_status,match_method,profile_snapshot)
  values (source,org,'employee-test',member,'matched','provider_id',
    jsonb_build_object('provisionedMemberId', member::text, 'status','active','loginDisabled',false,'deleted',false));

  assert not public.admin_replace_org_roles_v1(actor,other_org,member,ids), 'Cross-organization role assignment must be refused';
  update public.organization_sources set authority_scope='{"directory":"authoritative","identity":"evidence"}' where id=source;
  assert not public.admin_replace_org_roles_v1(actor,org,member,ids), 'Unverified identity authority must be refused';
  update public.organization_sources set authority_scope='{"directory":"authoritative","identity":"authoritative"}' where id=source;
  update public.external_identities set match_status='conflict' where canonical_user_id=member;
  assert not public.admin_replace_org_roles_v1(actor,org,member,ids), 'Conflict must be refused';
  update public.external_identities set match_status='matched', profile_snapshot=profile_snapshot||'{"deleted":true}' where canonical_user_id=member;
  assert not public.admin_replace_org_roles_v1(actor,org,member,ids), 'Deleted directory record must be refused';
  update public.external_identities set profile_snapshot=profile_snapshot||'{"deleted":false,"loginDisabled":true}' where canonical_user_id=member;
  assert not public.admin_replace_org_roles_v1(actor,org,member,ids), 'Disabled directory login must be refused';
  update public.external_identities set profile_snapshot=profile_snapshot||'{"loginDisabled":false,"status":"inactive"}' where canonical_user_id=member;
  assert not public.admin_replace_org_roles_v1(actor,org,member,ids), 'Departed directory member must be refused';
  update public.external_identities set profile_snapshot=profile_snapshot||'{"status":"active"}' where canonical_user_id=member;
  update public.user_organizations set employment_status='ended' where user_id=member;
  assert not public.admin_replace_org_roles_v1(actor,org,member,ids), 'Ended employment must be refused';
  update public.user_organizations set employment_status='active' where user_id=member;
  update public.users set status='suspended' where id=member;
  assert not public.admin_replace_org_roles_v1(actor,org,member,ids), 'Locally suspended user must be refused';
  update public.users set status='inactive' where id=member;

  begin
    -- Saving a disabled login also on an untouched directory reservation is an explicit block.
    perform private.personnel_insert_event_v1(org,member,actor,'set_account_state','{}',
      '{"login_enabled":false,"status":"inactive"}','explicit administrator hold',null);
    assert not public.admin_replace_org_roles_v1(actor,org,member,ids);
    assert public.activate_fxiaoke_sso_member_v1(org,'employee-test',member) is null;
    raise exception sqlstate 'P9501' using message='restore eligible fixture';
  exception when sqlstate 'P9501' then null;
  end;
  assert public.admin_replace_org_roles_v1(actor,org,member,ids), 'Eligible pre-login employee must accept a role';
  select granted_at into before_grant from public.fxiaoke_pending_org_roles where user_id=member;
  assert not exists(select 1 from public.user_roles where user_id=member);
  assert not has_table_privilege('anon','public.fxiaoke_pending_org_roles','SELECT');
  assert not has_table_privilege('authenticated','public.fxiaoke_pending_org_roles','INSERT');
  assert not has_table_privilege('service_role','public.fxiaoke_pending_org_roles','INSERT');
  assert not has_function_privilege('authenticated', 'public.admin_replace_org_roles_v1(uuid,uuid,uuid,uuid[],text,text)', 'EXECUTE');
  assert not has_function_privilege('anon', 'public.get_org_admin_directory_payload_v2(uuid)', 'EXECUTE');
  set local role service_role;
  select row into row_snapshot from jsonb_array_elements(public.get_org_admin_directory_payload_v2(org)->'users') row
  where row->>'id'=member::text;
  reset role;
  assert row_snapshot is not null and (row_snapshot->>'can_preassign_org_roles')::boolean, 'Admin reader must show eligible person';
  assert row_snapshot->'pending_org_roles' @> jsonb_build_array(jsonb_build_object('id',operator_role)), 'Pending role must survive refresh';
  assert not (coalesce(row_snapshot->'role_ids','[]') @> to_jsonb(ids)), 'Pending role must stay out of actual assignments';
  assert public.admin_replace_org_roles_v1(actor,org,member,ids), 'Repeating the same assignment must succeed';
  assert (select count(*)=1 from public.personnel_lifecycle_events where target_user_id=member and command='assign_org_roles');
  assert (select count(*)=1 and bool_and(granted_at=before_grant) from public.fxiaoke_pending_org_roles where user_id=member);
  assert public.admin_replace_org_roles_if_current_v1(actor,org,member,array[second_role],array[]::uuid[])='conflict';
  assert (select count(*)=1 and bool_and(role_id=operator_role) from public.fxiaoke_pending_org_roles where user_id=member);
  assert public.admin_replace_org_roles_if_current_v1(actor,org,member,array[second_role,operator_role],ids)='saved';
  assert public.admin_replace_org_roles_v1(actor,org,member,array[second_role]);
  assert (select count(*)=1 and bool_and(role_id=second_role) from public.fxiaoke_pending_org_roles where user_id=member), 'Admin can replace';
  assert public.admin_replace_org_roles_v1(actor,org,member,array[]::uuid[]);
  assert public.admin_replace_org_roles_v1(actor,org,member,array[]::uuid[]);
  assert not exists(select 1 from public.fxiaoke_pending_org_roles where user_id=member), 'Admin can revoke before login';
  assert public.admin_replace_org_roles_v1(actor,org,member,ids);
  assert exists(select 1 from public.users where id=member and status='inactive' and not login_enabled and last_login_at is null);
  assert exists(select 1 from public.user_organizations where user_id=member and status='invited');
  assert not exists(select 1 from public.auth_tokens where user_id=member);
  assert exists(select 1 from public.personnel_lifecycle_events where target_user_id=member and actor_id=actor and command='assign_org_roles');
  assert public.activate_fxiaoke_sso_member_v1(org,'wrong-subject',member) is null;
  update public.external_identities set profile_snapshot=profile_snapshot||'{"deleted":true}' where canonical_user_id=member;
  assert public.activate_fxiaoke_sso_member_v1(org,'employee-test',member) is null;
  update public.external_identities set profile_snapshot=profile_snapshot||'{"deleted":false}' where canonical_user_id=member;
  -- PostgreSQL rolls back the account and grant together if an effective-role write fails.
  begin
    alter table public.user_roles add constraint fixture_reject_effective_grant check (false) not valid;
    perform public.activate_fxiaoke_sso_member_v1(org,'employee-test',member);
    raise exception 'Expected effective-role insertion to fail';
  exception when check_violation then null;
  end;
  assert exists(select 1 from public.user_organizations where user_id=member and status='invited');
  assert exists(select 1 from public.users where id=member and status='inactive' and not login_enabled);
  assert exists(select 1 from public.fxiaoke_pending_org_roles where user_id=member and role_id=operator_role);
  -- With a distinct verified subject a previous subject's deferred grants cannot transfer.
  begin
    update public.external_identities set external_user_id='replacement-subject' where canonical_user_id=member;
    assert public.activate_fxiaoke_sso_member_v1(org,'replacement-subject',member)=member;
    assert not exists(select 1 from public.user_roles where user_id=member);
    raise exception sqlstate 'P9501' using message='restore independent first-login fixture';
  exception when sqlstate 'P9501' then null;
  end;
  assert public.activate_fxiaoke_sso_member_v1(org,'employee-test',member)=member;
  assert not exists(select 1 from public.fxiaoke_pending_org_roles where user_id=member), 'Pending rows consumed atomically';
  assert public.activate_fxiaoke_sso_member_v1(org,'employee-test',member)=member;
  assert public.ensure_fxiaoke_baseline_view_v1(org,'employee-test',member);
  assert (select count(*)=1 and bool_and(role_id=operator_role and scope_type='org' and scope_id=org)
    from public.user_roles where user_id=member and org_id=org);
  assert public.admin_replace_org_roles_if_current_v1(actor,org,member,array[second_role],array[]::uuid[])='conflict';
  assert public.admin_replace_org_roles_if_current_v1(actor,org,member,array[second_role,operator_role],ids)='saved';
  assert (select count(*)=2 from public.user_roles where user_id=member and org_id=org);
  assert exists(select 1 from public.users where id=member and status='active' and login_enabled);
  assert exists(select 1 from public.user_organizations where user_id=member and status='active');
end $$;

-- Read-only, schema-only export. No employee rows, credentials or configuration values.
-- This scope includes the native directory and the complete FK closure of its read RPC.
with recursive selected(oid) as (
  select c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in (
    'organizations', 'users', 'departments', 'user_departments', 'user_organizations',
    'organization_sources', 'external_identities', 'organization_fxiaoke_connections',
    'roles', 'user_roles', 'sales_spaces', 'sales_space_members',
    'fxiaoke_pending_org_roles', 'personnel_invitations', 'personnel_lifecycle_events', 'department_lead_access'
  ) or (n.nspname = 'private' and c.relname in ('org_role_metadata', 'employee_permission_overrides'))
  union
  select c.confrelid from pg_constraint c join selected s on s.oid = c.conrelid where c.contype = 'f'
), functions as (
  select p.* from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where (n.nspname = 'public' and p.proname = 'get_org_admin_payload_v1')
     or (n.nspname = 'private' and p.proname = 'current_user_org_id')
     or (n.nspname = 'public' and p.proname in (
       'admin_list_org_roles_v1', 'get_org_admin_directory_payload_v1',
       'get_org_admin_directory_payload_v2', 'fxiaoke_prelogin_role_targets_v1'
     ))
     or (n.nspname = 'private' and p.proname in (
       'get_org_admin_before_owned_roles_v1', 'org_role_catalog_v1',
       'org_role_is_referenced_v1', 'assert_org_role_references_v1',
       'personnel_lock_org_v1', 'assert_system_role_assignment_actor_v1', 'personnel_is_org_control_admin_v1',
       'org_super_admin_active_member_v1', 'has_exact_org_role_v1', 'system_super_admin_role_enabled_v1',
       'fxiaoke_prelogin_directory_members_v1'
     ))
     or (n.nspname = 'auth' and p.proname = 'uid')
     or p.oid in (select t.tgfoid from pg_trigger t join selected s on s.oid = t.tgrelid where not t.tgisinternal)
)
select jsonb_build_object(
  'serverVersion', split_part(current_setting('server_version'), ' ', 1),
  'tables', (select jsonb_agg(jsonb_build_object(
    'schema', n.nspname, 'name', c.relname, 'owner', pg_get_userbyid(c.relowner),
    'rls', c.relrowsecurity, 'forceRls', c.relforcerowsecurity,
    'columns', (select jsonb_agg(jsonb_build_object(
      'name', a.attname, 'type', format_type(a.atttypid, a.atttypmod),
      'notNull', a.attnotnull, 'default', pg_get_expr(d.adbin, d.adrelid),
      'identity', a.attidentity, 'generated', a.attgenerated,
      'collation', case when a.attcollation <> typ.typcollation then a.attcollation::regcollation::text end
    ) order by a.attnum) from pg_attribute a join pg_type typ on typ.oid = a.atttypid
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped),
    'constraints', (select coalesce(jsonb_agg(jsonb_build_object(
      'name', con.conname, 'type', con.contype, 'definition', pg_get_constraintdef(con.oid, false)
    ) order by con.conname), '[]'::jsonb) from pg_constraint con where con.conrelid = c.oid),
    'indexes', (select coalesce(jsonb_agg(pg_get_indexdef(i.indexrelid) order by pg_get_indexdef(i.indexrelid)), '[]'::jsonb)
      from pg_index i where i.indrelid = c.oid and not exists (select 1 from pg_constraint con where con.conrelid = c.oid and con.contype in ('p','u','x') and con.conindid = i.indexrelid)),
    'triggers', (select coalesce(jsonb_agg(jsonb_build_object(
      'name', t.tgname, 'definition', pg_get_triggerdef(t.oid, false), 'enabled', t.tgenabled
    ) order by t.tgname), '[]'::jsonb) from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal),
    'policies', (select coalesce(jsonb_agg(jsonb_build_object(
      'name', pol.polname, 'permissive', pol.polpermissive, 'command', pol.polcmd,
      'roles', (select jsonb_agg(case when r = 0 then 'PUBLIC' else pg_get_userbyid(r) end order by r) from unnest(pol.polroles) r),
      'using', pg_get_expr(pol.polqual, pol.polrelid), 'check', pg_get_expr(pol.polwithcheck, pol.polrelid)
    ) order by pol.polname), '[]'::jsonb) from pg_policy pol where pol.polrelid = c.oid),
    'grants', (select coalesce(jsonb_agg(jsonb_build_object(
      'role', case when g.grantee = 0 then 'PUBLIC' else pg_get_userbyid(g.grantee) end,
      'privilege', g.privilege_type, 'grantable', g.is_grantable
    ) order by g.grantee, g.privilege_type), '[]'::jsonb) from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g)
  ) order by n.nspname, c.relname) from selected s join pg_class c on c.oid = s.oid join pg_namespace n on n.oid = c.relnamespace),
  'functions', (select jsonb_agg(jsonb_build_object(
    'schema', n.nspname, 'name', p.proname, 'arguments', pg_get_function_identity_arguments(p.oid),
    'definition', pg_get_functiondef(p.oid), 'owner', pg_get_userbyid(p.proowner),
    'grants', (select jsonb_agg(jsonb_build_object(
      'role', case when g.grantee = 0 then 'PUBLIC' else pg_get_userbyid(g.grantee) end,
      'privilege', g.privilege_type, 'grantable', g.is_grantable
    ) order by g.grantee, g.privilege_type) from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g)
  ) order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) from functions p join pg_namespace n on n.oid = p.pronamespace),
  'schemas', (select jsonb_agg(jsonb_build_object(
    'name', n.nspname, 'owner', pg_get_userbyid(n.nspowner),
    'grants', (select jsonb_agg(jsonb_build_object(
      'role', case when g.grantee = 0 then 'PUBLIC' else pg_get_userbyid(g.grantee) end,
      'privilege', g.privilege_type, 'grantable', g.is_grantable
    ) order by g.grantee, g.privilege_type) from aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) g)
  ) order by n.nspname) from pg_namespace n where n.nspname in ('public', 'private', 'auth')),
  'roles', (select jsonb_agg(jsonb_build_object(
    'name', rolname, 'bypassRls', rolbypassrls, 'inherit', rolinherit, 'superuser', rolsuper,
    'createDb', rolcreatedb, 'createRole', rolcreaterole
  ) order by rolname) from pg_roles where rolname in ('postgres', 'anon', 'authenticated', 'service_role', 'supabase_auth_admin', 'supabase_admin', 'dashboard_user', 'pg_database_owner')),
  'defaultPrivileges', (select coalesce(jsonb_agg(jsonb_build_object(
    'owner', pg_get_userbyid(d.defaclrole), 'schema', n.nspname, 'type', d.defaclobjtype,
    'grants', (select jsonb_agg(jsonb_build_object(
      'role', case when g.grantee = 0 then 'PUBLIC' else pg_get_userbyid(g.grantee) end,
      'privilege', g.privilege_type, 'grantable', g.is_grantable
    ) order by g.grantee, g.privilege_type) from aclexplode(d.defaclacl) g)
  ) order by pg_get_userbyid(d.defaclrole), n.nspname, d.defaclobjtype), '[]'::jsonb)
    from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
    where pg_get_userbyid(d.defaclrole) = 'postgres' and (n.nspname in ('public','private','auth') or d.defaclnamespace = 0))
) as catalog;

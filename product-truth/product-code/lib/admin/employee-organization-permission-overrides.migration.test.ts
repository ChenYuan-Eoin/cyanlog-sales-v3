// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, expect, it } from 'vitest'

const org = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherOrg = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const admin = '11111111-1111-4111-8111-111111111111'
const employee = '22222222-2222-4222-8222-222222222222'
const outsider = '33333333-3333-4333-8333-333333333333'
const rootRole = '44444444-4444-4444-8444-444444444444'
const shippingRole = '55555555-5555-4555-8555-555555555555'
const source = '66666666-6666-4666-8666-666666666666'
const identity = '77777777-7777-4777-8777-777777777777'
const nextIdentity = '88888888-8888-4888-8888-888888888888'
const department = '99999999-9999-4999-8999-999999999999'
const childDepartment = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const unrelatedDepartment = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const otherDepartment = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const lifecycle = '20261021000006_personnel_lifecycle_commands.sql'
const organizationAdmin = '20261125055213_organization_super_admin.sql'
const replacement = '20261126105311_employee_organization_permission_overrides.sql'
const firstLogin = '20261118095000_fxiaoke_prelogin_role_assignment.sql'
const roleCatalog = '20261126061431_org_owned_ordinary_roles.sql'
const pendingMigration = '20261126111603_fxiaoke_prelogin_employee_permission_overrides.sql'
const shippingDepartmentMigration = '20261126114126_allow_shipping_operator_department_ledger_roles.sql'
const signature = 'public.admin_set_employee_org_permission_override_v1(uuid,uuid,uuid,text,jsonb,jsonb)'
const allow = { effect: 'ALLOW', scope: { type: 'org' } }
const deny = { effect: 'DENY', scope: null }
let db: PGlite

function migration(file: string) {
  return readFileSync(join(process.cwd(), 'supabase/migrations', file), 'utf8')
}

function functionDefinition(file: string, name: string, schema = 'private') {
  const definition = migration(file).match(new RegExp(`create (?:or replace )?function ${schema}\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, 'i'))
  if (!definition) throw new Error(`Missing SQL dependency ${name}`)
  return definition[0]
}

beforeEach(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    grant usage on schema public to anon, authenticated, service_role;
    create schema private;
    create table public.organizations (id uuid primary key, status text default 'active', settings jsonb);
    create table public.users (
      id uuid primary key, org_id uuid, status text default 'active', login_enabled boolean default true,
      password_hash text, last_login_at timestamptz, updated_at timestamptz
    );
    create table public.user_organizations (
      user_id uuid, org_id uuid, is_default boolean default true, status text default 'active',
      employment_status text default 'active', left_at timestamptz, updated_at timestamptz,
      joined_at timestamptz, employment_started_at timestamptz, employment_ended_at timestamptz,
      membership_version bigint default 1, updated_by uuid, primary key (user_id, org_id)
    );
    create table public.roles (
      id uuid primary key, code text, name text, permissions jsonb, owner_org_id uuid,
      description text, sort_order int, created_at timestamptz
    );
    create table public.user_roles (
      org_id uuid, user_id uuid, role_id uuid, scope_type text, scope_id uuid, granted_by uuid,
      granted_at timestamptz,
      primary key (user_id, role_id, scope_type, scope_id)
    );
    create table private.org_role_metadata (
      org_id uuid, role_id uuid, name text, archived_at timestamptz, description text, role_revision bigint
    );
    create table public.permission_points (
      id uuid primary key default gen_random_uuid(), code text unique, name text, description text
    );
    create table public.personnel_lifecycle_events (
      id uuid default gen_random_uuid(), occurred_at timestamptz default now(),
      org_id uuid, target_user_id uuid, actor_id uuid, command text, before_state jsonb,
      after_state jsonb, reason text, request_id text
    );
    create table public.personnel_invitations (
      id uuid default gen_random_uuid(), org_id uuid, user_id uuid, created_by uuid,
      status text default 'pending', token_hash text unique, role_ids uuid[] default '{}',
      expires_at timestamptz, accepted_at timestamptz
    );
    create table public.auth_tokens (user_id uuid);
    create table public.organization_sources (
      id uuid primary key, system_org_id uuid, provider text, status text, connection_state text,
      effective_revision uuid, authority_scope jsonb
    );
    create table public.external_identities (
      id uuid primary key, system_org_id uuid, source_id uuid, canonical_user_id uuid, external_user_id text,
      match_status text, profile_snapshot jsonb
    );
    create table public.departments (id uuid, parent_id uuid, org_id uuid, leader_id uuid, name text, status text);
    create table public.sales_spaces (id uuid, org_id uuid);
    create table public.user_departments (org_id uuid, user_id uuid, department_id uuid);
    create table public.department_lead_access (org_id uuid, user_id uuid, department_id uuid);
    insert into public.organizations (id, settings) values ('${org}', '{"keep_setting":true}'), ('${otherOrg}', '{}');
    insert into public.users (id, org_id) values ('${admin}', '${org}'), ('${employee}', '${org}'), ('${outsider}', '${otherOrg}');
    insert into public.user_organizations (user_id, org_id) values
      ('${admin}', '${org}'), ('${employee}', '${org}'), ('${outsider}', '${otherOrg}');
    insert into public.roles (id, code, name, permissions) values ('${rootRole}', 'SUPER_ADMIN', '系统超级管理员', '["*"]');
    insert into public.user_roles (org_id, user_id, role_id, scope_type, scope_id)
    values ('${org}', '${admin}', '${rootRole}', 'org', '${org}');
  `)
  for (const [file, name] of [
    [lifecycle, 'personnel_lock_org_v1'],
    [lifecycle, 'personnel_insert_event_v1'],
    [organizationAdmin, 'has_exact_org_role_v1'],
    [organizationAdmin, 'org_super_admin_active_member_v1'],
    ['20261126054302_immutable_system_super_admin.sql', 'system_super_admin_role_enabled_v1'],
    ['20261126045425_system_super_admin_authority.sql', 'personnel_is_org_control_admin_v1'],
    ['20261126054700_guard_ordinary_role_assignments.sql', 'assert_system_role_assignment_actor_v1'],
  ]) await db.exec(functionDefinition(file, name))
  await db.exec(migration(firstLogin).split('-- This one predicate')[0])
  await db.exec(functionDefinition(firstLogin, 'fxiaoke_prelogin_role_targets_v1', 'public'))
  await db.exec(functionDefinition(firstLogin, 'activate_fxiaoke_sso_member_v1', 'public'))
  await db.exec(functionDefinition(roleCatalog, 'org_role_catalog_v1'))
  await db.exec(functionDefinition(roleCatalog, 'org_role_is_referenced_v1'))
  await db.exec(functionDefinition(roleCatalog, 'admin_list_org_roles_v1', 'public'))
  await db.exec(functionDefinition('20261126103435_admin_add_member_org_roles.sql', 'accept_personnel_invitation_v1', 'public'))
  for (const file of [
    '20261021000005_permission_registry_lifecycle.sql',
    '20261125171808_shipping_permission_actions.sql',
  ]) await db.exec(migration(file))
  await db.exec(migration('20261126052146_department_shipping_permission_grants.sql')
    .split('create function private.department_permission_state_v1')[0] + 'commit;')
  await db.exec(migration('20261126064003_shipping_department_record_return.sql')
    .split('create function private.shipping_return_scope_v1')[0] + 'commit;')
  for (const file of [
    '20261126064200_permission_dictionary_metadata.sql',
    '20261126074057_employee_permission_overrides.sql',
    replacement,
    pendingMigration,
  ]) await db.exec(migration(file))
})

afterEach(async () => { await db?.close() })

async function save(
  code: string,
  expected: object | null,
  value: object | null,
  identity: { actorId?: string; orgId?: string; userId?: string } = {},
) {
  await db.exec('set role service_role')
  try {
    return (await db.query<{ value: unknown }>(
      'select public.admin_set_employee_org_permission_override_v1($1,$2,$3,$4,$5::jsonb,$6::jsonb) as value',
      [identity.actorId ?? admin, identity.orgId ?? org, identity.userId ?? employee, code,
        JSON.stringify(expected), JSON.stringify(value)],
    )).rows[0].value
  } finally {
    await db.exec('reset role')
  }
}

async function employeeOverrides() {
  return (await db.query(
    'select permission_code, effect, scope from public.employee_permission_overrides_v1($1,$2)',
    [org, employee],
  )).rows
}

it('writes, reads and clears only the chosen employee action after comparing the expected snapshot', async () => {
  // user:view is still published with its older scope list in production.
  expect(await save('user:view', null, allow)).toEqual(allow)
  expect(await save('role:view', null, allow)).toEqual(allow)
  expect(await save('user:view', allow, deny)).toEqual(deny)
  await expect(save('user:view', allow, null)).rejects.toMatchObject({
    code: '40001', detail: 'EMPLOYEE_PERMISSION_OVERRIDE_CONFLICT',
  })
  expect(await employeeOverrides()).toEqual([
    { permission_code: 'role:view', ...allow },
    { permission_code: 'user:view', ...deny },
  ])
  expect(await save('user:view', deny, null)).toBeNull()
  expect(await employeeOverrides()).toEqual([{ permission_code: 'role:view', ...allow }])
  const audit = await db.query(
    'select before_state, after_state from public.personnel_lifecycle_events where after_state->>\'permission_code\' = $1',
    ['user:view'],
  )
  expect(audit.rows).toHaveLength(3)
  expect(audit.rows).toContainEqual({
    before_state: { permission_code: 'user:view', override: allow },
    after_state: { permission_code: 'user:view', override: deny },
  })
})

it('accepts the published department and member actions and keeps the shipping writer and flag independent', async () => {
  for (const key of ['dept:directory_view', 'dept:edit_structure', 'dept:delete_structure', 'user:edit_profile', 'user:invite',
    'user:manage_login', 'user:manage_employment', 'user:remove_membership']) {
    expect(await save(key, null, allow)).toEqual(allow)
  }
  const settings = async () => (await db.query<{ settings: unknown }>(
    'select settings from public.organizations where id = $1', [org],
  )).rows[0].settings
  expect(await settings()).toEqual({ keep_setting: true, employee_organization_permission_overrides_enabled: true })
  const shipping = await db.query<{ value: unknown }>(
    `select public.admin_set_employee_permission_override_v1($1,$2,$3,'shipping:ledger_view',null,$4::jsonb) as value`,
    [admin, org, employee, JSON.stringify(allow)],
  )
  expect(shipping.rows[0].value).toEqual(allow)
  expect(await settings()).toEqual({
    keep_setting: true, employee_organization_permission_overrides_enabled: true, employee_permission_overrides_enabled: true,
  })
  expect(await employeeOverrides()).toContainEqual({ permission_code: 'shipping:ledger_view', ...allow })
})

it('rejects foreign or inactive targets, ordinary actors, protected targets and protected permission codes', async () => {
  await expect(save('user:view', null, allow, { actorId: employee })).rejects.toMatchObject({ code: '42501' })
  await expect(save('user:view', null, allow, { orgId: otherOrg, userId: outsider })).rejects.toMatchObject({ code: '42501' })
  await expect(save('user:view', null, allow, { userId: outsider })).rejects.toMatchObject({
    code: 'P0002', detail: 'EMPLOYEE_PERMISSION_OVERRIDE_TARGET_NOT_FOUND',
  })
  await expect(save('user:view', null, allow, { userId: admin })).rejects.toMatchObject({
    code: '42501', detail: 'EMPLOYEE_PERMISSION_OVERRIDE_PROTECTED',
  })
  await expect(save('role:manage', null, allow)).rejects.toMatchObject({ code: '22023' })
  await expect(save('user:assign_roles', null, allow)).rejects.toMatchObject({ code: '22023' })
  await db.query('update public.users set login_enabled = false where id = $1', [employee])
  await expect(save('user:view', null, allow)).rejects.toMatchObject({ code: 'P0002' })
  expect(await employeeOverrides()).toEqual([])
})

it('permits only organization scope and requires the consuming published catalog definition', async () => {
  await expect(save('user:view', null, { effect: 'ALLOW', scope: { type: 'self' } })).rejects.toMatchObject({
    code: '22023', detail: 'EMPLOYEE_PERMISSION_OVERRIDE_INVALID',
  })
  expect(await save('user:manage_login', null, allow)).toEqual(allow)
  await db.query('update public.permission_points set enforcement_consumer = $1 where code = $2',
    ['fixture-wrong-consumer', 'user:manage_login'])
  await expect(save('user:manage_login', allow, deny)).rejects.toMatchObject({
    code: '23514', detail: 'EMPLOYEE_PERMISSION_OVERRIDE_NOT_PUBLISHED',
  })
  expect(await save('user:manage_login', allow, null)).toBeNull()
  expect(await employeeOverrides()).toEqual([])
})

it('removes organization deltas when employment ends and exposes the new writer only to the service role', async () => {
  const privileges = await db.query(
    `select has_function_privilege('anon', $1, 'EXECUTE') as anon,
            has_function_privilege('authenticated', $1, 'EXECUTE') as authenticated,
            has_function_privilege('service_role', $1, 'EXECUTE') as service_role`,
    [signature],
  )
  expect(privileges.rows).toEqual([{ anon: false, authenticated: false, service_role: true }])
  await save('user:view', null, allow)
  await save('user:invite', null, deny)
  await db.query(`update public.user_organizations set employment_status = 'ended' where user_id = $1 and org_id = $2`, [employee, org])
  expect((await db.query('select permission_code from private.employee_permission_overrides')).rows).toEqual([])
  expect(await employeeOverrides()).toEqual([])
})

async function preparePendingEmployee() {
  await db.exec(`
    update public.users set status = 'inactive', login_enabled = false where id = '${employee}';
    update public.user_organizations set status = 'invited' where user_id = '${employee}';
    insert into public.organization_sources values (
      '${source}', '${org}', 'fxiaoke', 'active', 'verified', gen_random_uuid(),
      '{"identity":"authoritative","directory":"authoritative"}'
    );
    insert into public.external_identities values (
      '${identity}', '${org}', '${source}', '${employee}', 'verified-directory-employee', 'matched',
      '{"provisionedMemberId":"${employee}","status":"active"}'
    );
  `)
}

type PendingProjection = {
  target_revision: string
  pending_role_ids: string[]
  overrides: { permission_code: string; effect: string; scope: unknown }[]
  shipping_scopes: {
    permission_code: string
    base_organization_wide: boolean
    base_department_ids: string[]
    organization_wide: boolean
    department_ids: string[]
    base_sources: { kind: string; name: string }[]
  }[]
}

async function pendingProjection(actorId = admin) {
  const { rows } = await db.query<{ projection: PendingProjection | null }>(
    'select public.admin_employee_prelogin_permission_projection_v1($1,$2,$3) as projection',
    [actorId, org, employee],
  )
  return rows[0].projection
}

async function savePending(code: string, expected: object | null, value: object | null, targetRevision: string) {
  await db.exec('set role service_role')
  try {
    const { rows } = await db.query<{ value: unknown }>(
      'select public.admin_set_employee_prelogin_permission_override_v1($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7) as value',
      [admin, org, employee, code, JSON.stringify(expected), JSON.stringify(value), targetRevision],
    )
    return rows[0].value
  } finally {
    await db.exec('reset role')
  }
}

it('projects saved pending roles and the live department tree without granting runtime permission before verified login', async () => {
  await preparePendingEmployee()
  await db.exec(`
    insert into public.roles (id, code, name, permissions, owner_org_id)
    values ('${shippingRole}', 'TEST_SHIPPING_RETURN', '寄件退回', '["shipping:record_return"]', '${org}');
    insert into public.fxiaoke_pending_org_roles
      (org_id, user_id, role_id, source_id, external_identity_id, external_user_id)
    values ('${org}', '${employee}', '${shippingRole}', '${source}', '${identity}', 'verified-directory-employee');
    insert into public.departments (id, parent_id, org_id, leader_id, name, status) values
      ('${department}', null, '${org}', '${employee}', '测试部门', 'active'),
      ('${childDepartment}', '${department}', '${org}', null, '测试子部门', 'active');
    insert into public.department_lead_access values ('${org}', '${employee}', '${department}');
    update public.organizations set settings = settings || '{
      "department_permission_grants": {
        "${department}": {"permissions":["shipping:ledger_view"],"include_subdepartments":true}
      }
    }' where id = '${org}';
  `)
  const projection = await pendingProjection()
  expect(projection).toMatchObject({
    target_revision: expect.stringMatching(/^[0-9a-f]{64}$/),
    pending_role_ids: [shippingRole],
    overrides: [],
    shipping_scopes: [
      {
        permission_code: 'shipping:ledger_view', base_organization_wide: false,
        base_department_ids: [department, childDepartment], organization_wide: false,
        department_ids: [department, childDepartment], base_sources: [{ kind: 'department', name: '测试部门' }],
      },
      {
        permission_code: 'shipping:record_return', base_organization_wide: true,
        base_department_ids: [], organization_wide: true, department_ids: [],
        base_sources: [{ kind: 'role', name: '寄件退回' }],
      },
    ],
  })
  const revision = projection!.target_revision
  expect(await savePending('user:view', null, allow, revision)).toEqual(allow)
  expect(await savePending('shipping:ledger_view', null, deny, revision)).toEqual(deny)
  await expect(savePending('shipping:ledger_view', null, allow, revision)).rejects.toMatchObject({
    code: '40001', detail: 'EMPLOYEE_PERMISSION_OVERRIDE_CONFLICT',
  })
  await expect(save('user:view', null, deny)).rejects.toMatchObject({ code: 'P0002' })
  expect(await pendingProjection()).toMatchObject({
    overrides: [{ permission_code: 'shipping:ledger_view', ...deny }, { permission_code: 'user:view', ...allow }],
    shipping_scopes: [
      { permission_code: 'shipping:ledger_view', base_department_ids: [department, childDepartment], department_ids: [] },
      { permission_code: 'shipping:record_return', base_organization_wide: true, organization_wide: true },
    ],
  })
  const runtimeScopes = async () => (await db.query(
    'select * from public.shipping_employee_permission_scopes_v1($1,$2)', [org, employee],
  )).rows
  expect(await employeeOverrides()).toEqual([])
  expect(await runtimeScopes()).toMatchObject([
    { permission_code: 'shipping:ledger_view', organization_wide: false, department_ids: [] },
    { permission_code: 'shipping:record_return', organization_wide: false, department_ids: [] },
  ])
  expect((await db.query('select status, login_enabled from public.users where id = $1', [employee])).rows)
    .toEqual([{ status: 'inactive', login_enabled: false }])
  expect((await db.query(
    "select public.activate_fxiaoke_sso_member_v1($1,'verified-directory-employee',$2) as activated", [org, employee],
  )).rows).toEqual([{ activated: employee }])
  expect(await pendingProjection()).toBeNull()
  expect(await employeeOverrides()).toEqual([
    { permission_code: 'shipping:ledger_view', ...deny }, { permission_code: 'user:view', ...allow },
  ])
  expect(await runtimeScopes()).toMatchObject([
    { permission_code: 'shipping:ledger_view', base_department_ids: [department, childDepartment], department_ids: [] },
    { permission_code: 'shipping:record_return', base_organization_wide: true, organization_wide: true },
  ])
  await expect(savePending('user:view', allow, deny, revision)).rejects.toMatchObject({
    code: '40001', detail: 'EMPLOYEE_PERMISSION_OVERRIDE_CONFLICT',
  })
})

it('keeps a reassigned directory identity from viewing, editing or activating a stale sparse difference', async () => {
  await preparePendingEmployee()
  const revision = (await pendingProjection())!.target_revision
  await savePending('user:view', null, allow, revision)
  await db.exec(`
    update public.external_identities set canonical_user_id = null where id = '${identity}';
    insert into public.external_identities values (
      '${nextIdentity}', '${org}', '${source}', '${employee}', 'new-directory-identity', 'matched',
      '{"provisionedMemberId":"${employee}","status":"active"}'
    );
  `)
  const reassigned = await pendingProjection()
  expect(reassigned?.target_revision).not.toEqual(revision)
  expect(reassigned?.overrides).toEqual([])
  await expect(savePending('user:view', allow, deny, revision)).rejects.toMatchObject({
    code: '40001', detail: 'EMPLOYEE_PERMISSION_OVERRIDE_CONFLICT',
  })
  expect((await db.query(
    "select public.activate_fxiaoke_sso_member_v1($1,'new-directory-identity',$2) as activated", [org, employee],
  )).rows).toEqual([{ activated: employee }])
  expect(await employeeOverrides()).toEqual([])
  expect((await db.query('select permission_code from private.employee_permission_overrides')).rows).toEqual([])
})

it('does not promote pending differences through generic invitation acceptance or expose the pending RPCs to clients', async () => {
  await preparePendingEmployee()
  await expect(pendingProjection(outsider)).rejects.toMatchObject({ code: '42501' })
  const revision = (await pendingProjection())!.target_revision
  await savePending('user:view', null, allow, revision)
  for (const pendingSignature of [
    'public.admin_employee_prelogin_permission_projection_v1(uuid,uuid,uuid)',
    'public.admin_set_employee_prelogin_permission_override_v1(uuid,uuid,uuid,text,jsonb,jsonb,text)',
  ]) {
    expect((await db.query(
      `select has_function_privilege('anon',$1,'EXECUTE') as anon,
              has_function_privilege('authenticated',$1,'EXECUTE') as authenticated,
              has_function_privilege('service_role',$1,'EXECUTE') as service_role`,
      [pendingSignature],
    )).rows).toEqual([{ anon: false, authenticated: false, service_role: true }])
  }
  await db.query(
    "insert into public.personnel_invitations (org_id,user_id,created_by,token_hash,expires_at) values ($1,$2,$3,'test-invite',now() + interval '1 hour')",
    [org, employee, admin],
  )
  expect((await db.query("select public.accept_personnel_invitation_v1('test-invite') as accepted")).rows)
    .toEqual([{ accepted: { user_id: employee, org_id: org } }])
  expect(await pendingProjection()).toBeNull()
  expect(await employeeOverrides()).toEqual([])
  expect(await save('user:view', null, deny)).toEqual(deny)
  expect(await employeeOverrides()).toEqual([{ permission_code: 'user:view', ...deny }])
})

async function installScopedRoleCommands() {
  const operatorParity = migration('20261125065221_shipping_operator_role_parity.sql')
  await db.exec(operatorParity.slice(
    operatorParity.indexOf('with definitions as ('),
    operatorParity.indexOf('-- Membership identifies the tenant'),
  ))
  await db.exec(functionDefinition(roleCatalog, 'assert_org_role_references_v1'))
  for (const [file, name] of [
    ['20261022000001_role_scope_lifecycle.sql', 'admin_set_role_scope_assignment_v1'],
    [organizationAdmin, 'admin_set_role_scope_assignment_before_system_admin_v1'],
    ['20261126045425_system_super_admin_authority.sql', 'admin_set_role_scope_assignment_before_system_actor_v1'],
  ]) {
    await db.exec(functionDefinition(file, 'admin_set_role_scope_assignment_v1', 'public')
      .replace('function public.admin_set_role_scope_assignment_v1(', `function private.${name}(`))
  }
  await db.exec(functionDefinition('20261126060000_retire_new_fxiaoke_baseline_grants.sql', 'admin_set_role_scope_assignment_v1', 'public'))
  await db.exec(migration('20261126113407_allow_super_admin_scoped_ordinary_role_revoke.sql'))
  await db.exec(`
    revoke all on function public.admin_set_role_scope_assignment_v1(uuid,uuid,uuid,uuid,text,uuid,text,text,text)
      from public, anon, authenticated;
    grant execute on function public.admin_set_role_scope_assignment_v1(uuid,uuid,uuid,uuid,text,uuid,text,text,text)
      to service_role;
    insert into public.roles (id,code,name,permissions)
    values ('${shippingRole}','SHIPPING_OPERATOR','顺丰寄件操作员','["shipping:operate"]');
    insert into public.departments (id,parent_id,org_id,name,status) values
      ('${department}',null,'${org}','归属部门','active'),
      ('${childDepartment}','${department}','${org}','下属部门','active'),
      ('${unrelatedDepartment}',null,'${org}','其他部门','active'),
      ('${otherDepartment}',null,'${otherOrg}','其他组织部门','active');
    insert into public.sales_spaces values ('${unrelatedDepartment}','${org}');
  `)
}

async function scopedShippingRole(
  action: 'assign' | 'revoke',
  { scopeType = 'department', scopeId = department, userId = employee, actorId = admin } = {},
) {
  await db.exec('set role service_role')
  try {
    const { rows } = await db.query<{ saved: boolean }>(
      'select public.admin_set_role_scope_assignment_v1($1,$2,$3,$4,$5,$6,$7) as saved',
      [actorId, org, userId, shippingRole, scopeType, scopeId, action],
    )
    return rows[0].saved
  } finally {
    await db.exec('reset role')
  }
}

async function configureShippingRole(permissions: string[]) {
  await db.query(
    "update public.organizations set settings = settings || jsonb_build_object('role_permission_overrides',jsonb_build_object($1::text,$2::jsonb)) where id = $3",
    [shippingRole, JSON.stringify(permissions), org],
  )
}

async function shippingScopes() {
  const { rows } = await db.query(
    'select permission_code, organization_wide, department_ids from public.shipping_employee_permission_scopes_v1($1,$2)',
    [org, employee],
  )
  return rows
}

it('grants only published configured department ledger and optional return on a fresh shipping operator binding', async () => {
  await installScopedRoleCommands()
  await db.exec(migration(shippingDepartmentMigration))
  const ledgerRequired = { code: '23514', detail: 'SHIPPING_DEPARTMENT_LEDGER_PERMISSION_REQUIRED' }
  await expect(scopedShippingRole('assign')).rejects.toMatchObject(ledgerRequired)
  await configureShippingRole(['shipping:*', 'shipping:record_return'])
  await expect(scopedShippingRole('assign')).rejects.toMatchObject(ledgerRequired)

  const ledger = 'shipping:ledger_view'
  const recordReturn = 'shipping:record_return'
  await configureShippingRole([ledger])
  await db.query("update public.permission_points set supported_scope_types = array['org'] where code = $1", [ledger])
  await expect(scopedShippingRole('assign')).rejects.toMatchObject(ledgerRequired)
  await db.query("update public.permission_points set supported_scope_types = array['org','department'] where code = $1", [ledger])
  expect(await scopedShippingRole('assign')).toBe(true)

  const departments = [department, childDepartment]
  const scope = (permissionCode: string, departmentIds: string[], organizationWide = false) => ({
    permission_code: permissionCode, organization_wide: organizationWide, department_ids: departmentIds,
  })
  expect(await shippingScopes()).toEqual([scope(ledger, departments), scope(recordReturn, [])])
  await configureShippingRole([ledger, recordReturn, 'shipping:operate', 'shipping:order_confirm',
    'shipping:order_change', 'shipping:connection_write'])
  expect(await shippingScopes()).toEqual([scope(ledger, departments), scope(recordReturn, departments)])
  const checkedReturn = async () => (await db.query(
    'select * from private.shipping_return_scope_v1($1,$2)', [employee, org],
  )).rows
  expect(await checkedReturn()).toEqual([{ organization_wide: false, department_ids: departments }])

  await db.query("update public.permission_points set status = 'disabled' where code = $1", [recordReturn])
  expect(await shippingScopes()).toEqual([scope(ledger, departments), scope(recordReturn, [])])
  await db.query("update public.permission_points set status = 'published' where code = $1", [recordReturn])
  await db.query('insert into public.user_departments values ($1,$2,$3)', [org, employee, department])
  await db.query(`
    update public.organizations
    set settings = settings || jsonb_build_object(
      'department_permission_grants',
      jsonb_build_object($1::text,'{"permissions":["shipping:ledger_view"],"include_subdepartments":true}'::jsonb)
    ) where id = $2
  `, [department, org])
  await configureShippingRole([recordReturn])
  expect(await shippingScopes()).toEqual([scope(ledger, departments), scope(recordReturn, [])])
  expect(await checkedReturn()).toEqual([{ organization_wide: false, department_ids: [] }])

  expect(await scopedShippingRole('revoke')).toBe(true)
  await configureShippingRole(['shipping:operate'])
  expect(await scopedShippingRole('assign', { scopeType: 'org', scopeId: org })).toBe(true)
  expect(await shippingScopes()).toEqual([scope(ledger, [], true), scope(recordReturn, [])])
})

it('retains active membership, target, department and legacy space restrictions for shipping operator assignment', async () => {
  await installScopedRoleCommands()
  await db.exec(migration(shippingDepartmentMigration))
  await configureShippingRole(['shipping:ledger_view'])
  await expect(scopedShippingRole('assign', { actorId: outsider })).rejects.toMatchObject({ code: '42501' })
  await expect(scopedShippingRole('assign', { userId: admin })).rejects.toMatchObject({ code: '42501' })
  await expect(scopedShippingRole('assign', { scopeType: 'space', scopeId: unrelatedDepartment }))
    .rejects.toMatchObject({ code: '23514', detail: 'LEGACY_SCOPE_ASSIGNMENT_FORBIDDEN' })
  await expect(scopedShippingRole('assign', { scopeId: otherDepartment }))
    .rejects.toMatchObject({ code: '23514', detail: 'DEPARTMENT_SCOPE_UNAVAILABLE' })
  expect(await scopedShippingRole('assign', { userId: outsider })).toBe(false)
  await db.query('update public.roles set owner_org_id = $1 where id = $2', [otherOrg, shippingRole])
  await expect(scopedShippingRole('assign')).rejects.toMatchObject({ code: '23503', detail: 'ORG_ROLE_NOT_FOUND' })
  await db.query('update public.roles set owner_org_id = null where id = $1', [shippingRole])

  await db.query("update public.departments set status = 'inactive' where id = $1", [department])
  await expect(scopedShippingRole('assign'))
    .rejects.toMatchObject({ code: '23514', detail: 'DEPARTMENT_SCOPE_UNAVAILABLE' })
  await db.query("update public.departments set status = 'active' where id = $1", [department])
  await db.query('update public.users set login_enabled = false where id = $1', [employee])
  expect(await scopedShippingRole('assign')).toBe(false)
  expect((await db.query('select role_id from public.user_roles where user_id = $1', [employee])).rows).toEqual([])
})

it.each(['department', 'space'])('fails closed on an existing dormant %s shipping operator binding', async scopeType => {
  await installScopedRoleCommands()
  await db.query(`
    insert into public.user_roles (org_id,user_id,role_id,scope_type,scope_id)
    values ($1,$2,$3,$4,$5)
  `, [org, employee, shippingRole, scopeType, department])
  await configureShippingRole(['shipping:ledger_view'])
  await expect(db.exec(migration(shippingDepartmentMigration))).rejects.toMatchObject({
    code: '23514', detail: 'LEGACY_SHIPPING_OPERATOR_SCOPE_PRESENT',
  })
  await db.exec('rollback')
  expect((await db.query('select scope_type from public.user_roles where user_id = $1', [employee])).rows)
    .toEqual([{ scope_type: scopeType }])
  expect(await shippingScopes()).toEqual([
    { permission_code: 'shipping:ledger_view', organization_wide: false, department_ids: [] },
    { permission_code: 'shipping:record_return', organization_wide: false, department_ids: [] },
  ])
})

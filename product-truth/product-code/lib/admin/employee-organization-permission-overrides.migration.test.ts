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
const lifecycle = '20261021000006_personnel_lifecycle_commands.sql'
const organizationAdmin = '20261125055213_organization_super_admin.sql'
const replacement = '20261126105311_employee_organization_permission_overrides.sql'
const signature = 'public.admin_set_employee_org_permission_override_v1(uuid,uuid,uuid,text,jsonb,jsonb)'
const allow = { effect: 'ALLOW', scope: { type: 'org' } }
const deny = { effect: 'DENY', scope: null }
let db: PGlite

function migration(file: string) {
  return readFileSync(join(process.cwd(), 'supabase/migrations', file), 'utf8')
}

function privateFunction(file: string, name: string) {
  const definition = migration(file).match(new RegExp(`create (?:or replace )?function private\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, 'i'))
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
    create table public.users (id uuid primary key, status text default 'active', login_enabled boolean default true);
    create table public.user_organizations (
      user_id uuid, org_id uuid, is_default boolean default true, status text default 'active',
      employment_status text default 'active', left_at timestamptz, primary key (user_id, org_id)
    );
    create table public.roles (id uuid primary key, code text, name text, permissions jsonb, owner_org_id uuid);
    create table public.user_roles (org_id uuid, user_id uuid, role_id uuid, scope_type text, scope_id uuid);
    create table private.org_role_metadata (org_id uuid, role_id uuid, name text, archived_at timestamptz);
    create table public.permission_points (
      id uuid primary key default gen_random_uuid(), code text unique, name text, description text
    );
    create table public.personnel_lifecycle_events (
      org_id uuid, target_user_id uuid, actor_id uuid, command text, before_state jsonb,
      after_state jsonb, reason text, request_id text
    );
    create table public.departments (id uuid, parent_id uuid, org_id uuid, leader_id uuid, name text, status text);
    create table public.user_departments (org_id uuid, user_id uuid, department_id uuid);
    create table public.department_lead_access (org_id uuid, user_id uuid, department_id uuid);
    insert into public.organizations (id, settings) values ('${org}', '{"keep_setting":true}'), ('${otherOrg}', '{}');
    insert into public.users (id) values ('${admin}'), ('${employee}'), ('${outsider}');
    insert into public.user_organizations (user_id, org_id) values
      ('${admin}', '${org}'), ('${employee}', '${org}'), ('${outsider}', '${otherOrg}');
    insert into public.roles (id, code, name, permissions) values ('${rootRole}', 'SUPER_ADMIN', '系统超级管理员', '["*"]');
    insert into public.user_roles values ('${org}', '${admin}', '${rootRole}', 'org', '${org}');
  `)
  for (const [file, name] of [
    [lifecycle, 'personnel_lock_org_v1'],
    [lifecycle, 'personnel_insert_event_v1'],
    [organizationAdmin, 'has_exact_org_role_v1'],
    [organizationAdmin, 'org_super_admin_active_member_v1'],
    ['20261126054302_immutable_system_super_admin.sql', 'system_super_admin_role_enabled_v1'],
    ['20261126045425_system_super_admin_authority.sql', 'personnel_is_org_control_admin_v1'],
    ['20261126054700_guard_ordinary_role_assignments.sql', 'assert_system_role_assignment_actor_v1'],
  ]) await db.exec(privateFunction(file, name))
  for (const file of [
    '20261021000005_permission_registry_lifecycle.sql',
    '20261125171808_shipping_permission_actions.sql',
    '20261126064200_permission_dictionary_metadata.sql',
    '20261126074057_employee_permission_overrides.sql',
    replacement,
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

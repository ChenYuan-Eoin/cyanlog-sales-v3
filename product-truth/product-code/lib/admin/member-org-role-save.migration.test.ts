// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, expect, it } from 'vitest'

function migration(file: string) {
  return readFileSync(join(process.cwd(), 'supabase/migrations', file), 'utf8')
}

function functionDefinition(file: string, name: string) {
  const start = migration(file).match(new RegExp(`create (?:or replace )?function private\\.${name}\\([\\s\\S]*?\\n\\$\\$;`))
  if (!start) throw new Error(`Missing SQL dependency ${name}`)
  return start[0]
}

const lifecycle = '20261021000006_personnel_lifecycle_commands.sql'
const organizationAdmin = '20261125055213_organization_super_admin.sql'
const systemAdmin = '20261126045425_system_super_admin_authority.sql'
const immutableAdmin = '20261126054302_immutable_system_super_admin.sql'
const roleCatalog = '20261126061431_org_owned_ordinary_roles.sql'
const saveMigration = '20261126092416_admin_save_member_org_roles.sql'

const org = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherOrg = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const actor = '11111111-1111-4111-8111-111111111111'
const target = '22222222-2222-4222-8222-222222222222'
const otherMember = '33333333-3333-4333-8333-333333333333'
const ordinary = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const rootRole = '44444444-4444-4444-8444-444444444444'
const retained = '55555555-5555-4555-8555-555555555555'
const removed = '66666666-6666-4666-8666-666666666666'
const added = '77777777-7777-4777-8777-777777777777'
const legacy = '88888888-8888-4888-8888-888888888888'
const retired = '99999999-9999-4999-8999-999999999999'
const foreignRole = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const archived = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const department = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const request = 'member-role-save-fixture'
const signature = 'public.admin_save_member_org_roles_v1(uuid,uuid,uuid,uuid[],uuid[],boolean,boolean,text)'
let db: PGlite

beforeEach(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    grant usage on schema public to anon, authenticated, service_role;
    create schema private;
    create table public.organizations (id uuid primary key, status text default 'active');
    create table public.users (id uuid primary key, org_id uuid, status text default 'active', login_enabled boolean default true);
    create table public.user_organizations (
      user_id uuid, org_id uuid, is_default boolean default true, status text default 'active',
      employment_status text default 'active', left_at timestamptz, primary key (user_id, org_id)
    );
    create table public.roles (
      id uuid primary key, code text, name text, description text, permissions jsonb, sort_order integer,
      owner_org_id uuid, created_at timestamptz
    );
    create table private.org_role_metadata (
      org_id uuid, role_id uuid, name text, description text, archived_at timestamptz, role_revision bigint
    );
    create table public.user_roles (
      org_id uuid, user_id uuid, role_id uuid, scope_type text, scope_id uuid, granted_by uuid,
      granted_at timestamptz default clock_timestamp(), primary key (user_id, role_id, scope_type, scope_id)
    );
    create table public.personnel_lifecycle_events (
      org_id uuid, target_user_id uuid, actor_id uuid, command text,
      before_state jsonb, after_state jsonb, reason text, request_id text
    );
    insert into public.organizations (id) values ('${org}'), ('${otherOrg}');
    insert into public.users (id, org_id) values
      ('${actor}', '${org}'), ('${target}', '${org}'), ('${ordinary}', '${org}'), ('${otherMember}', '${otherOrg}');
    insert into public.user_organizations (user_id, org_id) select id, org_id from public.users;
    insert into public.roles (id, code, owner_org_id) values
      ('${rootRole}', 'SUPER_ADMIN', null), ('${legacy}', 'ORG_SUPER_ADMIN', null), ('${retired}', 'FXIAOKE_BASELINE', null),
      ('${retained}', 'RETAINED', null), ('${removed}', 'REMOVED', null), ('${added}', 'ADDED', '${org}'),
      ('${foreignRole}', 'FOREIGN', '${otherOrg}'), ('${archived}', 'ARCHIVED', '${org}');
    insert into private.org_role_metadata (org_id, role_id, archived_at) values ('${org}', '${archived}', now());
    insert into public.user_roles (org_id, user_id, role_id, scope_type, scope_id, granted_by) values ('${org}', '${actor}', '${rootRole}', 'org', '${org}', null);
    insert into public.user_roles (org_id, user_id, role_id, scope_type, scope_id, granted_by, granted_at)
    select '${org}', '${target}', role_id, 'org', '${org}', '${target}', '2026-01-01T00:00:00Z'
    from unnest(array['${rootRole}', '${retained}', '${removed}', '${retired}', '${legacy}', '${archived}']::uuid[]) as roles(role_id);
    insert into public.user_roles (org_id, user_id, role_id, scope_type, scope_id, granted_by)
    values ('${org}', '${target}', '${removed}', 'department', '${department}', '${target}');
  `)
  for (const [file, name] of [
    [lifecycle, 'personnel_lock_org_v1'],
    [lifecycle, 'personnel_insert_event_v1'],
    [organizationAdmin, 'has_exact_org_role_v1'],
    [organizationAdmin, 'org_super_admin_active_member_v1'],
    [immutableAdmin, 'system_super_admin_role_enabled_v1'],
    [systemAdmin, 'personnel_is_org_control_admin_v1'],
    [systemAdmin, 'personnel_assert_last_platform_admin_safe_v1'],
    [systemAdmin, 'read_super_admin_assignment_v1'],
    [systemAdmin, 'set_super_admin_assignment_v1'],
    [roleCatalog, 'org_role_catalog_v1'],
  ]) await db.exec(functionDefinition(file, name))
  await db.exec(migration(saveMigration))
})

afterEach(async () => { await db?.close() })

async function save(overrides: {
  actorId?: string; orgId?: string; targetId?: string; wanted?: string[];
  expected?: string[]; admin?: boolean; expectedAdmin?: boolean;
} = {}) {
  await db.exec('set role service_role')
  try {
    const result = await db.query<{ result: string }>(
      'select public.admin_save_member_org_roles_v1($1,$2,$3,$4,$5,$6,$7,$8) as result',
      [
        overrides.actorId ?? actor, overrides.orgId ?? org, overrides.targetId ?? target,
        overrides.wanted ?? [added, retained], overrides.expected ?? [retained, removed],
        overrides.admin ?? true, overrides.expectedAdmin ?? true, request,
      ],
    )
    return result.rows[0].result
  } finally {
    await db.exec('reset role')
  }
}

async function bindings() {
  return (await db.query<{
    role_id: string; scope_type: string; granted_by: string; granted_at: Date;
  }>(
    'select role_id, scope_type, granted_by, granted_at from public.user_roles where user_id = $1 order by role_id, scope_type',
    [target],
  )).rows
}

async function events() {
  return (await db.query('select command, before_state, after_state, request_id from public.personnel_lifecycle_events order by command')).rows
}

it('changes ordinary roles for an existing system administrator while preserving all unrelated bindings and grant metadata', async () => {
  const before = await bindings()
  expect(await save()).toBe('saved')
  const after = await bindings()
  expect(after.filter(binding => binding.role_id !== added))
    .toEqual(before.filter(binding => binding.role_id !== removed || binding.scope_type !== 'org'))
  expect(after.find(binding => binding.role_id === added)).toMatchObject({ granted_by: actor, scope_type: 'org' })
  expect(await events()).toEqual([{
    command: 'assign_org_roles', before_state: { role_ids: [retained, removed] },
    after_state: { role_ids: [retained, added] }, request_id: request,
  }])
  expect(await save({ expected: [added, retained] })).toBe('saved')
  expect(await bindings()).toEqual(after)
  expect(await events()).toHaveLength(1)
})

it('compares both snapshots and rejects forbidden actors, targets and roles before any mutation', async () => {
  const before = await bindings()
  expect(await save({ expected: [retained] })).toBe('conflict')
  expect(await save({ expectedAdmin: false })).toBe('conflict')
  expect(await save({ actorId: target })).toBe('ineligible')
  expect(await save({ actorId: ordinary })).toBe('ineligible')
  expect(await save({ actorId: otherMember })).toBe('ineligible')
  expect(await save({ orgId: otherOrg })).toBe('ineligible')
  expect(await save({ targetId: otherMember })).toBe('ineligible')
  for (const invalid of [rootRole, legacy, retired, foreignRole, archived]) {
    expect(await save({ wanted: [retained, invalid] })).toBe('ineligible')
  }
  await db.query("update public.user_organizations set status = 'invited' where user_id = $1", [target])
  expect(await save()).toBe('ineligible')
  expect(await bindings()).toEqual(before)
  expect(await events()).toEqual([])
})

it('atomically delegates canonical appointment and rolls back role changes on a real appointment failure', async () => {
  expect(await save({ admin: false })).toBe('saved')
  expect((await bindings()).some(binding => binding.role_id === rootRole)).toBe(false)
  expect(await events()).toContainEqual({
    command: 'revoke_system_super_admin', before_state: { role_id: rootRole, assigned: true },
    after_state: { role_id: rootRole, assigned: false }, request_id: request,
  })
  const before = await bindings()
  const beforeEvents = await events()
  await db.query('update public.users set login_enabled = false where id = $1', [target])
  await expect(save({ wanted: [removed], expected: [added, retained], expectedAdmin: false }))
    .rejects.toMatchObject({ code: '23514', detail: 'SYSTEM_SUPER_ADMIN_MEMBER_NOT_ELIGIBLE' })
  expect(await bindings()).toEqual(before)
  expect(await events()).toEqual(beforeEvents)
  await db.query('update public.users set login_enabled = true where id = $1', [target])
  expect(await save({ wanted: [removed], expected: [added, retained], expectedAdmin: false })).toBe('saved')
  expect((await bindings()).some(binding => binding.role_id === rootRole)).toBe(true)
})

it('keeps the sole system administrator protected and grants RPC execution only to the server role', async () => {
  expect(await save({ admin: false })).toBe('saved')
  expect(await save({ targetId: actor, admin: false })).toBe('ineligible')
  await expect(db.query('select private.personnel_assert_last_platform_admin_safe_v1($1,$2)', [actor, org]))
    .rejects.toMatchObject({ code: '23514', detail: 'LAST_SYSTEM_SUPER_ADMIN_PROTECTED' })
  expect((await db.query(`
    select has_function_privilege('anon', $1, 'execute') as anon,
      has_function_privilege('authenticated', $1, 'execute') as authenticated,
      has_function_privilege('service_role', $1, 'execute') as server
  `, [signature])).rows).toEqual([{ anon: false, authenticated: false, server: true }])
})

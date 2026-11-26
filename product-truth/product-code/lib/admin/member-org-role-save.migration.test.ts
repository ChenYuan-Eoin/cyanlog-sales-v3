// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, expect, it } from 'vitest'

function migration(file: string) {
  return readFileSync(join(process.cwd(), 'supabase/migrations', file), 'utf8')
}

function functionDefinition(file: string, name: string, schema = 'private') {
  const start = migration(file).match(new RegExp(`create (?:or replace )?function ${schema}\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, 'i'))
  if (!start) throw new Error(`Missing SQL dependency ${name}`)
  return start[0]
}

const lifecycle = '20261021000006_personnel_lifecycle_commands.sql'
const organizationAdmin = '20261125055213_organization_super_admin.sql'
const systemAdmin = '20261126045425_system_super_admin_authority.sql'
const immutableAdmin = '20261126054302_immutable_system_super_admin.sql'
const roleCatalog = '20261126061431_org_owned_ordinary_roles.sql'
const saveMigration = '20261126092416_admin_save_member_org_roles.sql'
const assignmentGuard = '20261126054700_guard_ordinary_role_assignments.sql'
const firstLogin = '20261118095000_fxiaoke_prelogin_role_assignment.sql'
const accountState = '20260715142428_atomic_admin_user_account_state.sql'
const activation = '20261029100000_remove_local_password_auth.sql'
const batchMigration = '20261126103435_admin_add_member_org_roles.sql'

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
const batchSignature = 'public.admin_apply_org_member_batch_v1(uuid,uuid,uuid[],text,uuid[],text)'
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
    create table public.users (
      id uuid primary key, org_id uuid, status text default 'active', login_enabled boolean default true,
      primary_dept_id uuid, report_to_user_id uuid, updated_at timestamptz, password_hash text,
      must_change_password boolean, last_login_at timestamptz
    );
    create table public.user_organizations (
      user_id uuid, org_id uuid, is_default boolean default true, status text default 'active',
      employment_status text default 'active', left_at timestamptz, primary_department_id uuid,
      offboard_reason text, employment_ended_at timestamptz, membership_version bigint default 1,
      updated_at timestamptz, joined_at timestamptz, employment_started_at timestamptz, updated_by uuid,
      primary key (user_id, org_id)
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
      id uuid default gen_random_uuid(), occurred_at timestamptz default now(),
      org_id uuid, target_user_id uuid, actor_id uuid, command text,
      before_state jsonb, after_state jsonb, reason text, request_id text
    );
    create table public.personnel_employment_periods (
      user_id uuid, org_id uuid, status text, ended_at timestamptz, end_reason text,
      department_id uuid, manager_user_id uuid, updated_at timestamptz
    );
    create table public.personnel_invitations (
      id uuid primary key default gen_random_uuid(), org_id uuid, user_id uuid, created_by uuid,
      status text default 'pending', token_hash text unique, role_ids uuid[] default '{}',
      expires_at timestamptz, accepted_at timestamptz, revoked_at timestamptz
    );
    create table public.auth_tokens (user_id uuid);
    create table public.user_permission_assignments (user_id uuid, org_id uuid);
    create table public.user_departments (user_id uuid, org_id uuid, department_id uuid);
    create table public.sales_space_members (user_id uuid, org_id uuid, space_id uuid);
    create table public.organization_sources (
      id uuid primary key, system_org_id uuid, provider text, status text, connection_state text,
      effective_revision uuid, authority_scope jsonb
    );
    create table public.external_identities (
      id uuid primary key, system_org_id uuid, source_id uuid, canonical_user_id uuid, external_user_id text,
      match_status text, profile_snapshot jsonb
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
    [organizationAdmin, 'assert_no_org_super_admin_v1'],
    [organizationAdmin, 'personnel_assert_last_admin_safe_v1'],
    [immutableAdmin, 'system_super_admin_role_enabled_v1'],
    [systemAdmin, 'personnel_is_org_control_admin_v1'],
    [systemAdmin, 'personnel_assert_last_platform_admin_safe_v1'],
    [systemAdmin, 'read_super_admin_assignment_v1'],
    [systemAdmin, 'set_super_admin_assignment_v1'],
    [roleCatalog, 'org_role_catalog_v1'],
    [assignmentGuard, 'assert_system_role_assignment_actor_v1'],
  ]) await db.exec(functionDefinition(file, name))
  await db.exec(migration(firstLogin).split('-- This one predicate')[0])
  await db.exec(functionDefinition(firstLogin, 'fxiaoke_prelogin_role_targets_v1', 'public'))
  await db.exec(functionDefinition(accountState, 'set_org_user_account_state_and_revoke_sessions_v1', 'public'))
  await db.exec(functionDefinition(lifecycle, 'admin_set_account_state_v1', 'public')
    .replace('function public.', 'function private.'))
  await db.exec(functionDefinition(systemAdmin, 'admin_set_account_state_v1', 'public'))
  await db.exec(functionDefinition(lifecycle, 'admin_offboard_member_v1', 'public'))
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
  return (await db.query<{ command: string }>('select command, before_state, after_state, request_id from public.personnel_lifecycle_events order by command')).rows
}

async function batch(action: string, userIds: string[], roles: string[] = [], actorId = actor) {
  await db.exec('set role service_role')
  try {
    return (await db.query<{ user_id: string; outcome: string }>(
      'select * from public.admin_apply_org_member_batch_v1($1,$2,$3,$4,$5,$6)',
      [actorId, org, userIds, action, roles, request],
    )).rows
  } finally {
    await db.exec('reset role')
  }
}

async function prepareDirectoryFirstLogin() {
  await db.query("update public.users set status = 'inactive', login_enabled = false where id = $1", [ordinary])
  await db.query("update public.user_organizations set status = 'invited' where user_id = $1", [ordinary])
  await db.query(`insert into public.organization_sources values
    ($1, $2, 'fxiaoke', 'active', 'verified', $1, '{"identity":"authoritative","directory":"authoritative"}')`,
  [department, org])
  await db.query(`insert into public.external_identities values
    ($1, $2, $3, $4, 'fixture-external-id', 'matched',
      jsonb_build_object('provisionedMemberId', $4::uuid::text, 'status', 'active'))`,
  [archived, org, department, ordinary])
}

async function addInvitation() {
  await db.query(`insert into public.personnel_invitations (org_id,user_id,created_by,token_hash,role_ids,expires_at)
    values ($1,$2,$3,'fixture-invite',$4,now() + interval '1 hour')`, [org, ordinary, actor, [added]])
}

async function installBatchMigration(invitationBaseline: 'passwordless' | 'legacy' = 'passwordless') {
  const previousMigration = invitationBaseline === 'legacy' ? lifecycle : activation
  await db.exec(functionDefinition(previousMigration, 'accept_personnel_invitation_v1', 'public'))
  if (invitationBaseline === 'legacy') {
    await db.exec('grant execute on function public.accept_personnel_invitation_v1(text, text, text) to service_role')
  }
  await db.exec(migration(batchMigration))
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

it('adds roles for eligible people, keeps unrelated history and rejects unavailable or reserved roles', async () => {
  await installBatchMigration()
  await prepareDirectoryFirstLogin()
  const before = await bindings()
  expect(await batch('assign_roles', [target, ordinary, actor, otherMember], [added])).toEqual([
    { user_id: target, outcome: 'saved' },
    { user_id: ordinary, outcome: 'pending' },
    { user_id: actor, outcome: 'SELF_MUTATION_FORBIDDEN' },
    { user_id: otherMember, outcome: 'MEMBER_NOT_ELIGIBLE' },
  ])
  expect((await bindings()).filter(binding => binding.role_id !== added)).toEqual(before)
  expect((await db.query('select role_id, granted_by from public.fxiaoke_pending_org_roles where user_id = $1', [ordinary])).rows)
    .toEqual([{ role_id: added, granted_by: actor }])
  expect((await events()).map(event => event.command)).toEqual(['assign_org_roles', 'assign_org_roles'])

  expect(await batch('assign_roles', [target, ordinary], [added, added])).toEqual([
    { user_id: target, outcome: 'saved' }, { user_id: ordinary, outcome: 'pending' },
  ])
  expect(await events()).toHaveLength(2)
  for (const invalid of [rootRole, legacy, retired, foreignRole, archived]) {
    await expect(batch('assign_roles', [target, ordinary], [retained, invalid]))
      .rejects.toMatchObject({ code: '23503', detail: 'ORG_ROLE_NOT_FOUND' })
  }
  await expect(batch('assign_roles', [target], [added], ordinary)).rejects.toMatchObject({ code: '42501' })
  expect((await db.query(`
    select has_function_privilege('anon', $1, 'execute') as anon,
      has_function_privilege('authenticated', $1, 'execute') as authenticated,
      has_function_privilege('service_role', $1, 'execute') as server
  `, [batchSignature])).rows).toEqual([{ anon: false, authenticated: false, server: true }])
})

it('stops verified first login and leaves active employment unchanged when disabling ICU login', async () => {
  await installBatchMigration()
  await prepareDirectoryFirstLogin()
  await addInvitation()
  expect(await batch('suspend', [ordinary, actor, target])).toEqual([
    { user_id: ordinary, outcome: 'saved' },
    { user_id: actor, outcome: 'SELF_MUTATION_FORBIDDEN' },
    { user_id: target, outcome: 'PROTECTED_ROLE_MUTATION_FORBIDDEN' },
  ])
  expect((await db.query('select * from public.fxiaoke_prelogin_role_targets_v1($1,$2)', [org, ordinary])).rows).toEqual([])
  expect((await db.query("select public.accept_personnel_invitation_v1('fixture-invite') as accepted")).rows)
    .toEqual([{ accepted: null }])
  const eligible = await batch('assign_roles', [ordinary], [added])
  expect(eligible).toEqual([{ user_id: ordinary, outcome: 'MEMBER_NOT_ELIGIBLE' }])
  expect((await db.query('select status, employment_status from public.user_organizations where user_id = $1', [ordinary])).rows)
    .toEqual([{ status: 'invited', employment_status: 'active' }])
})

it('offboards linked members and retired-role holders, keeps audit and rejects unsafe changes to active administrators', async () => {
  await installBatchMigration()
  await prepareDirectoryFirstLogin()
  await addInvitation()
  await batch('assign_roles', [ordinary], [added])
  await db.query('insert into public.auth_tokens values ($1), ($2)', [ordinary, target])
  expect(await save({ admin: false })).toBe('saved')
  expect(await batch('offboard', [target, ordinary, actor])).toEqual([
    { user_id: target, outcome: 'saved' },
    { user_id: ordinary, outcome: 'saved' },
    { user_id: actor, outcome: 'SELF_MUTATION_FORBIDDEN' },
  ])
  expect((await db.query('select * from public.auth_tokens')).rows).toEqual([])
  expect((await db.query('select * from public.fxiaoke_pending_org_roles')).rows).toEqual([])
  expect((await db.query('select status from public.personnel_invitations')).rows).toEqual([{ status: 'revoked' }])
  expect((await db.query("select public.accept_personnel_invitation_v1('fixture-invite') as accepted")).rows)
    .toEqual([{ accepted: null }])
  expect((await db.query('select match_status from public.external_identities')).rows).toEqual([{ match_status: 'matched' }])
  const states = await db.query(`select status, employment_status, left_at, membership_version
    from public.user_organizations where user_id in ($1,$2) order by user_id`, [target, ordinary])
  for (const state of states.rows) expect(state).toMatchObject({ status: 'ended', employment_status: 'ended', membership_version: 2 })
  expect(await batch('offboard', [ordinary])).toEqual([{ user_id: ordinary, outcome: 'saved' }])
  expect((await db.query(`select status, employment_status, left_at, membership_version
    from public.user_organizations where user_id in ($1,$2) order by user_id`, [target, ordinary])).rows).toEqual(states.rows)
  expect((await events()).filter(event => event.command === 'offboard_member')).toHaveLength(2)
})

it.each(['passwordless', 'legacy'] as const)('accepts a current invitation through the server RPC with a %s baseline', async baseline => {
  if (baseline === 'passwordless') {
    await db.exec('alter table public.users drop column password_hash, drop column must_change_password')
  }
  await installBatchMigration(baseline)
  await prepareDirectoryFirstLogin()
  await addInvitation()

  const privileges = await db.query(`
    select to_regprocedure('public.accept_personnel_invitation_v1(text,text,text)') is null as retired,
      has_function_privilege('anon', $1, 'execute') as anon,
      has_function_privilege('authenticated', $1, 'execute') as authenticated,
      has_function_privilege('service_role', $1, 'execute') as server
  `, ['public.accept_personnel_invitation_v1(text,text)'])
  expect(privileges.rows).toEqual([{ retired: true, anon: false, authenticated: false, server: true }])

  await db.exec('set role service_role')
  try {
    const accept = () => db.query(
      'select public.accept_personnel_invitation_v1(p_token_hash => $1, p_request_id => $2) as accepted',
      ['fixture-invite', request],
    )
    expect((await accept()).rows).toEqual([{ accepted: { user_id: ordinary, org_id: org } }])
    expect((await accept()).rows).toEqual([{ accepted: null }])
  } finally {
    await db.exec('reset role')
  }
  expect((await db.query('select status from public.personnel_invitations')).rows).toEqual([{ status: 'accepted' }])
  expect((await events()).filter(event => event.command === 'activate_membership')).toMatchObject([{ request_id: request }])
  if (baseline === 'legacy') {
    expect((await db.query('select password_hash from public.users where id = $1', [ordinary])).rows).toEqual([{ password_hash: null }])
  }
})

it('reports a last administrator separately from a protected peer', async () => {
  await installBatchMigration()
  expect(await save({ admin: false })).toBe('saved')
  expect(await batch('offboard', [actor], [], ordinary))
    .toEqual([{ user_id: actor, outcome: 'LAST_SYSTEM_SUPER_ADMIN_PROTECTED' }])
})

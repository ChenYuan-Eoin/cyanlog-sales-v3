// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, expect, it } from 'vitest'

const migrations = [
  '20261021000006_personnel_lifecycle_commands.sql',
  '20261022000001_role_scope_lifecycle.sql',
  '20261022000002_remove_tenant_membership.sql',
  '20261118095000_fxiaoke_prelogin_role_assignment.sql',
  '20261125051750_department_lead_access.sql',
  '20261125055213_organization_super_admin.sql',
  '20261126045425_system_super_admin_authority.sql',
  '20261126054302_immutable_system_super_admin.sql',
  '20261126054700_guard_ordinary_role_assignments.sql',
  '20261126054900_guard_invitation_role_authority.sql',
].map(file => readFileSync(join(process.cwd(), 'supabase/migrations', file), 'utf8'))
const invitationAcceptance = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261029100000_remove_local_password_auth.sql'), 'utf8',
).match(/create or replace function public\.accept_personnel_invitation_v1\([\s\S]*?\n\$\$;/)?.[0]

const org = '11111111-1111-4111-8111-111111111111'
const otherOrg = '22222222-2222-4222-8222-222222222222'
const root = '33333333-3333-4333-8333-333333333333'
const actor = '44444444-4444-4444-8444-444444444444'
const member = '55555555-5555-4555-8555-555555555555'
const pending = '66666666-6666-4666-8666-666666666666'
const rootRole = '77777777-7777-4777-8777-777777777777'
const ordinaryRole = '88888888-8888-4888-8888-888888888888'
const actorRole = '99999999-9999-4999-8999-999999999999'
const department = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherDepartment = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const space = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const source = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const identity = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const denied = { code: '42501' }

let db: PGlite

beforeEach(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create table public.organizations (id uuid primary key, status text default 'active', settings jsonb default '{}');
    create table public.users (
      id uuid primary key, org_id uuid references public.organizations(id), status text default 'active',
      login_enabled boolean default true, password_hash text, last_login_at timestamptz,
      must_change_password boolean default false, primary_dept_id uuid, report_to_user_id uuid, updated_at timestamptz
    );
    create table public.user_organizations (
      user_id uuid references public.users(id), org_id uuid references public.organizations(id),
      is_default boolean default true, status text default 'active', left_at timestamptz,
      membership_id uuid, membership_version bigint default 1, joined_at timestamptz default now(),
      created_by uuid, updated_by uuid, created_at timestamptz, updated_at timestamptz,
      primary key (user_id, org_id)
    );
    create table public.roles (
      id uuid primary key default gen_random_uuid(), code text not null unique, name text not null,
      description text, permissions jsonb default '[]', sort_order int
    );
    create table public.user_roles (
      user_id uuid references public.users(id), org_id uuid references public.organizations(id),
      role_id uuid references public.roles(id), scope_type text, scope_id uuid, granted_by uuid,
      granted_at timestamptz default now(), primary key (user_id, role_id, scope_type, scope_id)
    );
    create table public.departments (
      id uuid primary key, org_id uuid references public.organizations(id), leader_id uuid, status text default 'active'
    );
    create table public.sales_spaces (id uuid primary key, org_id uuid references public.organizations(id));
    create table public.organization_sources (
      id uuid primary key, system_org_id uuid references public.organizations(id), provider text,
      status text, connection_state text, effective_revision uuid, authority_scope jsonb
    );
    create table public.external_identities (
      id uuid primary key, system_org_id uuid, source_id uuid references public.organization_sources(id),
      canonical_user_id uuid, external_user_id text, match_status text, profile_snapshot jsonb
    );
    create table public.auth_tokens (id uuid primary key default gen_random_uuid(), user_id uuid);
    create function public.get_org_admin_directory_payload_v1(uuid) returns jsonb language sql
      as $$ select '{"users":[]}'::jsonb $$;
    insert into public.organizations (id, settings) values
      ('${org}', '{"role_permission_overrides":{"${rootRole}":[]}}'), ('${otherOrg}', '{}');
    insert into public.users (id, org_id) values ('${root}', '${org}'), ('${actor}', '${org}'), ('${member}', '${org}');
    insert into public.user_organizations (user_id, org_id) select id, org_id from public.users;
    insert into public.roles (id, code, name, permissions) values
      ('${rootRole}', 'SUPER_ADMIN', 'System', '[]'),
      ('${ordinaryRole}', 'SALES', 'Sales', '[]'),
      ('${actorRole}', 'ADMIN', 'Department administrator', '["role:manage","user:assign_roles"]');
    insert into public.user_roles (user_id, org_id, role_id, scope_type, scope_id) values
      ('${root}', '${org}', '${rootRole}', 'org', '${org}'),
      ('${actor}', '${org}', '${actorRole}', 'org', '${org}');
    insert into public.departments (id, org_id) values ('${department}', '${org}'), ('${otherDepartment}', '${otherOrg}');
    insert into public.sales_spaces (id, org_id) values ('${space}', '${org}');
  `)
  for (const migration of migrations) await db.exec(migration)
})

afterEach(async () => db.close())

const replaceSql = 'select public.admin_replace_org_roles_v1($1,$2,$3,$4) as result'
const compareAndReplaceSql = 'select public.admin_replace_org_roles_if_current_v1($1,$2,$3,$4,$5) as result'
const scopeSql = 'select public.admin_set_role_scope_assignment_v1($1,$2,$3,$4,$5,$6,$7) as result'

async function replace(user = root, desired = [ordinaryRole], target = member, expected?: string[]) {
  const result = expected === undefined
    ? await db.query<{ result: boolean }>(replaceSql, [user, org, target, desired])
    : await db.query<{ result: string }>(compareAndReplaceSql, [user, org, target, desired, expected])
  return result.rows[0].result
}

async function scope(action: 'assign' | 'revoke', user = root, type = 'department', scopeId = department, role = ordinaryRole) {
  const result = await db.query<{ result: boolean }>(scopeSql, [user, org, member, role, type, scopeId, action])
  return result.rows[0].result
}

it('denies all ordinary operations before checking stale state unless the actor is the exact live system root', async () => {
  await db.exec('set role service_role')
  await expect(replace(actor)).rejects.toMatchObject(denied)
  await expect(replace(actor, [ordinaryRole], member, [ordinaryRole])).rejects.toMatchObject(denied)
  await expect(scope('assign', actor)).rejects.toMatchObject(denied)
  await expect(scope('revoke', actor)).rejects.toMatchObject(denied)
  await db.exec('reset role')
  await db.query("update public.user_roles set scope_type = 'department', scope_id = $2 where user_id = $1", [root, department])
  await expect(replace()).rejects.toMatchObject(denied)
  await db.query("update public.user_roles set scope_type = 'org', scope_id = $2 where user_id = $1", [root, org])
  await db.query('update public.user_organizations set is_default = false where user_id = $1', [root])
  await expect(replace(root, [ordinaryRole], member, [])).rejects.toMatchObject(denied)
  await db.query('update public.user_organizations set is_default = true where user_id = $1', [root])
  await db.query('update public.users set login_enabled = false where id = $1', [root])
  await expect(scope('assign')).rejects.toMatchObject(denied)
  expect((await db.query('select role_id from public.user_roles where user_id = $1', [member])).rows).toEqual([])
})

it('preserves both organization RPC contracts, role CAS and reserved-role protection', async () => {
  await db.exec('set role service_role')
  expect(await replace()).toBe(true)
  expect(await replace(root, [], member, [])).toBe('conflict')
  expect(await replace(root, [], member, [ordinaryRole])).toBe('saved')
  await expect(replace(root, [rootRole])).rejects.toMatchObject(denied)
  await expect(replace(root, [], root)).rejects.toMatchObject(denied)
  await expect(scope('assign', root, 'department', department, rootRole)).rejects.toMatchObject(denied)
  await db.exec('reset role')
  expect((await db.query('select role_id from public.user_roles where user_id = $1', [member])).rows).toEqual([])
})

it('keeps exact department assignment and allows removing a legacy space grant without creating new ones', async () => {
  await db.query(`
    insert into public.user_roles (user_id, org_id, role_id, scope_type, scope_id) values ($1,$2,$3,'space',$4)
  `, [member, org, ordinaryRole, space])
  await db.exec('set role service_role')
  expect(await scope('assign')).toBe(true)
  await expect(scope('assign', root, 'department', otherDepartment)).rejects.toMatchObject({ code: '23514' })
  await expect(scope('assign', root, 'space', space)).rejects.toMatchObject({
    code: '23514', detail: 'LEGACY_SCOPE_ASSIGNMENT_FORBIDDEN',
  })
  expect(await scope('revoke', root, 'space', space)).toBe(true)
  await expect(scope('assign', root, 'space', space)).rejects.toMatchObject({ code: '23514' })
  await db.exec('reset role')
  expect((await db.query('select scope_type, scope_id from public.user_roles where user_id = $1', [member])).rows)
    .toEqual([{ scope_type: 'department', scope_id: department }])
})

it('preserves verified pending reservations and first-login promotion after a root assignment', async () => {
  await db.query("insert into public.users (id,org_id,status,login_enabled) values ($1,$2,'inactive',false)", [pending, org])
  await db.query("insert into public.user_organizations (user_id,org_id,status) values ($1,$2,'invited')", [pending, org])
  await db.query(`
    insert into public.organization_sources (id,system_org_id,provider,status,connection_state,effective_revision,authority_scope)
    values ($1,$2,'fxiaoke','active','verified',$1,'{"identity":"authoritative","directory":"authoritative"}')
  `, [source, org])
  await db.query(`
    insert into public.external_identities (id,system_org_id,source_id,canonical_user_id,external_user_id,match_status,profile_snapshot)
    values ($1,$2,$3,$4,'verified-id','matched',jsonb_build_object('provisionedMemberId',$4::uuid::text,'status','active'))
  `, [identity, org, source, pending])
  await db.exec('set role service_role')
  await expect(replace(actor, [ordinaryRole], pending, [])).rejects.toMatchObject(denied)
  expect(await replace(root, [ordinaryRole], pending, [])).toBe('saved')
  expect((await db.query('select role_id, granted_by from public.fxiaoke_pending_org_roles where user_id = $1', [pending])).rows)
    .toEqual([{ role_id: ordinaryRole, granted_by: root }])
  expect((await db.query("select public.activate_fxiaoke_sso_member_v1($1,'verified-id',$2) as user_id", [org, pending])).rows)
    .toEqual([{ user_id: pending }])
  expect((await db.query('select role_id from public.fxiaoke_pending_org_roles where user_id = $1', [pending])).rows).toEqual([])
  await db.exec('reset role')
  expect((await db.query('select role_id, granted_by from public.user_roles where user_id = $1', [pending])).rows)
    .toEqual([{ role_id: ordinaryRole, granted_by: root }])
})

it('exposes only the guarded functions to the service role', async () => {
  await db.exec('set role authenticated')
  await expect(replace()).rejects.toMatchObject(denied)
  await expect(replace(root, [], member, [])).rejects.toMatchObject(denied)
  await expect(scope('assign')).rejects.toMatchObject(denied)
  await db.exec('reset role; set role service_role')
  await expect(db.query('select private.admin_replace_org_roles_before_system_actor_v1($1,$2,$3,$4)', [
    actor, org, member, [ordinaryRole],
  ])).rejects.toMatchObject(denied)
  await expect(db.query('select private.admin_replace_org_roles_if_current_before_system_actor_v1($1,$2,$3,$4,$5)', [
    actor, org, member, [ordinaryRole], [],
  ])).rejects.toMatchObject(denied)
  await expect(db.query('select private.admin_set_role_scope_assignment_before_system_actor_v1($1,$2,$3,$4,$5,$6,$7)', [
    actor, org, member, ordinaryRole, 'department', department, 'assign',
  ])).rejects.toMatchObject(denied)
})

it('allows ordinary empty invitations, requires live authority for reserved roles, and prevents rewriting a pending reservation', async () => {
  if (!invitationAcceptance) throw new Error('Missing invitation acceptance definition')
  await db.exec(invitationAcceptance)
  const invite = (token: string, roleIds: string[], creator: string, destination = org) => db.query(
    `insert into public.personnel_invitations (org_id,user_id,token_hash,role_ids,expires_at,created_by)
     values ($1,$2,$3,$4,now() + interval '1 day',$5)`,
    [destination, member, token, roleIds, creator],
  )
  const actorRequired = { code: '42501', detail: 'PERSONNEL_INVITATION_ROLE_AUTHORITY_REQUIRED' }
  const newReservation = { code: '42501', detail: 'PERSONNEL_INVITATION_ROLE_CHANGE_FORBIDDEN' }
  await invite('empty', [], actor)
  await expect(invite('ordinary-actor', [ordinaryRole], actor)).rejects.toMatchObject(actorRequired)
  await expect(invite('wrong-organization', [ordinaryRole], root, otherOrg)).rejects.toMatchObject(actorRequired)
  await expect(invite('system-root', [rootRole], root)).rejects.toMatchObject(denied)
  await invite('approved', [ordinaryRole], root)
  await invite('to-revoke', [ordinaryRole], root)

  // Role reservations cannot be added or transferred by changing existing rows.
  await expect(db.query("update public.personnel_invitations set role_ids = $1 where token_hash = 'empty'", [[ordinaryRole]]))
    .rejects.toMatchObject(newReservation)
  await expect(db.query("update public.personnel_invitations set user_id = $1 where token_hash = 'approved'", [actor]))
    .rejects.toMatchObject(newReservation)
  await expect(db.query("update public.personnel_invitations set org_id = $1 where token_hash = 'approved'", [otherOrg]))
    .rejects.toMatchObject(newReservation)
  await db.exec("update public.personnel_invitations set status = 'revoked', revoked_at = now() where token_hash = 'to-revoke'")
  await expect(db.exec("update public.personnel_invitations set status = 'pending' where token_hash = 'to-revoke'"))
    .rejects.toMatchObject(newReservation)

  // A later authority change does not undo the previously approved invitation.
  await db.query('update public.users set login_enabled = false where id = $1', [root])
  await expect(invite('stale-actor', [ordinaryRole], root)).rejects.toMatchObject(actorRequired)
  await db.exec(`
    update public.personnel_invitations set token_hash = 'reissued', status = 'pending', expires_at = now() + interval '1 day'
    where token_hash = 'approved' and status = 'pending'
  `)
  const accepted = await db.query('select public.accept_personnel_invitation_v1(p_token_hash => $1, p_request_id => $2) as data', [
    'reissued', 'approved-invitation',
  ])
  expect(accepted.rows).toEqual([{ data: { user_id: member, org_id: org } }])
  expect((await db.query('select role_id, granted_by from public.user_roles where user_id = $1', [member])).rows)
    .toEqual([{ role_id: ordinaryRole, granted_by: root }])
})

// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const migrations = [
  '20261021000006_personnel_lifecycle_commands.sql',
  '20261022000001_role_scope_lifecycle.sql',
  '20261022000002_remove_tenant_membership.sql',
  '20261118095000_fxiaoke_prelogin_role_assignment.sql',
  '20261125051750_department_lead_access.sql',
  '20261125055213_organization_super_admin.sql',
].map(file => readFileSync(join(process.cwd(), 'supabase/migrations', file), 'utf8'))

const org = '11111111-1111-4111-8111-111111111111'
const otherOrg = '22222222-2222-4222-8222-222222222222'
const root = '33333333-3333-4333-8333-333333333333'
const candidate = '44444444-4444-4444-8444-444444444444'
const peer = '55555555-5555-4555-8555-555555555555'
const outsider = '66666666-6666-4666-8666-666666666666'
const reserved = '77777777-7777-4777-8777-777777777777'
const sourceId = '88888888-8888-4888-8888-888888888888'
const identityId = '99999999-9999-4999-8999-999999999999'
const rootRole = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const salesRole = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const department = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

describe('organization super administrator migration', () => {
  let db: PGlite
  let orgAdminRole: string

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
    `)
    await db.query('insert into public.organizations(id) values ($1), ($2)', [org, otherOrg])
    await db.query(`
      insert into public.users(id, org_id) values ($1, $5), ($2, $5), ($3, $5), ($4, $6)
    `, [root, candidate, peer, outsider, org, otherOrg])
    await db.query(`
      insert into public.user_organizations(user_id, org_id) select id, org_id from public.users
    `)
    await db.query("insert into public.roles(id, code, name) values ($1, 'SUPER_ADMIN', 'Platform'), ($2, 'SALES', 'Sales')",
      [rootRole, salesRole])
    await db.query("insert into public.user_roles(user_id, org_id, role_id, scope_type, scope_id) values ($1, $4, $2, 'org', $4), ($3, $4, $5, 'org', $4)",
      [root, rootRole, candidate, org, salesRole])
    await db.query('insert into public.departments(id, org_id, leader_id) values ($1, $2, $3)', [department, org, peer])
    for (const migration of migrations.slice(0, -1)) await db.exec(migration)
    // Exercise the old functions on this connection before the migration.
    await expect(db.query('select public.admin_remove_tenant_membership_v1($1,$2,$3)', [peer, org, root]))
      .rejects.toMatchObject({ code: '23514' })
    await expect(db.query('select public.admin_offboard_member_v1($1,$2,$3,$4)', [peer, org, root, 'test']))
      .rejects.toMatchObject({ code: '23514' })
    await db.exec(migrations[migrations.length - 1])
    orgAdminRole = (await db.query<{ id: string }>("select id from public.roles where code = 'ORG_SUPER_ADMIN'")).rows[0].id
  })

  afterEach(async () => db.close())

  async function read(target = candidate, actor = root, organization = org) {
    const result = await db.query<{ assigned: boolean }>(
      'select public.admin_get_org_super_admin_v1($1, $2, $3) as assigned', [actor, organization, target],
    )
    return result.rows[0].assigned
  }

  async function set(assigned: boolean, expected: boolean, target = candidate, actor = root, organization = org) {
    const result = await db.query<{ assigned: boolean }>(
      'select public.admin_set_org_super_admin_v1($1, $2, $3, $4, $5, $6) as assigned',
      [actor, organization, target, assigned, expected, 'test-request'],
    )
    return result.rows[0].assigned
  }

  it('lets a current organization super admin manage peers and confirm the current department lead', async () => {
    expect(await read()).toBe(false)
    expect(await set(true, false)).toBe(true)
    expect(await set(true, false)).toBe(true)
    expect(await read()).toBe(true)
    await expect(set(false, false)).rejects.toMatchObject({ code: '40001' })

    await db.query('update public.organizations set settings = $1 where id = $2', [
      JSON.stringify({ role_permission_overrides: { [orgAdminRole]: [] } }), org,
    ])
    expect(await set(true, false, peer, candidate)).toBe(true)
    expect((await db.query(
      'select public.admin_set_department_lead_access_v1($1, $2, $3, $4, null) as data',
      [candidate, org, department, peer],
    )).rows).toEqual([{ data: { status: 'saved', userId: peer } }])
    expect(await set(false, true, candidate, peer)).toBe(false)
    await expect(read(peer, candidate)).rejects.toMatchObject({ code: '42501' })

    const result = await db.query(`
      select actor_id, target_user_id, command, before_state, after_state, request_id
      from public.personnel_lifecycle_events
      where command in ('assign_org_super_admin', 'revoke_org_super_admin')
    `)
    expect(result.rows).toHaveLength(3)
    expect(result.rows).toEqual(expect.arrayContaining([
      {
        actor_id: peer, target_user_id: candidate, command: 'revoke_org_super_admin',
        before_state: { assigned: true, role_id: orgAdminRole },
        after_state: { assigned: false, role_id: orgAdminRole }, request_id: 'test-request',
      },
    ]))
  })

  it('denies ordinary actors, cross-tenant scopes, self changes, platform targets and disabled members', async () => {
    await expect(set(true, false, peer, candidate)).rejects.toMatchObject({ code: '42501' })
    await expect(set(true, false, outsider)).rejects.toMatchObject({ code: 'P0002' })
    await expect(set(true, false, outsider, root, otherOrg)).rejects.toMatchObject({ code: '42501' })
    await expect(set(true, false, root)).rejects.toMatchObject({ code: '42501' })
    await db.query('update public.users set login_enabled = false where id = $1', [candidate])
    await expect(read()).rejects.toMatchObject({ code: '23514' })
    await expect(set(true, false)).rejects.toMatchObject({ code: '23514' })
    await db.query("update public.organizations set status = 'inactive' where id = $1", [org])
    await expect(read(peer)).rejects.toMatchObject({ code: '42501' })
  })

  it('blocks new assignments to a disabled department while allowing an existing binding to be revoked', async () => {
    const changeRole = 'select public.admin_set_role_scope_assignment_v1($1, $2, $3, $4, $5, $6, $7) as saved'
    const scope = [root, org, peer, salesRole, 'department', department]
    const bindings = "select user_id from public.user_roles where scope_type = 'department' and org_id = $1 and scope_id = $2"
    expect((await db.query(changeRole, [...scope, 'assign'])).rows).toEqual([{ saved: true }])
    await db.query("update public.departments set status = 'inactive' where org_id = $1 and id = $2", [org, department])

    await expect(db.query(changeRole, [root, org, candidate, salesRole, 'department', department, 'assign']))
      .rejects.toMatchObject({ code: '23514', detail: 'DEPARTMENT_SCOPE_UNAVAILABLE' })
    expect((await db.query(bindings, [org, department])).rows).toEqual([{ user_id: peer }])
    expect((await db.query(changeRole, [...scope, 'revoke'])).rows).toEqual([{ saved: true }])
    expect((await db.query(bindings, [org, department])).rows).toEqual([])
  })

  it('preserves dedicated assignment during generic active-role edits and blocks generic privilege changes', async () => {
    const replace = 'select public.admin_replace_org_roles_v1($1, $2, $3, $4) as saved'
    const replaceIfCurrent = 'select public.admin_replace_org_roles_if_current_v1($1, $2, $3, $4, $5) as result'
    await expect(db.query(replace, [root, org, peer, [orgAdminRole]])).rejects.toMatchObject({ code: '42501' })
    await expect(db.query(replace, [root, org, peer, [rootRole]])).rejects.toMatchObject({ code: '42501' })
    expect(await set(true, false)).toBe(true)
    expect((await db.query(replaceIfCurrent, [root, org, candidate, [], [orgAdminRole, salesRole]])).rows)
      .toEqual([{ result: 'saved' }])
    expect((await db.query(replaceIfCurrent, [root, org, candidate, [salesRole], [salesRole]])).rows)
      .toEqual([{ result: 'conflict' }])
    expect((await db.query(replace, [root, org, candidate, [salesRole, orgAdminRole]])).rows)
      .toEqual([{ saved: true }])
    expect(await read()).toBe(true)

    const scopes = 'select public.admin_set_role_scope_assignment_v1($1, $2, $3, $4, $5, $6, $7)'
    expect((await db.query(scopes, [root, org, peer, salesRole, 'department', department, 'assign'])).rows)
      .toEqual([{ admin_set_role_scope_assignment_v1: true }])
    await expect(db.query(scopes, [root, org, peer, salesRole, 'space', department, 'assign']))
      .rejects.toMatchObject({ code: '23514' })
    await expect(db.query(scopes, [root, org, root, salesRole, 'department', department, 'assign']))
      .rejects.toMatchObject({ code: '42501' })
    await expect(db.query(scopes, [candidate, org, root, salesRole, 'department', department, 'assign']))
      .rejects.toMatchObject({ code: '42501' })
    await expect(db.query(scopes, [outsider, org, peer, salesRole, 'department', department, 'assign']))
      .rejects.toMatchObject({ code: '42501' })
    await expect(db.query(scopes, [root, org, peer, orgAdminRole, 'department', department, 'assign']))
      .rejects.toMatchObject({ code: '42501' })
    await expect(db.query(scopes, [root, org, candidate, orgAdminRole, 'org', org, 'revoke']))
      .rejects.toMatchObject({ code: '42501' })
    await expect(db.query('select public.admin_set_account_state_v1($1,$2,$3,$4,$5)', [peer, org, candidate, 'active', false]))
      .rejects.toMatchObject({ code: '42501' })
    await expect(db.query('select public.admin_remove_tenant_membership_v1($1,$2,$3)', [peer, org, candidate]))
      .rejects.toMatchObject({ code: '42501' })
    await expect(db.query('select public.admin_offboard_member_v1($1,$2,$3,$4)', [peer, org, candidate, 'test']))
      .rejects.toMatchObject({ code: '42501' })

    await db.exec('set role service_role')
    await expect(db.query('select private.admin_replace_org_roles_v1($1,$2,$3,$4)', [peer, org, candidate, []]))
      .rejects.toMatchObject({ code: '42501' })
    await db.exec('reset role; set role authenticated')
    await expect(read()).rejects.toMatchObject({ code: '42501' })
    await expect(set(false, true)).rejects.toMatchObject({ code: '42501' })
    await db.exec('reset role; set role service_role')
    expect(await set(false, true)).toBe(false)
  })

  it('preserves the last viable organization controller through generic lifecycle calls', async () => {
    expect(await set(true, false)).toBe(true)
    await db.query('update public.users set login_enabled = false where id = $1', [root])
    await expect(set(false, true)).rejects.toMatchObject({ code: '42501' })
    await expect(set(false, true, candidate, candidate)).rejects.toMatchObject({ code: '42501' })
    await expect(db.query('select public.admin_set_account_state_v1($1,$2,$3,null,false)', [peer, org, candidate]))
      .rejects.toMatchObject({ code: '42501' })
    await expect(db.query('select public.admin_remove_tenant_membership_v1($1,$2,$3)', [peer, org, candidate]))
      .rejects.toMatchObject({ code: '42501' })
    expect(await set(true, false, peer, candidate)).toBe(true)
    expect(await set(false, true, candidate, peer)).toBe(false)
  })

  it('rejects new narrow shipping operator bindings at the guarded RPC and allows removing old ones', async () => {
    const space = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const { rows: [{ id: operatorRole }] } = await db.query<{ id: string }>(`
      insert into public.roles(code, name, permissions) values ('SHIPPING_OPERATOR', 'Operator', '["shipping:operate"]')
      returning id
    `)
    await db.query(`update public.roles set permissions = '["shipping:operate", "contract:view"]' where id = $1`, [salesRole])
    await db.query('insert into public.sales_spaces(id, org_id) values ($1, $2)', [space, org])
    await db.query(`
      insert into public.user_roles(user_id, org_id, role_id, scope_type, scope_id)
      values ($1, $2, $3, 'department', $4), ($1, $2, $3, 'space', $5), ($1, $2, $3, 'org', $2)
    `, [peer, org, operatorRole, department, space])

    const scopes = 'select public.admin_set_role_scope_assignment_v1($1, $2, $3, $4, $5, $6, $7) as saved'
    await db.exec('set role service_role')
    for (const [scopeType, scopeId] of [['department', department], ['space', space]]) {
      expect((await db.query(scopes, [root, org, peer, operatorRole, scopeType, scopeId, 'revoke'])).rows)
        .toEqual([{ saved: true }])
      await expect(db.query(scopes, [root, org, peer, operatorRole, scopeType, scopeId, 'assign']))
        .rejects.toMatchObject({ code: '23514', detail: 'ROLE_SCOPE_NOT_SUPPORTED' })
      expect((await db.query(scopes, [root, org, peer, salesRole, scopeType, scopeId, 'assign'])).rows)
        .toEqual([{ saved: true }])
    }
    expect((await db.query(scopes, [root, org, candidate, operatorRole, 'org', org, 'assign'])).rows)
      .toEqual([{ saved: true }])
    await db.exec('reset role')
    expect((await db.query('select scope_type from public.user_roles where role_id = $1 order by user_id', [operatorRole])).rows)
      .toEqual([{ scope_type: 'org' }, { scope_type: 'org' }])
  })

  it('preserves ordinary pending reservations and first-login activation', async () => {
    await db.query("insert into public.users(id,org_id,status,login_enabled) values ($1,$2,'inactive',false)", [reserved, org])
    await db.query("insert into public.user_organizations(user_id,org_id,status) values ($1,$2,'invited')", [reserved, org])
    await db.query(`
      insert into public.organization_sources(id,system_org_id,provider,status,connection_state,effective_revision,authority_scope)
      values ($1,$2,'fxiaoke','active','verified',$1,'{"identity":"authoritative","directory":"authoritative"}')
    `, [sourceId, org])
    await db.query(`
      insert into public.external_identities(id,system_org_id,source_id,canonical_user_id,external_user_id,match_status,profile_snapshot)
      values ($1,$2,$3,$4,'verified-id','matched',jsonb_build_object('provisionedMemberId',$4::uuid::text,'status','active'))
    `, [identityId, org, sourceId, reserved])
    const invite = `insert into public.personnel_invitations(org_id,user_id,token_hash,role_ids,expires_at,created_by)
      values ($1,$2,'test-invitation',$3,now() + interval '1 day',$4)`
    await expect(db.query(invite, [org, reserved, [orgAdminRole], root])).rejects.toMatchObject({ code: '42501' })
    await db.query(invite, [org, reserved, [salesRole], root])
    const replace = 'select public.admin_replace_org_roles_if_current_v1($1,$2,$3,$4,$5) as status'
    await expect(set(true, false, reserved)).rejects.toMatchObject({ code: '23514' })
    await expect(db.query(replace, [root, org, reserved, [orgAdminRole], []])).rejects.toMatchObject({ code: '42501' })
    expect((await db.query(replace, [root, org, reserved, [salesRole], []])).rows).toEqual([{ status: 'saved' }])
    expect((await db.query(
      "select public.activate_fxiaoke_sso_member_v1($1,'verified-id',$2) as user_id", [org, reserved],
    )).rows).toEqual([{ user_id: reserved }])
    expect((await db.query('select role_id from public.user_roles where user_id = $1', [reserved])).rows)
      .toEqual([{ role_id: salesRole }])
  })
})

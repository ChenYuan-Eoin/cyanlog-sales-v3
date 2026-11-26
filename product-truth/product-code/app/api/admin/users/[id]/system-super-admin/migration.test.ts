// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const migrations = [
  '20260715142428_atomic_admin_user_account_state.sql',
  '20261021000006_personnel_lifecycle_commands.sql',
  '20261022000001_role_scope_lifecycle.sql',
  '20261022000002_remove_tenant_membership.sql',
  '20261118095000_fxiaoke_prelogin_role_assignment.sql',
  '20261125051750_department_lead_access.sql',
  '20261125055213_organization_super_admin.sql',
  '20261126045425_system_super_admin_authority.sql',
].map(file => readFileSync(join(process.cwd(), 'supabase/migrations', file), 'utf8'))

const organization = '11111111-1111-4111-8111-111111111111'
const otherOrganization = '22222222-2222-4222-8222-222222222222'
const root = '33333333-3333-4333-8333-333333333333'
const candidate = '44444444-4444-4444-8444-444444444444'
const legacyAdministrator = '55555555-5555-4555-8555-555555555555'
const outsider = '66666666-6666-4666-8666-666666666666'
const rootRole = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const salesRole = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const department = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

describe('system super administrator migration', () => {
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
      create unique index one_default_organization on public.user_organizations(user_id) where is_default;
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
    await db.query('insert into public.organizations(id) values ($1), ($2)', [organization, otherOrganization])
    await db.query('insert into public.users(id, org_id) values ($1, $5), ($2, $5), ($3, $5), ($4, $6)', [
      root, candidate, legacyAdministrator, outsider, organization, otherOrganization,
    ])
    await db.exec('insert into public.user_organizations(user_id, org_id) select id, org_id from public.users')
    await db.query("insert into public.roles(id, code, name) values ($1, 'SUPER_ADMIN', 'System'), ($2, 'SALES', 'Sales')", [
      rootRole, salesRole,
    ])
    await db.query(`
      insert into public.user_roles(user_id, org_id, role_id, scope_type, scope_id)
      values ($1, $4, $2, 'org', $4), ($3, $4, $5, 'org', $4)
    `, [root, rootRole, candidate, organization, salesRole])
    await db.query('insert into public.departments(id, org_id, leader_id) values ($1, $2, $3)', [
      department, organization, candidate,
    ])

    for (const migration of migrations.slice(0, -1)) await db.exec(migration)
    await db.query('select public.admin_set_org_super_admin_v1($1, $2, $3, true, false)', [
      root, organization, legacyAdministrator,
    ])
    await db.exec(migrations[migrations.length - 1])
  })

  afterEach(async () => db.close())

  async function assigned(target = candidate, actor = root, orgId = organization) {
    const result = await db.query<{ assigned: boolean }>(
      'select public.admin_get_system_super_admin_v1($1, $2, $3) as assigned', [actor, orgId, target],
    )
    return result.rows[0].assigned
  }

  async function setAssigned(enabled: boolean, expected: boolean, target = candidate, actor = root) {
    const result = await db.query<{ assigned: boolean }>(
      'select public.admin_set_system_super_admin_v1($1, $2, $3, $4, $5, $6) as assigned',
      [actor, organization, target, enabled, expected, 'test-request'],
    )
    return result.rows[0].assigned
  }

  it('assigns and revokes the existing exact organization role with CAS and one audit event per change', async () => {
    expect(await assigned()).toBe(false)
    expect(await setAssigned(true, false)).toBe(true)
    expect(await assigned()).toBe(true)
    await expect(setAssigned(true, false)).rejects.toMatchObject({ code: '40001' })
    expect(await setAssigned(true, true)).toBe(true)
    await expect(setAssigned(false, false)).rejects.toMatchObject({ code: '40001' })
    expect(await setAssigned(false, true)).toBe(false)
    expect(await assigned()).toBe(false)

    const events = await db.query(`
      select command, before_state, after_state
      from public.personnel_lifecycle_events
      where target_user_id = $1 and actor_id = $2 and request_id = 'test-request'
    `, [candidate, root])
    expect(events.rows).toHaveLength(2)
    expect(events.rows).toEqual(expect.arrayContaining([
      {
        command: 'assign_system_super_admin', before_state: { role_id: rootRole, assigned: false },
        after_state: { role_id: rootRole, assigned: true },
      },
      {
        command: 'revoke_system_super_admin', before_state: { role_id: rootRole, assigned: true },
        after_state: { role_id: rootRole, assigned: false },
      },
    ]))
    const roles = await db.query('select role_id from public.user_roles where user_id = $1', [candidate])
    expect(roles.rows).toEqual([{ role_id: salesRole }])
  })

  it('denies legacy administrators, self mutation, foreign targets and an actor without effective control', async () => {
    expect(await assigned(legacyAdministrator)).toBe(false)
    await expect(setAssigned(true, false, candidate, legacyAdministrator)).rejects.toMatchObject({ code: '42501' })
    await expect(setAssigned(false, true, root)).rejects.toMatchObject({ code: '42501' })
    await expect(assigned(outsider)).rejects.toMatchObject({ code: 'P0002' })
    await expect(assigned(outsider, root, otherOrganization)).rejects.toMatchObject({ code: '42501' })

    await db.query('update public.organizations set settings = $1 where id = $2', [
      { role_permission_overrides: { [rootRole]: ['config:read'] } }, organization,
    ])
    await expect(assigned()).rejects.toMatchObject({ code: '42501' })
    await db.query('update public.organizations set settings = $1 where id = $2', [
      { role_permission_overrides: { [rootRole]: ['role:manage'] } }, organization,
    ])
    expect(await assigned()).toBe(false)
    await db.query('update public.user_organizations set is_default = false where user_id = $1', [root])
    await expect(assigned()).rejects.toMatchObject({ code: '42501' })
  })

  it('requires an active login for a new grant and permits revoking a dormant exact binding', async () => {
    await db.query('update public.users set login_enabled = false where id = $1', [candidate])
    await expect(setAssigned(true, false)).rejects.toMatchObject({
      code: '23514', detail: 'SYSTEM_SUPER_ADMIN_MEMBER_NOT_ELIGIBLE',
    })
    await db.query('update public.users set login_enabled = true where id = $1', [candidate])
    expect(await setAssigned(true, false)).toBe(true)
    await db.query("update public.user_organizations set status = 'ended', left_at = now(), is_default = false where user_id = $1", [candidate])

    expect(await assigned()).toBe(true)
    expect(await setAssigned(false, true)).toBe(false)
    expect(await assigned()).toBe(false)
  })

  it('protects the last effective controller from login, offboarding and membership commands', async () => {
    expect(await setAssigned(true, false)).toBe(true)
    await db.query('update public.user_organizations set is_default = false where user_id = $1', [candidate])
    const lastAdministrator = { code: '23514', detail: 'LAST_SYSTEM_SUPER_ADMIN_PROTECTED' }

    await expect(db.query("select public.admin_set_account_state_v1($1, $2, $3, 'active', false)", [
      candidate, organization, root,
    ])).rejects.toMatchObject(lastAdministrator)
    await expect(db.query("select public.admin_offboard_member_v1($1, $2, $3, 'test')", [
      candidate, organization, root,
    ])).rejects.toMatchObject(lastAdministrator)
    await expect(db.query('select public.admin_remove_tenant_membership_v1($1, $2, $3)', [
      candidate, organization, root,
    ])).rejects.toMatchObject(lastAdministrator)

    await db.query('update public.user_organizations set is_default = true, left_at = now() where user_id = $1', [candidate])
    await expect(db.query("select public.admin_set_account_state_v1($1, $2, $3, 'active', false)", [
      candidate, organization, root,
    ])).rejects.toMatchObject(lastAdministrator)
  })

  it('lets only a canonical administrator remove even a dormant legacy binding and preserves prior audit', async () => {
    const legacyRead = 'select public.admin_get_org_super_admin_v1($1, $2, $3) as assigned'
    const legacyChange = 'select public.admin_set_org_super_admin_v1($1, $2, $3, $4, $5) as assigned'
    await expect(db.query(legacyChange, [legacyAdministrator, organization, candidate, false, false]))
      .rejects.toMatchObject({ code: '42501' })
    expect(await setAssigned(true, false, legacyAdministrator)).toBe(true)
    await db.query('update public.users set login_enabled = false where id = $1', [legacyAdministrator])

    expect((await db.query(legacyRead, [root, organization, legacyAdministrator])).rows)
      .toEqual([{ assigned: true }])
    await expect(db.query(legacyChange, [root, organization, legacyAdministrator, false, false]))
      .rejects.toMatchObject({ code: '40001' })
    expect((await db.query(legacyChange, [root, organization, legacyAdministrator, false, true])).rows)
      .toEqual([{ assigned: false }])
    expect(await assigned(legacyAdministrator)).toBe(true)
    const history = await db.query(`
      select command from public.personnel_lifecycle_events
      where target_user_id = $1 and command in ('assign_org_super_admin', 'revoke_org_super_admin')
      order by occurred_at, command
    `, [legacyAdministrator])
    expect(history.rows).toEqual([{ command: 'assign_org_super_admin' }, { command: 'revoke_org_super_admin' }])
  })

  it('keeps the commands service-only and closes legacy, invitation and generic scope assignment paths', async () => {
    await db.exec('set role authenticated')
    await expect(assigned()).rejects.toMatchObject({ code: '42501' })
    await expect(setAssigned(true, false)).rejects.toMatchObject({ code: '42501' })
    await db.exec('reset role; set role service_role')

    await expect(db.query('select public.admin_set_org_super_admin_v1($1, $2, $3, true, false)', [
      root, organization, candidate,
    ])).rejects.toMatchObject({ code: '42501' })
    const legacy = await db.query('select public.admin_get_org_super_admin_v1($1, $2, $3) as assigned', [
      root, organization, legacyAdministrator,
    ])
    expect(legacy.rows).toEqual([{ assigned: true }])

    const changeScope = 'select public.admin_set_role_scope_assignment_v1($1, $2, $3, $4, $5, $6, $7) as saved'
    for (const action of ['assign', 'revoke']) {
      await expect(db.query(changeScope, [root, organization, candidate, rootRole, 'org', organization, action]))
        .rejects.toMatchObject({ code: '42501' })
    }
    expect((await db.query(changeScope, [root, organization, candidate, salesRole, 'department', department, 'assign'])).rows)
      .toEqual([{ saved: true }])
    await expect(db.query('select public.admin_get_department_lead_access_v1($1, $2, $3)', [
      legacyAdministrator, organization, department,
    ])).rejects.toMatchObject({ code: '42501' })

    await db.exec('reset role')
    await expect(db.query(`
      insert into public.personnel_invitations(org_id, user_id, token_hash, role_ids, expires_at, created_by)
      values ($1, $2, 'test-invitation', array[$3]::uuid[], now() + interval '1 day', $4)
    `, [organization, candidate, rootRole, root])).rejects.toMatchObject({ code: '42501' })
  })
})

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveRolePermissions } from '@/lib/role-permission-resolution'

function readMigration(name: string) {
  return readFileSync(join(process.cwd(), 'supabase/migrations', name), 'utf8')
}

const baseRegistry = readMigration('20261021000005_permission_registry_lifecycle.sql')
const migration = readMigration('20261125065221_shipping_operator_role_parity.sql')
const org = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const secondOrg = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const suspendedOrg = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const operatorRoleId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const originalGrantTime = '2026-10-21T08:45:00Z'

function person(n: number) {
  return `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`
}

describe('F054 shipping operator role parity migration', () => {
  let db: PGlite

  beforeEach(async () => {
    db = new PGlite()
    await db.exec(`
      create table public.organizations (id uuid primary key, status text, settings jsonb default '{}');
      create table public.users (id uuid primary key, status text, login_enabled boolean);
      create table public.user_organizations (
        user_id uuid references public.users, org_id uuid references public.organizations,
        is_default boolean, status text, employment_status text, left_at timestamptz,
        primary key (user_id, org_id)
      );
      create unique index one_default on public.user_organizations (user_id) where is_default;
      create table public.roles (
        id uuid primary key default gen_random_uuid(), code text not null unique, name text not null,
        description text, permissions jsonb, sort_order integer
      );
      create table public.user_roles (
        user_id uuid references public.users, role_id uuid references public.roles,
        org_id uuid not null references public.organizations, scope_type text, scope_id uuid,
        granted_by uuid references public.users, granted_at timestamptz,
        primary key (user_id, role_id, scope_type, scope_id)
      );
      create table public.permission_points (
        id uuid primary key default gen_random_uuid(), code text not null unique, name text not null,
        description text, scope jsonb default '{}', created_at timestamptz default now()
      );
      create table public.user_permission_assignments (
        id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users,
        permission_point_id uuid not null references public.permission_points,
        org_id uuid not null references public.organizations, assigned_by uuid references public.users,
        assigned_at timestamptz, unique (user_id, permission_point_id, org_id)
      );
      insert into public.organizations (id, status) values
        ('${org}', 'active'), ('${secondOrg}', 'active'), ('${suspendedOrg}', 'suspended');
      insert into public.users (id, status, login_enabled) values
        ('${person(1)}', 'active', true), ('${person(2)}', 'active', true),
        ('${person(3)}', 'active', false), ('${person(4)}', 'inactive', true),
        ('${person(5)}', 'active', true), ('${person(6)}', 'active', true),
        ('${person(7)}', 'active', true), ('${person(8)}', 'active', true),
        ('${person(9)}', 'active', true);
      insert into public.user_organizations (user_id, org_id, is_default, status, employment_status, left_at) values
        ('${person(1)}', '${org}', true, 'active', 'active', null),
        ('${person(2)}', '${org}', false, 'active', 'active', null),
        ('${person(2)}', '${secondOrg}', true, 'active', 'active', null),
        ('${person(3)}', '${org}', true, 'active', 'active', null),
        ('${person(4)}', '${org}', true, 'active', 'active', null),
        ('${person(5)}', '${org}', true, 'inactive', 'active', null),
        ('${person(6)}', '${org}', true, 'active', 'ended', null),
        ('${person(7)}', '${org}', true, 'active', 'active', now()),
        ('${person(8)}', '${suspendedOrg}', true, 'active', 'active', null);
    `)
    await db.exec(baseRegistry)
  })

  afterEach(async () => {
    await db.close()
  })

  async function addDirect(userId: string, orgId = org, key = 'shipping:operate') {
    await db.query(`
      insert into public.user_permission_assignments (user_id, org_id, permission_point_id, assigned_by, assigned_at)
      select $1, $2, id, $3, $4 from public.permission_points where code = $5
    `, [userId, orgId, person(1), originalGrantTime, key])
  }

  async function addExistingRole(permissions: string[] = ['shipping:operate']) {
    await db.query(`
      insert into public.roles (id, code, name, description, permissions, sort_order)
      values ($1, 'SHIPPING_OPERATOR', '现有操作员', '保留已有角色资料', $2::jsonb, 12)
    `, [operatorRoleId, JSON.stringify(permissions)])
  }

  async function directGrants() {
    const { rows } = await db.query(`
      select direct.user_id, direct.org_id, point.code
      from public.user_permission_assignments as direct
      join public.permission_points as point on point.id = direct.permission_point_id
      order by point.code, direct.user_id, direct.org_id
    `)
    return rows
  }

  async function bindings() {
    const { rows } = await db.query(`
      select user_id, org_id, role_id, scope_type, scope_id, granted_by, granted_at
      from public.user_roles order by user_id, org_id, role_id
    `)
    return rows
  }

  async function lifecycle(key = 'shipping:operate') {
    const { rows } = await db.query(`
      select version.lifecycle_version, version.status, version.snapshot->'scopeTypes' as scopes,
        version.snapshot->>'enforcementConsumer' as consumer
      from public.permission_point_versions as version
      join public.permission_points as point on point.id = version.permission_point_id
      where point.code = $1 order by version.lifecycle_version
    `, [key])
    return rows
  }

  it('converts only active same-organization grants, keeps original metadata and preserves other direct assignments', async () => {
    await addDirect(person(1))
    await addDirect(person(2))
    await addDirect(person(1), org, 'shipping:manage_connections')
    const rejected = [
      [person(1), secondOrg], [person(3), org], [person(4), org], [person(5), org],
      [person(6), org], [person(7), org], [person(8), suspendedOrg], [person(9), org],
    ]
    for (const [userId, orgId] of rejected) await addDirect(userId, orgId)

    await db.exec(migration)

    const { rows: roles } = await db.query<{ id: string; code: string; permissions: unknown }>(`
      select id, code, permissions from public.roles where code = 'SHIPPING_OPERATOR'
    `)
    expect(roles).toHaveLength(1)
    expect(resolveRolePermissions({}, roles[0]).permissions).toEqual(['shipping:operate'])
    expect(await bindings()).toEqual([person(1), person(2)].map(userId => ({
      user_id: userId, org_id: org, role_id: roles[0].id, scope_type: 'org', scope_id: org,
      granted_by: person(1), granted_at: new Date(originalGrantTime),
    })))
    expect(await directGrants()).toEqual([
      { user_id: person(1), org_id: org, code: 'shipping:manage_connections' },
      ...rejected.map(([userId, orgId]) => ({ user_id: userId, org_id: orgId, code: 'shipping:operate' })),
    ])
    expect(await lifecycle()).toEqual([
      { lifecycle_version: 1, status: 'published', scopes: ['org', 'department'], consumer: 'lib/shipping/operator-access.ts#requireShippingOperator' },
      { lifecycle_version: 2, status: 'published', scopes: ['org'], consumer: 'lib/shipping/operator-access.ts#requireShippingOperator' },
    ])
    expect(await lifecycle('shipping:*')).toEqual([
      { lifecycle_version: 1, status: 'published', scopes: ['org', 'department', 'space', 'self'], consumer: 'lib/permissions.ts#hasPermission' },
      { lifecycle_version: 2, status: 'published', scopes: ['org'], consumer: 'lib/permissions.ts#hasPermission' },
    ])
    expect((await db.query("select supported_scope_types from public.permission_points where code = 'shipping:*'")).rows)
      .toEqual([{ supported_scope_types: ['org'] }])
  })

  it('preserves the already-installed role and binding, and repeated execution leaves one new snapshot', async () => {
    await addExistingRole()
    await db.exec(`
      insert into public.user_roles values ('${person(1)}', '${operatorRoleId}', '${org}', 'org', '${org}', null, '2026-11-01T00:00:00Z')
    `)
    const before = await bindings()

    await db.exec(migration)
    await addDirect(person(1))
    await db.exec(migration)
    await db.exec(migration)

    expect(await bindings()).toEqual(before)
    expect(await directGrants()).toEqual([])
    expect(await lifecycle()).toHaveLength(2)
    expect(await lifecycle('shipping:*')).toHaveLength(2)
    expect((await db.query('select name, sort_order from public.roles where code = $1', ['SHIPPING_OPERATOR'])).rows)
      .toEqual([{ name: '现有操作员', sort_order: 12 }])
  })

  it.each([
    { override: [] }, { override: ['*'] },
    { override: ['shipping:operate', 'shipping:manage_connections'] }, { override: 'invalid override' },
  ])(
    'rolls back the entire conversion and the lifecycle update for a conflicting override $override',
    async ({ override }) => {
      await addExistingRole()
      await addDirect(person(1))
      await addDirect(person(2), secondOrg)
      const direct = await directGrants()
      await db.query('update public.organizations set settings = $1::jsonb where id = $2', [
        JSON.stringify({ role_permission_overrides: { [operatorRoleId]: override } }), secondOrg,
      ])

      await expect(db.exec(migration)).rejects.toThrow('conflicts with an organization role override')
      await db.exec('rollback')

      expect(await directGrants()).toEqual(direct)
      expect(await bindings()).toEqual([])
      expect(await lifecycle()).toHaveLength(1)
    },
  )

  it('preserves a pre-existing conflicting role scope and its source grant if role readback cannot prove parity', async () => {
    await addExistingRole()
    await addDirect(person(1))
    await db.exec(`
      insert into public.user_roles values ('${person(1)}', '${operatorRoleId}', '${secondOrg}', 'org', '${org}', null, now())
    `)
    const before = await bindings()

    await expect(db.exec(migration)).rejects.toThrow('could not verify every exact organization role')
    await db.exec('rollback')

    expect(await bindings()).toEqual(before)
    expect(await directGrants()).toHaveLength(1)
    expect(await lifecycle()).toHaveLength(1)
  })

  it('does not change an existing unusually broad role template or move its direct grants', async () => {
    await addExistingRole(['shipping:operate', 'shipping:manage_connections'])
    await addDirect(person(1))

    await expect(db.exec(migration)).rejects.toThrow('dedicated role to contain only shipping:operate')
    await db.exec('rollback')

    expect(await bindings()).toEqual([])
    expect(await directGrants()).toHaveLength(1)
    expect(await lifecycle()).toHaveLength(1)
  })

  it('does not enable a disabled definition with or without legacy grants', async () => {
    await db.exec(`update public.permission_points set status = 'disabled' where code = 'shipping:operate'`)
    await expect(db.exec(migration)).rejects.toThrow('requires the published organization-only permission definition')
    await db.exec('rollback')
    await addDirect(person(1))

    await expect(db.exec(migration)).rejects.toThrow('requires the published organization-only permission definition')
    await db.exec('rollback')

    const { rows } = await db.query(`select status from public.permission_points where code = 'shipping:operate'`)
    expect(rows).toEqual([{ status: 'disabled' }])
    expect(await directGrants()).toHaveLength(1)
    expect(await bindings()).toEqual([])
    expect(await lifecycle()).toHaveLength(1)
  })

  it('fails atomically if a noncanonical published definition cannot be migrated and there are zero legacy grants', async () => {
    await db.exec(`update public.permission_points set enforcement_consumer = 'retired-consumer' where code = 'shipping:operate'`)
    await expect(db.exec(migration)).rejects.toThrow('requires the published organization-only permission definition')
    await db.exec('rollback')

    expect(await directGrants()).toEqual([])
    expect(await bindings()).toEqual([])
    expect(await lifecycle()).toHaveLength(1)
    const { rows } = await db.query(`select code from public.roles where code = 'SHIPPING_OPERATOR'`)
    expect(rows).toEqual([])
  })
})

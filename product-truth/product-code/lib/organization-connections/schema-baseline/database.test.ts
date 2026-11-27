// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { baseline, preCutoverBaseline, productionSchemaDatabase, connectionMigration, directoryMigration } from './database'
import { canonical } from '../../../scripts/organization-schema-gate.mjs'

const org = 'aaaaaaaa-0000-4000-8000-000000000001'
const person = 'aaaaaaaa-0000-4000-8000-000000000002'
const department = 'aaaaaaaa-0000-4000-8000-000000000003'
const child = 'aaaaaaaa-0000-4000-8000-000000000004'
const membership = 'aaaaaaaa-0000-4000-8000-000000000005'
async function seed(db: Awaited<ReturnType<typeof productionSchemaDatabase>>) {
  await db.exec(`
    insert into public.organizations(id,name) values ('${org}','Test company');
    insert into public.users(id,org_id,display_name) values ('${person}','${org}','Test employee');
    insert into public.departments(id,org_id,name) values ('${department}','${org}','Test department');
  `)
}

describe('production DDL database gates', () => {
  it('reconstructs production tables, constraints, indexes, functions, triggers, policies and grants from one captured source', async () => {
    const db = await productionSchemaDatabase()
    try {
      const actual = (await db.query<{ catalog: typeof baseline.catalog }>(readFileSync(join(process.cwd(), 'lib/organization-connections/schema-baseline/capture.sql'), 'utf8'))).rows[0].catalog
      // PGlite has a different engine/bootstrap superuser. Release lane uses native 17.6 + the actual non-superuser deployment role.
      if (!process.env.ORGANIZATION_TEST_DATABASE_URL) {
        actual.serverVersion = baseline.catalog.serverVersion
        actual.roles = actual.roles.map((r: { name: string }) => r.name === 'postgres' ? baseline.catalog.roles.find((b: { name: string }) => b.name === 'postgres') : r)
        // PostgreSQL 18 also lists NOT NULL in pg_constraint. PostgreSQL 17 stores it in pg_attribute.
        // Verify each extra entry is represented by the same column flag before removing only that duplicate representation.
        for (const table of actual.tables) {
          for (const constraint of table.constraints.filter((c: { type: string }) => c.type === 'n')) {
            expect(table.columns.some((column: { name: string; notNull: boolean }) => column.notNull && constraint.definition === `NOT NULL ${column.name}`)).toBe(true)
          }
          table.constraints = table.constraints.filter((c: { type: string }) => c.type !== 'n')
        }
      }
      expect(canonical(actual)).toEqual(canonical(baseline.catalog))
    } finally { await db.close() }
  }, 15_000)

  it('reads synced members, renamed roles and first-login assignments through the rebuilt directory', async () => {
    const db = await productionSchemaDatabase()
    const pendingPerson = 'aaaaaaaa-0000-4000-8000-000000000006'
    const pendingMembership = 'aaaaaaaa-0000-4000-8000-000000000007'
    const roleId = 'aaaaaaaa-0000-4000-8000-000000000008'
    const source = 'aaaaaaaa-0000-4000-8000-000000000009'
    const personIdentity = 'aaaaaaaa-0000-4000-8000-000000000010'
    const pendingIdentity = 'aaaaaaaa-0000-4000-8000-000000000011'
    try {
      await seed(db)
      await db.exec(`
        insert into public.users (id, org_id, display_name, status, login_enabled)
          values ('${pendingPerson}', '${org}', 'Pending member', 'inactive', false);
        insert into public.user_organizations (user_id, org_id, membership_id, status, is_default)
          values ('${person}', '${org}', '${membership}', 'active', true),
                 ('${pendingPerson}', '${org}', '${pendingMembership}', 'invited', true);
        insert into public.user_departments (user_id, department_id, org_id, is_primary)
          values ('${person}', '${department}', '${org}', true);
        insert into public.roles (id, code, name, owner_org_id)
          values ('${roleId}', 'DIRECTORY_FIXTURE', 'Original role name', '${org}');
        insert into private.org_role_metadata (org_id, role_id, name, role_revision)
          values ('${org}', '${roleId}', 'Renamed role', 1);
        insert into public.user_roles (user_id, org_id, role_id, scope_type, scope_id)
          values ('${person}', '${org}', '${roleId}', 'org', '${org}');
        insert into public.organization_sources (
          id, system_org_id, provider, external_tenant_id, priority, status, authority_scope, connection_state, effective_revision
        ) values ('${source}', '${org}', 'fxiaoke', 'directory-fixture', 1, 'active',
          '{"identity":"authoritative","directory":"authoritative"}', 'verified', gen_random_uuid());
        insert into public.external_identities (
          id, source_id, system_org_id, external_user_id, canonical_user_id, match_status, profile_snapshot
        ) values
          ('${personIdentity}', '${source}', '${org}', 'linked-member', '${person}', 'matched', '{"status":"active"}'),
          ('${pendingIdentity}', '${source}', '${org}', 'pending-member', '${pendingPerson}', 'matched',
            jsonb_build_object('status', 'active', 'provisionedMemberId', '${pendingPerson}'::text));
        insert into public.fxiaoke_pending_org_roles (org_id, user_id, role_id, source_id, external_identity_id, external_user_id)
          values ('${org}', '${pendingPerson}', '${roleId}', '${source}', '${pendingIdentity}', 'pending-member');
        set role service_role;
        set search_path = '';
      `)

      const readDirectory = () => db.query<{ payload: unknown }>(
        'select public.get_org_admin_directory_payload_v2($1) as payload', [org],
      )
      const { rows: [{ payload }] } = await readDirectory()
      expect(payload).toMatchObject({
        roles: [{ id: roleId, name: 'Renamed role' }],
        users: expect.arrayContaining([
          expect.objectContaining({
            id: person, directory_external_id: 'linked-member', department_ids: [department],
            role_ids: [roleId], role_names: 'Renamed role',
          }),
          expect.objectContaining({
            id: pendingPerson, can_preassign_org_roles: true,
            pending_org_roles: [expect.objectContaining({ id: roleId, name: 'Renamed role' })],
          }),
        ]),
      })
      await expect(db.query('select private.get_org_admin_before_owned_roles_v1($1)', [org]))
        .rejects.toMatchObject({ code: '42501' })

      for (const role of ['anon', 'authenticated']) {
        await db.exec(`set role ${role};`)
        await expect(readDirectory()).rejects.toMatchObject({ code: '42501' })
      }
    } finally { await db.close() }
  }, 15_000)

  it('rejects an omitted membership ID and accepts an explicit ID under the production constraint and service role', async () => {
    const db = await productionSchemaDatabase()
    try {
      await seed(db)
      await db.exec('set role service_role;')
      await expect(db.query(`insert into public.user_organizations(user_id,org_id) values ('${person}','${org}')`))
        .rejects.toMatchObject({ code: '23502', column: 'membership_id' })
      await db.exec(`insert into public.user_organizations(membership_id,user_id,org_id) values ('${membership}','${person}','${org}');`)
      expect((await db.query(`select membership_id from public.user_organizations`)).rows).toEqual([{ membership_id: membership }])
    } finally { await db.close() }
  }, 15_000)

  it('reproduces the old trigger failure and validates both repaired triggers in a hostile schema under the application role', async () => {
    const db = await productionSchemaDatabase(preCutoverBaseline)
    try {
      await seed(db)
      await db.exec("set search_path = '';")
      await expect(db.query(`insert into public.departments(id,org_id,name,parent_id) values ('${child}','${org}','Child','${department}')`))
        .rejects.toMatchObject({ code: '42P01' })
      await db.exec('set search_path = public;')
      await db.exec(connectionMigration)
      await db.exec(directoryMigration)
      await db.exec(`
        create schema hostile;
        create table hostile.departments (id uuid, path text, depth integer, member_count integer);
        insert into hostile.departments values ('${department}','/wrong/',99,100);
        grant usage on schema hostile to service_role;
        grant all on hostile.departments to service_role;
        set role service_role;
        set search_path = hostile;
        insert into public.user_organizations(membership_id,user_id,org_id) values ('${membership}','${person}','${org}');
        insert into public.departments(id,org_id,name,parent_id) values ('${child}','${org}','Child','${department}');
        insert into public.user_departments(user_id,department_id,org_id) values ('${person}','${child}','${org}');
      `)
      expect((await db.query(`select path,depth,member_count from public.departments where id='${child}'`)).rows)
        .toEqual([{ path: `/${department}/${child}/`, depth: 1, member_count: 1 }])
      await db.exec(`delete from public.user_departments where user_id='${person}';`)
      expect((await db.query(`select member_count from public.departments where id='${child}'`)).rows).toEqual([{ member_count: 0 }])
      expect((await db.query('select path,depth,member_count from hostile.departments')).rows).toEqual([{ path: '/wrong/', depth: 99, member_count: 100 }])
    } finally { await db.close() }
  }, 15_000)

  it('rolls back all migration DDL on a conflicting legacy tenant and leaves native data intact', async () => {
    const db = await productionSchemaDatabase(preCutoverBaseline)
    try {
      await seed(db)
      await db.exec(`
        insert into public.organization_sources(system_org_id,provider,external_tenant_id,priority,status) values ('${org}','fxiaoke','other-ea',100,'disabled');
        insert into public.organization_fxiaoke_connections(system_org_id,app_id,expected_ea,api_user_id,credentials_ciphertext,updated_by)
          values ('${org}','fixture','expected-ea','fixture','v1.fixture','${person}');
      `)
      await expect(db.exec(connectionMigration)).rejects.toThrow('enterprise does not match')
      await db.exec('rollback;')
      expect((await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='organization_sources' and column_name='configuration_revision'")).rows).toEqual([])
      expect((await db.query(`select name from public.departments where id='${department}'`)).rows).toEqual([{ name: 'Test department' }])
    } finally { await db.close() }
  }, 15_000)

  it('does not expose the directory write RPCs or audit tables to browser database roles', async () => {
    const db = await productionSchemaDatabase()
    try {
      await db.exec(connectionMigration)
      await db.exec(directoryMigration)
      for (const role of ['anon', 'authenticated']) {
        await db.exec(`set role ${role};`)
        await expect(db.query(`select public.apply_organization_directory_cutover_v1('${org}','${org}','hash','${org}','{}','${person}')`)).rejects.toMatchObject({ code: '42501' })
        await expect(db.query('select * from public.organization_directory_cutover_plans')).rejects.toMatchObject({ code: '42501' })
        await db.exec('set role postgres;')
      }
    } finally { await db.close() }
  }, 15_000)

  it('rolls back the directory migration, including trigger replacement, when existing department keys conflict', async () => {
    const db = await productionSchemaDatabase(preCutoverBaseline)
    try {
      await seed(db)
      await db.exec(connectionMigration)
      await db.exec(`insert into public.departments(org_id,name,source,external_id) values
        ('${org}','First','feishu','duplicate'),('${org}','Second','feishu','duplicate');`)
      const before = (await db.query("select pg_get_functiondef('public.update_department_path()'::regprocedure) as definition")).rows
      await expect(db.exec(directoryMigration)).rejects.toMatchObject({ code: '23505' })
      await db.exec('rollback;')
      expect((await db.query("select pg_get_functiondef('public.update_department_path()'::regprocedure) as definition")).rows).toEqual(before)
      expect((await db.query("select to_regclass('public.organization_directory_cutover_plans') as plans")).rows).toEqual([{ plans: null }])
      expect((await db.query("select count(*)::integer as n from public.departments where external_id='duplicate'")).rows).toEqual([{ n: 2 }])
    } finally { await db.close() }
  }, 15_000)
})

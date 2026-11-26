// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, expect, it } from 'vitest'

const migration = (name: string) => readFileSync(join(process.cwd(), 'supabase/migrations', name), 'utf8')
const actionRegistration = migration('20261125171808_shipping_permission_actions.sql')
const departmentPermissions = migration('20261126052146_department_shipping_permission_grants.sql')
const org = '11111111-1111-4111-8111-111111111111'
const otherOrg = '22222222-2222-4222-8222-222222222222'
const root = '33333333-3333-4333-8333-333333333333'
const department = '44444444-4444-4444-8444-444444444444'
const otherDepartment = '55555555-5555-4555-8555-555555555555'
const operator = '66666666-6666-4666-8666-666666666666'
const sibling = '77777777-7777-4777-8777-777777777777'
const point = 'shipping:ledger_view'
const none = { permissions: [], include_subdepartments: false }
const direct = { permissions: [point], include_subdepartments: false }
const inherited = { permissions: [point], include_subdepartments: true }
let db: PGlite

beforeEach(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema private;
    create table public.organizations (id uuid primary key, settings jsonb, status text default 'active');
    create table public.departments (id uuid primary key, org_id uuid references public.organizations(id), status text default 'active');
    create table public.actors (id uuid primary key, current_org_id uuid, system_root boolean, active boolean default true);
    create table public.permission_points (
      id uuid primary key default gen_random_uuid(), code text unique, name text, description text,
      resource text, action text, kind text, status text, category text, semantic_version text,
      lifecycle_version integer, supported_scope_types text[], dependencies text[], conflicts text[],
      implied_by text[], enforcement_consumer text, published_at timestamptz, updated_at timestamptz
    );
    create table public.permission_point_versions (
      permission_point_id uuid references public.permission_points(id), semantic_version text,
      lifecycle_version integer, snapshot jsonb, status text, published_at timestamptz,
      primary key (permission_point_id, lifecycle_version)
    );
    create function private.personnel_lock_org_v1(uuid) returns void language sql
      as $$ select pg_advisory_xact_lock(hashtextextended($1::text, 0)) $$;
    create function private.personnel_is_org_control_admin_v1(uuid, uuid) returns boolean language sql stable
      as $$ select exists (
        select 1 from public.actors join public.organizations on organizations.id = actors.current_org_id
        where actors.id = $1 and organizations.id = $2 and organizations.status = 'active'
          and actors.active and actors.system_root
      ) $$;
    insert into public.organizations (id, settings) values ('${org}', '{"unrelated":{"value":7}}'), ('${otherOrg}', null);
    insert into public.departments (id, org_id) values ('${department}', '${org}'), ('${sibling}', '${org}'), ('${otherDepartment}', '${otherOrg}');
    insert into public.actors (id, current_org_id, system_root) values ('${root}', '${org}', true), ('${operator}', '${org}', false);
  `)
  await db.exec(actionRegistration)
  await db.exec(departmentPermissions)
})

afterEach(async () => db.close())

type Grant = { permissions: string[]; include_subdepartments: boolean }

async function read(departmentId = department, actor = root) {
  const result = await db.query<{ state: Grant }>('select public.admin_get_department_permissions_v1($1, $2, $3) as state', [
    actor, org, departmentId,
  ])
  return result.rows[0].state
}

async function save(desired: Grant, expected: Grant, options: { actor?: string; departmentId?: string; expectedOrg?: string } = {}) {
  const result = await db.query<{ state: Grant }>(
    'select public.admin_set_department_permissions_v1($1, $2, $3, $4, $5, $6, $7, $8) as state', [
      options.actor ?? root, org, options.departmentId ?? department, options.expectedOrg ?? org,
      expected.permissions, expected.include_subdepartments, desired.permissions, desired.include_subdepartments,
    ],
  )
  return result.rows[0].state
}

it('publishes one compatibility-preserving scope change with a new historical version', async () => {
  const ledger = await db.query('select semantic_version, lifecycle_version, supported_scope_types from public.permission_points where code = $1', [point])
  expect(ledger.rows).toEqual([{ semantic_version: '1.1.0', lifecycle_version: 2, supported_scope_types: ['org', 'department'] }])
  const versions = await db.query(`
    select snapshot->'scopeTypes' as scopes from public.permission_point_versions
    where snapshot->>'key' = $1 order by lifecycle_version
  `, [point])
  expect(versions.rows).toEqual([{ scopes: ['org'] }, { scopes: ['org', 'department'] }])
  const widened = await db.query("select code from public.permission_points where 'department' = any(supported_scope_types)")
  expect(widened.rows).toEqual([{ code: point }])
})

it('defaults to zero, compares both submitted baseline fields and preserves unrelated organization settings', async () => {
  expect(await read()).toEqual(none)
  expect(await save(direct, none)).toEqual(direct)
  await expect(save(inherited, none)).rejects.toMatchObject({ code: '40001' })
  expect(await save(inherited, direct)).toEqual(inherited)
  await expect(save(none, direct)).rejects.toMatchObject({ code: '40001' })
  expect(await save(direct, none, { departmentId: sibling })).toEqual(direct)
  expect(await save(none, inherited)).toEqual(none)
  expect(await read()).toEqual(none)
  expect(await read(sibling)).toEqual(direct)

  const receipt = await db.query('select settings from public.organizations where id = $1', [org])
  expect(receipt.rows).toEqual([{ settings: { unrelated: { value: 7 }, department_permission_grants: { [sibling]: direct } } }])
})

it('enforces exact organization, current root authority, active department and service-only grants', async () => {
  await expect(save(direct, none, { expectedOrg: otherOrg })).rejects.toMatchObject({ code: '40001' })
  await expect(save(direct, none, { actor: operator })).rejects.toMatchObject({ code: '42501' })
  await expect(read(department, operator)).rejects.toMatchObject({ code: '42501' })
  await expect(save(direct, none, { departmentId: otherDepartment })).rejects.toMatchObject({ code: 'P0002' })
  await db.query("update public.departments set status = 'inactive' where id = $1", [department])
  await expect(save(direct, none)).rejects.toMatchObject({ code: 'P0002' })
  await db.query('update public.actors set current_org_id = $2 where id = $1', [root, otherOrg])
  await expect(save(direct, none)).rejects.toMatchObject({ code: '42501' })

  const acl = await db.query(`
    select has_function_privilege('anon', rf, 'execute') as anon,
      has_function_privilege('authenticated', rf, 'execute') as authenticated,
      has_function_privilege('service_role', rf, 'execute') as service_role
    from unnest(array[
      'public.admin_get_department_permissions_v1(uuid,uuid,uuid)',
      'public.admin_set_department_permissions_v1(uuid,uuid,uuid,uuid,text[],boolean,text[],boolean)'
    ]) as functions(rf)
  `)
  expect(acl.rows).toEqual([
    { anon: false, authenticated: false, service_role: true },
    { anon: false, authenticated: false, service_role: true },
  ])
})

it('permits removal of a persisted unpublished permission and never accepts other actions or wildcards', async () => {
  await expect(save({ ...direct, permissions: ['shipping:*'] }, none)).rejects.toMatchObject({ code: '22023' })
  await expect(save({ ...direct, permissions: ['shipping:record_review'] }, none)).rejects.toMatchObject({ code: '22023' })
  await expect(save({ ...direct, permissions: [point, point] }, none)).rejects.toMatchObject({ code: '22023' })
  await expect(save({ ...none, include_subdepartments: true }, none)).rejects.toMatchObject({ code: '22023' })
  await save(inherited, none)
  await db.query("update public.permission_points set status = 'disabled' where code = $1", [point])
  expect(await read()).toEqual(inherited)
  await expect(save(direct, inherited)).rejects.toMatchObject({ code: '23514' })
  expect(await save(none, inherited)).toEqual(none)
  await expect(save(direct, none)).rejects.toMatchObject({ code: '23514' })
})

it('matches the published department scope independent of registry order', async () => {
  await db.query("update public.permission_points set supported_scope_types = array['department', 'org'] where code = $1", [point])
  expect(await save(direct, none)).toEqual(direct)
})

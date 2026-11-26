// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, expect, it } from 'vitest'

const migration = (name: string) => readFileSync(join(process.cwd(), 'supabase/migrations', name), 'utf8')
const lifecycle = migration('20261021000006_personnel_lifecycle_commands.sql')
const existingTransfer = lifecycle.slice(
  lifecycle.indexOf('create or replace function public.admin_transfer_primary_department_v1('),
  lifecycle.indexOf('create or replace function public.admin_set_reporting_manager_v1('),
)
const guard = migration('20261126053054_guard_manual_department_ledger_membership.sql')
const org = '11111111-1111-4111-8111-111111111111'
const otherOrg = '22222222-2222-4222-8222-222222222222'
const root = '33333333-3333-4333-8333-333333333333'
const editor = '44444444-4444-4444-8444-444444444444'
const person = '55555555-5555-4555-8555-555555555555'
const invite = '66666666-6666-4666-8666-666666666666'
const authorized = '77777777-7777-4777-8777-777777777777'
const ordinary = '88888888-8888-4888-8888-888888888888'
const otherDept = '99999999-9999-4999-8999-999999999999'
const denied = { code: '42501', detail: 'DEPARTMENT_LEDGER_MEMBERSHIP_FORBIDDEN' }

let db: PGlite
beforeEach(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema private;
    create table public.organizations (id uuid primary key, settings jsonb);
    create table public.users (
      id uuid primary key, org_id uuid, primary_dept_id uuid, status text default 'active', updated_at timestamptz,
      email text, phone text, display_name text check (display_name <> 'reject update'), title text,
      report_to_user_id uuid, login_enabled boolean default true
    );
    create table public.user_organizations (
      user_id uuid, org_id uuid, primary_department_id uuid, status text,
      employment_status text default 'active', membership_version integer default 1, updated_at timestamptz,
      primary key (user_id, org_id)
    );
    create table public.departments (id uuid primary key, org_id uuid, parent_id uuid);
    create table public.user_departments (
      user_id uuid, department_id uuid, org_id uuid, is_primary boolean default false,
      source text default 'manual', primary key (user_id, department_id)
    );
    create table public.sales_spaces (id uuid primary key, department_id uuid, org_id uuid);
    create table public.sales_space_members (space_id uuid, user_id uuid, org_id uuid, space_role text, primary key (space_id, user_id));
    create table public.personnel_employment_periods (user_id uuid, department_id uuid, org_id uuid, status text, updated_at timestamptz);
    create function private.personnel_lock_org_v1(uuid) returns void language sql
      as $$ select pg_advisory_xact_lock(hashtextextended($1::text, 0)) $$;
    create function private.personnel_is_org_control_admin_v1(uuid, uuid) returns boolean language sql stable
      as $$ select $1 = '${root}'::uuid and $2 = '${org}'::uuid $$;
    create function private.personnel_insert_event_v1(uuid, uuid, uuid, text, jsonb, jsonb, text, text)
      returns void language plpgsql as $$ begin return; end $$;
    insert into public.organizations values
      ('${org}', '{"department_permission_grants":{"${authorized}":{"permissions":["shipping:ledger_view"],"include_subdepartments":true}}}'),
      ('${otherOrg}', '{}');
    insert into public.departments (id, org_id, parent_id) values
      ('${authorized}', '${org}', null), ('${ordinary}', '${org}', '${authorized}'), ('${otherDept}', '${otherOrg}', null);
    insert into public.users (id, org_id, primary_dept_id, status) values
      ('${person}', '${org}', null, 'active'), ('${invite}', '${org}', '${authorized}', 'inactive');
    insert into public.user_organizations (user_id, org_id, status) values
      ('${person}', '${org}', 'active'), ('${invite}', '${org}', 'invited');
  `)
  await db.exec(existingTransfer)
  await db.exec(guard)
})

afterEach(async () => db.close())

async function change(
  departmentIds: string[], action: 'add' | 'remove' | 'initialize', actor = editor, target = person, currentOrg = org,
) {
  const result = await db.query<{ saved: boolean }>(
    'select public.admin_change_manual_department_membership_v1($1, $2, $3, $4, $5) as saved',
    [actor, currentOrg, target, departmentIds, action],
  )
  return result.rows[0].saved
}

async function transfer(departmentId: string | null, actor = editor) {
  const result = await db.query<{ saved: boolean }>(
    'select public.admin_transfer_primary_department_v1($1, $2, $3, $4) as saved',
    [actor, org, person, departmentId],
  )
  return result.rows[0].saved
}

async function memberships(target = person) {
  return (await db.query('select department_id, is_primary from public.user_departments where user_id = $1 order by department_id', [target])).rows
}

it('requires exact system authority for direct granted additions and revocations, preserving all-or-none', async () => {
  await expect(change([ordinary, authorized], 'add')).rejects.toMatchObject(denied)
  expect(await memberships()).toEqual([])
  expect(await change([ordinary], 'add')).toBe(true)
  expect(await change([authorized], 'remove')).toBe(true)
  expect(await change([authorized], 'add', root)).toBe(true)
  expect(await change([authorized], 'add')).toBe(true) // Already present, no change to authority.
  await expect(change([authorized], 'remove')).rejects.toMatchObject(denied)
  expect(await change([authorized], 'remove', root)).toBe(true)
  expect(await memberships()).toEqual([{ department_id: ordinary, is_primary: false }])
})

it('protects both old and new primary departments while retaining ordinary department moves', async () => {
  expect(await transfer(ordinary)).toBe(true)
  await expect(transfer(authorized)).rejects.toMatchObject(denied)
  expect(await memberships()).toEqual([{ department_id: ordinary, is_primary: true }])
  expect(await transfer(authorized, root)).toBe(true)
  expect(await transfer(authorized)).toBe(true)
  await expect(transfer(ordinary)).rejects.toMatchObject(denied)
  await expect(transfer(null)).rejects.toMatchObject(denied)
  expect(await transfer(ordinary, root)).toBe(true)
  expect(await transfer(null)).toBe(true)
  expect(await memberships()).toEqual([])
})

it('updates member fields with department transfer and rolls back a failed combination', async () => {
  const update = (departmentId: string, displayName: string, actor = editor) => db.query(
    'select public.admin_update_member_profile_and_primary_department_v1($1, $2, $3, $4, $5) as member',
    [actor, org, person, departmentId, JSON.stringify({ display_name: displayName, title: null })],
  )
  await expect(update(authorized, 'blocked')).rejects.toMatchObject(denied)
  await expect(update(ordinary, 'reject update')).rejects.toMatchObject({ code: '23514' })
  expect(await memberships()).toEqual([])
  expect((await db.query('select display_name, primary_dept_id from public.users where id = $1', [person])).rows)
    .toEqual([{ display_name: null, primary_dept_id: null }])
  const saved = await update(authorized, 'Updated', root)
  expect(saved.rows).toMatchObject([{ member: { display_name: 'Updated', primary_dept_id: authorized, id: person } }])
  expect(await memberships()).toEqual([{ department_id: authorized, is_primary: true }])
})

it('protects initial membership on invitation and preserves exact organization and eligible target', async () => {
  await expect(change([authorized], 'initialize', editor, invite)).rejects.toMatchObject(denied)
  expect(await memberships(invite)).toEqual([])
  expect(await change([ordinary], 'initialize', root, invite)).toBe(false)
  expect(await change([authorized], 'initialize', root, person)).toBe(false)
  expect(await change([authorized], 'initialize', root, invite, otherOrg)).toBe(false)
  expect(await change([otherDept], 'add', root)).toBe(false)
  expect(await change([authorized], 'initialize', root, invite)).toBe(true)
  expect(await memberships(invite)).toEqual([{ department_id: authorized, is_primary: true }])
})

it('keeps authoritative directory link writes separate and restricts manual RPC execution', async () => {
  await db.query("insert into public.user_departments values ($1, $2, $3, false, 'fxiaoke')", [person, authorized, org])
  expect(await memberships()).toEqual([{ department_id: authorized, is_primary: false }])
  await expect(change([authorized], 'remove')).rejects.toMatchObject(denied)
  const grants = await db.query(`
    select has_function_privilege('authenticated', 'public.admin_change_manual_department_membership_v1(uuid,uuid,uuid,uuid[],text)', 'execute') as authenticated,
      has_function_privilege('service_role', 'private.admin_transfer_primary_department_v1(uuid,uuid,uuid,uuid,text,text)', 'execute') as old_delegate
  `)
  expect(grants.rows).toEqual([{ authenticated: false, old_delegate: false }])
})

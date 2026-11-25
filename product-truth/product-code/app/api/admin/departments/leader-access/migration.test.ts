import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20261125051750_department_lead_access.sql'), 'utf8')
const org = '11111111-1111-4111-8111-111111111111'
const otherOrg = '22222222-2222-4222-8222-222222222222'
const root = '33333333-3333-4333-8333-333333333333'
const lead = '44444444-4444-4444-8444-444444444444'
const outsider = '55555555-5555-4555-8555-555555555555'
const rootRole = '66666666-6666-4666-8666-666666666666'
const east = '77777777-7777-4777-8777-777777777777'
const south = '88888888-8888-4888-8888-888888888888'
const elsewhere = '99999999-9999-4999-8999-999999999999'

describe('department leader access SQL migration', () => {
  let db: PGlite

  beforeEach(async () => {
    db = new PGlite()
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema private;
      create table public.organizations (
        id uuid primary key, settings jsonb default '{}', status text not null default 'active'
      );
      create table public.users (
        id uuid primary key, status text not null default 'active', login_enabled boolean not null default true
      );
      create table public.user_organizations (
        user_id uuid references public.users(id), org_id uuid references public.organizations(id),
        is_default boolean not null default true, status text not null default 'active',
        employment_status text not null default 'active', left_at timestamptz, primary key (user_id, org_id)
      );
      create table public.departments (
        id uuid primary key, org_id uuid references public.organizations(id), parent_id uuid,
        leader_id uuid, status text not null default 'active'
      );
      create table public.roles (id uuid primary key, code text unique not null);
      create table public.user_roles (
        user_id uuid, org_id uuid, role_id uuid references public.roles(id), scope_type text, scope_id uuid
      );
      create table public.events (
        org_id uuid, user_id uuid, actor_id uuid, command text, before_state jsonb, after_state jsonb, request_id text
      );
      create function private.personnel_lock_org_v1(uuid) returns void language sql
      as $$ select pg_advisory_xact_lock(hashtextextended($1::text, 0)) $$;
      create function private.personnel_insert_event_v1(uuid, uuid, uuid, text, jsonb, jsonb, text, text)
      returns void language sql as $$ insert into public.events values ($1, $2, $3, $4, $5, $6, $8) $$;
      insert into public.organizations (id) values ('${org}'), ('${otherOrg}');
      insert into public.users (id) values ('${root}'), ('${lead}'), ('${outsider}');
      insert into public.user_organizations (user_id, org_id) values
        ('${root}', '${org}'), ('${lead}', '${org}'), ('${outsider}', '${otherOrg}');
      insert into public.departments (id, org_id, leader_id) values
        ('${east}', '${org}', '${lead}'), ('${south}', '${org}', '${lead}'),
        ('${elsewhere}', '${otherOrg}', '${outsider}');
      insert into public.roles values ('${rootRole}', 'SUPER_ADMIN');
      insert into public.user_roles values ('${root}', '${org}', '${rootRole}', 'org', '${org}');
    `)
    await db.exec(migration)
  })

  afterEach(async () => db.close())

  async function get(actor = root, department = east) {
    const result = await db.query<{ data: { leaderId: string | null; userId: string | null } }>(
      'select public.admin_get_department_lead_access_v1($1, $2, $3) as data', [actor, org, department],
    )
    return result.rows[0].data
  }

  async function change(userId: string | null, expectedId: string | null, department = east, actor = root) {
    const result = await db.query<{ data: { status: string; userId: string | null } }>(
      'select public.admin_set_department_lead_access_v1($1, $2, $3, $4, $5, $6) as data',
      [actor, org, department, userId, expectedId, 'reviewed-department-lead'],
    )
    return result.rows[0].data
  }

  it('starts unconfirmed and accepts only reviewed current leads, with audited CAS and idempotent retries', async () => {
    expect(await get()).toEqual({ leaderId: lead, userId: null })
    await expect(change(lead, outsider)).rejects.toMatchObject({ code: '40001' })
    expect(await change(lead, null)).toEqual({ status: 'saved', userId: lead })
    expect(await change(lead, null)).toEqual({ status: 'unchanged', userId: lead })
    expect(await get()).toEqual({ leaderId: lead, userId: lead })
    await expect(change(null, outsider)).rejects.toMatchObject({ code: '40001' })
    expect(await change(null, lead)).toEqual({ status: 'saved', userId: null })
    expect(await change(null, lead)).toEqual({ status: 'unchanged', userId: null })

    const events = await db.query('select actor_id, user_id, command, before_state, after_state, request_id from public.events order by command')
    expect(events.rows).toEqual([
      { actor_id: root, user_id: lead, command: 'confirm_department_lead_access',
        before_state: { department_id: east, user_id: null }, after_state: { department_id: east, user_id: lead },
        request_id: 'reviewed-department-lead' },
      { actor_id: root, user_id: lead, command: 'revoke_department_lead_access',
        before_state: { department_id: east, user_id: lead }, after_state: { department_id: east, user_id: null },
        request_id: 'reviewed-department-lead' },
    ])
  })

  it('requires the effective root role and keeps target and department boundaries exact', async () => {
    await expect(get(lead)).rejects.toMatchObject({ code: '42501' })
    await expect(change(lead, null, east, lead)).rejects.toMatchObject({ code: '42501' })
    await expect(get(root, elsewhere)).rejects.toMatchObject({ code: 'P0002' })
    await expect(change(lead, null, elsewhere)).rejects.toMatchObject({ code: 'P0002' })
    await expect(change(outsider, null)).rejects.toMatchObject({ code: '23514' })
    await db.query('update public.departments set leader_id = $1 where id = $2', [outsider, east])
    await expect(change(outsider, null)).rejects.toMatchObject({ code: '23514' })
    await db.query('update public.user_roles set scope_id = $1 where user_id = $2', [otherOrg, root])
    await expect(get()).rejects.toMatchObject({ code: '42501' })
  })

  it('honors edited and malformed root rules, plus current actor membership', async () => {
    const setPermissions = (permissions: unknown) =>
      db.query('update public.organizations set settings = $1 where id = $2', [
        JSON.stringify({ role_permission_overrides: { [rootRole]: permissions } }), org,
      ])
    await setPermissions([])
    await expect(get()).rejects.toMatchObject({ code: '42501' })
    await setPermissions(['role:manage', null])
    await expect(change(lead, null)).rejects.toMatchObject({ code: '42501' })
    await setPermissions(['role:manage'])
    expect(await change(lead, null)).toEqual({ status: 'saved', userId: lead })
    await db.query('update public.user_organizations set is_default = false where user_id = $1', [root])
    await expect(change(null, lead)).rejects.toMatchObject({ code: '42501' })
  })

  it('clears stale confirmations without interfering with rename or reparent operations', async () => {
    await change(lead, null)
    await change(lead, null, south)
    await db.query('update public.departments set parent_id = $1 where id = $2', [east, south])
    expect(await get(root, south)).toEqual({ leaderId: lead, userId: lead })
    await db.query('update public.departments set leader_id = null where id = $1', [east])
    await db.query('update public.departments set leader_id = $1 where id = $2', [lead, east])
    expect(await get()).toEqual({ leaderId: lead, userId: null })
    await db.query("update public.user_organizations set employment_status = 'ended' where user_id = $1", [lead])
    await db.query("update public.user_organizations set employment_status = 'active' where user_id = $1", [lead])
    expect(await get(root, south)).toEqual({ leaderId: lead, userId: null })
    await change(lead, null, south)
    await db.query("update public.departments set status = 'inactive' where id = $1", [south])
    await expect(get(root, south)).rejects.toMatchObject({ code: 'P0002' })
    await db.query("update public.departments set status = 'active' where id = $1", [south])
    expect(await get(root, south)).toEqual({ leaderId: lead, userId: null })
  })

  it('exposes writes only through the service-role RPC', async () => {
    await db.exec('set role authenticated')
    await expect(get()).rejects.toMatchObject({ code: '42501' })
    await expect(db.query('select * from public.department_lead_access')).rejects.toMatchObject({ code: '42501' })
    await db.exec('reset role; set role service_role')
    expect((await db.query('select count(*) from public.department_lead_access')).rows).toEqual([{ count: 0 }])
    await expect(db.query('delete from public.department_lead_access')).rejects.toMatchObject({ code: '42501' })
    expect(await change(lead, null)).toEqual({ status: 'saved', userId: lead })
  })
})

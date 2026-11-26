// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, expect, it } from 'vitest'

const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20261126054800_guard_role_permission_edits.sql'), 'utf8')
const org = '11111111-1111-4111-8111-111111111111'
const otherOrg = '22222222-2222-4222-8222-222222222222'
const actor = '33333333-3333-4333-8333-333333333333'
const ordinary = '44444444-4444-4444-8444-444444444444'
const role = '55555555-5555-4555-8555-555555555555'
const rootRole = '66666666-6666-4666-8666-666666666666'
const baseline = '77777777-7777-4777-8777-777777777777'
const initialSettings = { locale: 'zh', role_permission_overrides: { [rootRole]: [], existing: ['quote:view'] } }
const template = ['quote:view']
let db: PGlite

beforeEach(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema private;
    create table public.organizations (id uuid primary key, settings jsonb, status text not null default 'active');
    create table public.roles (id uuid primary key, code text not null, permissions jsonb);
    create table public.live_system_admins (actor_id uuid, org_id uuid, primary key (actor_id, org_id));
    create function private.personnel_lock_org_v1(p_org_id uuid) returns void language sql
      as $$ select pg_advisory_xact_lock(hashtextextended(p_org_id::text, 0)) $$;
    create function private.assert_system_role_assignment_actor_v1(p_actor_id uuid, p_org_id uuid)
      returns void language plpgsql as $$
      begin
        perform private.personnel_lock_org_v1(p_org_id);
        if not exists (
          select 1 from public.live_system_admins where actor_id = p_actor_id and org_id = p_org_id
        ) then raise exception 'system super administrator required' using errcode = '42501'; end if;
      end;
      $$;
    insert into public.organizations (id, settings) values
      ('${org}', '${JSON.stringify(initialSettings)}'), ('${otherOrg}', null);
    insert into public.roles (id, code, permissions) values
      ('${role}', 'QUOTES', '["quote:view"]'), ('${rootRole}', 'SUPER_ADMIN', '["*"]'),
      ('${baseline}', 'FXIAOKE_BASELINE', '[]');
    insert into public.live_system_admins values ('${actor}', '${org}');
  `)
  await db.exec(migration)
})

afterEach(async () => db.close())

function save(options: {
  actorId?: string; orgId?: string; roleId?: string; expected?: unknown; expectedCode?: string;
  expectedTemplate?: string[]; permissions?: string[] | null; ownerPermissions?: string[] | null;
} = {}) {
  return db.query<{ status: string }>(
    'select public.admin_save_org_role_permissions_v1($1,$2,$3,$4,$5,$6,$7,$8) as status',
    [
      options.actorId ?? actor, options.orgId ?? org, options.roleId ?? role,
      options.expected === undefined ? initialSettings : options.expected,
      options.expectedCode ?? 'QUOTES', JSON.stringify(options.expectedTemplate ?? template),
      options.permissions === undefined ? ['quote:create'] : options.permissions, options.ownerPermissions ?? null,
    ],
  ).then(result => result.rows[0].status)
}

async function settings(orgId = org) {
  const result = await db.query<{ settings: unknown }>('select settings from public.organizations where id = $1', [orgId])
  return result.rows[0].settings
}

it('patches exactly the chosen role and keeps unrelated settings, definitions and organizations', async () => {
  expect(await save({ ownerPermissions: ['shipping:owner_view'] })).toBe('saved')
  const next = {
    ...initialSettings,
    role_permission_overrides: { ...initialSettings.role_permission_overrides, [role]: ['quote:create'] },
    shipping_owner_permission_overrides: { [role]: ['shipping:owner_view'] },
  }
  expect(await settings()).toEqual(next)
  expect(await settings(otherOrg)).toBeNull()
  expect((await db.query('select permissions from public.roles where id = $1', [role])).rows).toEqual([{ permissions: template }])

  expect(await save({ permissions: [], expected: next })).toBe('saved')
  expect(await settings()).toEqual({
    ...next, role_permission_overrides: { ...next.role_permission_overrides, [role]: [] },
  })
})

it('checks current authority before disclosing conflicts and rechecks unchanged saves', async () => {
  await expect(save({ actorId: ordinary, expected: {} })).rejects.toMatchObject({ code: '42501' })
  await expect(save({ orgId: otherOrg, expected: null })).rejects.toMatchObject({ code: '42501' })
  expect(await save({ permissions: null })).toBe('saved')
  await db.query('delete from public.live_system_admins where actor_id = $1', [actor])
  await expect(save({ permissions: null })).rejects.toMatchObject({ code: '42501' })
  expect(await settings()).toEqual(initialSettings)
})

it('rejects stale organization and template snapshots and attempts to bypass fixed definitions', async () => {
  expect(await save({ expected: {} })).toBe('conflict')
  expect(await save({ expectedTemplate: [] })).toBe('conflict')
  expect(await save({ roleId: rootRole, expectedCode: 'SUPER_ADMIN', expectedTemplate: ['*'] })).toBe('fixed_role')
  expect(await save({ roleId: baseline, expectedCode: 'FXIAOKE_BASELINE', expectedTemplate: [] })).toBe('fixed_role')
  await expect(save({ permissions: ['shipping:owner_view'] })).rejects.toMatchObject({ code: '22023' })
  await expect(save({ permissions: ['quote:view', 'quote:view'] })).rejects.toMatchObject({ code: '22023' })
  await expect(save({ ownerPermissions: ['shipping:owner_submit'] })).rejects.toMatchObject({ code: '22023' })
  expect(await settings()).toEqual(initialSettings)
})

it('only exposes the atomic save command to the server role', async () => {
  const result = await db.query(`
    select has_function_privilege('anon', command, 'execute') as anon,
      has_function_privilege('authenticated', command, 'execute') as authenticated,
      has_function_privilege('service_role', command, 'execute') as server
    from (values ('public.admin_save_org_role_permissions_v1(uuid,uuid,uuid,jsonb,text,jsonb,text[],text[])')) as commands(command)
  `)
  expect(result.rows).toEqual([{ anon: false, authenticated: false, server: true }])
})

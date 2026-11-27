// @vitest-environment node
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, expect, it } from 'vitest'

const org = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherOrg = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const actor = '11111111-1111-4111-8111-111111111111'
const user = '22222222-2222-4222-8222-222222222222'
const secondActor = '33333333-3333-4333-8333-333333333333'
const otherUser = '44444444-4444-4444-8444-444444444444'
const root = '55555555-5555-4555-8555-555555555555'
const dept = '66666666-6666-4666-8666-666666666666'
const reviewId = '77777777-7777-4777-8777-777777777777'
const otherReviewId = '88888888-8888-4888-8888-888888888888'
const lifecycle = '20261021000006_personnel_lifecycle_commands.sql'
const systemRole = '20261126045425_system_super_admin_authority.sql'
const orgRole = '20261125055213_organization_super_admin.sql'
const transfer = '20261127150000_confirmed_department_transfer.sql'
let db: PGlite

function migration(file: string) {
  return readFileSync('supabase/migrations/' + file, 'utf8')
}

function definition(file: string, name: string) {
  const sql = migration(file).match(new RegExp(`create (?:or replace )?function private\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, 'i'))
  if (!sql) throw new Error(`Missing SQL function ${name}`)
  return sql[0]
}

beforeEach(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema private;
    create table public.organizations (id uuid primary key, status text default 'active', settings jsonb);
    create table public.users (id uuid primary key, org_id uuid, status text default 'active', login_enabled boolean default true);
    create table public.user_organizations (
      org_id uuid, user_id uuid, status text default 'active', employment_status text default 'active',
      is_default bool default true, left_at timestamptz, primary key (user_id, org_id)
    );
    create table public.roles (id uuid primary key, code text, name text, owner_org_id uuid);
    create table public.user_roles (org_id uuid, user_id uuid, role_id uuid, scope_type text, scope_id uuid);
    create table public.departments (id uuid primary key, org_id uuid, name text);
    create table public.sales_spaces (id uuid primary key, org_id uuid, name text);
    create table public.personnel_lifecycle_events (
      org_id uuid, target_user_id uuid, actor_id uuid, command text, before_state jsonb,
      after_state jsonb, reason text, request_id text
    );
    create table private.employee_permission_overrides (
      org_id uuid, user_id uuid, permission_code text, effect text, scope jsonb
    );
    insert into public.organizations (id) values ('${org}'), ('${otherOrg}');
    insert into public.users (id, org_id) values
      ('${actor}', '${org}'), ('${user}', '${org}'), ('${secondActor}', '${org}'), ('${otherUser}', '${otherOrg}');
    insert into public.user_organizations (org_id, user_id) select org_id, id from public.users;
    insert into public.roles (id, code, name) values ('${root}', 'SUPER_ADMIN', '超级管理员');
    insert into public.user_roles values
      ('${org}', '${actor}', '${root}', 'org', '${org}'), ('${org}', '${secondActor}', '${root}', 'org', '${org}');
    insert into public.departments values ('${dept}', '${org}', '原部门');
    insert into private.employee_permission_overrides (org_id, user_id, permission_code, effect)
      values ('${org}', '${user}', 'shipping:ledger_view', 'DENY');
  `)
  for (const [file, name] of [
    [lifecycle, 'personnel_lock_org_v1'],
    [lifecycle, 'personnel_insert_event_v1'],
    [orgRole, 'has_exact_org_role_v1'],
    [orgRole, 'org_super_admin_active_member_v1'],
    [systemRole, 'system_super_admin_role_enabled_v1'],
    [systemRole, 'personnel_is_org_control_admin_v1'],
    [transfer, 'assert_member_department_transfer_actor_v1'],
  ]) await db.exec(definition(file, name))
  await db.exec(migration('20261127145000_department_change_authority.sql')
    .split('create function private.department_transfer_affiliations_v1')[0] + 'commit;')
  await db.exec(migration('20261127152000_department_transfer_review.sql'))

  const earlier = { permission_code: 'shipping:ledger_view', effect: 'ALLOW', scope: {
    type: 'department', departments: [{ department_id: dept, include_subdepartments: false }],
  }, private_fixture_field: 'not exposed' }
  await db.query(
    'insert into private.department_transfer_review_items(id,org_id,user_id,actor_id,effective_at,kind,previous_grant) values ($1,$2,$3,$4,now(),$5,$6)',
    [reviewId, org, user, actor, 'personal_override', earlier],
  )
  await db.query(
    'insert into private.department_transfer_review_items(id,org_id,user_id,actor_id,effective_at,kind,previous_grant) values ($1,$2,$3,$4,now(),$5,$6)',
    [otherReviewId, otherOrg, otherUser, actor, 'department_lead', { department_id: dept }],
  )
})

afterEach(async () => { await db.close() })

async function list(as = actor, target = user) {
  return (await db.query<{ items: unknown }>(
    'select public.list_member_department_transfer_reviews_v1($1,$2,$3) as items', [org, as, target],
  )).rows[0].items
}

async function acknowledge(id = reviewId, as = actor) {
  return (await db.query<{ applied: boolean }>(
    'select public.acknowledge_member_department_transfer_review_v1($1,$2,$3,$4,$5) as applied',
    [org, as, user, id, 'test-review'],
  )).rows[0].applied
}

it('lists sanitized pending items under service role and exact active organization authority', async () => {
  await db.exec('set role service_role')
  try {
    expect(await list()).toEqual([{
      review_id: reviewId, effective_at: expect.any(String), kind: 'personal_override',
      permission_code: 'shipping:ledger_view', effect: 'ALLOW',
      scope: { type: 'department', departments: [{ department_id: dept, include_subdepartments: false }] },
    }])
    await expect(list(user)).rejects.toMatchObject({ detail: 'DEPARTMENT_TRANSFER_REVIEW_FORBIDDEN' })
    await expect(list(actor, otherUser)).rejects.toMatchObject({ detail: 'DEPARTMENT_TRANSFER_REVIEW_NOT_FOUND' })
    await expect(acknowledge(otherReviewId)).rejects.toMatchObject({ detail: 'DEPARTMENT_TRANSFER_REVIEW_NOT_FOUND' })
  } finally {
    await db.exec('reset role')
  }
  await db.exec(`update public.user_organizations set status = 'ended' where user_id = '${user}'`)
  await expect(list()).rejects.toMatchObject({ detail: 'DEPARTMENT_TRANSFER_REVIEW_NOT_FOUND' })
  await expect(acknowledge()).rejects.toMatchObject({ detail: 'DEPARTMENT_TRANSFER_REVIEW_NOT_FOUND' })
})

it('preserves restrictions and writes exactly one audit event when acknowledging a pending item', async () => {
  await db.exec('set role service_role')
  try {
    expect(await acknowledge()).toBe(true)
    expect(await acknowledge()).toBe(true)
    await expect(acknowledge(reviewId, secondActor)).rejects.toMatchObject({ detail: 'DEPARTMENT_TRANSFER_REVIEW_STALE' })
    expect(await list()).toEqual([])
  } finally {
    await db.exec('reset role')
  }
  expect((await db.query('select effect,scope from private.employee_permission_overrides')).rows).toEqual([{ effect: 'DENY', scope: null }])
  const stored = await db.query('select acknowledged_at,acknowledged_by,previous_grant from private.department_transfer_review_items where id = $1', [reviewId])
  expect(stored.rows).toEqual([expect.objectContaining({
    acknowledged_at: expect.any(Date), acknowledged_by: actor, previous_grant: expect.objectContaining({ effect: 'ALLOW' }),
  })])
  expect((await db.query('select command, actor_id, request_id from public.personnel_lifecycle_events')).rows).toEqual([
    { command: 'acknowledge_department_transfer_review', actor_id: actor, request_id: 'test-review' },
  ])
})

it('keeps review RPCs and the private persistence table off the browser role', async () => {
  await db.exec('set role authenticated')
  try {
    await expect(list()).rejects.toMatchObject({ code: '42501' })
    await expect(acknowledge()).rejects.toMatchObject({ code: '42501' })
    await expect(db.query('select 1 from private.department_transfer_review_items')).rejects.toMatchObject({ code: '42501' })
  } finally {
    await db.exec('reset role')
  }
})

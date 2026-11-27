// @vitest-environment node
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'

const org = '11111111-1111-4111-8111-111111111111'
const actor = '22222222-2222-4222-8222-222222222222'
const user = '33333333-3333-4333-8333-333333333333'
const old = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const target = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const secondary = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const oldChild = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const sharedParent = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const role = '55555555-5555-4555-8555-555555555555'
const systemRole = '66666666-6666-4666-8666-666666666666'
const oldSpace = '77777777-7777-4777-8777-777777777777'
const secondarySpace = '88888888-8888-4888-8888-888888888888'
const db = new PGlite()
const effectiveAt = '2026-11-27T07:00:00Z'
const impact = (keepPrevious = false) => db.query<{ impact: Record<string, unknown> }>(
  'select private.department_transfer_impact_v1($1,$2,$3,$4,$5) as impact',
  [org, user, old, target, keepPrevious],
).then(result => result.rows[0].impact)
const reconcile = (keepPrevious = false) => db.query(
  'select private.reconcile_department_transfer_v1($1,$2,$3,$4,$5,$6,$7)',
  [org, actor, user, old, target, keepPrevious, effectiveAt],
)

beforeAll(async () => {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema private;
    create table public.organizations (id uuid primary key, status text, settings jsonb);
    create table public.user_organizations (user_id uuid, org_id uuid, primary key (user_id,org_id));
    create table public.departments (id uuid primary key, org_id uuid, parent_id uuid, status text, leader_id uuid);
    create table public.user_departments (org_id uuid, user_id uuid, department_id uuid, is_primary boolean);
    create table public.roles (id uuid primary key, code text, name text, permissions jsonb);
    create table public.user_roles (
      org_id uuid, user_id uuid, role_id uuid, scope_type text, scope_id uuid, granted_by uuid,
      granted_at timestamptz not null default now()
    );
    create table public.fxiaoke_pending_org_roles (
      org_id uuid, user_id uuid, role_id uuid, granted_by uuid, granted_at timestamptz not null default now()
    );
    create table public.department_lead_access (
      org_id uuid, user_id uuid, department_id uuid, confirmed_by uuid, confirmed_at timestamptz not null default now()
    );
    create table public.sales_spaces (id uuid primary key, org_id uuid, department_id uuid, name text);
    create table public.sales_space_members (
      org_id uuid, user_id uuid, space_id uuid, space_role text, joined_at timestamptz not null default now()
    );
    create table private.employee_permission_overrides (
      org_id uuid, user_id uuid, permission_code text, effect text not null, scope jsonb,
      updated_by uuid, updated_at timestamptz not null default now(), pending_target_revision text
    );
    create function private.shipping_role_scope_catalog_v1()
    returns table(code text,supported_scope_types text[]) language sql stable as $$
      select 'shipping:ledger_view'::text, array['org','department']::text[];
    $$;
  `)
  await db.exec(readFileSync('supabase/migrations/20261127145000_department_change_authority.sql','utf8'))
}, 15000)

afterAll(async () => { await db.close() })

beforeEach(async () => {
  await db.exec(`
    truncate organizations, user_organizations, departments, user_departments, roles, user_roles,
      fxiaoke_pending_org_roles, department_lead_access, sales_spaces, sales_space_members,
      private.employee_permission_overrides cascade;
    insert into organizations values ('${org}','active',jsonb_build_object('department_permission_grants',jsonb_build_object(
      '${old}', '{"permissions":["shipping:ledger_view"],"include_subdepartments":true}'::jsonb,
      '${target}', '{"permissions":["shipping:ledger_view"],"include_subdepartments":false}'::jsonb)));
    insert into user_organizations values ('${user}','${org}');
    insert into departments values
      ('${sharedParent}','${org}',null,'active',null),
      ('${old}','${org}','${sharedParent}','active','${user}'),
      ('${target}','${org}','${sharedParent}','active',null),
      ('${secondary}','${org}',null,'active','${user}'),
      ('${oldChild}','${org}','${old}','active',null);
    insert into user_departments values ('${org}','${user}','${old}',true), ('${org}','${user}','${secondary}',false);
    insert into roles values ('${role}','SALES','销售','["shipping:ledger_view"]'), ('${systemRole}','SUPER_ADMIN','超管','["*"]');
    insert into sales_spaces values ('${oldSpace}','${org}','${old}','原部门'), ('${secondarySpace}','${org}','${secondary}','兼岗');
    insert into user_roles(org_id,user_id,role_id,scope_type,scope_id,granted_by) values
      ('${org}','${user}','${role}','department','${old}','${actor}'),
      ('${org}','${user}','${role}','department','${secondary}','${actor}'),
      ('${org}','${user}','${role}','org','${org}','${actor}'),
      ('${org}','${user}','${role}','space','${oldSpace}','${actor}'),
      ('${org}','${user}','${systemRole}','org','${org}','${actor}');
    insert into sales_space_members(org_id,user_id,space_id,space_role) values
      ('${org}','${user}','${oldSpace}','MEMBER'), ('${org}','${user}','${secondarySpace}','MEMBER');
    insert into department_lead_access(org_id,user_id,department_id,confirmed_by) values
      ('${org}','${user}','${old}','${actor}'), ('${org}','${user}','${secondary}','${actor}');
    insert into fxiaoke_pending_org_roles(org_id,user_id,role_id,granted_by) values ('${org}','${user}','${role}','${actor}');
    insert into private.employee_permission_overrides(org_id,user_id,permission_code,effect,scope,updated_by) values
      ('${org}','${user}','shipping:ledger_view','ALLOW',jsonb_build_object('type','department','departments',
        jsonb_build_array(jsonb_build_object('department_id','${old}','include_subdepartments',false))),'${actor}'),
      ('${org}','${user}','shipping:record_return','DENY',null,'${actor}');
  `)
})

it('previews deterministic lost and gained scopes without changing any grants', async () => {
  const preview = await impact()
  expect(preview).toMatchObject({
    lost_department_ids: [old, oldChild], retained_department_ids: [target, secondary],
    roles_for_review: [
      { role_id: role, scope_type: 'department', scope_id: old },
      { role_id: role, scope_type: 'space', scope_id: oldSpace },
    ],
    retained_roles_for_review: [
      { role_id: role, scope_type: 'department', scope_id: secondary },
      { role_id: role, scope_type: 'org', scope_id: org },
    ],
    pending_roles_for_review: [{ role_id: role }],
    lead_departments_for_review: [old],
    spaces_for_review: [{ space_id: oldSpace }],
    baseline_permission_changes: [{
      permission_code: 'shipping:ledger_view',
      before_department_ids: [old, oldChild], after_department_ids: [target],
    }],
    overrides_for_review: [
      { permission_code: 'shipping:ledger_view', effect: 'ALLOW', resolution: 'blocked_pending_review' },
      { permission_code: 'shipping:record_return', effect: 'DENY', resolution: 'deny_retained' },
    ],
  })
  expect(await impact()).toEqual(preview)
  expect((await db.query('select count(*)::int as total from private.department_transfer_review_items')).rows).toEqual([{ total: 0 }])
  await db.query('update public.organizations set settings = settings || $1 where id = $2', [
    JSON.stringify({ role_permission_overrides: { [role]: ['shipping:ledger_view', 'shipping:record_return'] } }), org,
  ])
  const changed = await impact()
  expect(changed.context_revision).not.toBe(preview.context_revision)
  await db.query('update public.roles set permissions = $1 where id = $2', [JSON.stringify(['shipping:record_return']), role])
  expect((await impact()).context_revision).not.toBe(changed.context_revision)
})

it('suspends only lost role origins and prevents a narrow ALLOW from widening', async () => {
  await reconcile()
  expect((await db.query(
    'select role_id,scope_type,scope_id from user_roles order by role_id,scope_type,scope_id',
  )).rows).toEqual([
    { role_id: role, scope_type: 'department', scope_id: secondary },
    { role_id: role, scope_type: 'org', scope_id: org },
    { role_id: systemRole, scope_type: 'org', scope_id: org },
  ])
  expect((await db.query('select space_id from sales_space_members')).rows).toEqual([{ space_id: secondarySpace }])
  expect((await db.query('select department_id from department_lead_access')).rows).toEqual([{ department_id: secondary }])
  expect((await db.query('select role_id from fxiaoke_pending_org_roles')).rows).toEqual([])
  expect((await db.query(
    'select permission_code,effect,scope from private.employee_permission_overrides order by permission_code',
  )).rows).toEqual([
    { permission_code: 'shipping:ledger_view', effect: 'DENY', scope: null },
    { permission_code: 'shipping:record_return', effect: 'DENY', scope: null },
  ])
  const history = await db.query('select kind,previous_grant from private.department_transfer_review_items')
  expect(history.rows).toHaveLength(9)
  expect(history.rows).toContainEqual(expect.objectContaining({
    kind: 'personal_override',
    previous_grant: expect.objectContaining({ permission_code: 'shipping:ledger_view', effect: 'ALLOW' }),
  }))
})

it('keeps an intentionally retained former affiliation and its independent scopes', async () => {
  expect(await impact(true)).toMatchObject({
    lost_department_ids: [], retained_department_ids: [old, target, secondary],
    roles_for_review: [], lead_departments_for_review: [], spaces_for_review: [],
  })
  await reconcile(true)
  expect((await db.query('select count(*)::int as total from user_roles')).rows).toEqual([{ total: 5 }])
  expect((await db.query('select count(*)::int as total from sales_space_members')).rows).toEqual([{ total: 2 }])
})

it('pauses an old parent department grant when only the new child membership remains', async () => {
  await db.query('update departments set parent_id = $1 where id = $2', [old, target])
  const preview = await impact()
  expect(preview).toMatchObject({
    lost_department_ids: [old, oldChild],
    roles_for_review: expect.arrayContaining([{ role_id: role, role_name: '销售', scope_type: 'department', scope_id: old }]),
    lead_departments_for_review: [old],
    baseline_permission_changes: [{
      permission_code: 'shipping:ledger_view',
      before_department_ids: [old, target, oldChild],
      after_department_ids: [target],
    }],
  })
  await reconcile()
  const roles = await db.query('select scope_id from user_roles where scope_type = $1', ['department'])
  expect(roles.rows).toEqual([{ scope_id: secondary }])
})

it('keeps permission mutations private and rolls them back with any failed transfer', async () => {
  expect((await db.query(`
    select has_function_privilege('service_role','private.reconcile_department_transfer_v1(uuid,uuid,uuid,uuid,uuid,boolean,timestamp with time zone)','execute') as allowed
  `)).rows).toEqual([{ allowed: false }])
  await db.exec('begin')
  await reconcile()
  await db.exec('rollback')
  expect((await db.query('select count(*)::int as total from user_roles')).rows).toEqual([{ total: 5 }])
  expect((await db.query('select count(*)::int as total from private.department_transfer_review_items')).rows).toEqual([{ total: 0 }])
})

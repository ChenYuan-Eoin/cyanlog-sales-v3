// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, expect, it } from 'vitest'

const migrations = [
  '20261021000006_personnel_lifecycle_commands.sql',
  '20261022000001_role_scope_lifecycle.sql',
  '20261022000002_remove_tenant_membership.sql',
  '20261118095000_fxiaoke_prelogin_role_assignment.sql',
  '20261125051750_department_lead_access.sql',
  '20261125055213_organization_super_admin.sql',
  '20261126045425_system_super_admin_authority.sql',
  '20261126054302_immutable_system_super_admin.sql',
  '20261126054700_guard_ordinary_role_assignments.sql',
  '20261126054800_guard_role_permission_edits.sql',
  '20261126054900_guard_invitation_role_authority.sql',
  '20261126060000_retire_new_fxiaoke_baseline_grants.sql',
].map(file => readFileSync(join(process.cwd(), 'supabase/migrations', file), 'utf8'))
const invitationAcceptance = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261029100000_remove_local_password_auth.sql'), 'utf8',
).match(/create or replace function public\.accept_personnel_invitation_v1\([\s\S]*?\n\$\$;/)?.[0]

const moduleMigration = (file: string) => readFileSync(join(process.cwd(), 'supabase/migrations', file), 'utf8')

const org = '11111111-1111-4111-8111-111111111111'
const otherOrg = '22222222-2222-4222-8222-222222222222'
const root = '33333333-3333-4333-8333-333333333333'
const actor = '44444444-4444-4444-8444-444444444444'
const member = '55555555-5555-4555-8555-555555555555'
const pending = '66666666-6666-4666-8666-666666666666'
const rootRole = '77777777-7777-4777-8777-777777777777'
const ordinaryRole = '88888888-8888-4888-8888-888888888888'
const actorRole = '99999999-9999-4999-8999-999999999999'
const department = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherDepartment = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const space = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const source = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const identity = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const baselineRole = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const denied = { code: '42501' }
const baselineRetired = { code: '42501', detail: 'LEGACY_BASELINE_ASSIGNMENT_FORBIDDEN' }

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
    insert into public.organizations (id, settings) values
      ('${org}', '{"role_permission_overrides":{"${rootRole}":[]}}'), ('${otherOrg}', '{}');
    insert into public.users (id, org_id) values ('${root}', '${org}'), ('${actor}', '${org}'), ('${member}', '${org}');
    insert into public.user_organizations (user_id, org_id) select id, org_id from public.users;
    insert into public.roles (id, code, name, permissions) values
      ('${rootRole}', 'SUPER_ADMIN', 'System', '[]'),
      ('${ordinaryRole}', 'SALES', 'Sales', '[]'),
      ('${baselineRole}', 'FXIAOKE_BASELINE', 'Historical baseline', '["quote:view","contract:view","customer:view"]'),
      ('${actorRole}', 'ADMIN', 'Department administrator', '["role:manage","user:assign_roles"]');
    insert into public.user_roles (user_id, org_id, role_id, scope_type, scope_id) values
      ('${root}', '${org}', '${rootRole}', 'org', '${org}'),
      ('${actor}', '${org}', '${actorRole}', 'org', '${org}');
    insert into public.departments (id, org_id) values ('${department}', '${org}'), ('${otherDepartment}', '${otherOrg}');
    insert into public.sales_spaces (id, org_id) values ('${space}', '${org}');
  `)
  for (const migration of migrations) await db.exec(migration)
})

afterEach(async () => db.close())

const replaceSql = 'select public.admin_replace_org_roles_v1($1,$2,$3,$4) as result'
const compareAndReplaceSql = 'select public.admin_replace_org_roles_if_current_v1($1,$2,$3,$4,$5) as result'
const scopeSql = 'select public.admin_set_role_scope_assignment_v1($1,$2,$3,$4,$5,$6,$7) as result'

async function setupRoleOverrideChoice() {
  const shippingScope = moduleMigration('20261126114126_allow_shipping_operator_department_ledger_roles.sql')
  const employeeOverrides = moduleMigration('20261126111603_fxiaoke_prelogin_employee_permission_overrides.sql')
  await db.exec(`
    create table private.employee_permission_overrides (
      org_id uuid, user_id uuid, permission_code text, effect text, scope jsonb,
      updated_at timestamptz default now(), updated_by uuid, pending_target_revision text
    );
    create table private.department_transfer_review_items (
      org_id uuid, user_id uuid, actor_id uuid, effective_at timestamptz, kind text, previous_grant jsonb
    );
    create table private.org_role_metadata (org_id uuid, role_id uuid, name text, archived_at timestamptz);
    create table public.user_departments (org_id uuid, user_id uuid, department_id uuid);
    create table public.permission_points (
      code text, status text, kind text, resource text, category text, action text,
      supported_scope_types text[], dependencies text[], enforcement_consumer text
    );
    alter table public.roles add column owner_org_id uuid;
    alter table public.departments add column parent_id uuid, add column name text default 'Test department';
    insert into public.permission_points values
      ('shipping:ledger_view','published','atomic','shipping','shipping','ledger_view',
        array['org','department'],array[]::text[],'lib/shipping/http.ts'),
      ('shipping:record_return','published','atomic','shipping','shipping','record_return',
        array['org','department'],array['shipping:ledger_view'],'lib/shipping/http.ts');
    create function private.org_role_catalog_v1(uuid,boolean)
      returns table(id uuid,code text,permissions jsonb) language sql stable as $$
        select definition.id, definition.code, definition.permissions
        from public.roles as definition join public.organizations as org on org.id = $1
        where org.status = 'active';
      $$;
    create function public.admin_list_org_roles_v1(uuid)
      returns table(id uuid, code text, name text) language sql stable as $$
        select role.id, role.code, role.name from public.roles as role;
      $$;
    create function public.department_automatic_role_sources_v1(uuid,uuid)
      returns table(rule_department_id uuid, affiliation_department_id uuid, role_id uuid,
        role_code text, role_name text, permissions text[])
      language sql stable as $$
        select null::uuid, null::uuid, null::uuid, null::text, null::text, null::text[] where false;
      $$;
    ${shippingScope.match(/create function private\.shipping_role_scope_catalog_v1\([\s\S]*?\n\$\$;/)?.[0]}
    ${shippingScope.match(/create function private\.shipping_role_effective_scope_permissions_v1\([\s\S]*?\n\$\$;/)?.[0]}
    ${employeeOverrides.match(/create function private\.employee_prelogin_target_revision_v1\([\s\S]*?\n\$\$;/)?.[0]}
    ${employeeOverrides.match(/create function private\.employee_prelogin_target_v1\([\s\S]*?\n\$\$;/)?.[0]}
    ${employeeOverrides.match(/create function private\.employee_prelogin_role_ids_v1\([\s\S]*?\n\$\$;/)?.[0]}
    ${employeeOverrides.match(/create or replace function public\.employee_permission_overrides_v1\([\s\S]*?\n\$\$;/)?.[0]}
    ${moduleMigration('20261127150000_confirmed_department_transfer.sql').match(/create function private\.assert_member_department_transfer_actor_v1\([\s\S]*?\n\$\$;/)?.[0]}
    ${moduleMigration('20261127161000_department_membership_override_choice.sql').match(/create function private\.apply_employee_department_override_choice_v1\([\s\S]*?\n\$\$;/)?.[0]}
    ${moduleMigration('20261126120100_allow_revoke_stopped_fxiaoke_pending_roles.sql').match(/create function private\.fxiaoke_prelogin_directory_members_v1\([\s\S]*?\n\$\$;/)?.[0]}
  `)
  await db.exec(moduleMigration('20261126092416_admin_save_member_org_roles.sql'))
  await db.exec(moduleMigration('20261126103435_admin_add_member_org_roles.sql'))
  const stoppedPendingMigration = moduleMigration('20261126120100_allow_revoke_stopped_fxiaoke_pending_roles.sql')
  const publicStoppedPendingFunctions = [
    'fxiaoke_prelogin_role_targets_v1', 'admin_replace_org_roles_if_current_v1',
  ].flatMap(name => stoppedPendingMigration.match(new RegExp(
    `create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
  )) ?? [])
  expect(publicStoppedPendingFunctions).toHaveLength(2)
  for (const routine of publicStoppedPendingFunctions) await db.exec(routine)
  await db.exec(moduleMigration('20261127154500_department_automatic_role_runtime.sql'))
  await db.exec(moduleMigration('20261127161500_member_role_override_choice.sql'))

  const applyChange = (userId: string, change: object, review: string | null = null, choice: string | null = null) =>
    db.query<{ result: { result?: string; review_revision?: string; affected_permissions?: unknown } }>(
      'select public.admin_apply_member_role_change_v1($1,$2,$3,$4,$5,$6) as result',
      [root, org, userId, JSON.stringify(change), review, choice],
    ).then(query => query.rows[0].result)
  return { applyChange }
}

it('changes ordinary roles directly and reconciles only affected personal settings in the checked transaction', async () => {
  const { applyChange } = await setupRoleOverrideChoice()
  const roleChange = (roleIds: string[], previous: string[], review: string | null = null, choice: string | null = null) =>
    applyChange(member, { kind: 'replace_org_if_current', role_ids: roleIds, expected_role_ids: previous }, review, choice)
  const overrides = () => db.query<{ permission_code: string; effect: string }>(`
    select permission_code, effect from private.employee_permission_overrides where user_id = $1 order by permission_code
  `, [member]).then(query => query.rows)

  await db.query("update public.roles set permissions = '[\"user:view\"]' where id = $1", [ordinaryRole])
  await db.query(`insert into private.employee_permission_overrides(org_id,user_id,permission_code,effect,scope)
    values ($1,$2,'shipping:owner_view','ALLOW','{"type":"self"}')`, [org, member])
  expect(await roleChange([ordinaryRole], [])).toEqual({ result: 'saved' })

  await db.query(`insert into private.employee_permission_overrides(org_id,user_id,permission_code,effect,scope)
    values ($1,$2,'user:view','ALLOW','{"type":"org"}')`, [org, member])
  const first = await roleChange([], [ordinaryRole])
  expect(first).toMatchObject({
    review_revision: expect.any(String),
    affected_permissions: [{ permission_code: 'user:view', retainable: false }],
  })
  expect((await db.query('select role_id from public.user_roles where user_id = $1', [member])).rows).toEqual([{ role_id: ordinaryRole }])
  expect(await overrides()).toEqual([
    { permission_code: 'shipping:owner_view', effect: 'ALLOW' }, { permission_code: 'user:view', effect: 'ALLOW' },
  ])
  await db.query("update private.employee_permission_overrides set updated_at = clock_timestamp() where permission_code = 'user:view'")
  await expect(roleChange([], [ordinaryRole], first.review_revision, 'retain_eligible')).rejects.toMatchObject({
    detail: 'ROLE_OVERRIDE_REVIEW_CHANGED',
  })
  const current = await roleChange([], [ordinaryRole])
  expect(await roleChange([], [ordinaryRole], current.review_revision, 'retain_eligible')).toEqual({ result: 'saved' })
  expect(await overrides()).toEqual([
    { permission_code: 'shipping:owner_view', effect: 'ALLOW' }, { permission_code: 'user:view', effect: 'DENY' },
  ])
  const restored = await roleChange([ordinaryRole], [])
  expect(restored.affected_permissions).toEqual([{ permission_code: 'user:view', retainable: true }])
  expect(await roleChange([ordinaryRole], [], restored.review_revision, 'new_baseline')).toEqual({ result: 'saved' })
  expect(await overrides()).toEqual([{ permission_code: 'shipping:owner_view', effect: 'ALLOW' }])

  await db.query("insert into public.users (id,org_id,status,login_enabled) values ($1,$2,'inactive',false)", [pending, org])
  await db.query("insert into public.user_organizations (user_id,org_id,status) values ($1,$2,'invited')", [pending, org])
  await db.query(`
    insert into public.organization_sources (id,system_org_id,provider,status,connection_state,effective_revision,authority_scope)
    values ($1,$2,'fxiaoke','active','verified',$1,'{"identity":"authoritative","directory":"authoritative"}')
  `, [source, org])
  await db.query(`
    insert into public.external_identities (id,system_org_id,source_id,canonical_user_id,external_user_id,match_status,profile_snapshot)
    values ($1,$2,$3,$4,'verified-id','matched',jsonb_build_object('provisionedMemberId',$4::uuid::text,'status','active'))
  `, [identity, org, source, pending])
  await db.query(`insert into private.employee_permission_overrides(org_id,user_id,permission_code,effect,pending_target_revision)
    values ($1,$2,'user:view','DENY',private.employee_prelogin_target_revision_v1($1,$2,$3,$4,'verified-id'))`, [org, pending, source, identity])
  const additive = { kind: 'add_org', role_ids: [ordinaryRole] }
  const pendingReview = await applyChange(pending, additive)
  expect(pendingReview.affected_permissions).toEqual([{ permission_code: 'user:view', retainable: true }])
  expect((await db.query('select role_id from public.fxiaoke_pending_org_roles where user_id = $1', [pending])).rows).toEqual([])
  expect(await applyChange(pending, additive, pendingReview.review_revision, 'retain_eligible')).toEqual({ result: 'pending' })
  expect((await db.query('select role_id from public.fxiaoke_pending_org_roles where user_id = $1', [pending])).rows)
    .toEqual([{ role_id: ordinaryRole }])
  expect((await db.query('select role_id from public.user_roles where user_id = $1', [pending])).rows).toEqual([])
  await db.query(`select private.personnel_insert_event_v1($1,$2,$3,'set_account_state',
    '{}'::jsonb,'{"login_enabled":false}',null,null)`, [org, pending, root])
  const stoppedRemoval = { kind: 'replace_org_if_current', role_ids: [], expected_role_ids: [ordinaryRole] }
  const stoppedReview = await applyChange(pending, stoppedRemoval)
  expect(stoppedReview.affected_permissions).toEqual([{ permission_code: 'user:view', retainable: true }])
  expect(await applyChange(pending, stoppedRemoval, stoppedReview.review_revision, 'retain_eligible')).toEqual({ result: 'saved' })
  expect((await db.query('select role_id from public.fxiaoke_pending_org_roles where user_id = $1', [pending])).rows).toEqual([])

  expect(await roleChange([], [ordinaryRole])).toEqual({ result: 'saved' })
  const remainingScope = 'abababab-abab-4bab-8bab-abababababab'
  await db.query('insert into public.departments (id,org_id) values ($1,$2)', [remainingScope, org])
  await db.query("update public.roles set permissions = '[\"shipping:ledger_view\"]' where id = $1", [ordinaryRole])
  await db.query(`insert into public.user_roles(user_id,org_id,role_id,scope_type,scope_id)
    values ($1,$2,$3,'department',$4),($1,$2,$3,'department',$5)`, [member, org, ordinaryRole, department, remainingScope])
  await db.query(`insert into private.employee_permission_overrides(org_id,user_id,permission_code,effect,scope)
    values ($1,$2,'shipping:ledger_view','ALLOW',jsonb_build_object('type','department','departments',
      jsonb_build_array(jsonb_build_object('department_id',$3::uuid,'include_subdepartments',false))))`, [org, member, remainingScope])
  const revoke = { kind: 'scope', role_id: ordinaryRole, scope_type: 'department', action: 'revoke' }
  expect(await applyChange(member, { ...revoke, scope_id: department })).toEqual({ result: true })
  const scoped = await applyChange(member, { ...revoke, scope_id: remainingScope })
  expect(scoped.affected_permissions).toEqual([{ permission_code: 'shipping:ledger_view', retainable: false }])
  expect(await applyChange(member, { ...revoke, scope_id: remainingScope }, scoped.review_revision, 'new_baseline')).toEqual({ result: true })
  expect(await overrides()).toEqual([{ permission_code: 'shipping:owner_view', effect: 'ALLOW' }])
}, 20_000)

it.each(['organization-wide role', 'paused department role'] as const)(
  'prevents a personal allowance from restoring access after removal of a %s',
  async (binding) => {
    const { applyChange } = await setupRoleOverrideChoice()
    const paused = 'abababab-abab-4bab-8bab-abababababab'
    await db.query("insert into public.departments (id,org_id,status) values ($1,$2,'inactive')", [paused, org])
    await db.query("update public.roles set permissions = '[\"shipping:ledger_view\"]' where id = $1", [ordinaryRole])
    const removedScope = binding === 'organization-wide role' ? org : paused
    const scopeType = binding === 'organization-wide role' ? 'org' : 'department'
    await db.query(`insert into public.user_roles(user_id,org_id,role_id,scope_type,scope_id)
      values ($1,$2,$3,'department',$4),($1,$2,$3,$5,$6)`, [member, org, ordinaryRole, department, scopeType, removedScope])
    await db.query(`insert into private.employee_permission_overrides(org_id,user_id,permission_code,effect,scope)
      values ($1,$2,'shipping:ledger_view','ALLOW',jsonb_build_object('type','department','departments',
        jsonb_build_array(jsonb_build_object('department_id',$3::uuid,'include_subdepartments',false),
          jsonb_build_object('department_id',$4::uuid,'include_subdepartments',false))))`, [org, member, department, paused])

    const ledgerScope = () => db.query(`select organization_wide, department_ids
      from private.shipping_employee_permission_scope_projection_v1($1,$2,null) where permission_code = 'shipping:ledger_view'`,
    [org, member]).then(result => result.rows)
    const change = scopeType === 'org'
      ? { kind: 'replace_org_if_current', role_ids: [], expected_role_ids: [ordinaryRole] }
      : { kind: 'scope', role_id: ordinaryRole, scope_type: 'department', scope_id: paused, action: 'revoke' }
    expect(await ledgerScope()).toEqual([{ organization_wide: false, department_ids: [department] }])
    const review = await applyChange(member, change)
    expect(review).toMatchObject({
      review_revision: expect.any(String),
      affected_permissions: [{ permission_code: 'shipping:ledger_view', retainable: false }],
    })
    expect((await db.query('select scope_id from public.user_roles where user_id = $1 order by scope_id', [member])).rows)
      .toEqual(expect.arrayContaining([{ scope_id: removedScope }]))
    expect(await applyChange(member, change, review.review_revision, 'new_baseline'))
      .toEqual({ result: scopeType === 'org' ? 'saved' : true })
    await db.query("update public.departments set status = 'active' where id = $1", [paused])
    expect(await ledgerScope()).toEqual([{ organization_wide: false, department_ids: [department] }])
  },
  20_000,
)

async function replace(user = root, desired = [ordinaryRole], target = member, expected?: string[]) {
  const result = expected === undefined
    ? await db.query<{ result: boolean }>(replaceSql, [user, org, target, desired])
    : await db.query<{ result: string }>(compareAndReplaceSql, [user, org, target, desired, expected])
  return result.rows[0].result
}

async function scope(action: 'assign' | 'revoke', user = root, type = 'department', scopeId = department, role = ordinaryRole) {
  const result = await db.query<{ result: boolean }>(scopeSql, [user, org, member, role, type, scopeId, action])
  return result.rows[0].result
}

it('denies all ordinary operations before checking stale state unless the actor is the exact live system root', async () => {
  await db.exec('set role service_role')
  await expect(replace(actor)).rejects.toMatchObject(denied)
  await expect(replace(actor, [ordinaryRole], member, [ordinaryRole])).rejects.toMatchObject(denied)
  await expect(scope('assign', actor)).rejects.toMatchObject(denied)
  await expect(scope('revoke', actor)).rejects.toMatchObject(denied)
  await db.exec('reset role')
  await db.query("update public.user_roles set scope_type = 'department', scope_id = $2 where user_id = $1", [root, department])
  await expect(replace()).rejects.toMatchObject(denied)
  await db.query("update public.user_roles set scope_type = 'org', scope_id = $2 where user_id = $1", [root, org])
  await db.query('update public.user_organizations set is_default = false where user_id = $1', [root])
  await expect(replace(root, [ordinaryRole], member, [])).rejects.toMatchObject(denied)
  await db.query('update public.user_organizations set is_default = true where user_id = $1', [root])
  await db.query('update public.users set login_enabled = false where id = $1', [root])
  await expect(scope('assign')).rejects.toMatchObject(denied)
  expect((await db.query('select role_id from public.user_roles where user_id = $1', [member])).rows).toEqual([])
})

it('preserves both organization RPC contracts, role CAS and reserved-role protection', async () => {
  await db.exec('set role service_role')
  expect(await replace()).toBe(true)
  expect(await replace(root, [], member, [])).toBe('conflict')
  expect(await replace(root, [], member, [ordinaryRole])).toBe('saved')
  await expect(replace(root, [rootRole])).rejects.toMatchObject(denied)
  await expect(replace(root, [], root)).rejects.toMatchObject(denied)
  await expect(scope('assign', root, 'department', department, rootRole)).rejects.toMatchObject(denied)
  await db.exec('reset role')
  expect((await db.query('select role_id from public.user_roles where user_id = $1', [member])).rows).toEqual([])
})

it('keeps exact department assignment and allows removing a legacy space grant without creating new ones', async () => {
  await db.query(`
    insert into public.user_roles (user_id, org_id, role_id, scope_type, scope_id) values ($1,$2,$3,'space',$4)
  `, [member, org, ordinaryRole, space])
  await db.exec('set role service_role')
  expect(await scope('assign')).toBe(true)
  await expect(scope('assign', root, 'department', otherDepartment)).rejects.toMatchObject({ code: '23514' })
  await expect(scope('assign', root, 'space', space)).rejects.toMatchObject({
    code: '23514', detail: 'LEGACY_SCOPE_ASSIGNMENT_FORBIDDEN',
  })
  expect(await scope('revoke', root, 'space', space)).toBe(true)
  await expect(scope('assign', root, 'space', space)).rejects.toMatchObject({ code: '23514' })
  await db.exec('reset role')
  expect((await db.query('select scope_type, scope_id from public.user_roles where user_id = $1', [member])).rows)
    .toEqual([{ scope_type: 'department', scope_id: department }])
})

it('preserves verified pending reservations and first-login promotion after a root assignment', async () => {
  await db.query("insert into public.users (id,org_id,status,login_enabled) values ($1,$2,'inactive',false)", [pending, org])
  await db.query("insert into public.user_organizations (user_id,org_id,status) values ($1,$2,'invited')", [pending, org])
  await db.query(`
    insert into public.organization_sources (id,system_org_id,provider,status,connection_state,effective_revision,authority_scope)
    values ($1,$2,'fxiaoke','active','verified',$1,'{"identity":"authoritative","directory":"authoritative"}')
  `, [source, org])
  await db.query(`
    insert into public.external_identities (id,system_org_id,source_id,canonical_user_id,external_user_id,match_status,profile_snapshot)
    values ($1,$2,$3,$4,'verified-id','matched',jsonb_build_object('provisionedMemberId',$4::uuid::text,'status','active'))
  `, [identity, org, source, pending])
  await db.exec('set role service_role')
  await expect(replace(actor, [ordinaryRole], pending, [])).rejects.toMatchObject(denied)
  expect(await replace(root, [ordinaryRole], pending, [])).toBe('saved')
  expect((await db.query('select role_id, granted_by from public.fxiaoke_pending_org_roles where user_id = $1', [pending])).rows)
    .toEqual([{ role_id: ordinaryRole, granted_by: root }])
  expect((await db.query("select public.activate_fxiaoke_sso_member_v1($1,'verified-id',$2) as user_id", [org, pending])).rows)
    .toEqual([{ user_id: pending }])
  expect((await db.query('select role_id from public.fxiaoke_pending_org_roles where user_id = $1', [pending])).rows).toEqual([])
  await db.exec('reset role')
  expect((await db.query('select role_id, granted_by from public.user_roles where user_id = $1', [pending])).rows)
    .toEqual([{ role_id: ordinaryRole, granted_by: root }])
})

it('exposes only the guarded functions to the service role', async () => {
  await db.exec('set role authenticated')
  await expect(replace()).rejects.toMatchObject(denied)
  await expect(replace(root, [], member, [])).rejects.toMatchObject(denied)
  await expect(scope('assign')).rejects.toMatchObject(denied)
  await db.exec('reset role; set role service_role')
  await expect(db.query('select private.admin_replace_org_roles_before_system_actor_v1($1,$2,$3,$4)', [
    actor, org, member, [ordinaryRole],
  ])).rejects.toMatchObject(denied)
  await expect(db.query('select private.admin_replace_org_roles_if_current_before_system_actor_v1($1,$2,$3,$4,$5)', [
    actor, org, member, [ordinaryRole], [],
  ])).rejects.toMatchObject(denied)
  await expect(db.query('select private.admin_set_role_scope_assignment_before_system_actor_v1($1,$2,$3,$4,$5,$6,$7)', [
    actor, org, member, ordinaryRole, 'department', department, 'assign',
  ])).rejects.toMatchObject(denied)
})

it('allows ordinary empty invitations, requires live authority for reserved roles, and prevents rewriting a pending reservation', async () => {
  if (!invitationAcceptance) throw new Error('Missing invitation acceptance definition')
  await db.exec(invitationAcceptance)
  const invite = (token: string, roleIds: string[], creator: string, destination = org) => db.query(
    `insert into public.personnel_invitations (org_id,user_id,token_hash,role_ids,expires_at,created_by)
     values ($1,$2,$3,$4,now() + interval '1 day',$5)`,
    [destination, member, token, roleIds, creator],
  )
  const actorRequired = { code: '42501', detail: 'PERSONNEL_INVITATION_ROLE_AUTHORITY_REQUIRED' }
  const newReservation = { code: '42501', detail: 'PERSONNEL_INVITATION_ROLE_CHANGE_FORBIDDEN' }
  await invite('empty', [], actor)
  await expect(invite('ordinary-actor', [ordinaryRole], actor)).rejects.toMatchObject(actorRequired)
  await expect(invite('wrong-organization', [ordinaryRole], root, otherOrg)).rejects.toMatchObject(actorRequired)
  await expect(invite('system-root', [rootRole], root)).rejects.toMatchObject(denied)
  await expect(invite('historical-baseline', [baselineRole], root)).rejects.toMatchObject(baselineRetired)
  await invite('approved', [ordinaryRole], root)
  await invite('to-revoke', [ordinaryRole], root)

  // Role reservations cannot be added or transferred by changing existing rows.
  await expect(db.query("update public.personnel_invitations set role_ids = $1 where token_hash = 'empty'", [[ordinaryRole]]))
    .rejects.toMatchObject(newReservation)
  await expect(db.query("update public.personnel_invitations set user_id = $1 where token_hash = 'approved'", [actor]))
    .rejects.toMatchObject(newReservation)
  await expect(db.query("update public.personnel_invitations set org_id = $1 where token_hash = 'approved'", [otherOrg]))
    .rejects.toMatchObject(newReservation)
  await db.exec("update public.personnel_invitations set status = 'revoked', revoked_at = now() where token_hash = 'to-revoke'")
  await expect(db.exec("update public.personnel_invitations set status = 'pending' where token_hash = 'to-revoke'"))
    .rejects.toMatchObject(newReservation)

  // A later authority change does not undo the previously approved invitation.
  await db.query('update public.users set login_enabled = false where id = $1', [root])
  await expect(invite('stale-actor', [ordinaryRole], root)).rejects.toMatchObject(actorRequired)
  await db.exec(`
    update public.personnel_invitations set token_hash = 'reissued', status = 'pending', expires_at = now() + interval '1 day'
    where token_hash = 'approved' and status = 'pending'
  `)
  const accepted = await db.query('select public.accept_personnel_invitation_v1(p_token_hash => $1, p_request_id => $2) as data', [
    'reissued', 'approved-invitation',
  ])
  expect(accepted.rows).toEqual([{ data: { user_id: member, org_id: org } }])
  expect((await db.query('select role_id, granted_by from public.user_roles where user_id = $1', [member])).rows)
    .toEqual([{ role_id: ordinaryRole, granted_by: root }])
})

it('keeps a retained historical organization binding physically intact and permits revocation without regrant', async () => {
  await expect(replace(root, [baselineRole])).rejects.toMatchObject(baselineRetired)
  await expect(replace(root, [baselineRole], member, [])).rejects.toMatchObject(baselineRetired)
  await db.query(`
    insert into public.user_roles (user_id, org_id, role_id, scope_type, scope_id, granted_at)
    values ($1,$2,$3,'org',$2,'2026-11-12 07:00:00+00')
  `, [member, org, baselineRole])
  const baseline = () => db.query('select ctid::text, granted_by, granted_at from public.user_roles where role_id = $1', [baselineRole])
  const { rows: before } = await baseline()

  expect(await replace(root, [baselineRole, ordinaryRole], member, [baselineRole])).toBe('saved')
  expect((await baseline()).rows).toEqual(before)
  expect((await db.query('select role_id from public.user_roles where user_id = $1 order by role_id', [member])).rows)
    .toEqual([{ role_id: ordinaryRole }, { role_id: baselineRole }])
  expect(await replace(root, [ordinaryRole], member, [baselineRole, ordinaryRole])).toBe('saved')
  expect((await baseline()).rows).toEqual([])
  await expect(replace(root, [baselineRole, ordinaryRole], member, [ordinaryRole])).rejects.toMatchObject(baselineRetired)
})

it('permits removal of old department and space bindings and forbids historical role configuration edits', async () => {
  await expect(scope('assign', root, 'department', department, baselineRole)).rejects.toMatchObject(baselineRetired)
  await db.query(`
    insert into public.user_roles (user_id, org_id, role_id, scope_type, scope_id)
    values ($1,$2,$3,'department',$4),($1,$2,$3,'space',$5)
  `, [member, org, baselineRole, department, space])
  expect(await scope('revoke', root, 'department', department, baselineRole)).toBe(true)
  expect(await scope('revoke', root, 'space', space, baselineRole)).toBe(true)
  expect((await db.query('select role_id from public.user_roles where user_id = $1', [member])).rows).toEqual([])

  const result = await db.query(`
    select public.admin_save_org_role_permissions_v1($1,$2,$3,null,'FXIAOKE_BASELINE',null,null,$4) as result
  `, [root, org, baselineRole, ['shipping:owner_view']])
  expect(result.rows).toEqual([{ result: 'fixed_role' }])
})

it('retains a verified archived reservation without changing provenance and never retargets stale reservations', async () => {
  await db.query("insert into public.users (id,org_id,status,login_enabled) values ($1,$2,'inactive',false)", [pending, org])
  await db.query("insert into public.user_organizations (user_id,org_id,status) values ($1,$2,'invited')", [pending, org])
  await db.query(`
    insert into public.organization_sources (id,system_org_id,provider,status,connection_state,effective_revision,authority_scope)
    values ($1,$2,'fxiaoke','active','verified',$1,'{"identity":"authoritative","directory":"authoritative"}')
  `, [source, org])
  await db.query(`
    insert into public.external_identities (id,system_org_id,source_id,canonical_user_id,external_user_id,match_status,profile_snapshot)
    values ($1,$2,$3,$4,'verified-id','matched',jsonb_build_object('provisionedMemberId',$4::uuid::text,'status','active'))
  `, [identity, org, source, pending])
  await expect(replace(root, [baselineRole], pending, [])).rejects.toMatchObject(baselineRetired)
  await db.query(`
    insert into public.fxiaoke_pending_org_roles
      (org_id,user_id,role_id,source_id,external_identity_id,external_user_id,granted_by,granted_at)
    values ($1,$2,$3,$4,$5,'verified-id',$6,'2026-11-12 07:00:00+00')
  `, [org, pending, baselineRole, source, identity, actor])
  const reservation = () => db.query(
    'select ctid::text, external_user_id, granted_by, granted_at from public.fxiaoke_pending_org_roles where role_id = $1',
    [baselineRole],
  )
  const { rows: before } = await reservation()
  expect(await replace(root, [baselineRole], pending, [baselineRole])).toBe('saved')
  expect((await reservation()).rows).toEqual(before)
  await db.query("update public.external_identities set external_user_id = 'replacement' where id = $1", [identity])
  await expect(replace(root, [baselineRole], pending, [])).rejects.toMatchObject(baselineRetired)
  expect((await reservation()).rows).toEqual(before)
  await db.query("update public.external_identities set external_user_id = 'verified-id' where id = $1", [identity])
  expect((await db.query("select public.activate_fxiaoke_sso_member_v1($1,'verified-id',$2) as user_id", [org, pending])).rows)
    .toEqual([{ user_id: pending }])
  expect((await db.query('select role_id, granted_by from public.user_roles where user_id = $1', [pending])).rows)
    .toEqual([{ role_id: baselineRole, granted_by: actor }])
  expect((await reservation()).rows).toEqual([])
})

it('saves regular batch recipients once and keeps affected recipients pending an exact personal choice', async () => {
  await setupRoleOverrideChoice()
  await db.exec(moduleMigration('20261127162000_member_batch_role_override_choice.sql'))
  await db.query("update public.roles set permissions = '[\"user:view\"]' where id = $1", [ordinaryRole])
  await db.query(`insert into private.employee_permission_overrides(org_id,user_id,permission_code,effect,scope)
    values ($1,$2,'user:view','ALLOW','{"type":"org"}')`, [org, member])
  const batch = (users: string[], decisions: object[] = [], by = root) => db.query<{
    user_id: string; outcome: string; review_revision: string | null; affected_permissions: unknown
  }>('select * from public.admin_assign_org_member_roles_batch_v1($1,$2,$3,$4,$5,$6)',
    [by, org, users, [ordinaryRole], JSON.stringify(decisions), 'batch-test']).then(result => result.rows)
  const assigned = () => db.query(`select user_id from public.user_roles where role_id = $1 order by user_id`,
    [ordinaryRole]).then(result => result.rows)
  const baselineChoice = (review_revision: string | null) => ({ user_id: member, review_revision, choice: 'new_baseline' })

  await expect(batch([member], [], actor)).rejects.toMatchObject(denied)
  const [normal, held, self] = await batch([actor, member, root])
  expect(normal).toMatchObject({ user_id: actor, outcome: 'saved', review_revision: null })
  expect(self).toMatchObject({ user_id: root, outcome: 'SELF_MUTATION_FORBIDDEN' })
  expect(held).toMatchObject({
    user_id: member, outcome: 'ROLE_PERMISSION_REVIEW_REQUIRED', review_revision: expect.any(String),
    affected_permissions: [{ permission_code: 'user:view', retainable: true }],
  })
  expect(await assigned()).toEqual([{ user_id: actor }])
  await expect(batch([actor], [baselineChoice(held.review_revision)])).rejects.toMatchObject({ code: '22023' })

  await db.query('update private.employee_permission_overrides set updated_at = clock_timestamp() where user_id = $1', [member])
  expect(await batch([member], [baselineChoice(held.review_revision)])).toMatchObject([
    { user_id: member, outcome: 'ROLE_OVERRIDE_REVIEW_CHANGED', review_revision: null },
  ])
  expect(await assigned()).toEqual([{ user_id: actor }])
  const [fresh] = await batch([member])
  expect(await batch([member], [baselineChoice(fresh.review_revision)])).toMatchObject([
    { user_id: member, outcome: 'saved', review_revision: null },
  ])
  expect(await assigned()).toEqual([{ user_id: actor }, { user_id: member }])
  expect((await db.query('select permission_code from private.employee_permission_overrides where user_id = $1', [member])).rows)
    .toEqual([])
  expect((await db.query(`select has_function_privilege('authenticated',
    'public.admin_assign_org_member_roles_batch_v1(uuid,uuid,uuid[],uuid[],jsonb,text)', 'execute') as executable`)).rows)
    .toEqual([{ executable: false }])
}, 20_000)

// @vitest-environment node
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const org = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherOrg = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const admin = '11111111-1111-4111-8111-111111111111'
const employee = '22222222-2222-4222-8222-222222222222'
const otherAdmin = '33333333-3333-4333-8333-333333333333'
const rootRole = '44444444-4444-4444-8444-444444444444'
const previous = '55555555-5555-4555-8555-555555555555'
const next = '66666666-6666-4666-8666-666666666666'
const secondary = '77777777-7777-4777-8777-777777777777'
const outsiderDepartment = '88888888-8888-4888-8888-888888888888'
const source = '99999999-9999-4999-8999-999999999999'
const oldSpace = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const nextSpace = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const lifecycle = '20261021000006_personnel_lifecycle_commands.sql'
const organizationAdmin = '20261125055213_organization_super_admin.sql'
const systemAuthority = '20261126045425_system_super_admin_authority.sql'
const shippingScopes = '20261126114126_allow_shipping_operator_department_ledger_roles.sql'
const authMigration = '20261127145000_department_change_authority.sql'
const transferMigration = '20261127150000_confirmed_department_transfer.sql'

let db: PGlite

function migration(file: string) {
  return readFileSync('supabase/migrations/' + file, 'utf8')
}

function functionDefinition(file: string, name: string, schema = 'private') {
  const source = migration(file).match(new RegExp(`create (?:or replace )?function ${schema}\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, 'i'))
  if (!source) throw new Error(`Missing SQL dependency ${name}`)
  return source[0]
}

beforeEach(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema private;
    create table public.organizations (id uuid primary key, status text default 'active', settings jsonb);
    create table public.departments (
      id uuid primary key, org_id uuid, name text not null, status text default 'active', source text default 'manual',
      parent_id uuid, leader_id uuid, updated_at timestamptz default now()
    );
    create table public.users (
      id uuid primary key, org_id uuid, primary_dept_id uuid, status text default 'active',
      login_enabled boolean default true, updated_at timestamptz default now()
    );
    create table public.user_organizations (
      org_id uuid, user_id uuid, primary_department_id uuid, membership_version bigint default 1,
      status text default 'active', employment_status text default 'active', is_default bool default true,
      left_at timestamptz, updated_by uuid, updated_at timestamptz default now(), primary key(user_id, org_id)
    );
    create table public.user_departments (
      org_id uuid, user_id uuid, department_id uuid, is_primary boolean not null, source text default 'manual',
      joined_at timestamptz default now(), primary key(user_id, department_id)
    );
    create table public.roles (id uuid primary key, code text, name text, permissions jsonb);
    create table public.user_roles (
      org_id uuid, user_id uuid, role_id uuid, scope_type text, scope_id uuid, granted_at timestamptz default now(), granted_by uuid
    );
    create table public.organization_sources (id uuid, system_org_id uuid, provider text, authority_scope jsonb);
    create table public.external_identities (
      system_org_id uuid, source_id uuid, canonical_user_id uuid, match_status text
    );
    create table public.personnel_lifecycle_events (
      org_id uuid, target_user_id uuid, actor_id uuid, command text, before_state jsonb,
      after_state jsonb, reason text, request_id text
    );
    create table public.personnel_employment_periods (org_id uuid, user_id uuid, department_id uuid, status text, updated_at timestamptz);
    create table private.employee_permission_overrides (
      org_id uuid, user_id uuid, permission_code text, effect text, scope jsonb, updated_by uuid, updated_at timestamptz default now(),
      pending_target_revision text, primary key(org_id, user_id, permission_code)
    );
    create table public.fxiaoke_pending_org_roles (org_id uuid, user_id uuid, role_id uuid, granted_at timestamptz, granted_by uuid);
    create table public.department_lead_access (org_id uuid, user_id uuid, department_id uuid, confirmed_by uuid, confirmed_at timestamptz);
    create table public.sales_spaces (id uuid primary key, org_id uuid, name text, department_id uuid, status text default 'active');
    create table public.sales_space_members (
      space_id uuid, user_id uuid, org_id uuid, space_role text, joined_at timestamptz default now(), primary key (space_id, user_id)
    );
    create table public.permission_points (
      code text, status text, kind text, resource text, category text, action text, supported_scope_types text[], dependencies text[],
      enforcement_consumer text
    );
    insert into public.organizations (id) values ('${org}'), ('${otherOrg}');
    insert into public.departments (id, org_id, name) values
      ('${previous}', '${org}', 'A'), ('${next}', '${org}', 'B'), ('${secondary}', '${org}', 'C'),
      ('${outsiderDepartment}', '${otherOrg}', 'Other');
    insert into public.users (id, org_id, primary_dept_id) values
      ('${admin}', '${org}', null), ('${employee}', '${org}', '${previous}'), ('${otherAdmin}', '${org}', null);
    insert into public.user_organizations (org_id, user_id, primary_department_id) values
      ('${org}', '${admin}', null), ('${org}', '${employee}', '${previous}'), ('${org}', '${otherAdmin}', null);
    insert into public.user_departments (org_id, user_id, department_id, is_primary) values
      ('${org}', '${employee}', '${previous}', true), ('${org}', '${employee}', '${secondary}', false);
    insert into public.roles values ('${rootRole}', 'SUPER_ADMIN', '系统超级管理员', '["*"]');
    insert into public.user_roles (org_id, user_id, role_id, scope_type, scope_id) values
      ('${org}', '${admin}', '${rootRole}', 'org', '${org}'), ('${org}', '${otherAdmin}', '${rootRole}', 'org', '${org}');
    insert into public.personnel_employment_periods (org_id, user_id, department_id, status)
    values ('${org}', '${employee}', '${previous}', 'active');
  `)
  for (const [file, name] of [
    [lifecycle, 'personnel_lock_org_v1'],
    [lifecycle, 'personnel_insert_event_v1'],
    [organizationAdmin, 'has_exact_org_role_v1'],
    [organizationAdmin, 'org_super_admin_active_member_v1'],
    [systemAuthority, 'system_super_admin_role_enabled_v1'],
    [systemAuthority, 'personnel_is_org_control_admin_v1'],
    [shippingScopes, 'shipping_role_scope_catalog_v1'],
  ]) await db.exec(functionDefinition(file, name))
  await db.exec(migration(authMigration))
  await db.exec(migration(transferMigration))
})

afterEach(async () => { await db.close() })

type Preview = { preview_id: string; previous_department_id: string; department_id: string; secondary_department_ids: string[] }

async function preview(department = next, keep = false, actor = admin, user = employee) {
  const result = await db.query<{ result: Preview }>(
    'select public.preview_member_department_transfer_v1($1, $2, $3, $4, $5) as result',
    [org, actor, user, department, keep],
  )
  return result.rows[0].result
}

async function confirm(previewId: string, actor = admin) {
  return (await db.query<{ result: { effective_at: Date } }>(
    'select public.confirm_member_department_transfer_v1($1, $2, $3, $4, $5) as result',
    [org, actor, employee, previewId, 'test-request'],
  )).rows[0].result
}

async function departments() {
  return (await db.query(
    'select department_id, is_primary from public.user_departments where org_id = $1 and user_id = $2 order by department_id',
    [org, employee],
  )).rows
}

describe('confirmed member department transfer', () => {
  it('keeps affiliations unchanged during preview and applies a single audited transfer after confirmation', async () => {
    await db.exec(`
      insert into public.sales_spaces (id, org_id, name, department_id) values
        ('${oldSpace}', '${org}', '旧空间', '${previous}'), ('${nextSpace}', '${org}', '新空间', '${next}');
      insert into public.sales_space_members (space_id, user_id, org_id, space_role)
      values ('${oldSpace}', '${employee}', '${org}', 'MEMBER');
      insert into public.permission_points values
        ('shipping:ledger_view', 'published', 'atomic', 'shipping', 'shipping', 'ledger_view',
         array['org', 'department'], array[]::text[], 'lib/shipping/http.ts');
    `)
    const grant = { permissions: ['shipping:ledger_view'], include_subdepartments: false }
    await db.query('update public.organizations set settings = $1 where id = $2', [
      { department_permission_grants: { [previous]: grant, [next]: grant } }, org,
    ])
    await db.query(
      'insert into private.employee_permission_overrides(org_id, user_id, permission_code, effect, scope) values ($1, $2, $3, $4, $5)',
      [org, employee, 'shipping:ledger_view', 'ALLOW', { type: 'department', dept_id: previous }],
    )
    const nextChange = await preview()
    expect(nextChange).toMatchObject({
      previous_department_id: previous, department_id: next, secondary_department_ids: [secondary],
      impact: {
        baseline_permission_changes: [{ permission_code: 'shipping:ledger_view', before_department_ids: [previous], after_department_ids: [next] }],
        overrides_for_review: [{ permission_code: 'shipping:ledger_view', resolution: 'blocked_pending_review' }],
        spaces_for_review: [{ space_id: oldSpace, department_id: previous }],
      },
    })
    expect(await departments()).toEqual([{ department_id: previous, is_primary: true }, { department_id: secondary, is_primary: false }])
    expect((await db.query('select effect from private.employee_permission_overrides')).rows).toEqual([{ effect: 'ALLOW' }])
    expect((await db.query('select 1 from public.personnel_lifecycle_events')).rows).toHaveLength(0)

    const recorded = await confirm(nextChange.preview_id)
    expect(recorded).toMatchObject({ department_id: next, secondary_department_ids: [secondary], effective_at: expect.any(String) })
    expect(await departments()).toEqual([{ department_id: next, is_primary: true }, { department_id: secondary, is_primary: false }])
    expect((await db.query('select effect, scope from private.employee_permission_overrides')).rows).toEqual([{ effect: 'DENY', scope: null }])
    expect((await db.query('select space_id from public.sales_space_members where user_id = $1', [employee])).rows).toEqual([])
    expect((await db.query(
      'select primary_department_id, membership_version from public.user_organizations where user_id = $1',
      [employee],
    )).rows).toEqual([{ primary_department_id: next, membership_version: 2 }])
    expect((await db.query('select command, before_state, after_state, request_id from public.personnel_lifecycle_events')).rows).toEqual([
      expect.objectContaining({
        command: 'confirm_department_transfer', request_id: 'test-request',
        before_state: expect.objectContaining({ primary_department_id: previous }),
        after_state: expect.objectContaining({ department_id: next, effective_at: recorded.effective_at }),
      }),
    ])
    await expect(confirm(nextChange.preview_id)).rejects.toMatchObject({ detail: 'DEPARTMENT_TRANSFER_STALE' })
  })

  it('promotes an existing secondary and retains the previous primary only when requested', async () => {
    const change = await preview(secondary, true)
    expect(change.secondary_department_ids).toEqual([previous])
    await confirm(change.preview_id)
    expect(await departments()).toEqual([{ department_id: previous, is_primary: false }, { department_id: secondary, is_primary: true }])
  })

  it('rolls back authorization changes and leaves the preview usable if a relationship write fails', async () => {
    await db.query(
      'insert into private.employee_permission_overrides(org_id, user_id, permission_code, effect, scope) values ($1, $2, $3, $4, $5)',
      [org, employee, 'shipping:ledger_view', 'ALLOW', { type: 'org' }],
    )
    const change = await preview()
    await db.exec(`
      create function private.reject_fixture_transfer() returns trigger language plpgsql as
      $$ begin raise exception 'fixture rejected relationship write'; end; $$;
      create trigger reject_fixture_transfer before update of primary_dept_id on public.users
      for each row execute function private.reject_fixture_transfer();
    `)
    await expect(confirm(change.preview_id)).rejects.toThrow('fixture rejected relationship write')
    expect(await departments()).toContainEqual({ department_id: previous, is_primary: true })
    expect((await db.query('select effect from private.employee_permission_overrides')).rows).toEqual([{ effect: 'ALLOW' }])
    expect((await db.query('select 1 from private.department_transfer_review_items')).rows).toHaveLength(0)
    await db.exec('drop trigger reject_fixture_transfer on public.users')
    expect(await confirm(change.preview_id)).toMatchObject({ department_id: next })
  })

  it('rejects expired and superseded previews, wrong actors, and changes to saved permissions', async () => {
    const prior = await preview()
    const latest = await preview()
    await expect(confirm(prior.preview_id)).rejects.toMatchObject({ detail: 'DEPARTMENT_TRANSFER_STALE' })
    await expect(confirm(latest.preview_id, otherAdmin)).rejects.toMatchObject({ detail: 'DEPARTMENT_TRANSFER_STALE' })
    await db.query('update private.member_department_transfer_previews set expires_at = now() - interval \'1 minute\' where id = $1', [latest.preview_id])
    await expect(confirm(latest.preview_id)).rejects.toMatchObject({ detail: 'DEPARTMENT_TRANSFER_STALE' })
    const beforeChange = await preview()
    await db.query(
      'insert into private.employee_permission_overrides(org_id, user_id, permission_code, effect) values ($1,$2,$3,$4)',
      [org, employee, 'shipping:ledger_view', 'DENY'],
    )
    await expect(confirm(beforeChange.preview_id)).rejects.toMatchObject({ detail: 'DEPARTMENT_TRANSFER_STALE' })
    expect(await departments()).toContainEqual({ department_id: previous, is_primary: true })
  })

  it('enforces the tenant and administrator boundary before creating a preview', async () => {
    await expect(preview(outsiderDepartment)).rejects.toMatchObject({ detail: 'DEPARTMENT_TRANSFER_INVALID_TARGET' })
    await expect(preview(next, false, employee)).rejects.toMatchObject({ detail: 'DEPARTMENT_TRANSFER_FORBIDDEN' })
    await expect(preview(next, false, admin, admin)).rejects.toMatchObject({ detail: 'DEPARTMENT_TRANSFER_PROTECTED' })
    await expect(preview(next, false, admin, otherAdmin)).rejects.toMatchObject({ detail: 'DEPARTMENT_TRANSFER_PROTECTED' })
    await db.exec(`update public.departments set status = 'inactive' where id = '${next}'`)
    await expect(preview()).rejects.toMatchObject({ detail: 'DEPARTMENT_TRANSFER_INVALID_TARGET' })
    expect((await db.query('select 1 from private.member_department_transfer_previews')).rows).toHaveLength(0)
  })

  it('keeps authority-owned relationships out of manual transfer for Feishu and Fxiaoke', async () => {
    for (const provider of ['feishu', 'fxiaoke']) {
      await db.query('insert into public.organization_sources values ($1,$2,$3,$4)', [source, org, provider, { directory: 'authoritative' }])
      await db.query('insert into public.external_identities values ($1,$2,$3,$4)', [org, source, employee, 'matched'])
      await expect(preview()).rejects.toMatchObject({ detail: 'DEPARTMENT_TRANSFER_EXTERNAL_SOURCE' })
      await db.query('delete from public.external_identities where source_id = $1', [source])
      await db.query('delete from public.organization_sources where id = $1', [source])
    }
    expect(await departments()).toContainEqual({ department_id: previous, is_primary: true })
  })

  it('does not let legacy profile updates change the primary or a browser invoke the service RPCs', async () => {
    const legacy = (destination: string) => db.query(
      'select public.admin_transfer_primary_department_v1($1, $2, $3, $4) as result',
      [admin, org, employee, destination],
    )
    expect((await legacy(previous)).rows).toEqual([{ result: true }])
    await expect(legacy(next)).rejects.toMatchObject({ detail: 'DEPARTMENT_TRANSFER_PREVIEW_REQUIRED' })
    const before = await preview()
    await db.exec('set role authenticated')
    try {
      await expect(preview()).rejects.toMatchObject({ code: '42501' })
      await expect(confirm(before.preview_id)).rejects.toMatchObject({ code: '42501' })
    } finally {
      await db.exec('reset role')
    }
  })
})

describe('confirmed secondary relationship changes', () => {
  beforeEach(async () => {
    const legacy = '20261126053054_guard_manual_department_ledger_membership.sql'
    await db.exec(functionDefinition(legacy, 'assert_manual_ledger_department_membership_v1'))
    await db.exec(functionDefinition(legacy, 'admin_change_manual_department_membership_v1', 'public'))
    await db.exec(migration('20261127153000_confirmed_secondary_department_membership.sql'))
  })

  async function legacy(action: 'add' | 'remove' | 'initialize', department: string, actor = admin) {
    return (await db.query<{ result: boolean }>(
      'select public.admin_change_manual_department_membership_v1($1,$2,$3,$4,$5) as result',
      [actor, org, employee, [department], action],
    )).rows[0].result
  }

  async function previewSecondary(action: 'add' | 'remove', department: string, actor = admin) {
    return (await db.query<{ result: Preview }>(
      'select public.preview_member_secondary_department_change_v1($1,$2,$3,$4,$5) as result',
      [org, actor, employee, [department], action],
    )).rows[0].result
  }

  async function confirmSecondary(previewId: string, actor = admin) {
    return (await db.query<{ result: unknown }>(
      'select public.confirm_member_secondary_department_change_v1($1,$2,$3,$4,$5) as result',
      [org, actor, employee, previewId, 'secondary-test'],
    )).rows[0].result
  }

  it('keeps legacy no-ops and invitation initialization while rejecting any direct write', async () => {
    expect(await legacy('add', secondary, employee)).toBe(true)
    expect(await legacy('remove', next, employee)).toBe(true)
    await expect(legacy('add', next)).rejects.toMatchObject({ detail: 'SECONDARY_DEPARTMENT_PREVIEW_REQUIRED' })
    await expect(legacy('remove', secondary)).rejects.toMatchObject({ detail: 'SECONDARY_DEPARTMENT_PREVIEW_REQUIRED' })
    expect(await legacy('remove', previous)).toBe(false)
    expect(await legacy('remove', outsiderDepartment)).toBe(false)
    await db.exec(`
      delete from public.user_departments where user_id = '${employee}';
      update public.users set status = 'inactive' where id = '${employee}';
      update public.user_organizations set status = 'invited' where user_id = '${employee}';
    `)
    expect(await legacy('initialize', previous)).toBe(true)
    expect(await departments()).toEqual([{ department_id: previous, is_primary: true }])
  })

  it('pauses departed-secondary grants after confirmation and keeps the public audit free of raw grants', async () => {
    const role = 'abababab-abab-4bab-8bab-abababababab'
    await db.exec(`
      insert into public.roles (id,code,name,permissions) values ('${role}', 'LOCAL_ROLE', '辅助角色', '["shipping:ledger_view"]');
      insert into public.user_roles (org_id,user_id,role_id,scope_type,scope_id)
        values ('${org}','${employee}','${role}','department','${secondary}');
    `)
    await db.query(
      'insert into private.employee_permission_overrides(org_id,user_id,permission_code,effect,scope) values ($1,$2,$3,$4,$5)',
      [org, employee, 'shipping:ledger_view', 'ALLOW', { type: 'department', departments: [{ department_id: secondary, include_subdepartments: false }] }],
    )
    const change = await previewSecondary('remove', secondary)
    expect(change).toMatchObject({
      action: 'remove', affected_department_ids: [secondary],
      impact: { roles_for_review: [{ role_id: role }], overrides_for_review: [{ resolution: 'blocked_pending_review' }] },
    })
    expect(await departments()).toContainEqual({ department_id: secondary, is_primary: false })
    expect((await db.query('select effect from private.employee_permission_overrides')).rows).toEqual([{ effect: 'ALLOW' }])
    expect(await confirmSecondary(change.preview_id)).toMatchObject({
      action: 'remove', affected_department_ids: [secondary], effective_at: expect.any(String),
    })
    expect(await departments()).toEqual([{ department_id: previous, is_primary: true }])
    expect((await db.query('select effect from private.employee_permission_overrides')).rows).toEqual([{ effect: 'DENY' }])
    expect((await db.query('select role_id from public.user_roles where user_id = $1', [employee])).rows).toEqual([])
    expect((await db.query('select kind from private.department_transfer_review_items order by kind')).rows)
      .toEqual([{ kind: 'personal_override' }, { kind: 'role' }])
    const events = (await db.query('select before_state, after_state from public.personnel_lifecycle_events')).rows
    expect(events).toEqual([{
      before_state: { department_ids: [previous, secondary] },
      after_state: { department_ids: [previous], action: 'remove', affected_department_ids: [secondary], effective_at: expect.any(String) },
    }])
    await expect(confirmSecondary(change.preview_id)).rejects.toMatchObject({ detail: 'SECONDARY_DEPARTMENT_STALE' })
  })

  it('binds a real change to the exact administrator and rejects previews after related data changes', async () => {
    await expect(previewSecondary('add', next, employee)).rejects.toMatchObject({ detail: 'DEPARTMENT_TRANSFER_FORBIDDEN' })
    const prior = await previewSecondary('add', next)
    await expect(confirmSecondary(prior.preview_id, otherAdmin)).rejects.toMatchObject({ detail: 'SECONDARY_DEPARTMENT_STALE' })
    await db.query('update public.organizations set settings = $1 where id = $2', [
      { department_permission_grants: { extra: 'changed after preview' } }, org,
    ])
    await expect(confirmSecondary(prior.preview_id)).rejects.toMatchObject({ detail: 'SECONDARY_DEPARTMENT_STALE' })
    const current = await previewSecondary('add', next)
    expect(await confirmSecondary(current.preview_id)).toMatchObject({ action: 'add', affected_department_ids: [next] })
    expect(await departments()).toEqual([
      { department_id: previous, is_primary: true }, { department_id: next, is_primary: false }, { department_id: secondary, is_primary: false },
    ])
    expect(await previewSecondary('add', next)).toMatchObject({ preview_id: null, expires_at: null, affected_department_ids: [] })
  })

  it('rejects modifying source-controlled links and still keeps an existing verified association', async () => {
    for (const provider of ['feishu', 'fxiaoke']) {
      await db.query('update public.user_departments set source = $1 where department_id = $2', [provider, secondary])
      expect(await legacy('add', secondary)).toBe(true)
      await expect(previewSecondary('remove', secondary)).rejects.toMatchObject({ detail: 'SECONDARY_DEPARTMENT_EXTERNAL_SOURCE' })
      await db.query('insert into public.organization_sources values ($1,$2,$3,$4)', [source, org, provider, { directory: 'authoritative' }])
      await db.query('insert into public.external_identities values ($1,$2,$3,$4)', [org, source, employee, 'matched'])
      await db.query('update public.departments set source = $1 where id = $2', [provider, next])
      await expect(previewSecondary('add', next)).rejects.toMatchObject({ detail: 'SECONDARY_DEPARTMENT_EXTERNAL_SOURCE' })
      await db.query('delete from public.external_identities where source_id = $1', [source])
      await db.query('delete from public.organization_sources where id = $1', [source])
    }
  })

  describe('single-save memberships and personal department differences', () => {
    const ledger = 'shipping:ledger_view'
    const recordReturn = 'shipping:record_return'
    const ownShipments = 'shipping:owner_view'
    const submittedShipping = 'shipping:owner_submit'

    beforeEach(async () => {
      await db.exec(migration('20261127161000_department_membership_override_choice.sql'))
      await db.exec(`
        insert into public.permission_points values
        ('${ledger}','published','atomic','shipping','shipping','ledger_view',
          array['org','department'],array[]::text[],'lib/shipping/http.ts'),
        ('${recordReturn}','published','atomic','shipping','shipping','record_return',
          array['org','department'],array['${ledger}'],'lib/shipping/http.ts');
      `)
    })

    async function savePrimary(requestId: string, choice: string | null = null, choiceId: string | null = null, by = admin) {
      return (await db.query<{ result: { status: string; choice_id: string } }>(
        'select public.save_member_department_transfer_v1($1,$2,$3,$4,false,$5,$6,$7) as result',
        [org, by, employee, next, choice, choiceId, requestId],
      )).rows[0].result
    }

    async function saveSecondary(action: 'add' | 'remove', selected: string, requestId: string,
      choice: string | null = null, choiceId: string | null = null,
    ) {
      return (await db.query<{ result: { status: string; choice_id: string } }>(
        'select public.save_member_secondary_department_change_v1($1,$2,$3,$4,$5,$6,$7,$8) as result',
        [org, admin, employee, [selected], action, choice, choiceId, requestId],
      )).rows[0].result
    }

    const scope = (id: string) => ({ type: 'department', departments: [{ department_id: id, include_subdepartments: false }] })
    function addOverride(permission: string, effect: 'ALLOW' | 'DENY', scoped: object | null) {
      return db.query('insert into private.employee_permission_overrides (org_id,user_id,permission_code,effect,scope) values ($1,$2,$3,$4,$5)',
        [org, employee, permission, effect, scoped])
    }
    async function overrides() {
      return (await db.query(
        'select permission_code, effect, scope from private.employee_permission_overrides order by permission_code',
      )).rows
    }

    it('saves A to B once, preserves independent overrides, and replays the same request without an extra audit', async () => {
      await addOverride(ownShipments, 'ALLOW', { type: 'self' })
      await addOverride(submittedShipping, 'DENY', null)
      await addOverride(ledger, 'ALLOW', scope(secondary))
      const before = await overrides()
      await db.exec('set role service_role')
      const applied = await savePrimary('existing-independent-scope')
      expect(applied).toMatchObject({
        status: 'applied', department_id: next, secondary_department_ids: [secondary],
        impact: { overrides_for_review: [] },
      })
      expect(await savePrimary('existing-independent-scope')).toEqual(applied)
      await expect(preview()).rejects.toMatchObject({ code: '42501' })
      await expect(previewSecondary('remove', secondary)).rejects.toMatchObject({ code: '42501' })
      await db.exec('reset role')
      expect(await departments()).toEqual([{ department_id: next, is_primary: true }, { department_id: secondary, is_primary: false }])
      expect(await overrides()).toEqual(before)
      expect((await db.query('select count(*)::int as count from public.personnel_lifecycle_events')).rows).toEqual([{ count: 1 }])
    })

    it('requires one scoped choice, binds it to the current rules, and keeps only a valid department selection', async () => {
      await addOverride(ledger, 'ALLOW', scope(previous))
      await addOverride(recordReturn, 'ALLOW', scope(next))
      const draft = await savePrimary('stale-choice')
      expect(draft).toMatchObject({
        status: 'override_choice_required', impact: { affected_count: 2, retainable_count: 1, blocked_count: 1 },
      })
      expect(await departments()).toContainEqual({ department_id: previous, is_primary: true })
      await expect(savePrimary('stale-choice', 'retain_eligible', draft.choice_id, otherAdmin))
        .rejects.toMatchObject({ detail: 'DEPARTMENT_TRANSFER_STALE' })
      await db.query('update public.organizations set settings = $1 where id = $2', [{ changed: true }, org])
      await expect(savePrimary('stale-choice', 'retain_eligible', draft.choice_id))
        .rejects.toMatchObject({ detail: 'DEPARTMENT_TRANSFER_STALE' })
      const fresh = await savePrimary('scoped-choice')
      const applied = await savePrimary('scoped-choice', 'retain_eligible', fresh.choice_id)
      expect(applied).toMatchObject({ status: 'applied', department_id: next })
      expect(await overrides()).toEqual([
        { permission_code: ledger, effect: 'DENY', scope: null },
        { permission_code: recordReturn, effect: 'ALLOW', scope: scope(next) },
      ])
      expect(await savePrimary('scoped-choice', 'retain_eligible', fresh.choice_id)).toEqual(applied)
      await expect(savePrimary('scoped-choice', 'new_baseline', fresh.choice_id))
        .rejects.toMatchObject({ detail: 'DEPARTMENT_TRANSFER_STALE' })
      expect((await db.query("select previous_grant->>'permission_code' as permission_code from private.department_transfer_review_items where kind = 'personal_override'")).rows)
        .toEqual([{ permission_code: ledger }])
    })

    it('holds a paused department under the departing branch and preserves an unrelated paused selection', async () => {
      const paused = '0a000000-0000-4000-8000-000000000001'
      const unrelatedPaused = '0a000000-0000-4000-8000-000000000002'
      await db.query(`insert into public.departments(id,org_id,name,status,parent_id)
        values ($1,$2,'旧部门停用子组','inactive',$3),($4,$2,'兼岗停用子组','inactive',$5)`,
      [paused, org, previous, unrelatedPaused, secondary])
      await addOverride(ledger, 'ALLOW', scope(paused))
      await addOverride(recordReturn, 'ALLOW', scope(unrelatedPaused))

      const draft = await savePrimary('paused-departing-selection')
      expect(draft).toMatchObject({ status: 'override_choice_required', impact: { affected_count: 1, blocked_count: 1 } })
      expect(await departments()).toContainEqual({ department_id: previous, is_primary: true })
      expect(await savePrimary('paused-departing-selection', 'retain_eligible', draft.choice_id)).toMatchObject({
        status: 'applied', department_id: next,
      })
      await db.query("update public.departments set status = 'active' where id = $1 or id = $2", [paused, unrelatedPaused])
      expect(await overrides()).toEqual([
        { permission_code: ledger, effect: 'DENY', scope: null },
        { permission_code: recordReturn, effect: 'ALLOW', scope: scope(unrelatedPaused) },
      ])
    })

    it('binds a paused secondary department selection to its confirmed removal', async () => {
      await db.query("update public.departments set status = 'inactive' where id = $1", [secondary])
      await addOverride(ledger, 'ALLOW', scope(secondary))

      const draft = await saveSecondary('remove', secondary, 'paused-secondary-selection')
      expect(draft).toMatchObject({ status: 'override_choice_required', impact: { affected_count: 1, blocked_count: 1 } })
      expect(await saveSecondary('remove', secondary, 'paused-secondary-selection', 'new_baseline', draft.choice_id)).toMatchObject({
        status: 'applied', affected_department_ids: [secondary],
      })
      await db.query("update public.departments set status = 'active' where id = $1", [secondary])
      expect(await overrides()).toEqual([])
    })

    it('uses a new baseline on removal of a secondary department and leaves other choices intact', async () => {
      await addOverride(ledger, 'ALLOW', scope(secondary))
      await addOverride(recordReturn, 'ALLOW', { type: 'org' })
      await addOverride(submittedShipping, 'DENY', null)
      const draft = await saveSecondary('remove', secondary, 'secondary-reset')
      expect(draft).toMatchObject({ status: 'override_choice_required', impact: { affected_count: 1, retainable_count: 0, blocked_count: 1 } })
      expect(await saveSecondary('remove', secondary, 'secondary-reset', 'new_baseline', draft.choice_id)).toMatchObject({
        status: 'applied', action: 'remove', affected_department_ids: [secondary],
      })
      expect(await overrides()).toEqual([
        { permission_code: submittedShipping, effect: 'DENY', scope: null },
        { permission_code: recordReturn, effect: 'ALLOW', scope: { type: 'org' } },
      ])
      expect(await saveSecondary('add', next, 'ordinary-secondary')).toMatchObject({
        status: 'applied', action: 'add', affected_department_ids: [next],
      })
      expect(await saveSecondary('add', next, 'secondary-already-current')).toMatchObject({
        status: 'unchanged', action: 'add', affected_department_ids: [],
      })
    })
  })
})

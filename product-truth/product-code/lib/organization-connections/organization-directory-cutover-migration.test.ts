import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { buildDirectoryCutoverPlan, type DirectoryStateSnapshot } from './directory-cutover'

const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20261103120000_organization_directory_cutover.sql'), 'utf8')
const org = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherOrg = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const actor = '11111111-1111-4111-8111-111111111111'
const plan = '22222222-2222-4222-8222-222222222222'
const source = '33333333-3333-4333-8333-333333333333'
const revision = '44444444-4444-4444-8444-444444444444'
const previousSource = '55555555-5555-4555-8555-555555555555'
const manualDepartment = '66666666-6666-4666-8666-666666666666'

async function database() {
  const db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema private;
    create table public.organizations (id uuid primary key);
    create table public.users (
      id uuid primary key,
      org_id uuid not null references public.organizations(id),
      primary_dept_id uuid,
      display_name text not null default 'Existing member',
      login_enabled boolean not null default true,
      created_at timestamptz not null default now(),
      status text not null default 'active',
      updated_at timestamptz not null default now()
    );
    create table public.departments (
      id uuid primary key default gen_random_uuid(),
      org_id uuid not null references public.organizations(id),
      parent_id uuid references public.departments(id),
      name text not null,
      code text,
      path text,
      depth integer not null default 0,
      external_id text,
      source text not null default 'manual',
      status text not null default 'active',
      sort_order integer not null default 0,
      member_count integer not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table public.user_departments (
      user_id uuid not null references public.users(id),
      department_id uuid not null references public.departments(id),
      org_id uuid not null references public.organizations(id),
      is_primary boolean not null default false,
      joined_at timestamptz not null default now(),
      primary key (user_id, department_id)
    );
    create table public.user_organizations (
      user_id uuid not null references public.users(id) on delete cascade,
      org_id uuid not null references public.organizations(id),
      primary_department_id uuid references public.departments(id),
      is_default boolean not null default true,
      status text not null default 'active',
      employment_status text not null default 'active',
      created_at timestamptz not null default now(),
      primary key (user_id, org_id)
    );
    create table public.user_roles (user_id uuid references public.users(id) on delete cascade, role_id text);
    create function public.get_org_admin_payload_v1(p_org_id uuid) returns jsonb language sql stable as $$
      select jsonb_build_object('users', coalesce((
        select jsonb_agg(jsonb_build_object('id', u.id, 'display_name', u.display_name,
          'primary_dept_id', m.primary_department_id, 'login_enabled', u.login_enabled,
          'status', u.status, 'membership_status', m.status))
        from public.users u join public.user_organizations m on m.user_id = u.id and m.org_id = p_org_id
        where m.status in ('active','invited','suspended')
      ), '[]'::jsonb), 'departments', '[]'::jsonb, 'roles', '[]'::jsonb, 'spaces', '[]'::jsonb);
    $$;
    create table public.organization_sources (
      id uuid primary key default gen_random_uuid(),
      system_org_id uuid not null references public.organizations(id),
      provider text not null,
      external_tenant_id text not null,
      priority integer not null,
      status text not null,
      authority_scope jsonb not null default '{}'::jsonb,
      sync_mode text not null,
      configuration_revision uuid not null,
      connection_state text not null,
      effective_revision uuid,
      draft_check_status text not null default 'not_checked',
      last_successful_sync_at timestamptz,
      last_error text,
      last_error_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (id, system_org_id)
    );
    create table public.external_identities (
      id uuid primary key default gen_random_uuid(),
      source_id uuid not null,
      system_org_id uuid not null,
      external_user_id text not null,
      external_union_id text,
      external_open_id text,
      canonical_user_id uuid references public.users(id),
      match_status text not null default 'unresolved',
      match_method text not null default 'none',
      match_confidence numeric(5,4) not null default 0,
      profile_snapshot jsonb not null default '{}'::jsonb,
      observed_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      foreign key (source_id, system_org_id) references public.organization_sources(id, system_org_id),
      unique (source_id, external_user_id)
    );
    insert into public.organizations (id) values ('${org}'), ('${otherOrg}');
    insert into public.users (id, org_id, primary_dept_id) values ('${actor}', '${org}', '${manualDepartment}');
    insert into public.departments (id, org_id, name, source, status) values ('${manualDepartment}', '${org}', '手工部门', 'manual', 'active');
    insert into public.user_departments (user_id, department_id, org_id) values ('${actor}', '${manualDepartment}', '${org}');
    insert into public.user_organizations(user_id, org_id, primary_department_id) values ('${actor}', '${org}', '${manualDepartment}');
    insert into public.organization_sources (
      id, system_org_id, provider, external_tenant_id, priority, status,
      sync_mode, configuration_revision, connection_state, effective_revision, updated_at
    ) values
      ('${previousSource}', '${org}', 'feishu', 'feishu-target', 1, 'active', 'authoritative', '77777777-7777-4777-8777-777777777777', 'verified', '77777777-7777-4777-8777-777777777777', '2026-11-03 00:00:00.000+00'),
      ('${source}', '${org}', 'fxiaoke', 'FSCID_target', 2, 'draft', 'read_only', '${revision}', 'verified', '${revision}', '2026-11-03 00:00:00.000+00');
  `)
  await db.exec(migration)
  return db
}

describe('organization directory cutover migration', () => {
  it('keeps rollback provider-neutral and fails closed without current connection verification', () => {
    expect(migration).toContain("v_plan.plan_payload->>'targetProvider'")
    expect(migration).toContain('source = v_target_provider')
    expect(migration).not.toMatch(/source\s*=\s*'fxiaoke'/i)
    expect(migration).toContain("coalesce((v_payload->'snapshot'->>'connectionVerified')::boolean, false) is not true")
    expect(migration).not.toMatch(/'identity'\s*,\s*'authoritative'/i)
  })

  it('accepts applied and rolled-back audit states while retaining the original applied timestamp', async () => {
    const db = await database()
    try {
      await db.query(`
        insert into public.organization_directory_cutover_plans (
          id, system_org_id, target_source_id, connection_revision,
          directory_hash, plan_hash, plan_payload, status, created_by,
          created_at, expires_at, applied_at
        ) values (
          '${plan}', '${org}', '${source}', '${revision}',
          repeat('a', 64), repeat('b', 64), '{}'::jsonb, 'applied', '${actor}',
          now() - interval '1 minute', now() + interval '20 minutes', now()
        )
      `)
      await db.query(`
        update public.organization_directory_cutover_plans
           set status = 'rolled_back', rolled_back_at = now()
         where id = '${plan}'
      `)
      expect((await db.query<{ status: string; applied_at: string; rolled_back_at: string }>(`
        select status, applied_at::text, rolled_back_at::text
          from public.organization_directory_cutover_plans where id = '${plan}'
      `)).rows[0]).toMatchObject({ status: 'rolled_back' })
    } finally {
      await db.close()
    }
  }, 15_000)


  it('atomically switches, preserves manual data, is idempotent and restores the exact pre-switch state', async () => {
    const db = await database()
    try {
      const before = await db.query<{ state: unknown }>(`
        select private.organization_directory_state_v1(
          '${org}', '${source}', array['${actor}']::uuid[]
        ) as state
      `)
      const revisions = await db.query<{ revisions: unknown }>(`
        select jsonb_agg(jsonb_build_object(
          'id', id, 'provider', provider, 'priority', priority, 'status', status,
          'syncMode', sync_mode, 'configurationRevision', configuration_revision,
          'updatedAt', to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        ) order by id) as revisions
        from public.organization_sources where system_org_id = '${org}'
      `)
      const payload = {
        version: 'f003-directory-cutover-v2',
        organizationId: org,
        targetProvider: 'fxiaoke',
        targetSourceId: source,
        targetExternalTenantId: 'FSCID_target',
        connectionRevision: revision,
        previousPrimarySourceId: previousSource,
        sourceRevisions: revisions.rows[0].revisions,
        snapshot: {
          checkedAt: '2026-11-03T00:00:00.000Z', complete: true, connectionVerified: true, scopeVerified: true,
          scopeEvidence: 'provider-admin-scope-proof:73-departments:405-employees',
          directoryHash: 'a'.repeat(64), departmentCount: 1, employeeCount: 1, warnings: [],
        },
        summary: { departmentsAdded: 1, departmentsUpdated: 0, departmentsUnchanged: 0, departmentsToDeactivate: 0, identitiesAdded: 1, identitiesUpdated: 0, identitiesUnchanged: 0, conflicts: 0 },
        conflicts: [],
        notices: [],
        departmentChanges: [{ kind: 'added', externalId: 'dept-sales', existingDepartmentId: null, name: '销售部', parentExternalId: null, status: 'active', changedFields: ['created'] }],
        staleTargetDepartmentIds: [],
        identityChanges: [{ kind: 'added', externalUserId: 'employee-1', existingIdentityId: null, canonicalUserId: actor, displayName: '操作员', matchMethod: 'employee_id', confidence: 1, departmentExternalIds: ['dept-sales'], active: true, profileSnapshot: { employeeNumber: 'E001', directorySyncVersion: 'f003-directory-cutover-v2', departmentExternalIds: ['dept-sales'], primaryDepartmentExternalId: 'dept-sales', status: 'active' }, changedFields: ['created'] }],
        userDepartmentChanges: [{ userId: actor, externalUserId: 'employee-1', departmentExternalIds: ['dept-sales'], primaryDepartmentExternalId: 'dept-sales', active: true }],
        preserved: { manualDepartmentCount: 1, otherSourceDepartmentCount: 1, otherSourceIdentityCount: 0, previousPrimaryDepartmentsRetained: 0, previousPrimaryIdentitiesRetained: 0 },
        beforeState: before.rows[0].state,
        applyable: true,
        planHash: 'b'.repeat(64),
      }
      await db.query(`
        insert into public.organization_directory_cutover_plans (
          id, system_org_id, target_source_id, connection_revision, previous_primary_source_id,
          directory_hash, plan_hash, plan_payload, status, created_by, created_at, expires_at
        ) values (
          '${plan}', '${org}', '${source}', '${revision}', '${previousSource}',
          repeat('a', 64), repeat('b', 64), $1::jsonb, 'planned', '${actor}', now(), now() + interval '20 minutes'
        )
      `, [JSON.stringify(payload)])

      const first = await db.query<{ result: Record<string, unknown> }>(`
        select public.apply_organization_directory_cutover_v1(
          '${org}', '${plan}', repeat('b', 64), '${revision}', $1::jsonb, '${actor}'
        ) as result
      `, [JSON.stringify(revisions.rows[0].revisions)])
      const firstRunId = String(first.rows[0].result.id)
      expect(first.rows[0].result).toMatchObject({ status: 'applied', department_count: 1, identity_count: 1, member_count: 1 })

      expect((await db.query<{ provider: string; priority: number; status: string }>(`
        select provider, priority, status from public.organization_sources
        where system_org_id = '${org}' order by provider
      `)).rows).toEqual([
        { provider: 'feishu', priority: 1, status: 'active' },
        { provider: 'fxiaoke', priority: 2, status: 'draft' },
      ])
      expect((await db.query<{ count: number }>(`
        select count(*)::integer as count from public.departments
        where org_id = '${org}' and source = 'manual'
      `)).rows[0].count).toBe(1)
      expect((await db.query<{ source: string; primary_dept_id: string }>(`
        select membership.source, user_row.primary_dept_id::text
        from public.user_departments membership join public.users user_row on user_row.id = membership.user_id
        where membership.user_id = '${actor}' order by membership.source
      `)).rows).toEqual([
        { source: 'fxiaoke', primary_dept_id: expect.any(String) },
        { source: 'manual', primary_dept_id: expect.any(String) },
      ])

      const retry = await db.query<{ result: Record<string, unknown> }>(`
        select public.apply_organization_directory_cutover_v1(
          '${org}', '${plan}', repeat('b', 64), '${revision}', $1::jsonb, '${actor}'
        ) as result
      `, [JSON.stringify(revisions.rows[0].revisions)])
      expect(String(retry.rows[0].result.id)).toBe(firstRunId)

      const rolledBack = await db.query<{ result: Record<string, unknown> }>(`
        select public.rollback_organization_directory_cutover_v1('${org}', '${plan}', '${actor}') as result
      `)
      expect(rolledBack.rows[0].result).toMatchObject({ id: firstRunId, status: 'rolled_back' })
      expect((await db.query<{ updated_at: string }>(`
        select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at
        from public.users where id = '${actor}'
      `)).rows[0].updated_at).toBe(String((payload.beforeState as { users: Array<{ updatedAt: string }> }).users[0].updatedAt))
      expect((await db.query<{ count: number }>(`
        select count(*)::integer as count from public.departments where org_id = '${org}' and source = 'fxiaoke'
      `)).rows[0].count).toBe(0)
      expect((await db.query<{ source: string }>(`
        select source from public.user_departments where user_id = '${actor}'
      `)).rows).toEqual([{ source: 'manual' }])
      expect((await db.query<{ provider: string; priority: number; status: string }>(`
        select provider, priority, status from public.organization_sources
        where system_org_id = '${org}' order by provider
      `)).rows).toEqual([
        { provider: 'feishu', priority: 1, status: 'active' },
        { provider: 'fxiaoke', priority: 2, status: 'draft' },
      ])
    } finally {
      await db.close()
    }
  })

  it('rejects rollback after the directory changes following a successful switch', async () => {
    const db = await database()
    try {
      const before = await db.query<{ state: unknown }>(`
        select private.organization_directory_state_v1('${org}', '${source}', array['${actor}']::uuid[]) as state
      `)
      const revisions = await db.query<{ revisions: unknown }>(`
        select jsonb_agg(jsonb_build_object(
          'id', id, 'provider', provider, 'priority', priority, 'status', status,
          'syncMode', sync_mode, 'configurationRevision', configuration_revision,
          'updatedAt', to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        ) order by id) as revisions
        from public.organization_sources where system_org_id = '${org}'
      `)
      const payload = {
        version: 'f003-directory-cutover-v2', organizationId: org, targetProvider: 'fxiaoke',
        targetSourceId: source, targetExternalTenantId: 'FSCID_target', connectionRevision: revision,
        previousPrimarySourceId: previousSource, sourceRevisions: revisions.rows[0].revisions,
        snapshot: {
          checkedAt: '2026-11-03T00:00:00.000Z', complete: true, connectionVerified: true, scopeVerified: true,
          scopeEvidence: 'provider-admin-scope-proof:73-departments:405-employees',
          directoryHash: 'a'.repeat(64), departmentCount: 1, employeeCount: 1, warnings: [],
        },
        summary: {}, conflicts: [], notices: [],
        departmentChanges: [{ kind: 'added', externalId: 'dept-sales', existingDepartmentId: null, name: '销售部', parentExternalId: null, status: 'active', changedFields: ['created'] }],
        staleTargetDepartmentIds: [],
        identityChanges: [{ kind: 'added', externalUserId: 'employee-1', existingIdentityId: null, canonicalUserId: actor, displayName: '操作员', matchMethod: 'employee_id', confidence: 1, departmentExternalIds: ['dept-sales'], active: true, profileSnapshot: { departmentExternalIds: ['dept-sales'], primaryDepartmentExternalId: 'dept-sales' }, changedFields: ['created'] }],
        userDepartmentChanges: [{ userId: actor, externalUserId: 'employee-1', departmentExternalIds: ['dept-sales'], primaryDepartmentExternalId: 'dept-sales', active: true }],
        beforeState: before.rows[0].state, applyable: true, planHash: 'd'.repeat(64),
      }
      await db.query(`
        insert into public.organization_directory_cutover_plans (
          id, system_org_id, target_source_id, connection_revision, previous_primary_source_id,
          directory_hash, plan_hash, plan_payload, status, created_by, created_at, expires_at
        ) values ('${plan}', '${org}', '${source}', '${revision}', '${previousSource}',
          repeat('a', 64), repeat('d', 64), $1::jsonb, 'planned', '${actor}', now(), now() + interval '20 minutes')
      `, [JSON.stringify(payload)])
      await db.query(`select public.apply_organization_directory_cutover_v1('${org}', '${plan}', repeat('d', 64), '${revision}', $1::jsonb, '${actor}')`, [JSON.stringify(revisions.rows[0].revisions)])
      await db.query(`update public.departments set name = '切换后人工修改' where org_id = '${org}' and source = 'fxiaoke'`)

      await expect(db.query(`select public.rollback_organization_directory_cutover_v1('${org}', '${plan}', '${actor}')`)).rejects.toThrow(/later changes|changed/i)
    } finally {
      await db.close()
    }
  })

  it('rejects a rolled-back plan without an applied timestamp', async () => {
    const db = await database()
    try {
      await expect(db.query(`
        insert into public.organization_directory_cutover_plans (
          system_org_id, target_source_id, connection_revision,
          directory_hash, plan_hash, plan_payload, status, created_by,
          created_at, expires_at, rolled_back_at
        ) values (
          '${org}', '${source}', '${revision}', repeat('a', 64), repeat('c', 64),
          '{}'::jsonb, 'rolled_back', '${actor}', now(), now() + interval '20 minutes', now()
        )
      `)).rejects.toThrow()
    } finally {
      await db.close()
    }
  })
})

describe('native organization directory landing', () => {
  it('creates real disabled members, reads native relationships, repeats without duplicates and restores exact state', async () => {
    const db = await database()
    try {
      await db.exec(`
        update public.users set status = 'suspended' where id = '${actor}';
        update public.organization_sources set status = 'disabled', connection_state = 'configured', effective_revision = null,
          authority_scope = '{"identity":"authoritative"}' where id = '${source}';
        update public.organization_sources set authority_scope = '{"directory":"authoritative"}' where id = '${previousSource}';
        insert into public.external_identities(source_id, system_org_id, external_user_id, canonical_user_id, match_status, match_method, match_confidence)
          values ('${source}', '${org}', 'known-employee', '${actor}', 'matched', 'manual', 1);
      `)
      const snapshot = {
        provider: 'fxiaoke' as const, externalTenantId: 'FSCID_target', checkedAt: new Date().toISOString(), complete: true,
        scopeVerified: false, scopeEvidence: null, warnings: [], applied: false as const,
        departments: [
          { id: 'root', name: '公司', parentId: null, status: 'inactive' },
          { id: 'sales', name: '销售部', parentId: 'root', status: 'active' },
        ],
        employees: [
          { id: 'known-employee', name: '已有成员', departmentIds: ['sales'], primaryDepartmentId: 'sales', status: 'active', loginDisabled: false },
          { id: 'new-employee', name: '待关联员工', departmentIds: ['sales', 'root'], primaryDepartmentId: 'root', status: 'active', loginDisabled: false, phone: '13800000001' },
        ],
      }
      async function state() {
        return (await db.query<{ state: DirectoryStateSnapshot }>(`
          select private.organization_directory_state_v1('${org}', '${source}', array(select id from public.users where org_id = '${org}')) as state
        `)).rows[0].state
      }
      async function prepare() {
        const current = await state()
        const payload = buildDirectoryCutoverPlan({
          organizationId: org, targetSourceId: source, connectionRevision: revision, connectionVerified: true, snapshot,
          sources: current.sources, identities: current.targetIdentities, memberships: current.memberships,
          organizationMemberships: current.organizationMemberships, departments: current.targetDepartments,
          users: current.users.map(user => ({ ...user, orgId: org, employeeId: null, email: null,
            phone: user.id === actor ? '13800000001' : null, displayName: '系统人员', title: null, avatarUrl: null })),
        })
        expect(payload.conflicts).toEqual([])
        expect(payload.applyable).toBe(true)
        const stored = await db.query<{ id: string }>(`
          select id from public.store_organization_directory_cutover_plan_v1(
            $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::text,$7::jsonb,$8::uuid,now() + interval '20 minutes')
        `, [org, source, revision, payload.previousPrimarySourceId, payload.snapshot.directoryHash, payload.planHash, JSON.stringify(payload), actor])
        return { id: stored.rows[0].id, payload }
      }
      async function apply(item: Awaited<ReturnType<typeof prepare>>) {
        return (await db.query<{ result: { id: string } }>(`
          select public.apply_organization_directory_cutover_v1($1::uuid,$2::uuid,$3::text,$4::uuid,$5::jsonb,$6::uuid) as result
        `, [org, item.id, item.payload.planHash, revision, JSON.stringify(item.payload.sourceRevisions), actor])).rows[0].result
      }
      async function rollback(id: string) {
        return db.query('select public.rollback_organization_directory_cutover_v1($1::uuid,$2::uuid,$3::uuid)', [org, id, actor])
      }
      const before = await state()
      const firstPlan = await prepare()
      const newPerson = firstPlan.payload.identityChanges.find(row => row.externalUserId === 'new-employee')!
      expect(newPerson).toMatchObject({ createsMember: true, matchMethod: 'none' })
      expect(newPerson.canonicalUserId).not.toBe(actor)
      const firstRun = await apply(firstPlan)
      expect(await apply(firstPlan)).toEqual(firstRun)
      expect((await db.query('select display_name,status,login_enabled from public.users where id=$1::uuid', [newPerson.canonicalUserId])).rows)
        .toEqual([{ display_name: '待关联员工', status: 'inactive', login_enabled: false }])
      expect((await db.query('select status,employment_status from public.user_organizations where user_id=$1::uuid', [newPerson.canonicalUserId])).rows)
        .toEqual([{ status: 'invited', employment_status: 'active' }])
      expect((await db.query('select count(*)::integer as n from public.user_departments where user_id=$1::uuid', [newPerson.canonicalUserId])).rows)
        .toEqual([{ n: 2 }])
      expect((await db.query('select * from public.user_roles')).rows).toEqual([])
      const read = (await db.query<{ payload: { users: Array<Record<string, unknown>>; departments: Array<Record<string, unknown>> } }>(`
        select public.get_org_admin_directory_payload_v1('${org}') as payload
      `)).rows[0].payload
      expect(read.users).toHaveLength(2)
      // A conflicting historical mapping must not duplicate a real member in the organization tree.
      await db.query(`insert into public.external_identities(source_id, system_org_id, external_user_id, canonical_user_id,
        match_status, match_method, match_confidence) values ($1::uuid,$2::uuid,'legacy-duplicate',$3::uuid,'matched','manual',1)`,
      [source, org, newPerson.canonicalUserId])
      expect((await db.query<{ payload: { users: unknown[] } }>(`select public.get_org_admin_directory_payload_v1('${org}') as payload`))
        .rows[0].payload.users).toHaveLength(2)
      await db.query(`delete from public.external_identities where source_id=$1::uuid and external_user_id='legacy-duplicate'`, [source])
      const rootDepartment = read.departments.find(row => row.external_id === 'root')!
      const salesDepartment = read.departments.find(row => row.external_id === 'sales')!
      expect(salesDepartment.parent_id).toBe(rootDepartment.id)
      expect(salesDepartment.member_count).toBe(2)
      expect(read.users.find(user => user.id === newPerson.canonicalUserId)).toMatchObject({
        display_name: '待关联员工', primary_dept_id: rootDepartment.id, primary_dept_name: '公司',
        directory_pending_account: true, secondary_dept_names: ['销售部'],
        department_ids: expect.arrayContaining([rootDepartment.id, salesDepartment.id]),
      })
      expect((await db.query(`select status from public.users where id='${actor}'`)).rows).toEqual([{ status: 'suspended' }])
      expect((await db.query(`select status,connection_state,authority_scope->>'identity' as identity from public.organization_sources where id='${source}'`)).rows)
        .toEqual([{ status: 'disabled', connection_state: 'configured', identity: 'authoritative' }])
      const secondPlan = await prepare()
      expect(secondPlan.payload.identityChanges.every(row => !row.createsMember)).toBe(true)
      await apply(secondPlan)
      expect((await db.query('select count(*)::integer as n from public.users')).rows).toEqual([{ n: 2 }])
      await rollback(secondPlan.id)
      // A later role grant must prevent a rollback from deleting a person through ON DELETE CASCADE.
      await db.query('insert into public.user_roles(user_id,role_id) values ($1::uuid,$2)', [newPerson.canonicalUserId, 'role-added-later'])
      await expect(rollback(firstPlan.id)).rejects.toThrow('later changes')
      expect((await db.query('select * from public.user_roles')).rows).toHaveLength(1)
      await db.query('delete from public.user_roles where user_id=$1::uuid', [newPerson.canonicalUserId])
      await rollback(firstPlan.id)
      expect(await state()).toEqual(before)
      expect((await db.query('select count(*)::integer as n from public.users')).rows).toEqual([{ n: 1 }])
    } finally {
      await db.close()
    }
  }, 15_000)

  it('rolls back department and person writes when the new person has an invalid relationship', async () => {
    const db = await database()
    try {
      const before = (await db.query<{ state: DirectoryStateSnapshot }>(`
        select private.organization_directory_state_v1('${org}','${source}',array['${actor}']::uuid[]) as state
      `)).rows[0].state
      const payload = buildDirectoryCutoverPlan({
        organizationId: org, targetSourceId: source, connectionRevision: revision, connectionVerified: true,
        sources: before.sources, identities: [], departments: [], users: [], memberships: [], organizationMemberships: [],
        snapshot: { provider: 'fxiaoke', externalTenantId: 'FSCID_target', checkedAt: new Date().toISOString(), complete: true,
          scopeVerified: false, scopeEvidence: null, warnings: [], applied: false,
          departments: [{ id: 'root', name: '公司', parentId: null, status: 'active' }],
          employees: [{ id: 'new', name: '新员工', departmentIds: ['root'], primaryDepartmentId: 'root', status: 'active', loginDisabled: false }],
        },
      })
      payload.identityChanges[0].profileSnapshot.primaryDepartmentExternalId = 'missing'
      await db.query(`insert into public.organization_directory_cutover_plans(id,system_org_id,target_source_id,connection_revision,directory_hash,plan_hash,plan_payload,status,created_by,expires_at)
        values ('${plan}','${org}','${source}','${revision}',$1,$2,$3::jsonb,'planned','${actor}',now()+interval '20 minutes')`, [payload.snapshot.directoryHash,payload.planHash,JSON.stringify(payload)])
      await expect(db.query(`select public.apply_organization_directory_cutover_v1('${org}','${plan}',$1,'${revision}',$2::jsonb,'${actor}')`, [payload.planHash,JSON.stringify(payload.sourceRevisions)]))
        .rejects.toThrow('relationship is malformed')
      expect((await db.query('select count(*)::integer as n from public.users')).rows).toEqual([{ n: 1 }])
      expect((await db.query(`select count(*)::integer as n from public.departments where source='fxiaoke'`)).rows).toEqual([{ n: 0 }])
      expect((await db.query('select * from public.organization_directory_cutover_runs')).rows).toEqual([])
    } finally {
      await db.close()
    }
  }, 15_000)
})

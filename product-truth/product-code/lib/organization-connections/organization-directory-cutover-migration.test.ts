import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'

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
  it('keeps rollback provider-neutral and fails closed without scope proof', () => {
    expect(migration).toContain("v_plan.plan_payload->>'targetProvider'")
    expect(migration).toContain('source = v_target_provider')
    expect(migration).not.toMatch(/source\s*=\s*'fxiaoke'/i)
    expect(migration).toContain("coalesce((v_payload->'snapshot'->>'scopeVerified')::boolean, false) is not true")
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
        version: 'f003-directory-cutover-v1',
        organizationId: org,
        targetProvider: 'fxiaoke',
        targetSourceId: source,
        targetExternalTenantId: 'FSCID_target',
        connectionRevision: revision,
        previousPrimarySourceId: previousSource,
        sourceRevisions: revisions.rows[0].revisions,
        snapshot: {
          checkedAt: '2026-11-03T00:00:00.000Z', complete: true, scopeVerified: true,
          scopeEvidence: 'provider-admin-scope-proof:73-departments:405-employees',
          directoryHash: 'a'.repeat(64), departmentCount: 1, employeeCount: 1, warnings: [],
        },
        summary: { departmentsAdded: 1, departmentsUpdated: 0, departmentsUnchanged: 0, departmentsToDeactivate: 0, identitiesAdded: 1, identitiesUpdated: 0, identitiesUnchanged: 0, conflicts: 0 },
        conflicts: [],
        notices: [],
        departmentChanges: [{ kind: 'added', externalId: 'dept-sales', existingDepartmentId: null, name: '销售部', parentExternalId: null, status: 'active', changedFields: ['created'] }],
        staleTargetDepartmentIds: [],
        identityChanges: [{ kind: 'added', externalUserId: 'employee-1', existingIdentityId: null, canonicalUserId: actor, displayName: '操作员', matchMethod: 'employee_id', confidence: 1, departmentExternalIds: ['dept-sales'], active: true, profileSnapshot: { employeeNumber: 'E001' }, changedFields: ['created'] }],
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
        { provider: 'feishu', priority: 1, status: 'disabled' },
        { provider: 'fxiaoke', priority: 1, status: 'active' },
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
        version: 'f003-directory-cutover-v1', organizationId: org, targetProvider: 'fxiaoke',
        targetSourceId: source, targetExternalTenantId: 'FSCID_target', connectionRevision: revision,
        previousPrimarySourceId: previousSource, sourceRevisions: revisions.rows[0].revisions,
        snapshot: {
          checkedAt: '2026-11-03T00:00:00.000Z', complete: true, scopeVerified: true,
          scopeEvidence: 'provider-admin-scope-proof:73-departments:405-employees',
          directoryHash: 'a'.repeat(64), departmentCount: 1, employeeCount: 1, warnings: [],
        },
        summary: {}, conflicts: [], notices: [],
        departmentChanges: [{ kind: 'added', externalId: 'dept-sales', existingDepartmentId: null, name: '销售部', parentExternalId: null, status: 'active', changedFields: ['created'] }],
        staleTargetDepartmentIds: [],
        identityChanges: [{ kind: 'added', externalUserId: 'employee-1', existingIdentityId: null, canonicalUserId: actor, displayName: '操作员', matchMethod: 'employee_id', confidence: 1, departmentExternalIds: ['dept-sales'], active: true, profileSnapshot: {}, changedFields: ['created'] }],
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

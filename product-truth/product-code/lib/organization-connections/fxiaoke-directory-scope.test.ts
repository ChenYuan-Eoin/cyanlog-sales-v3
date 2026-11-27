// @vitest-environment node
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ verified: vi.fn(), directory: vi.fn(), rpc: vi.fn() }))
vi.mock('./service', () => ({ loadVerifiedConnection: mocks.verified, readOrganizationDirectory: mocks.directory }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { rpc: mocks.rpc } }))

import { readFreshFxiaokeScopeProof, recordFxiaokeScopeProof } from './fxiaoke-directory-scope'
import type { readOrganizationDirectory } from './service'
import { productionSchemaDatabase } from './schema-baseline/database'

const org = '00000000-0000-4000-8000-000000000001'
const source = '00000000-0000-4000-8000-000000000002'
const actor = '00000000-0000-4000-8000-000000000003'
const revision = '00000000-0000-4000-8000-000000000004'
const proofId = '00000000-0000-4000-8000-000000000005'
const draft = '00000000-0000-4000-8000-000000000006'
const delegate = '00000000-0000-4000-8000-000000000007'
const delegateRole = '00000000-0000-4000-8000-000000000008'
const rootRole = '00000000-0000-4000-8000-000000000009'
const tenant = { ea: 'test-company', corpId: 'FSCID_test' }
const principal = { appId: 'FSAID_test', apiUserId: '101' }

function fixture() {
  const capturedAt = new Date(Date.now() - 1_000).toISOString()
  const departments = [
    { id: 'root', parentId: null, status: 'active' as const },
    { id: 'sales', parentId: 'root', status: 'active' as const },
    { id: 'support', parentId: 'root', status: 'inactive' as const },
  ]
  const employees = Array.from({ length: 13 }, (_, index) => ({
    id: `staff-${index}`, status: index === 12 ? 'inactive' as const : 'active' as const, primaryDepartmentId: 'sales',
    secondaryDepartmentIds: index === 0 ? ['root', 'support'] : [],
  }))
  return {
    sourceId: source, connectionRevision: revision, tenant, principal, capturedAt,
    scope: { rootDepartmentId: 'root', wholeCompany: true, includesStopped: true, unfiltered: true },
    evidence: { departmentExportSha256: 'a'.repeat(64), employeeExportSha256: 'b'.repeat(64) },
    departments, employees,
  }
}

function providerRead(data = fixture()): Awaited<ReturnType<typeof readOrganizationDirectory>> {
  return {
    binding: { organizationId: org, sourceId: source, provider: 'fxiaoke', externalTenantId: tenant.ea,
      connectionRevision: revision, sourceState: 'verified' },
    verifiedTenantIds: [tenant.ea, tenant.corpId], sourceUpdatedAt: data.capturedAt, sourceConfigurationRevision: revision,
    directory: {
      checkedAt: new Date().toISOString(), complete: true, scopeVerified: false, scopeEvidence: null, warnings: [],
      departments: data.departments.map(row => ({ ...row, name: 'internal department label' })),
      employees: data.employees.map(row => ({
        id: row.id, name: 'internal personal record', status: row.status, primaryDepartmentId: row.primaryDepartmentId,
        departmentIds: [row.primaryDepartmentId, ...row.secondaryDepartmentIds], loginDisabled: false, phone: 'test-PII',
      })),
    },
  }
}

const readProofCall = 'read_fxiaoke_directory_scope_proof_v1'
const recordProofCall = 'record_fxiaoke_directory_scope_proof_v1'
const unverified = { scopeVerified: false, scopeEvidence: null }

describe('independent Fxiaoke directory evidence', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.verified.mockResolvedValue({
      sourceId: source, revision, credentials: { ...principal, expectedEa: tenant.ea, expectedCorpId: tenant.corpId },
      summary: { revision, externalTenantId: tenant.ea },
    })
    mocks.directory.mockResolvedValue(providerRead())
  })

  function stubPersistence(data = fixture()) {
    let evidence: { p_roster_digest: string; p_principal_digest: string } | undefined
    const result = { id: proofId, capturedAt: data.capturedAt, verifiedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(), departmentCount: 3, employeeCount: 13 }
    mocks.rpc.mockImplementation(async (name: string, args: NonNullable<typeof evidence>) => {
      if (name === recordProofCall) {
        evidence = args
        return { data: result, error: null }
      }
      const matches = name === readProofCall && evidence?.p_roster_digest === args.p_roster_digest
        && evidence?.p_principal_digest === args.p_principal_digest
      return { data: matches ? { id: proofId, rosterDigest: args.p_roster_digest, expiresAt: result.expiresAt } : null, error: null }
    })
    return result
  }

  it('records exact evidence without retaining directory rows and resolves the same receipt after reorder', async () => {
    const data = fixture()
    const saved = stubPersistence(data)
    await expect(recordFxiaokeScopeProof(org, actor, data)).resolves.toEqual(saved)
    expect(mocks.directory).toHaveBeenCalledWith({ orgId: org, provider: 'fxiaoke', sourceId: source,
      revision, credentialSource: 'effective' })
    const [, recordArgs] = mocks.rpc.mock.calls[0]
    expect(recordArgs).toMatchObject({ p_org_id: org, p_source_id: source, p_actor_id: actor,
      p_connection_revision: revision, p_external_tenant_id: tenant.ea, p_tenant_corp_id: tenant.corpId,
      p_root_department_id: 'root', p_department_count: 3, p_employee_count: 13,
      p_department_export_digest: data.evidence.departmentExportSha256, p_employee_export_digest: data.evidence.employeeExportSha256 })
    expect(JSON.stringify(recordArgs)).not.toMatch(/staff-0|internal personal record|test-PII/)
    const reordered = providerRead(data)
    reordered.directory.departments.reverse()
    reordered.directory.employees.reverse().forEach(row => row.departmentIds.reverse())
    await expect(readFreshFxiaokeScopeProof(reordered)).resolves.toEqual({
      scopeVerified: true, scopeEvidence: `fx-roster-v1:${proofId}:${recordArgs.p_roster_digest}`, scopeExpiresAt: saved.expiresAt,
    })
  })

  it('confirms the exact roster despite isolated profile and competing phone claims', async () => {
    const data = fixture()
    const saved = stubPersistence(data)
    const observed = providerRead(data)
    observed.directory.employees[0] = {
      ...observed.directory.employees[0], sourceConflict: 'employee_profile', phone: null, loginDisabled: null,
    }
    observed.directory.employees[1] = {
      ...observed.directory.employees[1], sourceConflict: 'phone_claim', phone: null, loginDisabled: null,
    }
    mocks.directory.mockResolvedValueOnce(observed)
    await expect(recordFxiaokeScopeProof(org, actor, data)).resolves.toEqual(saved)
    await expect(readFreshFxiaokeScopeProof(observed)).resolves.toMatchObject({ scopeVerified: true })
  })

  it.each<[description: string, changes: Partial<ReturnType<typeof providerRead>['directory']['employees'][number]>]>([
    ['contradictory lifecycle', { sourceConflict: 'employee_profile', status: 'unknown' }],
    ['ambiguous primary', { sourceConflict: 'primary_department' }],
    ['a missing primary', { sourceConflict: 'employee_profile', primaryDepartmentId: null }],
    ['an omitted secondary membership', { sourceConflict: 'phone_claim', departmentIds: ['sales', 'root'] }],
  ])('withholds scope proof for %s despite the same headcount', async (_case, changes) => {
    const data = fixture()
    stubPersistence(data)
    await recordFxiaokeScopeProof(org, actor, data)
    const observed = providerRead(data)
    observed.directory.employees[0] = { ...observed.directory.employees[0], ...changes }
    mocks.directory.mockResolvedValueOnce(observed)
    await expect(recordFxiaokeScopeProof(org, actor, data)).rejects.toMatchObject({ code: 'DIRECTORY_SCOPE_MISMATCH' })
    await expect(readFreshFxiaokeScopeProof(observed)).resolves.toEqual(unverified)
    expect(mocks.rpc.mock.calls.filter(([name]) => name === recordProofCall)).toHaveLength(1)
  })

  it('refuses missing secondary coverage at equal headcount and ten absent staff in both issuance and readback', async () => {
    const data = fixture()
    stubPersistence(data)
    await recordFxiaokeScopeProof(org, actor, data)
    const sameCount = providerRead(data)
    sameCount.directory.employees[0].departmentIds = ['sales', 'root']
    const tenMissing = providerRead(data)
    tenMissing.directory.employees.splice(3)
    for (const altered of [sameCount, tenMissing]) {
      mocks.directory.mockResolvedValueOnce(altered)
      await expect(recordFxiaokeScopeProof(org, actor, data)).rejects.toMatchObject({ code: 'DIRECTORY_SCOPE_MISMATCH' })
      await expect(readFreshFxiaokeScopeProof(altered)).resolves.toEqual(unverified)
    }
    expect(mocks.rpc.mock.calls.filter(([name]) => name === recordProofCall)).toHaveLength(1)
  })

  it('fails closed for stale capture, ambiguous hierarchy, omitted secondary fields, and changed tenant or configuration', async () => {
    const data = fixture()
    const old = { ...data, capturedAt: new Date(Date.now() - 31 * 60_000).toISOString() }
    const incomplete = { ...data, employees: [{ id: 'staff-0', status: 'active', primaryDepartmentId: 'sales' }] }
    const duplicate = { ...data, departments: [...data.departments, data.departments[0]] }
    await expect(recordFxiaokeScopeProof(org, actor, old)).rejects.toMatchObject({ code: 'SCOPE_PROOF_EXPIRED' })
    await expect(recordFxiaokeScopeProof(org, actor, incomplete)).rejects.toMatchObject({ code: 'INVALID_SCOPE_PROOF' })
    await expect(recordFxiaokeScopeProof(org, actor, duplicate)).rejects.toMatchObject({ code: 'INVALID_SCOPE_PROOF' })
    await expect(recordFxiaokeScopeProof(org, actor, { ...data, principal: { ...principal, apiUserId: 'other' } }))
      .rejects.toMatchObject({ code: 'SCOPE_PROOF_SOURCE_MISMATCH' })
    await expect(readFreshFxiaokeScopeProof({ ...providerRead(), sourceConfigurationRevision: draft })).resolves.toEqual(unverified)
    const otherCorpid = { ...providerRead(), verifiedTenantIds: [tenant.ea, 'FSCID_other'] }
    mocks.directory.mockResolvedValueOnce(otherCorpid)
    await expect(recordFxiaokeScopeProof(org, actor, data)).rejects.toMatchObject({ code: 'SCOPE_PROOF_SOURCE_MISMATCH' })
    await expect(readFreshFxiaokeScopeProof(otherCorpid)).resolves.toEqual(unverified)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('leaves missing evidence or proof storage read-only', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } })
    await expect(readFreshFxiaokeScopeProof(providerRead())).resolves.toEqual(unverified)
    mocks.verified.mockRejectedValueOnce(new Error('temporary source change'))
    await expect(readFreshFxiaokeScopeProof(providerRead())).resolves.toEqual(unverified)
  })
})

describe('directory scope proof database boundary', () => {
  it('enforces current matching evidence around the existing apply and preserves historical retries', async () => {
    const db = await productionSchemaDatabase()
    try {
      const roleMigration = readFileSync(new URL(
        '../../supabase/migrations/20261126114126_allow_shipping_operator_department_ledger_roles.sql', import.meta.url,
      ), 'utf8')
      const resolveRole = roleMigration.match(/create function private\.shipping_role_effective_scope_permissions_v1\([\s\S]*?\n\$\$;/)?.[0]
      if (!resolveRole) throw new Error('Role permission resolver is missing from the deployed migration')
      await db.exec(resolveRole)
      await db.exec(`
        create table public.organization_directory_cutover_plans(
          id uuid primary key, system_org_id uuid, target_source_id uuid, status text,
          connection_revision uuid, plan_payload jsonb);
        create table private.applied_plans(id uuid);
        create function public.apply_organization_directory_cutover_v1(uuid, uuid, text, uuid, jsonb, uuid)
          returns jsonb language plpgsql security definer set search_path = '' as $$ begin
            if (select status from public.organization_directory_cutover_plans where id=$2) = 'applied' then
              return '{"status":"historical-retry"}'::jsonb;
            end if;
            insert into private.applied_plans values($2);
            return '{"status":"delegated"}'::jsonb;
          end $$;
        insert into public.organizations(id, name, status) values ('${org}', 'Scope fixture', 'active');
        insert into public.users(id, org_id, display_name, status, login_enabled) values
          ('${actor}', '${org}', 'Organization administrator', 'active', true),
          ('${delegate}', '${org}', 'Directory confirmer', 'active', true);
        insert into public.user_organizations(membership_id,user_id,org_id,status,employment_status,is_default) values
          (gen_random_uuid(), '${actor}', '${org}', 'active', 'active', true),
          (gen_random_uuid(), '${delegate}', '${org}', 'active', 'active', true);
        insert into public.roles(id,code,name,owner_org_id,permissions) values
          ('${rootRole}', 'SUPER_ADMIN', 'System administrator', null, '["*"]'),
          ('${delegateRole}', 'SCOPE_FIXTURE', 'Directory confirmer', '${org}', '["org:source_apply"]');
        insert into public.user_roles(org_id,user_id,role_id,scope_type,scope_id) values
          ('${org}', '${actor}', '${rootRole}', 'org', '${org}'),
          ('${org}', '${delegate}', '${delegateRole}', 'org', '${org}');
        insert into public.organization_sources(
          id, system_org_id, provider, priority, status, connection_state, external_tenant_id, configuration_revision, effective_revision, updated_at
        ) values ('${source}', '${org}', 'fxiaoke', 1, 'active', 'verified', '${tenant.ea}', '${revision}', '${revision}', now());
      `)
      await db.exec(readFileSync(new URL('../../supabase/migrations/20261127170000_fxiaoke_directory_scope_proof.sql', import.meta.url), 'utf8'))
      expect((await db.query<{ n: boolean }>(`select has_function_privilege('authenticated',
        'public.apply_organization_directory_cutover_v1(uuid,uuid,text,uuid,jsonb,uuid)', 'execute') as n`)).rows[0].n).toBe(false)
      expect((await db.query<{ n: boolean }>(`select has_function_privilege('service_role',
        'private.apply_organization_directory_before_scope_proof_v1(uuid,uuid,text,uuid,jsonb,uuid)', 'execute') as n`)).rows[0].n).toBe(false)
      const input = fixture()
      const roster = 'c'.repeat(64)
      const receipt = (id: string, digest = roster) => `fx-roster-v1:${id}:${digest}`
      const save = async (rosterDigest: string, age = '1 minute') => (await db.query<{ result: { id: string } }>(`
        select public.record_fxiaoke_directory_scope_proof_v1($1,$2,$3,$4,$5,
          (select updated_at from public.organization_sources where id=$2),$5,$6,$7,$8,
          clock_timestamp()-$9::interval,$10,$11,$12,3,13) as result
      `, [org, source, actor, revision, tenant.ea, tenant.corpId, 'd'.repeat(64), 'root', age,
        input.evidence.departmentExportSha256, input.evidence.employeeExportSha256, rosterDigest])).rows[0].result.id
      const plan = async (evidence: string, status = 'planned') => (await db.query<{ id: string }>(`
        insert into public.organization_directory_cutover_plans values(gen_random_uuid(),$1,$2,$3,$4,
          jsonb_build_object('targetExternalTenantId',$5::text,'snapshot',jsonb_build_object('scopeVerified',true,'scopeEvidence',$6::text))) returning id
      `, [org, source, status, revision, tenant.ea, evidence])).rows[0].id
      const apply = async (id: string, confirmer = actor) => {
        await db.exec('set role service_role')
        try {
          return (await db.query<{ result: unknown }>('select public.apply_organization_directory_cutover_v1($1,$2,$3,$4,$5,$6) as result',
            [org, id, roster, revision, '[]', confirmer])).rows[0].result
        } finally { await db.exec('set role postgres') }
      }
      const denied = { code: '23514', detail: 'DIRECTORY_SCOPE_UNVERIFIED' }
      await expect(apply(await plan('unverified nonempty proof'))).rejects.toMatchObject(denied)
      const recorded = await save(roster)
      await expect(apply(await plan(receipt(proofId)))).rejects.toMatchObject(denied)
      await expect(apply(await plan(receipt(recorded, 'e'.repeat(64))))).rejects.toMatchObject(denied)
      expect((await db.query<{ n: number }>('select count(*)::int as n from private.applied_plans')).rows[0].n).toBe(0)

      const read = (digest: string) => db.query<{ result: unknown }>(
        'select public.read_fxiaoke_directory_scope_proof_v1($1,$2,$3,$4,$5,$6,$7) as result',
        [org, source, revision, tenant.ea, 'd'.repeat(64), 'root', digest],
      ).then(result => result.rows[0].result)
      expect(await read(roster)).toEqual({ id: recorded, rosterDigest: roster, expiresAt: expect.any(String) })
      const delegatedPlan = await plan(receipt(recorded))
      await db.query('update public.organizations set settings=$2::jsonb where id=$1',
        [org, JSON.stringify({ role_permission_overrides: { [delegateRole]: [] } })])
      await expect(apply(delegatedPlan, delegate)).rejects.toMatchObject({ code: '42501' })
      expect((await db.query<{ n: number }>('select count(*)::int as n from private.applied_plans')).rows[0].n).toBe(0)
      await db.query("update public.organizations set settings='{}'::jsonb where id=$1", [org])
      await expect(apply(delegatedPlan, delegate)).resolves.toEqual({ status: 'delegated' })

      const newer = 'e'.repeat(64)
      const latest = await save(newer, '10 seconds')
      expect(await read(roster)).toBeNull()
      await expect(apply(await plan(receipt(recorded)))).rejects.toMatchObject(denied)
      await db.query('update public.organization_sources set configuration_revision=$1 where id=$2', [draft, source])
      expect(await read(newer)).toBeNull()
      await expect(apply(await plan(receipt(latest, newer)))).rejects.toMatchObject(denied)
      await db.query('update public.organization_sources set configuration_revision=$1 where id=$2', [revision, source])
      await db.exec(`update private.fxiaoke_directory_scope_proofs set captured_at=captured_at-interval '31 minutes',
        verified_at=verified_at-interval '31 minutes', expires_at=expires_at-interval '31 minutes'`)
      expect(await read(newer)).toBeNull()
      await expect(apply(await plan(receipt(latest, newer)))).rejects.toMatchObject(denied)
      await expect(apply(await plan('historical proof shape', 'applied'))).resolves.toEqual({ status: 'historical-retry' })
      expect((await db.query<{ n: number }>('select count(*)::int as n from private.applied_plans')).rows[0].n).toBe(1)
    } finally { await db.close() }
  }, 20_000)
})

describe('observed phone history on the Production schema', () => {
  it('preserves existing profiles and retains conflicting observations across changes', async () => {
    const db = await productionSchemaDatabase()
    try {
      await db.exec(`
        insert into public.organizations(id,name) values ('${org}', 'Phone history fixture');
        insert into public.users(id,org_id,display_name,phone,phone_verified) values
          ('${actor}','${org}','First holder','139-0000-0001',true),
          ('${delegate}','${org}','Second holder','+8613900000001',false);
      `)
      const profiles = () => db.query('select id,phone,phone_verified,updated_at from public.users order by id')
      const before = (await profiles()).rows
      const migration = readFileSync(new URL(
        '../../supabase/migrations/20261127171000_fxiaoke_observed_phone_history.sql', import.meta.url,
      ), 'utf8')
      await db.exec(migration)
      expect((await profiles()).rows).toEqual(before)
      const observations = () => db.query(`
        select user_id,phone,valid_to is not null as closed
        from public.phone_history where org_id=$1 order by user_id,valid_from
      `, [org])
      expect((await observations()).rows).toEqual([
        { user_id: actor, phone: '+8613900000001', closed: false },
        { user_id: delegate, phone: '+8613900000001', closed: false },
      ])
      await db.query('update public.users set phone=$2 where id=$1', [actor, '13900000002'])
      await db.query('update public.users set phone=$2 where id=$1', [actor, '+8613900000002'])
      expect((await observations()).rows).toEqual([
        { user_id: actor, phone: '+8613900000001', closed: true },
        { user_id: actor, phone: '+8613900000002', closed: false },
        { user_id: delegate, phone: '+8613900000001', closed: false },
      ])
      const acl = await db.query(`select
        has_table_privilege('authenticated','public.phone_history','SELECT') as browser_read,
        has_table_privilege('service_role','public.phone_history','SELECT') as service_read,
        has_table_privilege('service_role','public.phone_history','INSERT') as service_write
      `)
      expect(acl.rows).toEqual([{ browser_read: false, service_read: true, service_write: false }])
    } finally { await db.close() }
  }, 20_000)
})

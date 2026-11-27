// @vitest-environment node
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ verified: vi.fn(), directory: vi.fn(), rpc: vi.fn() }))
vi.mock('./service', () => ({ loadVerifiedConnection: mocks.verified, readOrganizationDirectory: mocks.directory }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { rpc: mocks.rpc } }))

import { readFreshFxiaokeScopeProof, recordFxiaokeScopeProof } from './fxiaoke-directory-scope'
import type { readOrganizationDirectory } from './service'

const org = '00000000-0000-4000-8000-000000000001'
const source = '00000000-0000-4000-8000-000000000002'
const actor = '00000000-0000-4000-8000-000000000003'
const revision = '00000000-0000-4000-8000-000000000004'
const proofId = '00000000-0000-4000-8000-000000000005'
const draft = '00000000-0000-4000-8000-000000000006'
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
    const db = new PGlite()
    try {
      await db.exec(`
        create schema private;
        create role anon; create role authenticated; create role service_role;
        create table public.organizations(id uuid primary key);
        create table public.organization_sources(id uuid, system_org_id uuid, provider text,
          status text, connection_state text, external_tenant_id text, configuration_revision uuid, effective_revision uuid,
          updated_at timestamptz, primary key(id, system_org_id));
        create table public.organization_directory_cutover_plans(
          id uuid primary key, system_org_id uuid, target_source_id uuid, status text,
          connection_revision uuid, plan_payload jsonb);
        create table private.applied_plans(id uuid);
        create function private.personnel_lock_org_v1(p_org uuid)
          returns void language sql as $$ select pg_advisory_xact_lock(hashtextextended(p_org::text,0)) $$;
        create function private.assert_system_role_assignment_actor_v1(p_actor uuid, p_org uuid)
          returns void language plpgsql as $$ begin
            perform private.personnel_lock_org_v1(p_org);
            if p_actor <> '${actor}' then raise exception 'not an admin' using errcode='42501'; end if;
          end $$;
        create function public.apply_organization_directory_cutover_v1(uuid, uuid, text, uuid, jsonb, uuid)
          returns jsonb language plpgsql security definer set search_path = '' as $$ begin
            if (select status from public.organization_directory_cutover_plans where id=$2) = 'applied' then
              return '{"status":"historical-retry"}'::jsonb;
            end if;
            insert into private.applied_plans values($2);
            return '{"status":"delegated"}'::jsonb;
          end $$;
        insert into public.organizations values ('${org}');
        insert into public.organization_sources values ('${source}','${org}','fxiaoke','active','verified',
          '${tenant.ea}','${revision}','${revision}', now());
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
      const apply = async (id: string) => {
        await db.exec('set role service_role')
        try {
          return (await db.query<{ result: unknown }>('select public.apply_organization_directory_cutover_v1($1,$2,$3,$4,$5,$6) as result',
            [org, id, roster, revision, '[]', actor])).rows[0].result
        } finally { await db.exec('reset role') }
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
      await expect(apply(await plan(receipt(recorded)))).resolves.toEqual({ status: 'delegated' })

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

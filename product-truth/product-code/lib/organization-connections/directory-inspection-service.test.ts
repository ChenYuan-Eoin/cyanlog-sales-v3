// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  mode: vi.fn(), from: vi.fn(), verify: vi.fn(), read: vi.fn(), decrypt: vi.fn(),
  write: vi.fn(() => { throw new Error('inspection must never write') }),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from, rpc: mocks.write } }))
vi.mock('./storage', () => ({ detectConnectionStorageMode: mocks.mode }))
vi.mock('./crypto', () => ({ decryptConnectionPayload: mocks.decrypt }))
vi.mock('./adapters', () => ({
  isConfigurableProvider: (value: string) => value === 'fxiaoke' || value === 'feishu',
  getConnectionAdapter: () => ({ verifyConnection: mocks.verify }),
  getDirectoryAdapter: () => ({ readDirectory: mocks.read, normalizeDirectoryStatus: (status: string) => status === 'resigned' ? 'inactive' : status }),
}))
import { inspectOrganizationDirectory, loadOrganizationConnection } from './service'

const input = { orgId: 'org-1', provider: 'fxiaoke', sourceId: 'source-1', revision: 'revision-1' }
const source = {
  id: input.sourceId, system_org_id: input.orgId, provider: input.provider, external_tenant_id: 'tenant-1',
  configuration_revision: input.revision, draft_credentials_ciphertext: 'encrypted', draft_credential_envelope: 'v1',
  connection_state: 'disabled', status: 'disabled', updated_at: '2026-11-04T10:00:00.000Z',
}
let beforeRead: Record<string, unknown>
let legacyEa: string
let sourceReads: number
let afterRead: Record<string, unknown> | null
const filters: Array<[string, unknown]> = []
beforeEach(() => {
  vi.clearAllMocks()
  sourceReads = 0
  beforeRead = source
  legacyEa = 'tenant-1'
  afterRead = source
  filters.length = 0
  mocks.mode.mockResolvedValue('unified')
  mocks.decrypt.mockReturnValue({ savedCredential: 'private-fixture' })
  mocks.verify.mockResolvedValue({ externalTenantId: 'tenant-1', checkedAt: '2026-11-04T10:00:00Z', credentialPatch: { ephemeralToken: 'example-ephemeral-token' } })
  mocks.read.mockResolvedValue({ checkedAt: '2026-11-04T10:00:00Z', complete: true, scopeVerified: false, scopeEvidence: null, departments: [], employees: [], warnings: [] })
  mocks.from.mockImplementation((table: string) => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn((column: string, value: unknown) => { filters.push([column, value]); return query }),
      update: mocks.write, insert: mocks.write, upsert: mocks.write, delete: mocks.write,
      maybeSingle: vi.fn(async () => ({ data: {
        system_org_id: input.orgId, expected_ea: legacyEa, revision: input.revision,
        credentials_ciphertext: 'encrypted', last_check_status: 'preview_ready', updated_at: source.updated_at,
      }, error: null })),
      then: (resolve: (value: unknown) => unknown) => {
        if (table !== 'organization_sources') throw new Error(`unexpected table ${table}`)
        const row = sourceReads++ === 0 ? beforeRead : afterRead
        return Promise.resolve({ data: row ? [row] : [], error: null }).then(resolve)
      },
    }
    return query
  })
})

describe('inspection service read-only boundaries', () => {
  it.each(['unified', 'legacy_fxiaoke_read_only'])('reads %s without reviving a disabled source or persisting verification', async mode => {
    mocks.mode.mockResolvedValue(mode)
    const report = await inspectOrganizationDirectory(input)
    expect(report).toMatchObject({ binding: { sourceState: 'disabled', connectionRevision: input.revision }, dataStatus: 'empty', applied: false })
    expect(mocks.read).toHaveBeenCalledWith({ savedCredential: 'private-fixture', ephemeralToken: 'example-ephemeral-token' }, { systemOrgId: input.orgId })
    expect(filters).toContainEqual(['system_org_id', input.orgId])
    expect(filters).toContainEqual(['provider', 'fxiaoke'])
    expect(mocks.write).not.toHaveBeenCalled()
    expect(JSON.stringify(report)).not.toContain('private-fixture')
    expect(JSON.stringify(report)).not.toContain('example-ephemeral-token')
  })

  it('matches legacy EA and source corpId only through the same current provider verification', async () => {
    mocks.mode.mockResolvedValue('legacy_fxiaoke_read_only')
    legacyEa = 'ones001'
    beforeRead = afterRead = { ...source, external_tenant_id: 'FSCID_company' }
    await expect(loadOrganizationConnection(input.orgId, input.provider)).resolves.toMatchObject({
      sourceId: input.sourceId, externalTenantId: 'FSCID_company', configured: true, state: 'disabled', effectiveVerified: false,
    })
    expect(mocks.verify).not.toHaveBeenCalled()
    mocks.verify.mockResolvedValue({ externalTenantId: 'ones001', verifiedTenantIds: ['ones001', 'FSCID_company'] })
    const report = await inspectOrganizationDirectory(input)
    expect(report.binding).toMatchObject({ externalTenantId: 'FSCID_company', sourceState: 'disabled' })
    expect(mocks.read).toHaveBeenCalledOnce()
    expect(mocks.write).not.toHaveBeenCalled()
  })

  it.each([
    { externalTenantId: 'ones001' },
    { externalTenantId: 'ones001', verifiedTenantIds: ['ones001', 'FSCID_foreign'] },
    { externalTenantId: 'foreign-ea', verifiedTenantIds: ['foreign-ea', 'FSCID_company'] },
  ])('rejects a missing or mismatched current EA/corpId pair before reading: %o', async verification => {
    mocks.mode.mockResolvedValue('legacy_fxiaoke_read_only')
    legacyEa = 'ones001'
    beforeRead = afterRead = { ...source, external_tenant_id: 'FSCID_company' }
    mocks.verify.mockResolvedValue(verification)
    await expect(inspectOrganizationDirectory(input)).rejects.toMatchObject({ code: 'ENTERPRISE_MISMATCH' })
    expect(mocks.read).not.toHaveBeenCalled()
    expect(mocks.write).not.toHaveBeenCalled()
  })

  it.each([{ sourceId: 'other-source' }, { revision: 'old-revision' }])('rejects stale binding %o before using credentials', async change => {
    await expect(inspectOrganizationDirectory({ ...input, ...change })).rejects.toMatchObject({ code: 'CONFIG_CHANGED' })
    expect(mocks.verify).not.toHaveBeenCalled()
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it('rejects enterprise mismatch before reading a directory', async () => {
    mocks.verify.mockResolvedValue({ externalTenantId: 'foreign-tenant' })
    await expect(inspectOrganizationDirectory(input)).rejects.toMatchObject({ code: 'ENTERPRISE_MISMATCH' })
    expect(mocks.read).not.toHaveBeenCalled()
    expect(mocks.write).not.toHaveBeenCalled()
  })

  it.each([
    null,
    { ...source, configuration_revision: 'new-revision' },
    { ...source, status: 'active' },
    { ...source, connection_state: 'verified' },
    { ...source, draft_credentials_ciphertext: 'new-encrypted' },
  ])('discards a read if the source disappeared or changed concurrently', async current => {
    afterRead = current
    await expect(inspectOrganizationDirectory(input)).rejects.toMatchObject({ code: 'CONFIG_CHANGED' })
    expect(mocks.read).toHaveBeenCalledTimes(1)
    expect(mocks.write).not.toHaveBeenCalled()
  })

  it('does not persist a failure or change the saved state after provider rejection', async () => {
    mocks.read.mockRejectedValue(new Error('provider unavailable'))
    await expect(inspectOrganizationDirectory(input)).rejects.toThrow('provider unavailable')
    expect(mocks.write).not.toHaveBeenCalled()
  })

  it('uses the provider lifecycle normalization before evaluating personnel structure', async () => {
    mocks.read.mockResolvedValue({
      checkedAt: '2026-11-04T10:00:00Z', complete: true, scopeVerified: false, scopeEvidence: null,
      departments: [{ id: 'd', name: '部门', parentId: null, status: 'active' }],
      employees: [{ id: 'p', name: '员工', departmentIds: ['d'], primaryDepartmentId: 'd', status: 'resigned', loginDisabled: true }],
      warnings: ['旧流程的登录及寄件说明'],
    })
    const report = await inspectOrganizationDirectory(input)
    expect(report.structure.complete).toBe(true)
    expect(report.employees[0].status).toBe('inactive')
    expect(JSON.stringify(report)).not.toContain('登录')
    expect(JSON.stringify(report)).not.toContain('寄件')
  })
})

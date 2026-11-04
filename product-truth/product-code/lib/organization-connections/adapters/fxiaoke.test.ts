import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  discoverEnterprise: vi.fn(),
  previewDirectory: vi.fn(),
  transport: vi.fn(),
}))

vi.mock('@/lib/fxiaoke/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/fxiaoke/client')>(),
  discoverEnterprise: mocks.discoverEnterprise,
  previewDirectory: mocks.previewDirectory,
}))
vi.mock('@/lib/fxiaoke/egress/server', () => ({
  transportForOrganization: () => mocks.transport,
}))
vi.mock('@/lib/fxiaoke/crypto', () => ({
  decryptCredentials: vi.fn(),
}))

import { fxiaokeConnectionAdapter, fxiaokeDirectoryAdapter } from './fxiaoke'

const credentials = {
  appId: 'cli_fxiaoke',
  appSecret: 'secret',
  permanentCode: 'permanent',
  expectedEa: 'pending-cli_fxiaoke',
  apiUserId: 'employee-1',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Fxiaoke adapter capability boundary', () => {
  it('verifies application credentials without reading the directory', async () => {
    mocks.discoverEnterprise.mockResolvedValue({ ea: 'FSCID_company', corpId: 'corp-1' })

    await expect(fxiaokeConnectionAdapter.verifyConnection(credentials, { systemOrgId: 'org-1' }))
      .resolves.toMatchObject({
        externalTenantId: 'FSCID_company',
        credentialPatch: { expectedEa: 'FSCID_company', expectedCorpId: 'corp-1' },
      })
    expect(mocks.discoverEnterprise).toHaveBeenCalledOnce()
    expect(mocks.previewDirectory).not.toHaveBeenCalled()
  })

  it('reads the authorized directory scope without redefining credential validity', async () => {
    mocks.previewDirectory.mockResolvedValue({
      ea: 'FSCID_company',
      corpId: 'corp-1',
      checkedAt: '2026-11-04T00:00:00.000Z',
      departments: [{ id: 'department-1', name: '销售部', parentId: null, status: 'active' }],
      employees: [{ id: 'employee-1', name: '员工甲', departmentIds: ['department-1'], primaryDepartmentId: 'department-1', status: 'active', loginDisabled: false }],
      complete: true,
      warnings: [],
      visibility: 'authorized_scope',
      applied: false,
    })

    await expect(fxiaokeDirectoryAdapter.readDirectory({ ...credentials, expectedEa: 'FSCID_company' }, { systemOrgId: 'org-1' }))
      .resolves.toMatchObject({ complete: true, scopeVerified: false, scopeEvidence: null })
    expect(mocks.previewDirectory).toHaveBeenCalledOnce()
    expect(mocks.discoverEnterprise).not.toHaveBeenCalled()
  })
})

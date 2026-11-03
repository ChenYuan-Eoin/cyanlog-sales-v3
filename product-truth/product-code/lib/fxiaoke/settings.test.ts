// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const shared = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  credentials: vi.fn(),
  preview: vi.fn(),
}))

vi.mock('@/lib/organization-connections', () => ({
  loadOrganizationConnection: shared.load,
  saveOrganizationConnection: shared.save,
  loadVerifiedConnection: shared.credentials,
  previewOrganizationConnection: shared.preview,
}))

import { loadConnection, loadOAuthCredentials, previewSavedConnection, saveConnection } from './settings'

const summary = {
  sourceId: 'source-1',
  provider: 'fxiaoke' as const,
  externalTenantId: 'FSCID_primary',
  revision: 'revision-1',
  state: 'verified' as const,
  draftCheckStatus: 'preview_ready' as const,
  configured: true,
  effectiveVerified: true,
  metadata: { appId: 'FSAID_test', expectedEa: 'FSCID_primary', apiUserId: '10001' },
  lastCheckedAt: '2026-11-03T05:00:00.000Z',
  lastVerifiedAt: '2026-11-03T05:00:00.000Z',
  lastError: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  shared.load.mockResolvedValue(summary)
  shared.save.mockResolvedValue(summary)
  shared.credentials.mockResolvedValue({
    sourceId: 'source-1',
    provider: 'fxiaoke',
    revision: 'effective-revision',
    credentials: {
      appId: 'FSAID_test',
      appSecret: 'secret',
      permanentCode: 'permanent',
      expectedEa: 'FSCID_primary',
      apiUserId: '10001',
    },
    summary,
  })
  shared.preview.mockResolvedValue({
    connection: summary,
    preview: {
      checkedAt: '2026-11-03T05:00:00.000Z',
      provider: 'fxiaoke',
      externalTenantId: 'FSCID_primary',
      departments: [{ id: 'dept-1', name: '销售部', parentId: null, status: 'active' }],
      employees: [{ id: 'employee-1', name: '张三', departmentIds: ['dept-1'], status: 'active', loginDisabled: false }],
      warnings: ['仅包含当前员工可访问范围'],
      applied: false,
    },
  })
})

describe('Fxiaoke shared connection wrapper', () => {
  it('reads only public metadata from the unified organization source record', async () => {
    await expect(loadConnection('org-1')).resolves.toEqual({
      appId: 'FSAID_test',
      expectedEa: 'FSCID_primary',
      apiUserId: '10001',
      revision: 'revision-1',
      configured: true,
      lastCheckedAt: '2026-11-03T05:00:00.000Z',
      lastCheckStatus: 'preview_ready',
      lastError: null,
    })
    expect(shared.load).toHaveBeenCalledWith('org-1', 'fxiaoke')
  })

  it('saves the provider-specific value through the shared service', async () => {
    const value = {
      appId: 'FSAID_test',
      appSecret: 'secret',
      permanentCode: 'permanent',
      expectedEa: 'FSCID_primary',
      apiUserId: '10001',
      revision: null,
    }
    await saveConnection('org-1', 'admin-1', value)
    expect(shared.save).toHaveBeenCalledWith({
      orgId: 'org-1',
      actorId: 'admin-1',
      provider: 'fxiaoke',
      value,
    })
  })

  it('uses only a verified effective connection for OAuth credentials', async () => {
    await expect(loadOAuthCredentials('org-1')).resolves.toMatchObject({
      appId: 'FSAID_test',
      appSecret: 'secret',
      expectedEa: 'FSCID_primary',
    })
    expect(shared.credentials).toHaveBeenCalledWith({ orgId: 'org-1', provider: 'fxiaoke' })
    expect(shared.load).not.toHaveBeenCalled()
  })

  it('previews a saved revision through the same lifecycle without applying the directory', async () => {
    await expect(previewSavedConnection('org-1', 'revision-1', 'admin-1')).resolves.toMatchObject({
      ea: 'FSCID_primary',
      checkedAt: '2026-11-03T05:00:00.000Z',
      departments: [{ id: 'dept-1', name: '销售部', parentId: null, status: 'active' }],
      employees: [{ id: 'employee-1', name: '张三', departmentIds: ['dept-1'], status: 'active', loginDisabled: false }],
      warnings: ['仅包含当前员工可访问范围'],
      applied: false,
    })
    expect(shared.preview).toHaveBeenCalledWith({
      orgId: 'org-1',
      actorId: 'admin-1',
      provider: 'fxiaoke',
      revision: 'revision-1',
    })
  })

  it('preserves shared lifecycle errors as Fxiaoke contract errors', async () => {
    shared.credentials.mockRejectedValue(Object.assign(new Error('尚未验证'), {
      code: 'CONNECTION_NOT_VERIFIED',
      status: 409,
    }))
    await expect(loadOAuthCredentials('org-1')).rejects.toMatchObject({
      code: 'CONNECTION_NOT_VERIFIED',
      status: 409,
    })
  })
})

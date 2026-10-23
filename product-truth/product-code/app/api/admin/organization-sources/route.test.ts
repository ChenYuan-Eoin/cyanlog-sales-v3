import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  defaultOrgId: vi.fn(),
  assignments: vi.fn(),
  canManage: vi.fn(),
  load: vi.fn(),
  bind: vi.fn(),
  unbind: vi.fn(),
  providers: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth }))
vi.mock('@/lib/scoped-access', () => ({
  canManageOrg: mocks.canManage,
  getFreshDefaultOrgId: mocks.defaultOrgId,
  getFreshUserScopedRoleAssignments: mocks.assignments,
}))
vi.mock('@/lib/organization-sources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/organization-sources')>()),
  loadOrganizationSources: mocks.load,
  bindOrganizationSource: mocks.bind,
  unbindOrganizationSource: mocks.unbind,
  listOrganizationSourceProviders: mocks.providers,
}))

import { DELETE, GET, POST } from './route'

const source = {
  id: '00000000-0000-4000-8000-000000000001',
  systemOrgId: 'org-1',
  provider: 'feishu',
  externalTenantId: 'tenant-1',
  priority: 1,
  status: 'active' as const,
  authorityScope: {},
  syncMode: 'authoritative' as const,
  lastSuccessfulSyncAt: null,
  lastError: null,
  createdAt: '2026-10-22T00:00:00.000Z',
  updatedAt: '2026-10-22T00:00:00.000Z',
}

function request(method = 'GET', body?: unknown, orgId = 'org-1') {
  return new NextRequest('http://localhost/api/admin/organization-sources', {
    method,
    headers: {
      'x-org-id': orgId,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAuth.mockResolvedValue({ id: 'user-1' })
  mocks.defaultOrgId.mockResolvedValue('org-1')
  mocks.assignments.mockResolvedValue([{ scopeType: 'org', scopeId: 'org-1' }])
  mocks.canManage.mockReturnValue(true)
  mocks.load.mockResolvedValue([source])
  mocks.bind.mockResolvedValue(source)
  mocks.unbind.mockResolvedValue({ ...source, status: 'disabled' })
  mocks.providers.mockReturnValue([
    { key: 'feishu', label: '飞书', syncAvailable: true, unavailableReason: null },
    { key: 'wecom', label: '企业微信', syncAvailable: false, unavailableReason: '未接入' },
  ])
})

describe('/api/admin/organization-sources', () => {
  it('returns tenant sources and provider capabilities', async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect((await response.json()).data).toMatchObject({
      sources: [source],
      active_primary_source_id: source.id,
    })
  })

  it('requires current-organization management authority', async () => {
    mocks.canManage.mockReturnValue(false)
    const response = await POST(request('POST', {
      provider: 'feishu',
      external_tenant_id: 'tenant-1',
      priority: 1,
      status: 'active',
      sync_mode: 'authoritative',
    }, 'org-2'))
    expect(response.status).toBe(403)
    expect(mocks.canManage).toHaveBeenCalledWith(
      [{ scopeType: 'org', scopeId: 'org-1' }],
      'org-2',
    )
    expect(mocks.bind).not.toHaveBeenCalled()
  })

  it('binds a source through the atomic lifecycle service', async () => {
    const response = await POST(request('POST', {
      provider: 'feishu',
      external_tenant_id: 'tenant-2',
      priority: 1,
      status: 'active',
      sync_mode: 'authoritative',
      authority_scope: { departments: 'authoritative' },
    }))
    expect(response.status).toBe(200)
    expect(mocks.bind).toHaveBeenCalledWith(expect.objectContaining({
      systemOrgId: 'org-1',
      provider: 'feishu',
      externalTenantId: 'tenant-2',
      priority: 1,
      status: 'active',
      syncMode: 'authoritative',
      actorId: 'user-1',
    }))
  })

  it('unbinds by source id without deleting the source record', async () => {
    const response = await DELETE(request('DELETE', { source_id: source.id }))
    expect(response.status).toBe(200)
    expect(mocks.unbind).toHaveBeenCalledWith({
      systemOrgId: 'org-1',
      sourceId: source.id,
      actorId: 'user-1',
    })
  })
})

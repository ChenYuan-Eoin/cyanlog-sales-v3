import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  defaultOrgId: vi.fn(),
  assignments: vi.fn(),
  load: vi.fn(),
  providers: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth }))
vi.mock('@/lib/scoped-access', () => ({
  getFreshDefaultOrgId: mocks.defaultOrgId,
  getFreshUserScopedRoleAssignments: mocks.assignments,
}))
vi.mock('@/lib/organization-sources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/organization-sources')>()),
  loadOrganizationSources: mocks.load,
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
  connectionState: 'verified' as const,
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
  mocks.assignments.mockResolvedValue([{ scopeType: 'org', scopeId: 'org-1', permissions: ['org:source_view'] }])
  mocks.load.mockResolvedValue([source])
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
      permissions: { view: true, connect: false, preview: false, apply: false, enterpriseLogin: false },
    })
  })

  it('requires current-organization management authority', async () => {
    const response = await POST(request('POST', {
      provider: 'feishu',
      external_tenant_id: 'tenant-1',
      priority: 1,
      status: 'active',
      sync_mode: 'authoritative',
    }, 'org-2'))
    expect(response.status).toBe(403)
    expect(mocks.assignments).toHaveBeenCalledWith('user-1')
  })

  it('keeps external provider data outside an ordinary member view grant', async () => {
    mocks.assignments.mockResolvedValue([{ scopeType: 'org', scopeId: 'org-1', permissions: ['user:view'] }])
    expect((await GET(request())).status).toBe(403)
    expect(mocks.load).not.toHaveBeenCalled()
  })

  it('preserves an unchanged existing administrator and respects an explicit permission override', async () => {
    const administrator = { scopeType: 'org', scopeId: 'org-1', roleCode: 'ADMIN' }
    mocks.assignments.mockResolvedValueOnce([{ ...administrator, permissions: ['admin:access'] }])
    const existing = await GET(request())
    expect((await existing.json()).data.permissions).toEqual({
      view: true, connect: true, preview: true, apply: true, enterpriseLogin: false,
    })

    mocks.assignments.mockResolvedValueOnce([{
      ...administrator, permissionsOverridden: true, permissions: ['org:source_view'],
    }])
    const overridden = await GET(request())
    expect((await overridden.json()).data.permissions).toEqual({
      view: true, connect: false, preview: false, apply: false, enterpriseLogin: false,
    })
  })

  it('keeps the legacy bind endpoint closed while shared lifecycle writes are pending', async () => {
    const response = await POST(request('POST', {
      provider: 'feishu',
      external_tenant_id: 'tenant-2',
      priority: 1,
      status: 'active',
      sync_mode: 'authoritative',
      authority_scope: { departments: 'authoritative' },
    }))
    expect(response.status).toBe(409)
    expect((await response.json()).error.message).toContain('只保存共享连接草稿')
  })

  it('keeps the legacy unbind endpoint closed', async () => {
    const response = await DELETE(request('DELETE', { source_id: source.id }))
    expect(response.status).toBe(409)
    expect((await response.json()).error.message).toContain('启用、主来源切换、同步和停用')
  })

})

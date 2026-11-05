import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => {
  class OrganizationConnectionError extends Error {
    code: string
    status: number

    constructor(code: string, message: string, status = 400) {
      super(message)
      this.name = 'OrganizationConnectionError'
      this.code = code
      this.status = status
    }
  }

  return {
    requireAuth: vi.fn(),
    defaultOrgId: vi.fn(),
    assignments: vi.fn(),
    canManage: vi.fn(),
    providers: vi.fn(),
    load: vi.fn(),
    save: vi.fn(),
    preview: vi.fn(),
    activate: vi.fn(),
    storageMode: vi.fn(),
    OrganizationConnectionError,
  }
})

vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth }))
vi.mock('@/lib/scoped-access', () => ({
  canManageOrg: mocks.canManage,
  getFreshDefaultOrgId: mocks.defaultOrgId,
  getFreshUserScopedRoleAssignments: mocks.assignments,
}))
vi.mock('@/lib/organization-connections', () => ({
  listOrganizationConnectionProviders: mocks.providers,
  loadOrganizationConnection: mocks.load,
  saveOrganizationConnection: mocks.save,
  previewOrganizationConnection: mocks.preview,
  activateDirectoryConnection: mocks.activate,
  OrganizationConnectionError: mocks.OrganizationConnectionError,
}))
vi.mock('@/lib/organization-connections/storage', () => ({
  detectConnectionStorageMode: mocks.storageMode,
}))

import { GET, POST } from './route'

const capability = {
  key: 'feishu',
  label: '飞书',
  configurable: true,
  previewAvailable: true,
  syncAvailable: true,
  ssoAvailable: false,
  capabilities: {
    credentialVerification: true,
    directoryPreview: true,
    directoryScopeProof: false,
    enterpriseLogin: false,
  },
  fields: [],
  unavailableReason: null,
}
const connection = {
  sourceId: 'source-1',
  provider: 'feishu',
  revision: 'revision-1',
  state: 'configured',
}

function request(method = 'GET', input?: {
  body?: unknown
  orgId?: string
  provider?: string
  rawBody?: string
}) {
  const url = new URL('http://localhost/api/admin/organization-sources/connection')
  if (input?.provider) url.searchParams.set('provider', input.provider)
  return new NextRequest(url, {
    method,
    headers: {
      ...(input?.orgId ? { 'x-org-id': input.orgId } : {}),
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
    },
    ...(method === 'POST' ? { body: input?.rawBody ?? JSON.stringify(input?.body) } : {}),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAuth.mockResolvedValue({ id: 'admin-1' })
  mocks.defaultOrgId.mockResolvedValue('org-1')
  mocks.assignments.mockResolvedValue([{ scopeType: 'org', scopeId: 'org-1' }])
  mocks.canManage.mockReturnValue(true)
  mocks.providers.mockReturnValue([
    capability,
    {
      key: 'wecom',
      label: '企业微信',
      configurable: false,
      previewAvailable: false,
      syncAvailable: false,
      ssoAvailable: false,
      capabilities: {
        credentialVerification: false,
        directoryPreview: false,
        directoryScopeProof: false,
        enterpriseLogin: false,
      },
      fields: [],
      unavailableReason: '连接器尚未接入',
    },
  ])
  mocks.load.mockResolvedValue(connection)
  mocks.save.mockResolvedValue(connection)
  mocks.activate.mockResolvedValue(connection)
  mocks.preview.mockResolvedValue({ connection, preview: { applied: false, departments: [], employees: [], warnings: [] } })
  mocks.storageMode.mockResolvedValue('unified')
})

describe('/api/admin/organization-sources/connection', () => {
  it('returns one provider connection only after current-organization management authority', async () => {
    const response = await GET(request('GET', { provider: 'feishu' }))

    expect(response.status).toBe(200)
    expect((await response.json()).data).toEqual({ provider: capability, storage_mode: 'unified', connection })
    expect(mocks.defaultOrgId).toHaveBeenCalledWith('admin-1')
    expect(mocks.canManage).toHaveBeenCalledWith([{ scopeType: 'org', scopeId: 'org-1' }], 'org-1')
    expect(mocks.load).toHaveBeenCalledWith('org-1', 'feishu')
  })

  it('rejects provider capabilities that cannot be configured', async () => {
    const response = await GET(request('GET', { provider: 'wecom' }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: '该组织提供方尚未接入连接配置。' })
    expect(mocks.load).not.toHaveBeenCalled()
  })

  it('saves a draft with the authenticated actor and selected provider', async () => {
    const configuration = { appId: 'cli_xxx', appSecret: 'secret', revision: null }
    const response = await POST(request('POST', {
      orgId: 'org-2',
      body: { action: 'save', provider: 'feishu', configuration },
    }))

    expect(response.status).toBe(200)
    expect(mocks.save).toHaveBeenCalledWith({
      orgId: 'org-2',
      actorId: 'admin-1',
      provider: 'feishu',
      value: configuration,
    })
  })

  it('validates and previews only an exact UUID revision', async () => {
    const revision = '00000000-0000-4000-8000-000000000001'
    const response = await POST(request('POST', {
      body: { action: 'preview', provider: 'feishu', revision },
    }))

    expect(response.status).toBe(200)
    expect(mocks.preview).toHaveBeenCalledWith({
      orgId: 'org-1',
      actorId: 'admin-1',
      provider: 'feishu',
      revision,
    })
  })

  it('rejects malformed, oversized and unknown requests before calling the service', async () => {
    const malformed = await POST(request('POST', { rawBody: '{' }))
    const oversized = await POST(request('POST', { rawBody: 'x'.repeat(16_385) }))
    const unknown = await POST(request('POST', { body: { action: 'activate', provider: 'feishu' } }))

    expect(malformed.status).toBe(400)
    expect(oversized.status).toBe(400)
    expect(unknown.status).toBe(400)
    expect((await unknown.json()).error).toBe('请选择保存配置、检查连接或启用目录连接。')
    expect(mocks.save).not.toHaveBeenCalled()
    expect(mocks.preview).not.toHaveBeenCalled()
  })

  it('enforces authentication and fresh management authority without leaking internal errors', async () => {
    const authError = new Error('unauthorized')
    authError.name = 'AuthError'
    mocks.requireAuth.mockRejectedValueOnce(authError)
    expect((await GET(request('GET', { provider: 'feishu' }))).status).toBe(401)

    mocks.canManage.mockReturnValue(false)
    expect((await GET(request('GET', { provider: 'feishu' }))).status).toBe(403)
    expect(mocks.load).not.toHaveBeenCalled()

    mocks.canManage.mockReturnValue(true)
    mocks.load.mockRejectedValueOnce(new Error('sensitive upstream value'))
    const response = await GET(request('GET', { provider: 'feishu' }))
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('sensitive upstream value')
  })

  it('activates only the authenticated organization and explicit configuration revision', async () => {
    const revision = '00000000-0000-4000-8000-000000000001'
    const body = { action: 'activate_directory', provider: 'fxiaoke', revision }
    expect((await POST(request('POST', { body }))).status).toBe(200)
    expect(mocks.activate).toHaveBeenCalledWith({ orgId: 'org-1', actorId: 'admin-1', provider: 'fxiaoke', configurationRevision: revision })
    mocks.activate.mockClear()
    mocks.canManage.mockReturnValue(false)
    expect((await POST(request('POST', { body, orgId: 'foreign-org' }))).status).toBe(403)
    expect(mocks.activate).not.toHaveBeenCalled()
  })
})

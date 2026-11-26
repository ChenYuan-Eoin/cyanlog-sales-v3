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
  mocks.assignments.mockResolvedValue([{
    scopeType: 'org', scopeId: 'org-1', permissions: ['org:source_connect', 'org:source_apply'],
  }])
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
    expect(mocks.assignments).toHaveBeenCalledWith('admin-1')
    expect(mocks.load).toHaveBeenCalledWith('org-1', 'feishu')
  })

  it('rejects provider capabilities that cannot be configured', async () => {
    const response = await GET(request('GET', { provider: 'wecom' }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: '该组织提供方尚未接入连接配置。' })
    expect(mocks.load).not.toHaveBeenCalled()
  })

  it('returns connection readiness without credential metadata to view-only access', async () => {
    mocks.assignments.mockResolvedValue([{ scopeType: 'org', scopeId: 'org-1', permissions: ['org:source_view'] }])
    mocks.load.mockResolvedValue({ ...connection, metadata: { appId: 'configured-provider-app' } })

    const response = await GET(request('GET', { provider: 'feishu' }))
    expect(response.status).toBe(200)
    expect((await response.json()).data.connection).toEqual({ ...connection, metadata: {} })
  })

  it('saves a draft with the authenticated actor and selected provider', async () => {
    mocks.assignments.mockResolvedValue([{ scopeType: 'org', scopeId: 'org-2', permissions: ['org:source_connect'] }])
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

  it('returns directory details only when the verifier also has directory preview access', async () => {
    const preview = { departments: [{ name: '目录部门' }], employees: [{ name: '目录员工' }], warnings: ['目录警告'] }
    mocks.preview.mockResolvedValue({ connection, preview })
    const body = { action: 'preview', provider: 'feishu', revision: '00000000-0000-4000-8000-000000000001' }
    const connectionOnly = await POST(request('POST', { body }))
    expect(connectionOnly.status).toBe(200)
    expect((await connectionOnly.json()).data).toEqual({ connection, preview: null })

    mocks.assignments.mockResolvedValue([{
      scopeType: 'org', scopeId: 'org-1', permissions: ['org:source_connect', 'org:source_preview'],
    }])
    const directoryPreview = await POST(request('POST', { body }))
    expect(directoryPreview.status).toBe(200)
    expect((await directoryPreview.json()).data).toEqual({ connection, preview })
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

    mocks.assignments.mockResolvedValueOnce([])
    expect((await GET(request('GET', { provider: 'feishu' }))).status).toBe(403)
    expect(mocks.load).not.toHaveBeenCalled()

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
    expect((await POST(request('POST', { body, orgId: 'foreign-org' }))).status).toBe(403)
    expect(mocks.activate).not.toHaveBeenCalled()
  })

  it('returns activation status without connection configuration to an apply-only actor', async () => {
    mocks.assignments.mockResolvedValue([{ scopeType: 'org', scopeId: 'org-1', permissions: ['org:source_apply'] }])
    mocks.activate.mockResolvedValue({ ...connection, metadata: { appId: 'configured-provider-app' } })
    const body = { action: 'activate_directory', provider: 'fxiaoke', revision: '00000000-0000-4000-8000-000000000001' }
    const result = await POST(request('POST', { body }))
    expect(result.status).toBe(200)
    expect((await result.json()).data).toEqual({ connection: { ...connection, metadata: {} } })
  })

  it.each([
    ['org:source_view', 'save'],
    ['user:view', 'preview'],
    ['org:source_connect', 'activate_directory'],
  ])('rejects %s for the independent %s action', async (permission, action) => {
    mocks.assignments.mockResolvedValue([{ scopeType: 'org', scopeId: 'org-1', permissions: [permission] }])
    const body = { action, provider: 'fxiaoke', revision: '00000000-0000-4000-8000-000000000001' }
    expect((await POST(request('POST', { body }))).status).toBe(403)
    expect(mocks.save).not.toHaveBeenCalled()
    expect(mocks.preview).not.toHaveBeenCalled()
    expect(mocks.activate).not.toHaveBeenCalled()
  })
})

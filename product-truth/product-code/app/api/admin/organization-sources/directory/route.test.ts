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
    canManageOrg: vi.fn(),
    latest: vi.fn(),
    prepare: vi.fn(),
    apply: vi.fn(),
    rollback: vi.fn(),
    storageAvailable: vi.fn(),
    OrganizationConnectionError,
  }
})

vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth }))
vi.mock('@/lib/scoped-access', () => ({
  canManageOrg: mocks.canManageOrg,
  getFreshDefaultOrgId: mocks.defaultOrgId,
  getFreshUserScopedRoleAssignments: mocks.assignments,
}))
vi.mock('@/lib/organization-connections/directory-cutover', () => ({
  loadLatestDirectoryCutoverPlan: mocks.latest,
  prepareDirectoryCutoverPlan: mocks.prepare,
  applyDirectoryCutoverPlan: mocks.apply,
  rollbackDirectoryCutover: mocks.rollback,
}))
vi.mock('@/lib/organization-connections/errors', () => ({
  OrganizationConnectionError: mocks.OrganizationConnectionError,
}))
vi.mock('@/lib/organization-connections/storage', () => ({
  detectDirectoryCutoverStorage: mocks.storageAvailable,
}))

import { GET, POST } from './route'

function request(method: 'GET' | 'POST', body?: unknown, orgId?: string, provider = 'fxiaoke') {
  return new NextRequest(`http://localhost/api/admin/organization-sources/directory?provider=${provider}`, {
    method,
    headers: {
      ...(orgId ? { 'x-org-id': orgId } : {}),
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
    },
    ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAuth.mockResolvedValue({ id: 'admin-1' })
  mocks.defaultOrgId.mockResolvedValue('org-1')
  mocks.assignments.mockResolvedValue([{ scopeType: 'org', scopeId: 'org-1' }])
  mocks.canManageOrg.mockReturnValue(true)
  mocks.latest.mockResolvedValue(null)
  mocks.prepare.mockResolvedValue({ id: 'plan-1' })
  mocks.apply.mockResolvedValue({ runId: 'run-1' })
  mocks.rollback.mockResolvedValue({ runId: 'run-1', status: 'rolled_back' })
  mocks.storageAvailable.mockResolvedValue(true)
})

describe('/api/admin/organization-sources/directory', () => {
  it('loads only the latest plan for a freshly authorized organization', async () => {
    const response = await GET(request('GET', undefined, 'org-explicit'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        plan: null,
        directory_cutover: { available: true, reason: null },
      },
    })
    expect(mocks.assignments).toHaveBeenCalledWith('admin-1')
    expect(mocks.canManageOrg).toHaveBeenCalledWith([{ scopeType: 'org', scopeId: 'org-1' }], 'org-explicit')
    expect(mocks.latest).toHaveBeenCalledWith('org-explicit', 'fxiaoke')
  })

  it('keeps directory reads available while reporting an unapplied schema upgrade', async () => {
    mocks.storageAvailable.mockResolvedValueOnce(false)
    const response = await GET(request('GET'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        plan: null,
        directory_cutover: {
          available: false,
          reason: '当前数据库尚未完成目录切源升级；目录读取可继续验收，差异应用与回滚暂不可用。',
        },
      },
    })
    expect(mocks.latest).not.toHaveBeenCalled()
  })

  it('dispatches preview, apply and rollback with authenticated actor and tenant', async () => {
    const sourceRevisions = [{ id: 'source-1', provider: 'feishu', priority: 1, status: 'active', syncMode: 'authoritative', configurationRevision: 'revision-1', updatedAt: '2026-11-03T08:00:00.000Z' }]

    expect((await POST(request('POST', { action: 'preview', provider: 'fxiaoke' }))).status).toBe(200)
    expect(mocks.prepare).toHaveBeenCalledWith({ orgId: 'org-1', actorId: 'admin-1', provider: 'fxiaoke' })

    expect((await POST(request('POST', {
      action: 'apply', plan_id: 'plan-1', plan_hash: 'a'.repeat(64), connection_revision: 'revision-1', source_revisions: sourceRevisions,
    }))).status).toBe(200)
    expect(mocks.apply).toHaveBeenCalledWith({
      orgId: 'org-1', actorId: 'admin-1', planId: 'plan-1', planHash: 'a'.repeat(64),
      connectionRevision: 'revision-1', sourceRevisions,
    })

    expect((await POST(request('POST', { action: 'rollback', plan_id: 'plan-1' }))).status).toBe(200)
    expect(mocks.rollback).toHaveBeenCalledWith({ orgId: 'org-1', actorId: 'admin-1', planId: 'plan-1' })
  })

  it('rejects unsupported providers, malformed bodies and missing source revisions before mutation', async () => {
    const unsupported = await POST(request('POST', { action: 'preview', provider: 'wecom' }))
    const malformed = await POST(request('POST', '{'))
    const missing = await POST(request('POST', { action: 'apply', plan_id: 'plan-1' }))
    const unknown = await POST(request('POST', { action: 'activate' }))

    expect(unsupported.status).toBe(400)
    expect(malformed.status).toBe(400)
    expect(missing.status).toBe(400)
    expect(unknown.status).toBe(400)
    expect(mocks.prepare).not.toHaveBeenCalled()
    expect(mocks.apply).not.toHaveBeenCalled()
    expect(mocks.rollback).not.toHaveBeenCalled()
  })

  it('enforces authentication and fresh organization authority', async () => {
    const authError = new Error('unauthorized')
    authError.name = 'AuthError'
    mocks.requireAuth.mockRejectedValueOnce(authError)
    expect((await GET(request('GET'))).status).toBe(401)

    mocks.canManageOrg.mockReturnValueOnce(false)
    expect((await GET(request('GET', undefined, 'org-other'))).status).toBe(403)
    expect(mocks.latest).not.toHaveBeenCalled()
  })


  it('requires an explicit supported provider when loading a provider-scoped plan', async () => {
    const missing = request('GET')
    missing.nextUrl.searchParams.delete('provider')
    expect((await GET(missing)).status).toBe(400)

    expect((await GET(request('GET', undefined, undefined, 'wecom'))).status).toBe(400)
    expect(mocks.latest).not.toHaveBeenCalled()
  })

  it('does not leak storage or provider errors', async () => {
    mocks.latest.mockRejectedValueOnce(new Error('private upstream response'))
    const response = await GET(request('GET'))

    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('private upstream response')
  })
})

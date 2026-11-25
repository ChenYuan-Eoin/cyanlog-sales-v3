// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), defaultOrg: vi.fn(), assignments: vi.fn(), inspect: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth }))
vi.mock('@/lib/scoped-access', () => ({ getFreshDefaultOrgId: mocks.defaultOrg, getFreshUserScopedRoleAssignments: mocks.assignments }))
vi.mock('@/lib/organization-connections', async () => ({ inspectOrganizationDirectory: mocks.inspect, ...await import('@/lib/organization-connections/errors') }))
import { OrganizationConnectionError } from '@/lib/organization-connections/errors'
import { POST } from './route'
const valid = { provider: 'fxiaoke', sourceId: '00000000-0000-4000-8000-000000000001', revision: '00000000-0000-4000-8000-000000000002' }
function request(body: unknown = valid, org?: string) {
  return new NextRequest('http://localhost/api/admin/organization-sources/inspection', { method: 'POST', headers: org ? { 'x-org-id': org } : {}, body: typeof body === 'string' ? body : JSON.stringify(body) })
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ id: 'admin-1' })
  mocks.defaultOrg.mockResolvedValue('org-1')
  mocks.assignments.mockResolvedValue([{ scopeType: 'org', scopeId: 'org-1', permissions: ['org:source_preview'] }])
  mocks.inspect.mockResolvedValue({ readOnly: true, applied: false, scope: { verified: false } })
})
describe('directory inspection authorization and input', () => {
  it('uses freshly authorized organization scope and forbids cached results', async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.assignments).toHaveBeenCalledWith('admin-1')
    expect(mocks.inspect).toHaveBeenCalledWith({ orgId: 'org-1', ...valid })
    expect((await response.json()).data.report.scope.verified).toBe(false)
  })
  it('rejects unauthenticated and cross-organization reads before using provider credentials', async () => {
    expect((await POST(request(valid, 'other-org'))).status).toBe(403)
    mocks.auth.mockRejectedValue(Object.assign(new Error('expired'), { name: 'AuthError' }))
    expect((await POST(request())).status).toBe(401)
    expect(mocks.inspect).not.toHaveBeenCalled()
  })
  it('does not contact the provider with source view alone', async () => {
    mocks.assignments.mockResolvedValue([{ scopeType: 'org', scopeId: 'org-1', permissions: ['org:source_view'] }])
    expect((await POST(request())).status).toBe(403)
    expect(mocks.inspect).not.toHaveBeenCalled()
  })
  it.each([{}, '{broken', 'x'.repeat(2049), { ...valid, revision: 'stale' }, { ...valid, scopeVerified: true }, { ...valid, orgId: 'other-org' }])('rejects malformed or authority-expanding input', async body => {
    expect((await POST(request(body))).status).toBe(400)
    expect(mocks.inspect).not.toHaveBeenCalled()
  })
  it('preserves actionable binding errors but redacts unexpected provider details', async () => {
    mocks.inspect.mockRejectedValue(new OrganizationConnectionError('CONFIG_CHANGED', '配置已改变。', 409))
    const changed = await POST(request())
    expect(changed.status).toBe(409)
    expect((await changed.json()).code).toBe('CONFIG_CHANGED')
    mocks.inspect.mockRejectedValue(new Error('private-provider-token'))
    const failed = await POST(request())
    expect(failed.status).toBe(502)
    expect(JSON.stringify(await failed.json())).not.toContain('private-provider-token')
  })
})

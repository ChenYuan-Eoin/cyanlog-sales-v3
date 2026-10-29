import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), org: vi.fn(), roles: vi.fn(), manage: vi.fn(), load: vi.fn(), save: vi.fn(), preview: vi.fn(), discover: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth }))
vi.mock('@/lib/scoped-access', () => ({ getFreshDefaultOrgId: mocks.org, getFreshUserScopedRoleAssignments: mocks.roles, canManageOrg: mocks.manage }))
vi.mock('@/lib/fxiaoke/settings', () => ({ loadConnection: mocks.load, saveConnection: mocks.save, previewSavedConnection: mocks.preview }))
vi.mock('@/lib/fxiaoke/client', () => ({ discoverEnterprise: mocks.discover }))
import { GET, POST } from './route'
beforeEach(() => {
  vi.resetAllMocks(); mocks.auth.mockResolvedValue({ id: 'admin' }); mocks.org.mockResolvedValue('org-a'); mocks.roles.mockResolvedValue([])
  mocks.manage.mockImplementation((_roles, orgId) => orgId === 'org-a'); mocks.load.mockResolvedValue(null)
})
const request = (body?: unknown, orgId = 'org-a') => new NextRequest('https://sales.cyanlog.icu/api/admin/organization-sources/fxiaoke', {
  method: body ? 'POST' : 'GET', headers: { 'x-org-id': orgId }, ...(body ? { body: JSON.stringify(body) } : {}),
})
it('blocks cross-organization reads and writes before accessing credentials', async () => {
  expect((await GET(request(undefined, 'org-b'))).status).toBe(403)
  expect((await POST(request({ action: 'save', connection: {} }, 'org-b'))).status).toBe(403)
  expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled()
})
it('only discovers an enterprise for an authorized manager and rejects incomplete credentials', async () => {
  const credentials = { appId: 'FSAID_test', appSecret: 'secret', permanentCode: 'permanent' }
  mocks.discover.mockResolvedValue({ ea: 'example', corpId: 'FSCID_server_only' })
  expect((await POST(request({ action: 'discover', credentials }, 'org-b'))).status).toBe(403)
  expect((await POST(request({ action: 'discover', credentials: { appId: 'FSAID_test' } }))).status).toBe(400)
  const response = await POST(request({ action: 'discover', credentials }))
  expect(await response.json()).toEqual({ data: { enterprise: { ea: 'example' } } })
  expect(mocks.discover).toHaveBeenCalledTimes(1)
})
it('rechecks fresh management authority for every request', async () => {
  expect((await GET(request())).status).toBe(200)
  mocks.manage.mockReturnValue(false)
  expect((await POST(request({ action: 'preview', revision: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }))).status).toBe(403)
  expect(mocks.roles).toHaveBeenCalledTimes(2); expect(mocks.preview).not.toHaveBeenCalled()
})
it('rejects anonymous access and unknown actions', async () => {
  expect((await POST(request({ action: 'activate' }))).status).toBe(400)
  mocks.auth.mockRejectedValue(Object.assign(new Error('denied'), { name: 'AuthError' }))
  expect((await GET(request())).status).toBe(401)
})
it('does not reflect unexpected internal errors or credentials', async () => {
  mocks.load.mockRejectedValue(new Error('sensitive upstream value'))
  const response = await GET(request())
  expect(response.status).toBe(500); expect(await response.text()).not.toContain('sensitive')
})

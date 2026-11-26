// @vitest-environment node
import { NextRequest } from 'next/server'
import { beforeEach, expect, it, vi } from 'vitest'
import { AuthError } from '@/lib/auth'
import { ShippingError } from '@/lib/shipping/config'
import { GET, PATCH } from './route'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), context: vi.fn(), load: vi.fn(), save: vi.fn() }))
vi.mock('@/lib/auth', () => ({ AuthError: class extends Error {}, requireAuth: mocks.auth }))
vi.mock('@/lib/org-role-permissions', () => ({ loadOrgRolePermissionContext: mocks.context }))
vi.mock('@/lib/shipping/intake-settings', () => ({ loadIntakeSettings: mocks.load, saveIntakeDepartmentScope: mocks.save }))

const path = 'https://example.test/api/admin/departments/shipping-intake'
const url = `${path}?orgId=active-org`
const rootDepartment = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const patch = (body: unknown, headers?: HeadersInit) => new NextRequest(url, { method: 'PATCH', body: JSON.stringify(body), headers })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ id: 'system-root', org_id: 'untrusted-home' })
  mocks.context.mockResolvedValue({ orgId: 'active-org', canEditPlatformRoot: true })
  mocks.load.mockResolvedValue({ allowedDepartmentIds: null })
  mocks.save.mockImplementation(async (_org: string, _actor: string, settings: { allowedDepartmentIds: string[] }) => settings)
})

it('returns legacy unrestricted state without granting a new wildcard', async () => {
  const response = await GET(new NextRequest(url))
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ allowedDepartmentIds: null })
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(mocks.context).toHaveBeenCalledExactlyOnceWith('system-root')
  expect(mocks.load).toHaveBeenCalledExactlyOnceWith('active-org')
})

it('uses the actor’s exact current organization for updates', async () => {
  const body = { allowedDepartmentIds: [rootDepartment] }
  const response = await PATCH(patch(body, { 'x-org-id': 'untrusted-org', origin: 'https://example.test' }))
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual(body)
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith('active-org', 'system-root', body)
})

it.each([path, `${path}?orgId=previous-org`])('requires the current organization even when clearing all departments', async staleUrl => {
  expect((await GET(new NextRequest(staleUrl))).status).toBe(409)
  expect((await PATCH(new NextRequest(staleUrl, {
    method: 'PATCH', body: JSON.stringify({ allowedDepartmentIds: [] }),
  }))).status).toBe(409)
  expect(mocks.load).not.toHaveBeenCalled()
  expect(mocks.save).not.toHaveBeenCalled()
})

it.each([null, { orgId: 'active-org', canRead: true, canEdit: true, canEditPlatformRoot: false }])(
  'denies users without exact system authority even if they can manage organization roles %j', async context => {
    mocks.context.mockResolvedValue(context)
    expect((await GET(new NextRequest(url))).status).toBe(403)
    expect((await PATCH(patch({ allowedDepartmentIds: [] }))).status).toBe(403)
    expect(mocks.load).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  },
)

it('denies unauthenticated and foreign-origin requests', async () => {
  mocks.auth.mockRejectedValueOnce(new AuthError())
  expect((await GET(new NextRequest(url))).status).toBe(401)
  expect((await PATCH(patch({ allowedDepartmentIds: [] }, { origin: 'https://other.example.test' }))).status).toBe(403)
  expect(mocks.save).not.toHaveBeenCalled()
})

it('propagates an invalid scope or changed snapshot without a success response', async () => {
  mocks.save.mockRejectedValueOnce(new ShippingError(400, '部门不属于当前组织。'))
  mocks.save.mockRejectedValueOnce(new ShippingError(409, '同时保存，请刷新。'))
  expect((await PATCH(patch({ allowedDepartmentIds: [rootDepartment] }))).status).toBe(400)
  expect((await PATCH(patch({ allowedDepartmentIds: [rootDepartment] }))).status).toBe(409)
})

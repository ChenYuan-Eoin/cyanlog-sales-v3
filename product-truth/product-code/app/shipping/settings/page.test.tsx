// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  token: vi.fn(),
  user: vi.fn(),
  redirect: vi.fn(),
  access: vi.fn(),
}))

vi.mock('@/lib/server-auth', () => ({ getServerAuthToken: mocks.token }))
vi.mock('@/lib/auth', () => ({ getAuthUserByToken: mocks.user }))
vi.mock('@/lib/shipping/entry-access', () => ({ resolveShippingEntry: mocks.access }))
vi.mock('../config-drawer', () => ({ default: function ShippingConfigDrawer() { return null } }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))

import ShippingSettingsPage from './page'

const user = { id: 'member' }
const access = { orgId: 'active-org', canOperate: false, canViewOwn: false, canSubmitOwn: false, canManageConnections: false }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.token.mockResolvedValue('token')
  mocks.user.mockResolvedValue(user)
  mocks.redirect.mockImplementation((path: string) => { throw new Error(`redirect:${path}`) })
})

describe('shipping connection settings entry', () => {
  it('requires a verified login', async () => {
    mocks.user.mockResolvedValue(null)
    await expect(ShippingSettingsPage()).rejects.toThrow('redirect:/login')
    expect(mocks.access).not.toHaveBeenCalled()
  })

  it.each([null, { ...access, canOperate: true }, { ...access, canViewOwn: true }])('denies access without connection management', async (entry) => {
    mocks.access.mockResolvedValue(entry)
    await expect(ShippingSettingsPage()).rejects.toThrow('redirect:/?denied=shipping:manage_connections')
  })

  it.each([
    { ...access, canManageConnections: true, returnTo: '/' },
    { ...access, canManageConnections: true, canViewOwn: true, returnTo: '/shipping' },
    { ...access, canManageConnections: true, canViewOwn: true, canSubmitOwn: true, returnTo: '/shipping' },
    { ...access, canManageConnections: true, canOperate: true, returnTo: '/shipping' },
  ])('opens settings and links to the accessible return path', async (entry) => {
    mocks.access.mockResolvedValue(entry)
    const page = await ShippingSettingsPage()
    expect(mocks.access).toHaveBeenCalledWith(user, 'token')
    expect(page.type.name).toBe('ShippingConfigDrawer')
    expect(page.props).toEqual({ embedded: true, standaloneReturn: entry.returnTo })
  })
})

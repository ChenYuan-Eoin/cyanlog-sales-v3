import { NextRequest } from 'next/server'
import { beforeEach, expect, it, vi } from 'vitest'
import { AuthError, requireAuth } from '@/lib/auth'
import { resolveShippingEntry } from '@/lib/shipping/entry-access'
import { GET } from './route'

vi.mock('@/lib/auth', async original => ({ ...await original<typeof import('@/lib/auth')>(), requireAuth: vi.fn() }))
vi.mock('@/lib/shipping/entry-access', () => ({ resolveShippingEntry: vi.fn() }))

const user = { id: 'shipping-user', org_id: 'org1', email: null, phone: null, display_name: null }
const request = () => new NextRequest('https://example.test/api/navigation', { headers: { Authorization: 'Bearer verified-token' } })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(user)
})

it.each([
  [true, false, false, false, ['/shipping']],
  [false, true, false, false, ['/shipping']],
  [false, true, true, false, ['/shipping']],
  [false, false, false, true, ['/shipping/settings']],
  [false, true, false, true, ['/shipping', '/shipping/settings']],
  [true, false, false, true, ['/shipping', '/shipping/settings']],
  [false, false, false, false, []],
] as const)('projects only shipping links for operate=%s, read own=%s, submit own=%s and manager=%s', async (canOperate, canViewOwn, canSubmitOwn, canManageConnections, paths) => {
  vi.mocked(resolveShippingEntry).mockResolvedValue({ orgId: 'org1', canOperate, canViewOwn, canSubmitOwn, canManageConnections, permissions: [] })
  const response = await GET(request())
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(await response.json()).toEqual({ paths })
  expect(resolveShippingEntry).toHaveBeenCalledWith(user, 'verified-token')
})

it('returns no links after the current organization, authorization source, or authentication is unavailable', async () => {
  vi.mocked(resolveShippingEntry).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('Registry unavailable'))
  const missing = await GET(request())
  expect(missing.status).toBe(403)
  expect(await missing.json()).toEqual({ paths: [] })
  const unavailable = await GET(request())
  expect(unavailable.status).toBe(503)
  expect(await unavailable.json()).toEqual({ paths: [] })
  vi.mocked(requireAuth).mockRejectedValueOnce(new AuthError())
  const unauthenticated = await GET(request())
  expect(unauthenticated.status).toBe(401)
  expect(await unauthenticated.json()).toEqual({ paths: [] })
  expect(resolveShippingEntry).toHaveBeenCalledTimes(2)
})

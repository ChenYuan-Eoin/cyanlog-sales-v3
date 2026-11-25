// @vitest-environment node
import { NextRequest } from 'next/server'
import { beforeEach, expect, it, vi } from 'vitest'
import { POST } from './route'
const m = vi.hoisted(() => ({ auth: vi.fn(), operator: vi.fn(), from: vi.fn(), refresh: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: m.auth, AuthError: class extends Error {} }))
vi.mock('@/lib/shipping/entry-access', () => ({ resolveShippingOwnerAccess: m.operator }))
vi.mock('@/lib/shipping/owner-tracking', () => ({ refreshOwnerTracking: m.refresh }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: m.from } }))
const url = 'https://app.example/api/shipping/owner/orders/SO-20261118-ABCD1618/tracking'
const context = { params: Promise.resolve({ orderNo: 'SO-20261118-ABCD1618' }) }
beforeEach(() => {
  vi.resetAllMocks()
  m.auth.mockResolvedValue({ id: 'user-A', org_id: 'org-A' })
  m.operator.mockResolvedValue({ orgId: 'org-A', ownerPermissions: ['shipping:owner_view', 'shipping:owner_tracking_refresh'] })
  m.from.mockImplementation(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { user_id: 'user-A', auth_method: 'fxiaoke' }, error: null }) }) }) }))
  m.refresh.mockResolvedValue({ verified: true, source: 'carrier' })
})
it('lets an authenticated Fxiaoke employee refresh the employee-owned order only', async () => {
  const response = await POST(new NextRequest(url, { method: 'POST', headers: { authorization: 'Bearer employee-token' } }), context)
  expect(response.status).toBe(200)
  expect(m.refresh).toHaveBeenCalledWith('org-A', 'user-A', 'SO-20261118-ABCD1618')
})
it('does not grant owner refresh to a non-Fxiaoke employee session', async () => {
  m.operator.mockResolvedValue({ orgId: 'org-A', ownerPermissions: [] })
  const response = await POST(new NextRequest(url, { method: 'POST', headers: { authorization: 'Bearer employee-token' } }), context)
  expect(response.status).toBe(403)
  expect(m.refresh).not.toHaveBeenCalled()
})
it('rejects malformed order numbers before tracking', async () => {
  const response = await POST(new NextRequest(url, { method: 'POST' }), { params: Promise.resolve({ orderNo: 'OTHER' }) })
  expect(response.status).toBe(404)
  expect(m.refresh).not.toHaveBeenCalled()
})

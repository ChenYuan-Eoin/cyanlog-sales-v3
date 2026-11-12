import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { ShippingError } from './config'

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireShippingOperator: vi.fn(),
  requireShippingConnectionManager: vi.fn(),
  getRequestAuthToken: vi.fn(),
  getDefaultOrgId: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth, AuthError: class AuthError extends Error {} }))
vi.mock('./operator-access', () => ({ requireShippingOperator: mocks.requireShippingOperator }))
vi.mock('./connection-authorization', () => ({ requireShippingConnectionManager: mocks.requireShippingConnectionManager }))
vi.mock('@/lib/auth-token', () => ({ getRequestAuthToken: mocks.getRequestAuthToken }))
vi.mock('@/lib/scoped-access', () => ({ getDefaultOrgId: mocks.getDefaultOrgId }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))

import { shippingHandler } from './http'

const request = {
  method: 'GET',
  nextUrl: new URL('https://sales.cyanlog.icu/api/shipping/owner/orders'),
  headers: new Headers(),
} as NextRequest

describe('Fxiaoke owner proposal admission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAuth.mockResolvedValue({ id: 'user-1', phone: null, display_name: '员工' })
    mocks.requireShippingOperator.mockRejectedValue(new ShippingError(403, 'operator required'))
    mocks.getRequestAuthToken.mockReturnValue('session-token')
    mocks.getDefaultOrgId.mockResolvedValue('org-1')
    const query = { eq: vi.fn(), maybeSingle: vi.fn() }
    query.eq.mockReturnValue(query)
    query.maybeSingle.mockResolvedValue({ data: { user_id: 'user-1', auth_method: 'fxiaoke' }, error: null })
    mocks.from.mockReturnValue({ select: () => query })
  })

  it('passes the verified Fxiaoke member and current organization as a self proposal', async () => {
    const action = vi.fn(async (_user, _orgId, selfSubmit) => ({ selfSubmit }))
    const response = await shippingHandler(request, action, { allowFxiaokeSelfSubmit: true })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ selfSubmit: true })
    expect(action).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }), 'org-1', true)
  })

  it('does not admit a local session through the Fxiaoke self proposal exception', async () => {
    const query = { eq: vi.fn(), maybeSingle: vi.fn() }
    query.eq.mockReturnValue(query)
    query.maybeSingle.mockResolvedValue({ data: { user_id: 'user-1', auth_method: 'local' }, error: null })
    mocks.from.mockReturnValue({ select: () => query })
    const action = vi.fn()
    const response = await shippingHandler(request, action, { allowFxiaokeSelfSubmit: true })
    expect(response.status).toBe(403)
    expect(action).not.toHaveBeenCalled()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ShippingError } from './config'

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireShippingOperator: vi.fn(),
  requireShippingConnectionManager: vi.fn(),
  resolveShippingOwnerAccess: vi.fn(),
  getRequestAuthToken: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth, AuthError: class AuthError extends Error {} }))
vi.mock('./operator-access', () => ({ requireShippingOperator: mocks.requireShippingOperator }))
vi.mock('./connection-authorization', () => ({ requireShippingConnectionManager: mocks.requireShippingConnectionManager }))
vi.mock('./entry-access', () => ({ resolveShippingOwnerAccess: mocks.resolveShippingOwnerAccess }))
vi.mock('@/lib/auth-token', () => ({ getRequestAuthToken: mocks.getRequestAuthToken }))

import { shippingHandler } from './http'

const owner = 'https://sales.cyanlog.icu/api/shipping/owner/orders'
const ledger = 'https://sales.cyanlog.icu/api/shipping/ledger'
const ownerView = 'shipping:owner_view'
const ownerSubmit = 'shipping:owner_submit'
const user = { id: 'user-1', phone: null, display_name: '员工', org_id: 'org-1' }

describe('exact owner proposal admission', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.requireAuth.mockResolvedValue(user)
    mocks.requireShippingOperator.mockRejectedValue(new ShippingError(403, 'operator required'))
    mocks.getRequestAuthToken.mockReturnValue('session-token')
    mocks.resolveShippingOwnerAccess.mockResolvedValue({ orgId: 'org-1', ownerPermissions: [ownerView, ownerSubmit] })
  })

  it('verifies the Fxiaoke session and passes the scoped actor to its own action', async () => {
    const action = vi.fn(async () => ({ ok: true }))
    const response = await shippingHandler(new NextRequest(owner), action, 'owner')
    expect(response.status).toBe(200)
    expect(mocks.resolveShippingOwnerAccess).toHaveBeenCalledWith(user, 'session-token')
    expect(action).toHaveBeenCalledWith(user, 'org-1')
    expect(mocks.requireShippingOperator).not.toHaveBeenCalled()
  })

  it('permits passive reads while denying owner submit, resubmit, tracking and unsupported methods', async () => {
    const action = vi.fn(async () => ({ ok: true }))
    mocks.resolveShippingOwnerAccess.mockResolvedValue({ orgId: 'org-1', ownerPermissions: [ownerView] })
    expect((await shippingHandler(new NextRequest(owner), action, 'owner')).status).toBe(200)
    for (const [path, method] of [
      [owner, 'POST'], [owner, 'PUT'], [owner, 'DELETE'],
      [owner + '/SO-20261118-AABBCCDD/resubmit', 'GET'],
      [owner + '/SO-20261118-AABBCCDD/tracking', 'POST'],
    ]) {
      expect((await shippingHandler(new NextRequest(path, { method }), action, 'owner')).status).toBe(403)
    }
    expect(action).toHaveBeenCalledOnce()
  })

  it('does not carry an operator grant into an owner route after owner submission is revoked', async () => {
    const action = vi.fn(async () => ({ ok: true }))
    mocks.requireShippingOperator.mockResolvedValue('org-1')
    mocks.resolveShippingOwnerAccess.mockResolvedValue({ orgId: 'org-1', ownerPermissions: [ownerView] })
    expect((await shippingHandler(new NextRequest(owner, { method: 'POST' }), action, 'owner')).status).toBe(403)
    expect(action).not.toHaveBeenCalled()
    expect(mocks.requireShippingOperator).not.toHaveBeenCalled()
    expect((await shippingHandler(new NextRequest(ledger, { method: 'POST' }), action)).status).toBe(200)
    expect(mocks.requireShippingOperator).toHaveBeenCalledExactlyOnceWith(user.id, 'shipping:record_create')
  })

  it('denies unknown or unavailable owner authorization without running the callback', async () => {
    const action = vi.fn(async () => ({ ok: true }))
    mocks.resolveShippingOwnerAccess.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('unavailable'))
    expect((await shippingHandler(new NextRequest(owner), action, 'owner')).status).toBe(403)
    expect((await shippingHandler(new NextRequest(owner), action, 'owner')).status).toBe(503)
    expect(action).not.toHaveBeenCalled()
  })
})

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { auth, confirm, returned, reconcile, assign, cancel, requireOperator } = vi.hoisted(() => ({ auth: vi.fn(), confirm: vi.fn(), returned: vi.fn(), reconcile: vi.fn(), assign: vi.fn(), cancel: vi.fn(), requireOperator: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: auth, AuthError: class AuthError extends Error {} }))
vi.mock('@/lib/shipping/workflow', () => ({ confirmAndSubmitShipment: confirm, returnShipmentOrder: returned, reconcileShipmentOrder: reconcile, cancelShipmentOrder: cancel }))
vi.mock('@/lib/shipping/collaboration', () => ({ assignShipmentRelation: assign }))
vi.mock('@/lib/shipping/operator-access', () => ({ requireShippingOperator: requireOperator }))
vi.mock('@/lib/shipping/entry-access', () => ({
  loadPublishedShippingAccess: async () => ({ orgId: 'org-1', returnRegistered: false, permissions: ['shipping:record_review'] }),
}))
import { POST as confirmRoute } from './[id]/confirm/route'
import { POST as returnRoute } from './[id]/return/route'
import { POST as reconcileRoute } from './[id]/reconcile/route'
import { POST as assignRoute } from './[id]/assign/route'
import { POST as cancelRoute } from './[id]/cancel/route'
import { ShippingError } from '@/lib/shipping/config'

const ctx = { params: Promise.resolve({ id: '91b36e00-31f0-4612-9bd8-f15742a0bb64' }) }
beforeEach(() => { auth.mockReset(); confirm.mockReset(); returned.mockReset(); reconcile.mockReset(); assign.mockReset(); cancel.mockReset(); requireOperator.mockReset().mockResolvedValue('org-1'); auth.mockResolvedValue({ id: 'owner' }); confirm.mockResolvedValue({ status: 'waybill_created', waybill: 'SF1234567890123' }); returned.mockResolvedValue({ status: 'returned' }); reconcile.mockResolvedValue({ status: 'waybill_created', waybill: 'SF1234567890123' }); assign.mockResolvedValue({ relation: { salesRef: 'sales-1', customerRef: 'customer-1' } }); cancel.mockResolvedValue({ status: 'cancelled' }) })

describe('shipment ledger actions', () => {
  it('confirms through the server workflow with the default database selection', async () => { const response = await confirmRoute(new NextRequest('http://localhost/api/shipping/ledger/id/confirm', { method: 'POST', headers: { origin: 'http://localhost' } }), ctx); expect(response.status).toBe(200); expect(confirm).toHaveBeenCalledWith('91b36e00-31f0-4612-9bd8-f15742a0bb64', 'owner', 'org-1', {}) })
  it('returns the original order with a bounded reason', async () => { const response = await returnRoute(new NextRequest('http://localhost/api/shipping/ledger/id/return', { method: 'POST', headers: { origin: 'http://localhost' }, body: JSON.stringify({ reason: '地址缺少门牌号' }) }), ctx); expect(response.status).toBe(200); expect(returned).toHaveBeenCalledWith('91b36e00-31f0-4612-9bd8-f15742a0bb64', 'owner', 'org-1', '地址缺少门牌号') })
  it('rejects malformed return reasons before the workflow', async () => { const response = await returnRoute(new NextRequest('http://localhost/api/shipping/ledger/id/return', { method: 'POST', body: JSON.stringify({ reason: '' }) }), ctx); expect(response.status).toBe(400); expect(returned).not.toHaveBeenCalled() })
  it('rejects users without the database-backed operator permission', async () => { auth.mockResolvedValue({ id: 'other' }); requireOperator.mockRejectedValue(new ShippingError(403, '当前账号没有自助收寄操作权限。')); const response = await confirmRoute(new NextRequest('http://localhost/api/shipping/ledger/id/confirm', { method: 'POST' }), ctx); expect(response.status).toBe(403); expect(confirm).not.toHaveBeenCalled() })
  it('reconciles an uncertain provider result without creating another order', async () => { const response = await reconcileRoute(new NextRequest('http://localhost/api/shipping/ledger/id/reconcile', { method: 'POST' }), ctx); expect(response.status).toBe(200); expect(reconcile).toHaveBeenCalledWith('91b36e00-31f0-4612-9bd8-f15742a0bb64', 'org-1') })
  it('assigns an unowned shipment to sales and customer server-side', async () => { const response = await assignRoute(new NextRequest('http://localhost/api/shipping/ledger/id/assign', { method: 'POST', body: JSON.stringify({ salesRef: 'sales-1', customerRef: 'customer-1' }) }), ctx); expect(response.status).toBe(200); expect(assign).toHaveBeenCalledWith('91b36e00-31f0-4612-9bd8-f15742a0bb64', 'org-1', 'sales-1', 'customer-1') })
  it('takes the organization from authorization when a different organization is supplied in the URL', async () => { requireOperator.mockResolvedValue('org-A'); const response = await cancelRoute(new NextRequest('http://localhost/api/shipping/ledger/id/cancel?orgId=org-B', { method: 'POST' }), ctx); expect(response.status).toBe(200); expect(cancel).toHaveBeenCalledWith('91b36e00-31f0-4612-9bd8-f15742a0bb64', 'owner', 'org-A') })
  it('cancels through the authenticated server workflow', async () => { const response = await cancelRoute(new NextRequest('http://localhost/api/shipping/ledger/id/cancel', { method: 'POST' }), ctx); expect(response.status).toBe(200); expect(cancel).toHaveBeenCalledWith('91b36e00-31f0-4612-9bd8-f15742a0bb64', 'owner', 'org-1') })
  it('passes the displayed order snapshot to the cancellation workflow', async () => {
    const snapshot={revision:2,status:'awaiting_confirmation',waybill:null}
    const response=await cancelRoute(new NextRequest('http://localhost/api/shipping/ledger/id/cancel', {
      method:'POST', body:JSON.stringify(snapshot),
    }),ctx)
    expect(response.status).toBe(200)
    expect(cancel).toHaveBeenCalledWith('91b36e00-31f0-4612-9bd8-f15742a0bb64','owner','org-1',snapshot)
  })
})

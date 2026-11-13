// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
const m = vi.hoisted(() => ({ authorized: true, receipt: vi.fn() }))
vi.mock('@/lib/shipping/http', () => ({ shippingHandler: async (_request: unknown, action: (user: { id: string }, orgId: string, selfSubmit: boolean) => Promise<unknown>) => {
  if (!m.authorized) return NextResponse.json({ error: '请先登录。' }, { status: 401 })
  try { return NextResponse.json(await action({ id: 'employee' }, 'org-current', true)) }
  catch (error) { return NextResponse.json({ error: String(error) }, { status: 404 }) }
} }))
vi.mock('@/lib/shipping/collaboration', () => ({ getShipmentByReceipt: m.receipt, publicShipmentReceipt: (value: unknown) => value }))
import { GET } from './route'
const token = 'a'.repeat(43)
const request = () => new NextRequest('https://sales.cyanlog.icu/api/shipping/public/orders/' + token)
beforeEach(() => { m.authorized = true; m.receipt.mockReset() })

it('requires an ICU session before looking up an old receipt', async () => {
  m.authorized = false
  expect((await GET(request(), { params: Promise.resolve({ token }) })).status).toBe(401)
  expect(m.receipt).not.toHaveBeenCalled()
})

it('limits a signed old receipt to the logged-in organization', async () => {
  m.receipt.mockResolvedValue({ orderNo: 'SO-OLD', status: 'awaiting_confirmation', waybill: null })
  const response = await GET(request(), { params: Promise.resolve({ token }) })
  expect(response.status).toBe(200)
  expect(m.receipt).toHaveBeenCalledWith(token, { orgId: 'org-current' })
})

it('does not disclose a receipt absent from the logged-in organization', async () => {
  m.receipt.mockResolvedValue(null)
  expect((await GET(request(), { params: Promise.resolve({ token }) })).status).toBe(404)
})

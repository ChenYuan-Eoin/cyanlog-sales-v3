import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { shippingJson } from '@/lib/shipping/http'
import { ShippingError } from '@/lib/shipping/config'
import { anonymousShipmentSchema } from '@/lib/shipping/validation'
import { createAnonymousShipment, publicShipmentReceipt, listEmployeeShipmentReceipts } from '@/lib/shipping/collaboration'
import { enforceAnonymousShippingRate } from '@/lib/shipping/rate-limit'
import { requireShippingEmployee } from '@/lib/shipping/company-email-access'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const origin = req.headers.get('origin')
    if (origin !== req.nextUrl.origin) throw new ShippingError(403, '请求来源不受信任。')
    const { employee } = await requireShippingEmployee(req)
    if (!employee.sender || !employee.team) throw new ShippingError(422, '请先保存本人的寄件资料。')
    await enforceAnonymousShippingRate(req)
    const submission = anonymousShipmentSchema.parse(await shippingJson(req))
    const result = await createAnonymousShipment({ ...submission, orgId: employee.orgId, employee: { id: employee.id, sender: employee.sender, team: employee.team } })
    return NextResponse.json({ ...publicShipmentReceipt(result.order), receiptToken: result.receiptToken }, { status: 202, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const status = error instanceof ShippingError ? error.status : error instanceof ZodError || error instanceof SyntaxError ? 400 : 500
    const message = error instanceof ShippingError ? error.message : status === 400 ? '请核对寄件信息。' : '寄件单暂未受理，请稍后重试。'
    return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } })
  }
}

export async function GET(req: NextRequest) {
  try {
    const { employee } = await requireShippingEmployee(req)
    return NextResponse.json({ orders: await listEmployeeShipmentReceipts(employee.orgId, employee.id) }, { headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof ShippingError ? error.message : '个人工单暂不可用。' }, { status: error instanceof ShippingError ? error.status : 500, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } })
  }
}

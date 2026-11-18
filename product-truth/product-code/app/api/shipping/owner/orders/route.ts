import { prepareOwnerSubmission } from '@/lib/shipping/owner-submission'
import { ShippingError } from '@/lib/shipping/config'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { shippingHandler, shippingJson } from '@/lib/shipping/http'
import { ownerOrderSchema } from '@/lib/shipping/validation'
import { createOwnerShipment, listOwnerShipmentReceipts, publicShipmentReceipt } from '@/lib/shipping/collaboration'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  return shippingHandler(req, async (user, orgId) => {
    const rawPage = req.nextUrl.searchParams.get('page') || '0'
    if (!/^(0|[1-9]\d{0,3})$/.test(rawPage)) throw new ShippingError(400, '记录页码无效。')
    return listOwnerShipmentReceipts(orgId, user.id, Number(rawPage))
  }, { allowFxiaokeSelfSubmit: true })
}

export async function POST(req: NextRequest) {
  const response = await shippingHandler(req, async (user, orgId, selfSubmit) => {
    const submission = ownerOrderSchema.parse(await shippingJson(req))
    const input = await prepareOwnerSubmission(user, orgId, selfSubmit, submission.input)
    const order = await createOwnerShipment({
      orgId, userId: user.id, key: submission.key, input, usesDefaultSender: !submission.input.sender,
    })
    return { ...publicShipmentReceipt(order), orderId: order.id, requestNumber: order.orderNo }
  }, { allowFxiaokeSelfSubmit: true })
  return response.ok ? new NextResponse(response.body, { status: 202, headers: response.headers }) : response
}

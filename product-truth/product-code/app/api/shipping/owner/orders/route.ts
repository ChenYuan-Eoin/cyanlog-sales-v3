import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { shippingHandler, shippingJson } from '@/lib/shipping/http'
import { ownerOrderSchema } from '@/lib/shipping/validation'
import { createOwnerShipment, publicShipmentReceipt } from '@/lib/shipping/collaboration'
import { loadDefaultShippingSender } from '@/lib/shipping/sender-profile'
import { emptyContact, type ShippingInput } from '@/lib/shipping/types'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const response = await shippingHandler(req, async (user, orgId) => {
    const submission = ownerOrderSchema.parse(await shippingJson(req))
    const sender = submission.input.sender || await loadDefaultShippingSender(orgId) || emptyContact()
    const input: ShippingInput = { ...submission.input, sender }
    delete input.serviceId
    const order = await createOwnerShipment({
      orgId, userId: user.id, key: submission.key, input, usesDefaultSender: !submission.input.sender,
    })
    return { ...publicShipmentReceipt(order), orderId: order.id, requestNumber: order.orderNo }
  })
  return response.ok ? new NextResponse(response.body, { status: 202, headers: response.headers }) : response
}

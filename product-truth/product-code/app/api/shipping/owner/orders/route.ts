import type { NextRequest } from 'next/server'
import { shippingHandler, shippingJson } from '@/lib/shipping/http'
import { createSchema } from '@/lib/shipping/validation'
import { createOwnerShipment, publicShipmentReceipt } from '@/lib/shipping/collaboration'
import { confirmAndSubmitShipment } from '@/lib/shipping/workflow'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  return shippingHandler(req, async user => {
    const submission = createSchema.parse(await shippingJson(req))
    const order = await createOwnerShipment({ userId: user.id, key: submission.key, input: submission.input })
    if (order.status === 'waybill_created') return publicShipmentReceipt(order)
    const result = await confirmAndSubmitShipment(order.id, user.id)
    return { ...publicShipmentReceipt(order), status: result.status, waybill: result.waybill }
  })
}

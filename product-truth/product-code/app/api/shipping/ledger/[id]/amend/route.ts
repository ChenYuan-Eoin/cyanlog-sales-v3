import type { NextRequest } from 'next/server'
import { amendShipmentOrder } from '@/lib/shipping/collaboration'
import { shippingHandler, shippingJson } from '@/lib/shipping/http'
import { amendShipmentSchema } from '@/lib/shipping/validation'

export const runtime = 'nodejs'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return shippingHandler(req, async (user, orgId) => {
    const body = amendShipmentSchema.parse(await shippingJson(req))
    return amendShipmentOrder({
      orgId,
      userId: user.id,
      orderId: (await params).id,
      expectedRevision: body.expected_revision,
      input: body.input,
      reason: body.reason,
    })
  })
}

import type { NextRequest } from 'next/server'
import { shippingHandler, shippingJson } from '@/lib/shipping/http'
import { assignShipmentSchema } from '@/lib/shipping/validation'
import { assignShipmentRelation } from '@/lib/shipping/collaboration'

export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return shippingHandler(req, async () => {
    const body = assignShipmentSchema.parse(await shippingJson(req))
    return assignShipmentRelation((await params).id, body.salesRef, body.customerRef)
  })
}

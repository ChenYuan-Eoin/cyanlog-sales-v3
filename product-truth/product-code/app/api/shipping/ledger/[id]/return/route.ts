import type { NextRequest } from 'next/server'
import { shippingHandler, shippingJson } from '@/lib/shipping/http'
import { returnShipmentSchema } from '@/lib/shipping/validation'
import { returnShipmentOrder } from '@/lib/shipping/workflow'

export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return shippingHandler(req, async user => {
    const body = returnShipmentSchema.parse(await shippingJson(req))
    return returnShipmentOrder((await params).id, user.id, body.reason)
  })
}

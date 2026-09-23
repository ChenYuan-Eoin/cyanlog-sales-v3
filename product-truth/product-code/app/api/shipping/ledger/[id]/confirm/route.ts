import type { NextRequest } from 'next/server'
import { shippingHandler, shippingJson } from '@/lib/shipping/http'
import { confirmAndSubmitShipment } from '@/lib/shipping/workflow'
import { orderSelectionSchema } from '@/lib/shipping/validation'

export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return shippingHandler(req, async user => {
    const selection = orderSelectionSchema.parse(await shippingJson(req))
    return confirmAndSubmitShipment((await params).id, user.id, selection)
  })
}

import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { shippingHandler, shippingJson } from '@/lib/shipping/http'
import { cancelShipmentOrder } from '@/lib/shipping/workflow'

export const runtime = 'nodejs'
const orderIdSchema = z.string().uuid()
const legacyEmptyBody = z.object({}).strict()

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return shippingHandler(req, async (user, orgId) => {
    const id = orderIdSchema.parse((await params).id)
    const body = await shippingJson(req)
    return legacyEmptyBody.safeParse(body).success
      ? cancelShipmentOrder(id, user.id, orgId)
      : cancelShipmentOrder(id, user.id, orgId, body)
  })
}

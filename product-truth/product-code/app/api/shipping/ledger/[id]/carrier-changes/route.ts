import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { shippingHandler, shippingJson } from '@/lib/shipping/http'
import { carrierChangeSchema, getCarrierChange, submitCarrierChange } from '@/lib/shipping/owner-carrier-change'

export const runtime = 'nodejs'
type Context = { params: Promise<{ id: string }> }
const orderIdSchema = z.string().uuid()

export async function GET(req: NextRequest, { params }: Context) {
  return shippingHandler(req, async (user, orgId) =>
    getCarrierChange({ orgId, userId: user.id, orderId: orderIdSchema.parse((await params).id) }))
}

export async function POST(req: NextRequest, { params }: Context) {
  return shippingHandler(req, async (user, orgId) => {
    const orderId = orderIdSchema.parse((await params).id)
    const body = carrierChangeSchema.parse(await shippingJson(req))
    return submitCarrierChange({ orgId, userId: user.id, orderId }, body)
  })
}

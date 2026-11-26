import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { shippingHandler, shippingJson } from '@/lib/shipping/http'
import { loadShippingOperatorDecision } from '@/lib/shipping/operator-access'
import { carrierChangeSchema, getCarrierChange, submitCarrierChange } from '@/lib/shipping/owner-carrier-change'

export const runtime = 'nodejs'
type Context = { params: Promise<{ id: string }> }
const orderIdSchema = z.string().uuid()

export async function GET(req: NextRequest, { params }: Context) {
  return shippingHandler(req, async (user, orgId) => {
    const orderId = orderIdSchema.parse((await params).id)
    const change = await loadShippingOperatorDecision(user.id, 'shipping:order_change').catch(() => null)
    return getCarrierChange({ orgId, userId: user.id, orderId }, {
      checkAvailability: change?.orgId === orgId && change.canOperate,
    })
  })
}

export async function POST(req: NextRequest, { params }: Context) {
  return shippingHandler(req, async (user, orgId) => {
    const orderId = orderIdSchema.parse((await params).id)
    const body = carrierChangeSchema.parse(await shippingJson(req))
    return submitCarrierChange({ orgId, userId: user.id, orderId }, body)
  })
}

import type { NextRequest } from 'next/server'
import { shippingHandler, shippingJson } from '@/lib/shipping/http'
import { carrierChangeSchema, getCarrierChange, submitCarrierChange } from '@/lib/shipping/owner-carrier-change'

export const runtime = 'nodejs'
type Context = { params: Promise<{ orderNo: string }> }
export async function GET(req: NextRequest, { params }: Context) {
  // Preparing an action can query carrier readiness, so passive record access is insufficient.
  return shippingHandler(req, async (user, orgId) => {
    return getCarrierChange({ orgId, userId: user.id, orderNo: (await params).orderNo })
  }, 'owner')
}
export async function POST(req: NextRequest, { params }: Context) {
  return shippingHandler(req, async (user, orgId) => {
    const body = carrierChangeSchema.parse(await shippingJson(req))
    return submitCarrierChange({ orgId, userId: user.id, orderNo: (await params).orderNo }, body)
  }, 'owner')
}

import type { NextRequest } from 'next/server'
import { shippingHandler, shippingJson } from '@/lib/shipping/http'
import { carrierChangeSchema, getCarrierChange, submitCarrierChange } from '@/lib/shipping/owner-carrier-change'

export const runtime = 'nodejs'
type Context = { params: Promise<{ orderNo: string }> }
export async function GET(req: NextRequest, { params }: Context) {
  return shippingHandler(req, async (user, orgId) =>
    getCarrierChange({ orgId, userId: user.id, orderNo: (await params).orderNo }), { allowFxiaokeSelfSubmit: true })
}
export async function POST(req: NextRequest, { params }: Context) {
  return shippingHandler(req, async (user, orgId) => {
    const body = carrierChangeSchema.parse(await shippingJson(req))
    return submitCarrierChange({ orgId, userId: user.id, orderNo: (await params).orderNo }, body)
  }, { allowFxiaokeSelfSubmit: true })
}

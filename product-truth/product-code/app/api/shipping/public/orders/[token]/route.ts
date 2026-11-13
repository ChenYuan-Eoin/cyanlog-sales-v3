import type { NextRequest } from 'next/server'
import { shippingHandler } from '@/lib/shipping/http'
import { ShippingError } from '@/lib/shipping/config'
import { getShipmentByReceipt, publicShipmentReceipt } from '@/lib/shipping/collaboration'

export const runtime = 'nodejs'

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  return shippingHandler(req, async (_user, orgId) => {
    const order = await getShipmentByReceipt((await params).token, { orgId })
    if (!order) throw new ShippingError(404, '寄件回执不存在或已失效。')
    return publicShipmentReceipt(order)
  }, { allowFxiaokeSelfSubmit: true })
}

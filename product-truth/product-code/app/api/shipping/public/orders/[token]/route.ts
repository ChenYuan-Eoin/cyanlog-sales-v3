import type { NextRequest } from 'next/server'
import { shippingHandler } from '@/lib/shipping/http'
import { ShippingError } from '@/lib/shipping/config'
import { getShipmentByReceipt, publicShipmentReceipt } from '@/lib/shipping/collaboration'

export const runtime = 'nodejs'

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  return shippingHandler(req, async (user, orgId, receiptAccess) => {
    const { token } = await params
    let order = receiptAccess?.canReadOwnedReceipt ? await getShipmentByReceipt(token, { orgId, userId: user.id }) : null
    if (!order && receiptAccess?.canReadLegacyReceipt) {
      order = await getShipmentByReceipt(token, { orgId, legacyAnonymous: true })
    }
    if (!order) throw new ShippingError(404, '寄件回执不存在或已失效。')
    return publicShipmentReceipt(order)
  }, 'receipt')
}

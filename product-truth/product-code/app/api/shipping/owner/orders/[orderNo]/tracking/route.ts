import type { NextRequest } from 'next/server'
import { ShippingError } from '@/lib/shipping/config'
import { shippingHandler } from '@/lib/shipping/http'
import { refreshOwnerTracking } from '@/lib/shipping/owner-tracking'

export const runtime = 'nodejs'
export const preferredRegion = 'hkg1'

export async function POST(req: NextRequest, { params }: { params: Promise<{ orderNo: string }> }) {
  return shippingHandler(req, async (user, orgId) => {
    const { orderNo } = await params
    if (!/^SO-\d{8}-[A-Z0-9]{8}$/.test(orderNo)) throw new ShippingError(404, '寄件单不存在。')
    return refreshOwnerTracking(orgId, user.id, orderNo)
  }, 'owner')
}

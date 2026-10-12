import type { NextRequest } from 'next/server'
import { shippingHandler } from '@/lib/shipping/http'
import { reopenFailedShipmentOrder } from '@/lib/shipping/workflow'
export const runtime = 'nodejs'
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return shippingHandler(req, async (user, orgId) => reopenFailedShipmentOrder((await params).id, user.id, orgId))
}

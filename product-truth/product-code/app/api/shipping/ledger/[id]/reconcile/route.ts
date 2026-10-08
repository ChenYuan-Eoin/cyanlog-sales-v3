import type { NextRequest } from 'next/server'
import { shippingHandler } from '@/lib/shipping/http'
import { reconcileShipmentOrder } from '@/lib/shipping/workflow'

export const runtime = 'nodejs'
// Verify this carrier connectivity comparison using the function's runtimeRegion log.
export const preferredRegion = 'hkg1'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return shippingHandler(req, async (_user, orgId) => reconcileShipmentOrder((await params).id, orgId))
}

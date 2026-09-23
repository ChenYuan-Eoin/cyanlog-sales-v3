import type { NextRequest } from 'next/server'
import { shippingHandler } from '@/lib/shipping/http'
import { cancelShipmentOrder } from '@/lib/shipping/workflow'

export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return shippingHandler(req, async user => cancelShipmentOrder((await params).id, user.id))
}

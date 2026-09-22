import type { NextRequest } from 'next/server'
import { shippingHandler } from '@/lib/shipping/http'
import { shipmentLedgerQuerySchema } from '@/lib/shipping/validation'
import { listShipmentLedger } from '@/lib/shipping/collaboration'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  return shippingHandler(req, async () => {
    const filters = shipmentLedgerQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()))
    const records = await listShipmentLedger(filters)
    return { records, nextCursor: records.length === filters.limit ? records.at(-1)?.createdAt || null : null }
  })
}

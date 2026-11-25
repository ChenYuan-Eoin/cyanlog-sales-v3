import type { NextRequest } from 'next/server'
import { shippingHandler } from '@/lib/shipping/http'
import { shipmentLedgerQuerySchema } from '@/lib/shipping/validation'
import { listShipmentLedger } from '@/lib/shipping/collaboration'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  return shippingHandler(req, async (_user, orgId) => {
    const filters = shipmentLedgerQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()))
    const records = await listShipmentLedger(orgId, filters)
    if (filters.page !== undefined) {
      return {
        records: records.slice(0, filters.limit),
        nextPage: records.length > filters.limit && filters.page < 1000 ? filters.page + 1 : null,
      }
    }
    return { records, nextCursor: records.length === filters.limit ? records.at(-1)?.createdAt || null : null }
  })
}

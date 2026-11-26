import { NextResponse, type NextRequest } from 'next/server'
import { shippingHandler, shippingJson, shippingLedgerRead } from '@/lib/shipping/http'
import { shipmentLedgerQuerySchema } from '@/lib/shipping/validation'
import { listShipmentLedger } from '@/lib/shipping/collaboration'
import { submitShippingWorkorder } from '@/lib/shipping/owner-submission'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  return shippingLedgerRead(req, async ({ orgId, departmentIds, query, returnAccess }) => {
    const filters = shipmentLedgerQuerySchema.parse(query)
    const records = await listShipmentLedger(orgId, filters, departmentIds, returnAccess)
    if (filters.page !== undefined) {
      return {
        records: records.slice(0, filters.limit),
        nextPage: records.length > filters.limit && filters.page < 1000 ? filters.page + 1 : null,
      }
    }
    return { records, nextCursor: records.length === filters.limit ? records.at(-1)?.createdAt || null : null }
  })
}

export async function POST(req: NextRequest) {
  const response = await shippingHandler(req, async (user, orgId) =>
    submitShippingWorkorder(user, orgId, false, await shippingJson(req)))
  return response.ok ? new NextResponse(response.body, { status: 202, headers: response.headers }) : response
}

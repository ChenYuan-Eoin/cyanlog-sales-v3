import { submitShippingWorkorder } from '@/lib/shipping/owner-submission'
import { ShippingError } from '@/lib/shipping/config'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { shippingHandler, shippingJson } from '@/lib/shipping/http'
import { listOwnerShipmentReceipts } from '@/lib/shipping/collaboration'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  return shippingHandler(req, async (user, orgId) => {
    const rawPage = req.nextUrl.searchParams.get('page') || '0'
    if (!/^(0|[1-9]\d{0,3})$/.test(rawPage)) throw new ShippingError(400, '记录页码无效。')
    return listOwnerShipmentReceipts(orgId, user.id, Number(rawPage))
  }, 'owner')
}

export async function POST(req: NextRequest) {
  const response = await shippingHandler(req, async (user, orgId) =>
    submitShippingWorkorder(user, orgId, true, await shippingJson(req)), 'owner')
  return response.ok ? new NextResponse(response.body, { status: 202, headers: response.headers }) : response
}

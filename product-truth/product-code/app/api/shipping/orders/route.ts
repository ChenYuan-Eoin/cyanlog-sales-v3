import type { NextRequest } from 'next/server'
import { shippingHandler } from '@/lib/shipping/http'
import { ShippingError } from '@/lib/shipping/config'
import { shippingStoreForOrg, publicRecord } from '@/lib/shipping/store'
import { shippingRequestId } from '@/lib/shipping/service'
import { listImportedOutbound } from '@/lib/shipping/outbound'
import { z } from 'zod'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  return shippingHandler(req, async (user, orgId) => {
    const shippingStore = shippingStoreForOrg(orgId)
    const key = req.nextUrl.searchParams.get('key')
    const current = key ? await shippingStore.get(shippingRequestId(user.id, z.string().uuid().parse(key)), user.id) : null
    const records = (await shippingStore.recent(user.id)).map(publicRecord)
    const imported = await listImportedOutbound(user.id)
    return { records, imported, current: current ? publicRecord(current) : null }
  })
}

export async function POST(req: NextRequest) {
  return shippingHandler(req, async () => {
    throw new ShippingError(410, '直接下单入口已停用，请先提报寄件工单，再由操作员审核确认下单。', 'validation')
  })
}

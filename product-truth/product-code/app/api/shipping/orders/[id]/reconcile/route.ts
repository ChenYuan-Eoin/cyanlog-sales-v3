import type { NextRequest } from 'next/server'
import { shippingHandler } from '@/lib/shipping/http'
import { requireShippingConnection, ShippingError } from '@/lib/shipping/config'
import { shippingStore, publicRecord } from '@/lib/shipping/store'
import { lookupSfOrder } from '@/lib/shipping/sf-client'
export const runtime = 'nodejs'
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return shippingHandler(req, async user => {
    const { id } = await ctx.params
    if (!/^PV3[a-f0-9]{28}$/.test(id)) throw new ShippingError(400, '请求编号无效。')
    const c = requireShippingConnection()
    const record = await shippingStore.get(id, user.id, c.connectionKey)
    if (!record) throw new ShippingError(404, '未找到本人的寄件记录。')
    if (record.status === 'accepted' && record.waybill) return publicRecord(record)
    const waybill = await lookupSfOrder(id)
    // Missing waybill remains pending/unknown; never infer absence as permission to resend.
    if (!waybill) return publicRecord(record)
    return publicRecord(await shippingStore.finish(id, user.id, 'accepted', waybill))
  })
}

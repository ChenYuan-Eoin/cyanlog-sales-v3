import type { NextRequest } from 'next/server'
import { shippingHandler } from '@/lib/shipping/http'
import { ShippingError } from '@/lib/shipping/config'
import { shippingStoreForOrg, publicRecord } from '@/lib/shipping/store'
import { lookupSfOrder } from '@/lib/shipping/sf-client'
import { getShippingRuntimeConfig } from '@/lib/shipping/runtime-config'
export const runtime = 'nodejs'
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return shippingHandler(req, async (user, orgId) => {
    const { id } = await ctx.params
    if (!/^PV3[a-f0-9]{28}$/.test(id)) throw new ShippingError(400, '请求编号无效。')
    const shippingStore = shippingStoreForOrg(orgId)
    const record = await shippingStore.get(id, user.id)
    if (!record) throw new ShippingError(404, '未找到本人的寄件记录。')
    if (record.status === 'accepted' && record.waybill) return publicRecord(record)
    if (!record.org_id || !record.carrier_connection_id || !record.billing_account_id) throw new ShippingError(409, '该历史寄件记录没有数据库配置快照，无法查回。')
    const connection = await getShippingRuntimeConfig({ orgId: record.org_id, connectionId: record.carrier_connection_id, billingAccountId: record.billing_account_id, allowHistorical: true, requireOrderCapability: false })
    const waybill = await lookupSfOrder(id, connection)
    // Missing waybill remains pending/unknown; never infer absence as permission to resend.
    if (!waybill) return publicRecord(record)
    return publicRecord(await shippingStore.finish(id, user.id, 'accepted', waybill))
  })
}

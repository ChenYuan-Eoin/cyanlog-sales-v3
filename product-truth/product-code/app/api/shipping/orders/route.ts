import type { NextRequest } from 'next/server'
import { shippingHandler, shippingJson } from '@/lib/shipping/http'
import { ShippingError } from '@/lib/shipping/config'
import { shippingStoreForOrg, publicRecord } from '@/lib/shipping/store'
import { submitShipping, checkShippingPolicy, shippingRequestId } from '@/lib/shipping/service'
import { createSfOrder } from '@/lib/shipping/sf-client'
import { getShippingRuntimeConfig, loadShippingSettings } from '@/lib/shipping/runtime-config'
import { ownerOrderSchema } from '@/lib/shipping/validation'
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
  return shippingHandler(req, async (user, orgId) => {
    const submission = ownerOrderSchema.parse(await shippingJson(req))
    const settings = await loadShippingSettings(orgId)
    const billingAccountId = submission.billingAccountId || settings.defaultBillingAccountId
    if (!billingAccountId) throw new ShippingError(409, '请先配置活动月结账号。')
    const connection = await getShippingRuntimeConfig({ orgId, billingAccountId })
    const input = { ...submission.input, sender: connection.sender }
    checkShippingPolicy(input, connection.services)
    const key = submission.key
    return publicRecord(await submitShipping({
      userId: user.id, key, input, connection: connection.connectionKey, environment: connection.environment, runtimeConfig: connection,
      store: shippingStoreForOrg(orgId), send: (requestId, frozenInput) => createSfOrder(requestId, frozenInput, connection)
    }))
  })
}

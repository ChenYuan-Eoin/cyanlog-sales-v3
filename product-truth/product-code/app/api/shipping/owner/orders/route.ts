import type { NextRequest } from 'next/server'
import { shippingHandler, shippingJson } from '@/lib/shipping/http'
import { ownerOrderSchema } from '@/lib/shipping/validation'
import { createOwnerShipment, publicShipmentReceipt } from '@/lib/shipping/collaboration'
import { confirmAndSubmitShipment } from '@/lib/shipping/workflow'
import { getUserShippingSettings, getShippingRuntimeConfig, selectAuthorizedShippingService } from '@/lib/shipping/runtime-config'
import { checkShippingPolicy } from '@/lib/shipping/service'
import { ShippingError } from '@/lib/shipping/config'
import type { ShippingInput } from '@/lib/shipping/types'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  return shippingHandler(req, async user => {
    const submission = ownerOrderSchema.parse(await shippingJson(req))
    const { orgId, settings } = await getUserShippingSettings(user.id)
    const billingAccountId = submission.billingAccountId || settings.defaultBillingAccountId
    if (!billingAccountId) throw new ShippingError(409, '请先配置活动月结账号。')
    const connection = await getShippingRuntimeConfig({ orgId, billingAccountId, connectionId: submission.connectionId })
    const input: ShippingInput = { ...submission.input, sender: connection.sender }
    checkShippingPolicy(input, connection.services)
    const service = selectAuthorizedShippingService(connection.services, input.servicePreference, input.serviceId)
    input.serviceId = service.id
    input.serviceName = service.name
    const order = await createOwnerShipment({
      userId: user.id, key: submission.key, input,
      snapshot: { orgId, connectionId: connection.connectionId, billingAccountId: connection.billingAccountId, senderProfileId: connection.senderProfileId, environment: connection.environment, billingAccountTail: connection.billingAccountTail, serviceId: service.id, serviceName: service.name }
    })
    if (order.status === 'waybill_created') return publicShipmentReceipt(order)
    const result = await confirmAndSubmitShipment(order.id, user.id, { connectionId: connection.connectionId, billingAccountId, serviceId: service.id })
    return { ...publicShipmentReceipt(order), status: result.status, waybill: result.waybill }
  })
}

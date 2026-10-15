import { createHash } from 'node:crypto'
import type { ShippingInput } from './types'
import type { ShippingStore, StoredShipping } from './store'
import { ShippingError } from './config'
import type { CarrierOrderContext } from './carrier-adapter'
// Single policy entry: future order-based policy must validate server-side before reserving a request.
export function checkShippingPolicy(input: ShippingInput, services: { id: number }[]) {
  if (input.source !== 'manual') throw new ShippingError(400, '暂不支持该寄件来源。')
  if (!Number.isInteger(input.serviceId) || !input.serviceId) throw new ShippingError(400, '请先选择已授权的承运商服务产品。')
  if (!services.some(s => s.id === input.serviceId)) throw new ShippingError(400, '请选择已开通的快递服务。')
}
export function shippingRequestId(userId: string, key: string) { return 'PV3' + createHash('sha256').update(userId + ':' + key).digest('hex').slice(0, 28) }
export async function submitShipping(args: { userId: string; key: string; input: ShippingInput; connection: string; environment: 'sandbox' | 'production'; store: ShippingStore; send: (id: string, input: ShippingInput) => Promise<string | null>; runtimeConfig?: CarrierOrderContext }) {
  const { userId, key, input, connection, environment, store, send, runtimeConfig } = args
  const id = shippingRequestId(userId, key)
  const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex')
  const row: StoredShipping = {
    id, created_by: userId, idempotency_key: key, connection_key: connection, environment, fingerprint, request_payload: input, status: 'pending', waybill: null, created_at: new Date().toISOString(),
    ...(runtimeConfig ? { org_id: runtimeConfig.orgId, carrier_connection_id: runtimeConfig.connectionId, billing_account_id: runtimeConfig.billingAccountId, sender_profile_id: runtimeConfig.senderProfileId, billing_account_tail: runtimeConfig.billingAccountTail, shipping_config_snapshot: runtimeConfig.snapshot } : {})
  }
  const reservation = await store.reserve(row)
  if (reservation.record.fingerprint !== fingerprint) throw new ShippingError(409, '同一请求的寄件信息发生变化，请先确认原请求结果。')
  if (!reservation.inserted) return reservation.record
  let waybill: string | null
  try { waybill = await send(id, input) }
  catch (error) {
    if (error instanceof ShippingError) {
      // Keep the request locked and let the workflow persist safe diagnostics.
      await store.finish(id, userId, 'unknown', null)
      throw error
    }
    return store.finish(id, userId, 'unknown', null)
  }
  return store.finish(id, userId, 'accepted', waybill)
}

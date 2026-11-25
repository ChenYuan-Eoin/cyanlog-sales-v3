import { enforceExternalTrackingRate } from '@/lib/shipping/rate-limit'
import type { NextRequest } from 'next/server'
import { shippingHandler, shippingJson } from '@/lib/shipping/http'
import { trackingSchema } from '@/lib/shipping/validation'
import { getHistoricalCarrierAdapter } from '@/lib/shipping/carrier-adapter'
import { ShippingError } from '@/lib/shipping/config'
import { getOwnedShippingWaybill } from '@/lib/shipping/store'
import { importedOutboundSuffix } from '@/lib/shipping/outbound'
import { recordTrackingResult } from '@/lib/shipping/tracking-store'
import { recordShippingCapability } from '@/lib/shipping/connections'
import { getOrganizationShipmentProviderSnapshot } from '@/lib/shipping/collaboration'
import { loadShippingSettings } from '@/lib/shipping/runtime-config'
export const runtime = 'nodejs'
export const preferredRegion = 'hkg1'
export async function POST(req: NextRequest) { return shippingHandler(req, async (user, orgId) => {
  const input = trackingSchema.parse(await shippingJson(req))
  const [ownedLegacy, ownedCollaborative, importedSuffix] = await Promise.all([
    getOwnedShippingWaybill(user.id, orgId, input.waybill),
    getOrganizationShipmentProviderSnapshot(orgId, input.waybill),
    importedOutboundSuffix(user.id, input.waybill)
  ])
  if ((ownedLegacy && ownedLegacy.org_id !== orgId) || (ownedCollaborative && ownedCollaborative.org_id !== orgId)) throw new ShippingError(403, '该运单不属于当前授权组织。')
  const owned = ownedLegacy || ownedCollaborative
  const external = !owned && !importedSuffix
  if (external) {
    if (!input.phoneSuffix) throw new ShippingError(422, '这票运单不在平台记录中，请填写收寄任一方手机号后四位，由顺丰校验后查询。')
    await enforceExternalTrackingRate(orgId, user.id)
  }
  let carrier
  if (ownedLegacy) {
    if (!ownedLegacy.org_id || !ownedLegacy.carrier_connection_id) throw new ShippingError(409, '该历史运单没有配置快照，请联系管理员协助查询。')
    carrier = await getHistoricalCarrierAdapter(ownedLegacy.shipping_config_snapshot?.carrier).connect({ expectedEnvironment: ownedLegacy.environment, orgId: ownedLegacy.org_id, connectionId: ownedLegacy.carrier_connection_id, billingAccountId: ownedLegacy.billing_account_id, allowHistorical: true, requireOrderCapability: false })
  } else if (ownedCollaborative) {
    if (!ownedCollaborative.org_id || !ownedCollaborative.carrier_connection_id) throw new ShippingError(409, '该历史运单没有配置快照，请联系管理员协助查询。')
    carrier = await getHistoricalCarrierAdapter(ownedCollaborative.provider_key).connect({ expectedEnvironment: ownedCollaborative.connection_environment, orgId: ownedCollaborative.org_id, connectionId: ownedCollaborative.carrier_connection_id, billingAccountId: ownedCollaborative.billing_account_id, allowHistorical: true, requireOrderCapability: false })
  } else {
    const settings = await loadShippingSettings(orgId)
    if (!settings.connectionId && !settings.defaultBillingAccountId) throw new ShippingError(409, '当前组织尚未配置可用于查询的顺丰连接。')
    carrier = await getHistoricalCarrierAdapter(undefined).connect({ orgId, connectionId: settings.connectionId, ...(external ? { expectedEnvironment: 'production' as const } : {}), requireOrderCapability: false })
  }
  const config = carrier.context
  const providerOrderId = !ownedLegacy ? ownedCollaborative?.provider_order_id?.trim() : null
  const result = providerOrderId
    ? await carrier.trackOrder(providerOrderId, input.waybill)
    : await carrier.track(input.waybill, importedSuffix || input.phoneSuffix)
  if (external && (result.source !== 'carrier' || result.waybill !== input.waybill || !result.events.length)) throw new ShippingError(422, '顺丰未返回可验证的轨迹。请核对收寄手机号后四位；也可能无查询权限、暂无轨迹或已超过3个月查询期限。未将此运单认定为平台工单。')
  if (external) console.info('shipping.tracking.verified', { provider: carrier.key, runtimeRegion: process.env.VERCEL_REGION, eventCount: result.events.length })
  // Only actual carrier observations may advance persisted shipment state.
  const recording = result.source === 'carrier' && Boolean(owned)
    ? await recordTrackingResult(orgId, result, carrier.key)
    : { recorded: 0, shipmentStatus: undefined }
  try { if (result.source === 'carrier' && result.events.length) await recordShippingCapability(config.orgId, config.connectionId, 'tracking') }
  catch { console.error('shipping.capability.record_failed', { capability: 'tracking' }) }
  return { ...result, ...(recording.shipmentStatus ? { shipmentStatus: recording.shipmentStatus } : {}) }
}) }

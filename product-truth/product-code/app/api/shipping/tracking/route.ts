import type { NextRequest } from 'next/server'
import { shippingHandler, shippingJson } from '@/lib/shipping/http'
import { trackingSchema } from '@/lib/shipping/validation'
import { querySfTracking } from '@/lib/shipping/sf-client'
import { ShippingError } from '@/lib/shipping/config'
import { getOwnedShippingWaybill } from '@/lib/shipping/store'
import { importedOutboundSuffix } from '@/lib/shipping/outbound'
import { recordTrackingResult } from '@/lib/shipping/tracking-store'
import { recordShippingCapability } from '@/lib/shipping/connections'
import { getOwnedShipmentProviderSnapshot } from '@/lib/shipping/collaboration'
import { getShippingRuntimeConfig, getUserShippingSettings } from '@/lib/shipping/runtime-config'
export const runtime = 'nodejs'
export async function POST(req: NextRequest) { return shippingHandler(req, async user => {
  const input = trackingSchema.parse(await shippingJson(req))
  const [ownedLegacy, ownedCollaborative, importedSuffix] = await Promise.all([
    getOwnedShippingWaybill(user.id, input.waybill),
    getOwnedShipmentProviderSnapshot(user.id, input.waybill),
    importedOutboundSuffix(user.id, input.waybill)
  ])
  const owned = ownedLegacy || ownedCollaborative
  if (!owned && !importedSuffix) throw new ShippingError(403, '当前仅支持查询本人已记录的寄出运单。')
  let config
  if (ownedLegacy) {
    if (!ownedLegacy.org_id || !ownedLegacy.carrier_connection_id || !ownedLegacy.billing_account_id) throw new ShippingError(409, '该历史运单没有配置快照，请联系管理员协助查询。')
    config = await getShippingRuntimeConfig({ orgId: ownedLegacy.org_id, connectionId: ownedLegacy.carrier_connection_id, billingAccountId: ownedLegacy.billing_account_id, allowHistorical: true, requireOrderCapability: false })
  } else if (ownedCollaborative) {
    if (!ownedCollaborative.org_id || !ownedCollaborative.carrier_connection_id || !ownedCollaborative.billing_account_id) throw new ShippingError(409, '该历史运单没有配置快照，请联系管理员协助查询。')
    config = await getShippingRuntimeConfig({ orgId: ownedCollaborative.org_id, connectionId: ownedCollaborative.carrier_connection_id, billingAccountId: ownedCollaborative.billing_account_id, allowHistorical: true, requireOrderCapability: false })
  } else {
    const { orgId, settings } = await getUserShippingSettings(user.id)
    if (!settings.defaultBillingAccountId) throw new ShippingError(409, '当前组织尚未配置可用于查询的顺丰连接。')
    config = await getShippingRuntimeConfig({ orgId, billingAccountId: settings.defaultBillingAccountId, requireOrderCapability: false })
  }
  const result = await querySfTracking(input.waybill, importedSuffix || input.phoneSuffix, config)
  await recordTrackingResult(result)
  try { await recordShippingCapability(config.orgId, config.connectionId, 'tracking') }
  catch { console.error('shipping.capability.record_failed', { capability: 'tracking' }) }
  return result
}) }

import type { NextRequest } from 'next/server'
import { shippingHandler, shippingJson } from '@/lib/shipping/http'
import { trackingSchema } from '@/lib/shipping/validation'
import { querySfTracking } from '@/lib/shipping/sf-client'
import { shippingConfig, ShippingError } from '@/lib/shipping/config'
import { ownsShippingWaybill } from '@/lib/shipping/store'
import { importedOutboundSuffix } from '@/lib/shipping/outbound'
export const runtime = 'nodejs'
export async function POST(req: NextRequest) { return shippingHandler(req, async user => {
  const input = trackingSchema.parse(await shippingJson(req))
  const config = shippingConfig()
  const owned = await ownsShippingWaybill(user.id, config.connectionKey, input.waybill)
  const importedSuffix = !owned && config.environment === 'production' ? await importedOutboundSuffix(user.id, input.waybill) : null
  if (!owned && !importedSuffix) throw new ShippingError(403, '当前仅支持查询本人已记录的寄出运单。')
  return querySfTracking(input.waybill, importedSuffix || input.phoneSuffix)
}) }

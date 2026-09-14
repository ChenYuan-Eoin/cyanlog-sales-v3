import type { NextRequest } from 'next/server'
import { shippingHandler, shippingJson } from '@/lib/shipping/http'
import { trackingSchema } from '@/lib/shipping/validation'
import { querySfTracking } from '@/lib/shipping/sf-client'
import { shippingConfig, ShippingError } from '@/lib/shipping/config'
import { ownsShippingWaybill } from '@/lib/shipping/store'
export const runtime = 'nodejs'
export async function POST(req: NextRequest) { return shippingHandler(req, async user => {
  const input = trackingSchema.parse(await shippingJson(req))
  const owned = await ownsShippingWaybill(user.id, shippingConfig().connectionKey, input.waybill)
  if (!owned && !input.phoneSuffix) throw new ShippingError(400, '非本人寄件记录需填写收寄手机号后四位后查询。')
  return querySfTracking(input.waybill, input.phoneSuffix)
}) }

import type { NextRequest } from 'next/server'
import { shippingHandler, shippingJson } from '@/lib/shipping/http'
import { trackingSchema } from '@/lib/shipping/validation'
import { querySfTracking } from '@/lib/shipping/sf-client'
export const runtime = 'nodejs'
export async function POST(req: NextRequest) { return shippingHandler(req, async () => { const input = trackingSchema.parse(await shippingJson(req)); return querySfTracking(input.waybill, input.phoneSuffix) }) }

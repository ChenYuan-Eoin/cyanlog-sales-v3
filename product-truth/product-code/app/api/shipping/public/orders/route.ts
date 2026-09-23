import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { shippingJson } from '@/lib/shipping/http'
import { shippingConfig, ShippingError } from '@/lib/shipping/config'
import { anonymousShipmentSchema, contactSchema } from '@/lib/shipping/validation'
import { createAnonymousShipment, publicShipmentReceipt } from '@/lib/shipping/collaboration'
import { enforceAnonymousShippingRate } from '@/lib/shipping/rate-limit'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const origin = req.headers.get('origin')
    if (origin && origin !== req.nextUrl.origin) throw new ShippingError(403, '请求来源不受信任。')
    await enforceAnonymousShippingRate(req)
    const submission = anonymousShipmentSchema.parse(await shippingJson(req))
    const configuredSender = contactSchema.safeParse(shippingConfig().publicSettings.sender)
    const sender = submission.input.sender || (configuredSender.success ? configuredSender.data : null)
    if (!sender) throw new ShippingError(503, '公司默认寄件地址尚未配置，请联系前台。')
    const result = await createAnonymousShipment({ ...submission, input: { ...submission.input, sender } })
    return NextResponse.json({ ...publicShipmentReceipt(result.order), receiptToken: result.receiptToken }, { status: 202, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const status = error instanceof ShippingError ? error.status : error instanceof ZodError || error instanceof SyntaxError ? 400 : 500
    const message = error instanceof ShippingError ? error.message : status === 400 ? '请核对寄件信息。' : '寄件单暂未受理，请稍后重试。'
    return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } })
  }
}

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { shippingJson } from '@/lib/shipping/http'
import { ShippingError } from '@/lib/shipping/config'
import { anonymousShipmentSchema } from '@/lib/shipping/validation'
import { createAnonymousShipment, publicShipmentReceipt, listEmployeeShipmentReceipts } from '@/lib/shipping/collaboration'
import { enforceAnonymousShippingRate } from '@/lib/shipping/rate-limit'
import { requireShippingEmployee, getShippingEmployeeSession } from '@/lib/shipping/company-email-access'

import { loadPublicIntakeOptions } from '@/lib/shipping/intake-options'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const origin = req.headers.get('origin')
    if (origin !== req.nextUrl.origin) throw new ShippingError(403, '请求来源不受信任。')
    await enforceAnonymousShippingRate(req)
    const submission = anonymousShipmentSchema.parse(await shippingJson(req))
    const options = await loadPublicIntakeOptions()
    const session = await getShippingEmployeeSession(req)
    if (options.requireVerification && !session) throw new ShippingError(401, '公司要求验证邮箱后提报，请在页面完成验证。')
    if (session && session.employee.orgId !== options.orgId) throw new ShippingError(403, '邮箱身份不属于当前提报入口，请退出后重新填写。')
    const selected = submission.input.serviceId ? options.services.find(item => item.id === submission.input.serviceId) : options.services.find(item => item.preference === submission.input.servicePreference)
    if (!selected) throw new ShippingError(400, '所选服务当前未开放提报，请刷新后重新选择。')
    const result = await createAnonymousShipment({ ...submission, input: { ...submission.input, serviceId: selected.id, serviceName: selected.name, servicePreference: selected.preference }, orgId: options.orgId, ...(session ? { employee: { id: session.employee.id } } : {}) })
    return NextResponse.json({ ...publicShipmentReceipt(result.order), receiptToken: result.receiptToken }, { status: 202, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const status = error instanceof ShippingError ? error.status : error instanceof ZodError || error instanceof SyntaxError ? 400 : 500
    const message = error instanceof ShippingError ? error.message : status === 400 ? '请核对寄件信息。' : '寄件单暂未受理，请稍后重试。'
    return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } })
  }
}

export async function GET(req: NextRequest) {
  try {
    const { employee } = await requireShippingEmployee(req)
    return NextResponse.json({ orders: await listEmployeeShipmentReceipts(employee.orgId, employee.id) }, { headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof ShippingError ? error.message : '个人工单暂不可用。' }, { status: error instanceof ShippingError ? error.status : 500, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { loadPublicIntakeOptions } from '@/lib/shipping/intake-options'
import { getWecomSession } from '@/lib/shipping/wecom-session'
import { ShippingError } from '@/lib/shipping/config'
import { getShipmentByReceipt, publicShipmentReceipt } from '@/lib/shipping/collaboration'

export const runtime = 'nodejs'

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const options = await loadPublicIntakeOptions()
    const employee = await getWecomSession(req)
    if (options.requireVerification && (!employee || employee.orgId !== options.orgId)) throw new ShippingError(401, '请先通过企业微信白名单身份验证。')
    const order = await getShipmentByReceipt((await params).token, employee ? { orgId: employee.orgId, employeeId: employee.id } : undefined)
    if (!order) return NextResponse.json({ error: '寄件回执不存在或已失效。' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
    return NextResponse.json(publicShipmentReceipt(order), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const message = error instanceof ShippingError ? error.message : '寄件状态暂不可用。'
    return NextResponse.json({ error: message }, { status: error instanceof ShippingError ? error.status : 500, headers: { 'Cache-Control': 'no-store' } })
  }
}

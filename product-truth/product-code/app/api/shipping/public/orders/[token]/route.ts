import { NextResponse } from 'next/server'
import { ShippingError } from '@/lib/shipping/config'
import { getShipmentByReceipt, publicShipmentReceipt } from '@/lib/shipping/collaboration'

export const runtime = 'nodejs'

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const order = await getShipmentByReceipt((await params).token)
    if (!order) return NextResponse.json({ error: '寄件回执不存在或已失效。' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
    return NextResponse.json(publicShipmentReceipt(order), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const message = error instanceof ShippingError ? error.message : '寄件状态暂不可用。'
    return NextResponse.json({ error: message }, { status: error instanceof ShippingError ? error.status : 500, headers: { 'Cache-Control': 'no-store' } })
  }
}

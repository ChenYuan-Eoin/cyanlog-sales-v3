import { NextResponse } from 'next/server'
import { loadPublicIntakeOptions } from '@/lib/shipping/intake-options'
import { ShippingError } from '@/lib/shipping/config'
export const runtime = 'nodejs'
export async function GET() {
  try { const { services, emailAvailable, requireVerification } = await loadPublicIntakeOptions(); return NextResponse.json({ services, emailAvailable, requireVerification }, { headers: { 'Cache-Control': 'no-store' } }) }
  catch (error) { return NextResponse.json({ error: error instanceof ShippingError ? error.message : '提报设置暂不可用。' }, { status: error instanceof ShippingError ? error.status : 500, headers: { 'Cache-Control': 'no-store' } }) }
}

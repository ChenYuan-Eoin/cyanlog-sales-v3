import { NextResponse, type NextRequest } from 'next/server'
import { ZodError } from 'zod'
import { ShippingError } from './config'

export async function employeeHandler(req: NextRequest, action: () => Promise<NextResponse>) {
  try {
    if (req.method !== 'GET') {
      if (req.headers.get('origin') !== req.nextUrl.origin || req.headers.get('sec-fetch-site') === 'cross-site') {
        throw new ShippingError(403, '请从员工寄件页面操作。')
      }
    }
    const response = await action()
    response.headers.set('Cache-Control', 'private, no-store')
    response.headers.set('Vary', 'Cookie')
    return response
  } catch (error) {
    const status = error instanceof ShippingError ? error.status : error instanceof ZodError || error instanceof SyntaxError ? 400 : 500
    return NextResponse.json({ error: error instanceof ShippingError ? error.message : status === 400 ? '请核对邮箱、验证码和个人寄件资料。' : '员工寄件服务暂不可用，请稍后再试。' }, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } })
  }
}

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { requireAuth, AuthError, type AuthUser } from '@/lib/auth'
import { ShippingError } from './config'
import { requireShippingConnectionManager } from './connection-authorization'
import { requireShippingOperator } from './operator-access'
import { ZodError } from 'zod'
export async function shippingHandler(req: NextRequest, action: (user: AuthUser) => Promise<unknown>) {
  try {
    const user = await requireAuth(req)
    await requireShippingOperator(user.id)
    if (req.method !== 'GET') {
      const origin = req.headers.get('origin')
      if (origin && origin !== req.nextUrl.origin) throw new ShippingError(403, '请求来源不受信任。')
    }
    return NextResponse.json(await action(user), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof ShippingError ? e.status : e instanceof ZodError || e instanceof SyntaxError ? 400 : 500
    const message = e instanceof AuthError ? '请先登录。' : e instanceof ShippingError ? e.message : status === 400 ? '请核对必填字段、电话、重量和运单号。' : '操作暂未完成，请稍后重试查询。'
    return NextResponse.json({ error: message, ...(e instanceof ShippingError && e.requestStage ? { requestStage: e.requestStage } : {}) }, { status, headers: { 'Cache-Control': 'no-store' } })
  }
}

export async function shippingManagerHandler(req: NextRequest, action: (user: AuthUser, orgId: string) => Promise<unknown>) {
  try {
    const user = await requireAuth(req)
    const origin = req.headers.get('origin')
    if (req.method !== 'GET' && origin && origin !== req.nextUrl.origin) throw new ShippingError(403, '请求来源不受信任。')
    const orgId = await requireShippingConnectionManager(user.id)
    return NextResponse.json(await action(user, orgId), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof ShippingError ? e.status : e instanceof ZodError || e instanceof SyntaxError ? 400 : 500
    const message = e instanceof AuthError ? '请先登录。' : e instanceof ShippingError ? e.message : status === 400 ? '请核对寄件配置信息。' : '操作暂未完成，请稍后重试。'
    return NextResponse.json({ error: message, ...(e instanceof ShippingError && e.requestStage ? { requestStage: e.requestStage } : {}) }, { status, headers: { 'Cache-Control': 'no-store' } })
  }
}
export async function shippingJson(req: NextRequest) {
  const raw = await req.text()
  if (raw.length > 10000) throw new ShippingError(413, '寄件信息过长。')
  if (!raw.trim()) return {}
  return JSON.parse(raw)
}

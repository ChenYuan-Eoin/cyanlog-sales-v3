import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { requireAuth, AuthError, type AuthUser } from '@/lib/auth'
import { ShippingError } from './config'
import { requireShippingConnectionManager } from './connection-authorization'
import { loadShippingOperatorDecision, requireShippingOperator } from './operator-access'
import { getRequestAuthToken } from '@/lib/auth-token'
import { supabaseAdmin } from '@/lib/supabase'
import {
  canWriteFxiaokeOwnerShipping, SHIPPING_MANAGE_CONNECTIONS, SHIPPING_OPERATE,
  shippingOwnerPermissionRequirement, shippingPermissionRequirement, type ShippingPermissionKey,
} from '@/lib/module-access'
import { ZodError } from 'zod'

type ShippingHandlerOptions = { allowFxiaokeSelfSubmit?: boolean; requiresOwnerWrite?: boolean }

export async function shippingHandler(req: NextRequest, action: (user: AuthUser, orgId: string, selfSubmit: boolean) => Promise<unknown>, options: ShippingHandlerOptions = {}) {
  try {
    const user = await requireAuth(req)
    const { pathname } = req.nextUrl
    const permission = options.allowFxiaokeSelfSubmit
      ? shippingOwnerPermissionRequirement(pathname, req.method) ?? SHIPPING_OPERATE
      : shippingPermissionRequirement(pathname, req.method, false) ?? SHIPPING_OPERATE
    const decision = options.allowFxiaokeSelfSubmit
      ? await loadShippingOperatorDecision(user.id, permission)
      : { orgId: await requireShippingOperator(user.id, permission), canOperate: true, roleCodes: [] }
    if (!decision?.orgId) throw new ShippingError(403, '当前账号没有可用的组织寄件授权。')
    const selfSubmit = !decision.canOperate
    const read = req.method === 'GET' || req.method === 'HEAD'
    if (selfSubmit) {
      const operatorRequired = new ShippingError(403, '当前账号没有自助收寄操作权限。')
      const token = getRequestAuthToken(req)
      if (!token || user.org_id !== decision.orgId || decision.roleCodes.length === 0) throw operatorRequired
      const { data: session, error } = await supabaseAdmin.from('auth_tokens')
        .select('user_id,auth_method').eq('token', token).maybeSingle()
      if (error) throw new ShippingError(503, '寄件会话暂时无法核实。')
      if (session?.user_id !== user.id || session.auth_method !== 'fxiaoke') throw operatorRequired
      if ((!read || options.requiresOwnerWrite) && !canWriteFxiaokeOwnerShipping(decision.roleCodes)) {
        throw new ShippingError(403, '当前账号仅可查看本人寄件记录。')
      }
    }
    if (req.method !== 'GET') {
      const origin = req.headers.get('origin')
      if (origin && origin !== req.nextUrl.origin) throw new ShippingError(403, '请求来源不受信任。')
    }
    return NextResponse.json(await action(user, decision.orgId, selfSubmit), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof ShippingError ? e.status : e instanceof ZodError || e instanceof SyntaxError ? 400 : 500
    const message = e instanceof AuthError ? '请先登录。' : e instanceof ShippingError ? e.message : status === 400 ? '请核对必填字段、电话、重量和运单号。' : '操作暂未完成，请稍后重试查询。'
    return NextResponse.json({ error: message, ...(e instanceof ShippingError && e.requestStage ? { requestStage: e.requestStage } : {}) }, { status, headers: { 'Cache-Control': 'no-store' } })
  }
}

export async function shippingManagerHandler(
  req: NextRequest,
  action: (user: AuthUser, orgId: string) => Promise<unknown>,
  resolvePermission?: () => Promise<ShippingPermissionKey | readonly ShippingPermissionKey[]>,
) {
  try {
    const user = await requireAuth(req)
    const origin = req.headers.get('origin')
    if (req.method !== 'GET' && origin && origin !== req.nextUrl.origin) throw new ShippingError(403, '请求来源不受信任。')
    const permission = resolvePermission
      ? await resolvePermission()
      : shippingPermissionRequirement(req.nextUrl.pathname, req.method, false) ?? SHIPPING_MANAGE_CONNECTIONS
    const orgId = await requireShippingConnectionManager(user.id, permission)
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

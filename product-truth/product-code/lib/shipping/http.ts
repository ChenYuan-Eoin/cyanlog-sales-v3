import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { requireAuth, AuthError, type AuthUser } from '@/lib/auth'
import { ShippingError } from './config'
import { requireShippingConnectionManager } from './connection-authorization'
import { requireShippingOperator } from './operator-access'
import { resolveShippingOwnerAccess } from './entry-access'
import { getRequestAuthToken } from '@/lib/auth-token'
import {
  SHIPPING_MANAGE_CONNECTIONS, SHIPPING_OPERATE,
  shippingOwnerPermissionRequirement, shippingPermissionRequirement, type ShippingPermissionKey,
} from '@/lib/module-access'
import { ZodError } from 'zod'

type ReceiptAccess = { canReadOwnedReceipt: boolean; canReadLegacyReceipt: boolean }

export async function shippingHandler(
  req: NextRequest,
  action: (user: AuthUser, orgId: string, receiptAccess?: ReceiptAccess) => Promise<unknown>,
  mode: 'operator' | 'owner' | 'receipt' = 'operator',
) {
  try {
    const user = await requireAuth(req)
    const { pathname } = req.nextUrl
    let orgId: string
    let receiptAccess: ReceiptAccess | undefined
    if (mode !== 'operator') {
      const permission = shippingOwnerPermissionRequirement(pathname, req.method)
      const access = await resolveShippingOwnerAccess(user, getRequestAuthToken(req)).catch(() => {
        throw new ShippingError(503, '寄件会话暂时无法核实。')
      })
      const ownerAuthorized = !!permission && !!access?.ownerPermissions.includes(permission)
      if (access && mode === 'receipt') {
        receiptAccess = { canReadOwnedReceipt: ownerAuthorized, canReadLegacyReceipt: access.canReadLegacyReceipt }
      }
      if (!access || (!ownerAuthorized && !receiptAccess?.canReadLegacyReceipt)) {
        throw new ShippingError(403, '当前账号没有执行此本人寄件操作的权限。')
      }
      orgId = access.orgId
    } else {
      orgId = await requireShippingOperator(user.id, shippingPermissionRequirement(pathname, req.method, false) ?? SHIPPING_OPERATE)
    }
    if (!orgId) throw new ShippingError(403, '当前账号没有可用的组织寄件授权。')
    if (req.method !== 'GET') {
      const origin = req.headers.get('origin')
      if (origin && origin !== req.nextUrl.origin) throw new ShippingError(403, '请求来源不受信任。')
    }
    const result = receiptAccess ? await action(user, orgId, receiptAccess) : await action(user, orgId)
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
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

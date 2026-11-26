import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { requireAuth, AuthError, type AuthUser } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { ShippingError } from './config'
import { requireShippingConnectionManager } from './connection-authorization'
import { requireShippingOperator } from './operator-access'
import { loadPublishedShippingAccess, loadShippingLedgerAccess, resolveShippingOwnerAccess } from './entry-access'
import { selectLedgerDepartments } from './department-ledger-access'
import type { ShipmentReturnAccess } from './collaboration'
import { returnShipmentOrder } from './workflow'
import { returnShipmentSchema } from './validation'
import { getRequestAuthToken } from '@/lib/auth-token'
import {
  SHIPPING_MANAGE_CONNECTIONS, SHIPPING_OPERATE,
  shippingOwnerPermissionRequirement, shippingPermissionRequirement, type ShippingPermissionKey,
} from '@/lib/module-access'
import { z, ZodError } from 'zod'

type ReceiptAccess = { canReadOwnedReceipt: boolean; canReadLegacyReceipt: boolean }

const scopeQuerySchema = z.object({
  departmentId: z.guid().transform(id => id.toLowerCase()).optional(),
  includeSubdepartments: z.enum(['true', 'false']).optional(),
}).refine(query => query.departmentId !== undefined || query.includeSubdepartments === undefined)

type LedgerRead = {
  orgId: string
  departmentIds?: string[]
  query: Record<string, string>
  returnAccess: ShipmentReturnAccess
}

export async function shippingLedgerRead(req: NextRequest, read: (context: LedgerRead) => Promise<unknown>) {
  const headers = { 'Cache-Control': 'private, no-store' }
  try {
    const user = await requireAuth(req)
    const { departmentId, includeSubdepartments, ...query } = Object.fromEntries(req.nextUrl.searchParams)
    const selection = scopeQuerySchema.parse({ departmentId, includeSubdepartments })
    const access = await loadShippingLedgerAccess(user.id, selection.departmentId !== undefined).catch(() => {
      throw new ShippingError(503, '暂时无法核实收寄台账权限。')
    })
    if (!access) throw new ShippingError(403, '当前账号没有收寄台账查看权限。')
    const departmentIds = access.organizationWide && !selection.departmentId
      ? undefined
      : selectLedgerDepartments(access.departments, selection.departmentId, selection.includeSubdepartments === 'true')
    if (departmentIds === null) throw new ShippingError(403, '当前账号没有所选部门的收寄台账查看权限。')
    // A failed return projection hides its action without interrupting the authorized ledger read.
    const returnScope = !access.organizationReturn && access.returnPublished
      ? await supabaseAdmin.rpc('shipping_department_return_scope_v1', { p_actor_id: user.id, p_org_id: access.orgId })
        .then(result => result.error ? [] : result.data, () => [])
      : []
    const returnAccess = {
      organizationWide: access.organizationReturn === true,
      departmentIds: new Set<string>(Array.isArray(returnScope) ? returnScope.filter(id => typeof id === 'string') : []),
    }
    return NextResponse.json(await read({ orgId: access.orgId, departmentIds, query, returnAccess }), { headers })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: '请先登录。' }, { status: 401, headers })
    if (error instanceof ShippingError) return NextResponse.json({ error: error.message }, { status: error.status, headers })
    if (error instanceof ZodError) return NextResponse.json({ error: '请核对台账筛选条件。' }, { status: 400, headers })
    return NextResponse.json({ error: '暂时无法读取收寄台账。' }, { status: 500, headers })
  }
}

export async function shippingHandler(
  req: NextRequest,
  action: (user: AuthUser, orgId: string, receiptAccess?: ReceiptAccess) => Promise<unknown>,
  mode: 'operator' | 'owner' | 'receipt' = 'operator',
) {
  return shippingActionResponse(req, async user => {
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
    return receiptAccess ? action(user, orgId, receiptAccess) : action(user, orgId)
  })
}

export async function shippingLedgerReturn(req: NextRequest, orderId: string) {
  return shippingActionResponse(req, async user => {
    const id = z.guid().transform(value => value.toLowerCase()).parse(orderId)
    const { reason } = returnShipmentSchema.parse(await shippingJson(req))
    const access = await loadPublishedShippingAccess(user.id)
    if (!access) throw new ShippingError(403, '当前账号没有退回工单权限。')
    const { orgId } = access

    // Preserve established organization-level workflow. The scoped permission
    // has its own live authorization and state transition in a single transaction.
    if (!access.returnRegistered) {
      if (!access.permissions.includes('shipping:record_review')) throw new ShippingError(403, '当前账号没有退回工单权限。')
      return returnShipmentOrder(id, user.id, orgId, reason)
    }
    const { data, error } = await supabaseAdmin.rpc('shipping_return_department_record_v1', {
      p_actor_id: user.id, p_org_id: orgId, p_order_id: id, p_reason: reason,
    })
    if (error?.code === '42501') throw new ShippingError(403, '当前账号没有退回工单权限。')
    if (error?.code === 'P0002') throw new ShippingError(404, '寄件单不存在或超出退回范围。')
    if (error?.code === '23514') throw new ShippingError(409, '寄件单状态已变化，请刷新后重试。')
    if (error || !data) throw new ShippingError(503, '暂时无法退回工单。')
    return data
  })
}

async function shippingActionResponse(req: NextRequest, action: (user: AuthUser) => Promise<unknown>) {
  try {
    const user = await requireAuth(req)
    const origin = req.headers.get('origin')
    if (req.method !== 'GET' && origin && origin !== req.nextUrl.origin) throw new ShippingError(403, '请求来源不受信任。')
    return NextResponse.json(await action(user), { headers: { 'Cache-Control': 'no-store' } })
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

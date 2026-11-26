import { type NextRequest, NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { AuthError, requireAuth } from '@/lib/auth'
import { loadOrgRolePermissionContext } from '@/lib/org-role-permissions'
import { ShippingError } from '@/lib/shipping/config'
import { shippingJson } from '@/lib/shipping/http'
import { loadIntakeSettings, saveIntakeDepartmentScope } from '@/lib/shipping/intake-settings'

export const runtime = 'nodejs'

const headers = { 'Cache-Control': 'private, no-store' }

function fail(error: unknown) {
  const status = error instanceof AuthError ? 401 : error instanceof ShippingError ? error.status
    : error instanceof ZodError || error instanceof SyntaxError ? 400 : 503
  const message = error instanceof ShippingError ? error.message
    : status === 401 ? '请先登录。'
      : status === 400 ? '请提供明确的寄件提报部门名单。' : '寄件提报部门暂不可用。'
  return NextResponse.json({ error: message }, { status, headers })
}

async function requireDepartmentScopeAuthority(req: NextRequest) {
  const actor = await requireAuth(req)
  const context = await loadOrgRolePermissionContext(actor.id)
  if (!context?.canEditPlatformRoot) throw new ShippingError(403, '仅系统超级管理员可以管理寄件提报部门。')
  if (req.nextUrl.searchParams.get('orgId') !== context.orgId) {
    throw new ShippingError(409, '当前组织已变化，请刷新后重试。')
  }
  return { actorId: actor.id, orgId: context.orgId }
}

export async function GET(req: NextRequest) {
  try {
    const { orgId } = await requireDepartmentScopeAuthority(req)
    const { allowedDepartmentIds } = await loadIntakeSettings(orgId)
    return NextResponse.json({ allowedDepartmentIds: allowedDepartmentIds ?? null }, { headers })
  } catch (error) {
    return fail(error)
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { actorId, orgId } = await requireDepartmentScopeAuthority(req)
    const origin = req.headers.get('origin')
    if (origin && origin !== req.nextUrl.origin) throw new ShippingError(403, '请求来源不受信任。')
    const { allowedDepartmentIds } = await saveIntakeDepartmentScope(orgId, actorId, await shippingJson(req))
    return NextResponse.json({ allowedDepartmentIds: allowedDepartmentIds ?? null }, { headers })
  } catch (error) {
    return fail(error)
  }
}

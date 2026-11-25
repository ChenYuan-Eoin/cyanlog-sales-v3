import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AuthError, requireAuth } from '@/lib/auth'
import { loadOrgRolePermissionContext } from '@/lib/org-role-permissions'
import { supabaseAdmin } from '@/lib/supabase'

const changeSchema = z.strictObject({
  enabled: z.boolean(),
  expected_enabled: z.boolean(),
  expected_org_id: z.guid(),
})

function json(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

function rpcFailure(code?: string) {
  switch (code) {
    case '42501':
      return json({ error: '当前账号无权处理该成员的组织超管授权', code: 'NO_PERMISSION' }, 403)
    case 'P0002':
      return json({ error: '当前组织中找不到该成员', code: 'MEMBER_NOT_FOUND' }, 404)
    case '40001':
      return json({ error: '授权已变更，请刷新后重试', code: 'ORG_SUPER_ADMIN_ASSIGNMENT_CHANGED' }, 409)
    case '23514':
      return json({ error: '请核对成员的在职和登录状态，组织需保留有效的管理账号', code: 'MEMBER_NOT_ELIGIBLE' }, 409)
    case 'PGRST202':
    case '42883':
      return json({ error: '组织超管授权服务正在更新，请稍后重试', code: 'ORG_SUPER_ADMIN_ASSIGNMENT_UNAVAILABLE' }, 503)
    default:
      return json({ error: '暂无法处理组织超管授权', code: 'ORG_SUPER_ADMIN_ASSIGNMENT_FAILED' }, 500)
  }
}

async function handle(req: NextRequest, userId: string, changing: boolean) {
  try {
    const actor = await requireAuth(req)
    const context = await loadOrgRolePermissionContext(actor.id)
    if (!context?.canAppointOrganizationSuperAdmin || actor.id === userId) return rpcFailure('42501')
    if (!z.guid().safeParse(userId).success) {
      return json({ error: '成员 ID 格式不正确', code: 'VALIDATION_ERROR' }, 400)
    }

    const args = { p_actor_id: actor.id, p_org_id: context.orgId, p_user_id: userId }
    let result
    if (changing) {
      const input = changeSchema.safeParse(await req.json().catch(() => null))
      if (!input.success) {
        return json({ error: '请提供当前组织、原授权状态与目标状态', code: 'VALIDATION_ERROR' }, 400)
      }
      if (input.data.expected_org_id !== context.orgId) return rpcFailure('40001')
      result = await supabaseAdmin.rpc('admin_set_org_super_admin_v1', {
        ...args,
        p_assigned: input.data.enabled,
        p_expected_assigned: input.data.expected_enabled,
        p_request_id: req.headers.get('x-request-id')?.slice(0, 128) ?? null,
      })
      if (!result.error && result.data !== input.data.enabled) return rpcFailure()
    } else {
      result = await supabaseAdmin.rpc('admin_get_org_super_admin_v1', args)
    }
    if (result.error) return rpcFailure(result.error.code)
    if (typeof result.data !== 'boolean') return rpcFailure()
    return json({ success: true, org_id: context.orgId, enabled: result.data })
  } catch (error) {
    if (error instanceof AuthError) return json({ error: '请先登录', code: 'UNAUTHORIZED' }, 401)
    return rpcFailure()
  }
}

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: RouteContext) {
  return handle(req, (await params).id, false)
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  return handle(req, (await params).id, true)
}

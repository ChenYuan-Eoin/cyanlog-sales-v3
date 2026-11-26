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

function rpcFailure(code?: string, details?: string) {
  switch (code) {
    case '42501':
      return json({ error: '仅系统超级管理员可以任免其他成员的系统超管身份', code: 'NO_PERMISSION' }, 403)
    case 'P0002':
      return json({ error: '当前组织中找不到该成员', code: 'MEMBER_NOT_FOUND' }, 404)
    case '40001':
      return json({ error: '授权或当前组织已变更，请刷新后重试', code: 'SYSTEM_SUPER_ADMIN_ASSIGNMENT_CHANGED' }, 409)
    case '23514':
      return details === 'LAST_SYSTEM_SUPER_ADMIN_PROTECTED'
        ? json({ error: '组织必须保留至少一名可登录的系统超管', code: details }, 409)
        : json({ error: '仅可任命当前组织内已启用登录的在职成员', code: 'MEMBER_NOT_ELIGIBLE' }, 409)
    case 'PGRST202':
    case '42883':
      return json({ error: '系统超管任免服务正在更新，请稍后重试', code: 'SYSTEM_SUPER_ADMIN_ASSIGNMENT_UNAVAILABLE' }, 503)
    default:
      return json({ error: '暂无法处理系统超管任免', code: 'SYSTEM_SUPER_ADMIN_ASSIGNMENT_FAILED' }, 500)
  }
}

export async function handleSuperAdminAssignment(req: NextRequest, userId: string, role: 'system' | 'legacy') {
  try {
    const actor = await requireAuth(req)
    const context = await loadOrgRolePermissionContext(actor.id)
    if (!context?.canEditPlatformRoot || actor.id.toLowerCase() === userId.toLowerCase()) return rpcFailure('42501')
    if (!z.guid().safeParse(userId).success) {
      return json({ error: '成员 ID 格式不正确', code: 'VALIDATION_ERROR' }, 400)
    }

    const args = { p_actor_id: actor.id, p_org_id: context.orgId, p_user_id: userId.toLowerCase() }
    let result
    if (req.method === 'PATCH') {
      const input = changeSchema.safeParse(await req.json().catch(() => null))
      if (!input.success) {
        return json({ error: '请提供当前组织、原授权状态与目标状态', code: 'VALIDATION_ERROR' }, 400)
      }
      if (input.data.expected_org_id !== context.orgId) return rpcFailure('40001')
      if (role === 'legacy' && input.data.enabled) return json({
        error: '旧组织超管仅可撤销，新增成员请使用系统超管角色', code: 'LEGACY_ROLE_ASSIGNMENT_RETIRED',
      }, 403)
      const rpc = role === 'system' ? 'admin_set_system_super_admin_v1' : 'admin_set_org_super_admin_v1'
      result = await supabaseAdmin.rpc(rpc, {
        ...args,
        p_assigned: input.data.enabled,
        p_expected_assigned: input.data.expected_enabled,
        p_request_id: req.headers.get('x-request-id')?.slice(0, 128) ?? null,
      })
      if (!result.error && result.data !== input.data.enabled) return rpcFailure()
    } else {
      const rpc = role === 'system' ? 'admin_get_system_super_admin_v1' : 'admin_get_org_super_admin_v1'
      result = await supabaseAdmin.rpc(rpc, args)
    }
    if (result.error) return rpcFailure(result.error.code, result.error.details)
    if (typeof result.data !== 'boolean') return rpcFailure()
    return json({ success: true, org_id: context.orgId, enabled: result.data })
  } catch (error) {
    if (error instanceof AuthError) return json({ error: '请先登录', code: 'UNAUTHORIZED' }, 401)
    return rpcFailure()
  }
}

import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AuthError, requireAuth } from '@/lib/auth'
import { userHasOrgRoleCode, validateOrgRoleAssignment } from '@/lib/admin/org-role-authority'
import { canManageSystemAuthorizations, loadCurrentOrganizationRoleAssignments } from '@/lib/org-role-permissions'
import { supabaseAdmin } from '@/lib/supabase'

const SHIPPING_OPERATOR_ORG_SCOPE_MESSAGE = '顺丰寄件操作员只能分配到整个组织'

const scopeSchema = z.strictObject({
  role_id: z.guid(),
  scope_type: z.enum(['department', 'space']),
  scope_id: z.guid(),
  reason: z.string().trim().max(500).optional(),
})

function failure(error: string, code: string, status: number) {
  return NextResponse.json({ error, code }, { status })
}

async function changeScope(req: NextRequest, userId: string, action: 'assign' | 'revoke') {
  try {
    const user = await requireAuth(req)
    const targetId = userId.toLowerCase()
    const authority = await loadCurrentOrganizationRoleAssignments(user.id)
    if (!authority || !canManageSystemAuthorizations(authority.assignments, authority.orgId) || user.id.toLowerCase() === targetId) {
      return failure('当前账号无权分配或撤销该成员的作用域角色', 'NO_PERMISSION', 403)
    }
    const { orgId, assignments } = authority
    const input = scopeSchema.safeParse(await req.json().catch(() => null))
    if (!input.success || !z.guid().safeParse(targetId).success) {
      return failure('请提供有效的成员、角色和作用域', 'VALIDATION_ERROR', 400)
    }
    if (action === 'assign' && input.data.scope_type === 'space') {
      return failure('请按部门分配角色，历史范围授权仅可撤销', 'LEGACY_SCOPE_ASSIGNMENT_FORBIDDEN', 409)
    }
    if (await userHasOrgRoleCode(targetId, orgId, 'SUPER_ADMIN')) {
      return failure('平台超级管理员的角色不能通过组织接口变更', 'PROTECTED_ROLE_MUTATION_FORBIDDEN', 403)
    }
    const validation = await validateOrgRoleAssignment(
      assignments, orgId, [input.data.role_id], { scopeType: input.data.scope_type, action },
    )
    if (!validation.ok) {
      if (validation.reason === 'LEGACY_BASELINE_ASSIGNMENT_FORBIDDEN') {
        return failure('历史纷享基础角色仅可撤销', validation.reason, 409)
      }
      if (validation.reason === 'ROLE_SCOPE_NOT_SUPPORTED') {
        return failure(SHIPPING_OPERATOR_ORG_SCOPE_MESSAGE, validation.reason, 409)
      }
      return validation.reason === 'ROLE_NOT_FOUND'
        ? failure('角色不存在', validation.reason, 404)
        : failure('不能通过作用域分配该角色', validation.reason, 403)
    }
    const { data, error } = await supabaseAdmin.rpc('admin_set_role_scope_assignment_v1', {
      p_actor_id: user.id,
      p_org_id: orgId,
      p_user_id: targetId,
      p_role_id: validation.roleIds[0],
      p_scope_type: input.data.scope_type,
      p_scope_id: input.data.scope_id,
      p_action: action,
      p_reason: input.data.reason ?? null,
      p_request_id: req.headers.get('x-request-id')?.slice(0, 128) ?? null,
    })
    if (error?.code === '42501' && error.details === 'LEGACY_BASELINE_ASSIGNMENT_FORBIDDEN') {
      return failure('历史纷享基础角色仅可撤销', error.details, 409)
    }
    if (error?.code === '42501') return failure('当前账号无权变更该作用域角色', 'NO_PERMISSION', 403)
    if (error?.code === '23514' && error.details === 'ROLE_SCOPE_NOT_SUPPORTED') {
      return failure(SHIPPING_OPERATOR_ORG_SCOPE_MESSAGE, error.details, 409)
    }
    if (error?.code === '23514' && error.details === 'DEPARTMENT_SCOPE_UNAVAILABLE') {
      return failure('所选部门未启用或已变化，请刷新后重新选择。', error.details, 409)
    }
    if (error?.code === '23514') return failure('作用域与当前组织不匹配', 'INVALID_SCOPE', 409)
    if (error?.code === 'PGRST202' || error?.code === '42883') {
      return failure('作用域角色服务正在更新', 'SCOPE_ASSIGNMENT_UNAVAILABLE', 503)
    }
    if (error || typeof data !== 'boolean') return failure('作用域角色保存失败', 'SCOPE_ASSIGNMENT_FAILED', 500)
    if (!data) return failure('成员不存在或当前状态不能分配作用域角色', 'MEMBER_NOT_ELIGIBLE', 409)
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof AuthError) return failure('请先登录', 'UNAUTHORIZED', 401)
    return failure('作用域角色保存失败', 'SCOPE_ASSIGNMENT_FAILED', 500)
  }
}

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: RouteContext) {
  return changeScope(req, (await params).id, 'assign')
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  return changeScope(req, (await params).id, 'revoke')
}

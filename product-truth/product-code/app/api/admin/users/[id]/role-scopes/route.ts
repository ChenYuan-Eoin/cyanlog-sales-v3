import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AuthError, requireAuth } from '@/lib/auth'
import { userHasOrgRoleCode, validateOrgRoleAssignment } from '@/lib/admin/org-role-authority'
import { canManageSystemAuthorizations, loadCurrentOrganizationRoleAssignments } from '@/lib/org-role-permissions'
import { supabaseAdmin } from '@/lib/supabase'
import {
  readRoleOverrideReview, roleMutationResult, roleOverrideDecisionSchema, ROLE_PERMISSION_REVIEW_REQUIRED,
} from '@/lib/admin/member-role-override-choice'

const SHIPPING_DEPARTMENT_LEDGER_MESSAGE = '该角色需要启用支持部门范围的「查看收寄台账」权限。'

const scopeSchema = z.strictObject({
  role_id: z.guid(),
  scope_type: z.enum(['department', 'space']),
  scope_id: z.guid(),
  reason: z.string().trim().max(500).optional(),
  personal_permissions: roleOverrideDecisionSchema.optional(),
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
    if (action === 'assign' && await userHasOrgRoleCode(targetId, orgId, 'SUPER_ADMIN')) {
      return failure('请在全组织范围为此成员分配角色', 'PROTECTED_ROLE_MUTATION_FORBIDDEN', 403)
    }
    const validation = await validateOrgRoleAssignment(
      assignments, orgId, [input.data.role_id], { scopeType: input.data.scope_type, action },
    )
    if (!validation.ok) {
      if (validation.reason === 'LEGACY_BASELINE_ASSIGNMENT_FORBIDDEN') {
        return failure('历史纷享基础角色仅可撤销', validation.reason, 409)
      }
      if (validation.reason === 'ROLE_SCOPE_NOT_SUPPORTED') {
        return failure(SHIPPING_DEPARTMENT_LEDGER_MESSAGE, validation.reason, 409)
      }
      return validation.reason === 'ROLE_NOT_FOUND'
        ? failure('角色不存在', validation.reason, 404)
        : failure('不能通过作用域分配该角色', validation.reason, 403)
    }
    const { data, error } = await supabaseAdmin.rpc('admin_apply_member_role_change_v1', {
      p_actor_id: user.id,
      p_org_id: orgId,
      p_user_id: targetId,
      p_change: {
        kind: 'scope',
        role_id: validation.roleIds[0],
        scope_type: input.data.scope_type,
        scope_id: input.data.scope_id,
        action,
        reason: input.data.reason ?? null,
      },
      p_review_id: input.data.personal_permissions?.review_revision ?? null,
      p_choice: input.data.personal_permissions?.choice ?? null,
      p_request_id: req.headers.get('x-request-id')?.slice(0, 128) ?? null,
    })
    if (error?.details === 'ROLE_OVERRIDE_REVIEW_CHANGED') {
      return failure('角色或个人权限设置已变更，请重新选择。', 'ROLE_ASSIGNMENT_CHANGED', 409)
    }
    if (error?.code === '23503' && error.details === 'ORG_ROLE_NOT_FOUND') {
      return failure('角色已变更，请刷新角色列表后重试。', 'ROLE_ASSIGNMENT_CHANGED', 409)
    }
    if (error?.code === '42501' && error.details === 'LEGACY_BASELINE_ASSIGNMENT_FORBIDDEN') {
      return failure('历史纷享基础角色仅可撤销', error.details, 409)
    }
    if (error?.code === '42501') return failure('当前账号无权变更该作用域角色', 'NO_PERMISSION', 403)
    if (error?.code === '23514' && (error.details === 'ROLE_SCOPE_NOT_SUPPORTED'
      || error.details === 'SHIPPING_DEPARTMENT_LEDGER_PERMISSION_REQUIRED')) {
      return failure(SHIPPING_DEPARTMENT_LEDGER_MESSAGE, 'ROLE_SCOPE_NOT_SUPPORTED', 409)
    }
    if (error?.code === '23514' && error.details === 'DEPARTMENT_SCOPE_UNAVAILABLE') {
      return failure('所选部门未启用或已变化，请刷新后重新选择。', error.details, 409)
    }
    if (error?.code === '23514') return failure('作用域与当前组织不匹配', 'INVALID_SCOPE', 409)
    if (error?.code === 'PGRST202' || error?.code === '42883') {
      return failure('作用域角色服务正在更新', 'SCOPE_ASSIGNMENT_UNAVAILABLE', 503)
    }
    if (error) return failure('作用域角色保存失败', 'SCOPE_ASSIGNMENT_FAILED', 500)
    const review = readRoleOverrideReview(data)
    if (review) return NextResponse.json({ code: ROLE_PERMISSION_REVIEW_REQUIRED, ...review }, { status: 409 })
    const saved = roleMutationResult(data)
    if (typeof saved !== 'boolean') return failure('作用域角色保存失败', 'SCOPE_ASSIGNMENT_FAILED', 500)
    if (!saved) return failure('成员不存在或当前状态不能分配作用域角色', 'MEMBER_NOT_ELIGIBLE', 409)
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

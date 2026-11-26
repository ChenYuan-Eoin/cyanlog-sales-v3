import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { canPerformMemberAction } from '@/lib/admin/member-actions'
import { ORG_MEMBER_MANAGE_EMPLOYMENT, ORG_MEMBER_MANAGE_LOGIN } from '@/lib/admin/member-action-keys'
import { validateOrgRoleAssignment } from '@/lib/admin/org-role-authority'
import { requireAuth } from '@/lib/auth'
import { canManageSystemAuthorizations, loadCurrentOrganizationRoleAssignments } from '@/lib/org-role-permissions'
import { getFreshDefaultOrgId, getFreshUserScopedRoleAssignments } from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'

const guid = z.guid().transform(id => id.toLowerCase())
const memberSelection = {
  expected_org_id: guid,
  user_ids: z.array(guid).min(1).max(200).transform(ids => [...new Set(ids)]),
}
const batchSchema = z.discriminatedUnion('action', [
  z.strictObject({ ...memberSelection, action: z.literal('suspend') }),
  z.strictObject({ ...memberSelection, action: z.literal('offboard') }),
  z.strictObject({
    ...memberSelection,
    action: z.literal('assign_roles'),
    role_ids: z.array(guid).min(1).max(100),
  }),
])

const memberErrors = {
  SELF_MUTATION_FORBIDDEN: '不能批量修改当前账号',
  MEMBER_NOT_ELIGIBLE: '该成员当前无法执行此操作',
  PROTECTED_ROLE_MUTATION_FORBIDDEN: '请先取消该成员的系统超管身份',
  LAST_SYSTEM_SUPER_ADMIN_PROTECTED: '组织必须保留至少一名可登录的系统超管',
  MEMBER_UPDATE_FORBIDDEN: '当前账号无权修改该成员',
  MEMBER_UPDATE_FAILED: '操作失败，请核对成员状态后重试',
}

const batchRows = z.array(z.object({ user_id: guid, outcome: z.string() }))

function replyError(error: string, code: string, status: number) {
  return NextResponse.json({ error, code }, { status })
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAuth(req)
    const parsed = batchSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return replyError('批量操作参数不正确', 'VALIDATION_ERROR', 400)

    const request = parsed.data
    let orgId: string
    let roleIds: string[] = []
    if (request.action === 'assign_roles') {
      const authority = await loadCurrentOrganizationRoleAssignments(actor.id)
      if (!authority || !canManageSystemAuthorizations(authority.assignments, authority.orgId)) {
        return replyError('仅系统超级管理员可以分配角色', 'NO_PERMISSION', 403)
      }
      orgId = authority.orgId
      if (orgId !== request.expected_org_id) return replyError('当前组织已变更', 'ORGANIZATION_CHANGED', 409)

      const validation = await validateOrgRoleAssignment(authority.assignments, orgId, request.role_ids, { action: 'replace' })
      if (!validation.ok && validation.reason === 'ROLE_NOT_FOUND') {
        return replyError('所选角色已变更，请重新选择', 'ROLE_ASSIGNMENT_CHANGED', 409)
      }
      if (!validation.ok) return replyError('无法分配所选角色', validation.reason, 403)
      roleIds = validation.roleIds
    } else {
      orgId = await getFreshDefaultOrgId(actor.id)
      if (orgId !== request.expected_org_id) return replyError('当前组织已变更', 'ORGANIZATION_CHANGED', 409)
      const action = request.action === 'suspend' ? ORG_MEMBER_MANAGE_LOGIN : ORG_MEMBER_MANAGE_EMPLOYMENT
      const assignments = await getFreshUserScopedRoleAssignments(actor.id)
      if (!canPerformMemberAction(assignments, orgId, action)) {
        return replyError('当前账号无权执行该操作', 'NO_PERMISSION', 403)
      }
    }

    const { data, error } = await supabaseAdmin.rpc('admin_apply_org_member_batch_v1', {
      p_actor_id: actor.id,
      p_org_id: orgId,
      p_user_ids: request.user_ids,
      p_action: request.action,
      p_role_ids: roleIds,
      p_request_id: req.headers.get('x-request-id')?.slice(0, 128) ?? null,
    })
    if (error?.code === '23503' && error.details === 'ORG_ROLE_NOT_FOUND') {
      return replyError('所选角色已变更，请重新选择', 'ROLE_ASSIGNMENT_CHANGED', 409)
    }
    if (error?.code === '42501') return replyError('当前账号无权执行该操作', 'NO_PERMISSION', 403)
    if (error?.code === 'PGRST202') return replyError('批量操作服务正在更新', 'MEMBER_BATCH_UPDATING', 503)
    if (error) throw error

    const applied = batchRows.parse(data)
    const outcomes = new Map(applied.map(row => [row.user_id, row.outcome]))
    if (applied.length !== request.user_ids.length || request.user_ids.some(id => !outcomes.has(id))) {
      throw new Error('Incomplete member batch response')
    }

    const results = request.user_ids.map(user_id => {
      const outcome = outcomes.get(user_id)
      if (outcome === 'saved') return { user_id, ok: true }
      if (outcome === 'pending') return { user_id, ok: true, pending: true }
      const code = outcome && Object.hasOwn(memberErrors, outcome)
        ? outcome as keyof typeof memberErrors
        : 'MEMBER_UPDATE_FAILED'
      return { user_id, ok: false, code, error: memberErrors[code] }
    })
    const succeeded = results.filter(result => result.ok).length
    return NextResponse.json({ results, succeeded, failed: results.length - succeeded })
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') return replyError('请重新登录', 'UNAUTHORIZED', 401)
    console.error('Batch organization member action error:', error)
    return replyError('未能确认批量操作结果，请核对成员状态', 'MEMBER_BATCH_UNCONFIRMED', 500)
  }
}

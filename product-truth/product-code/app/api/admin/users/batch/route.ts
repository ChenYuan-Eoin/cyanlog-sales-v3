import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { loadOrganizationPermissionAccess } from '@/lib/admin/member-actions'
import { ORG_MEMBER_MANAGE_EMPLOYMENT, ORG_MEMBER_MANAGE_LOGIN, ORG_MEMBER_REMOVE_MEMBERSHIP } from '@/lib/admin/member-action-keys'
import { removeOrganizationMembers } from '@/lib/admin/member-removal'
import {
  readRoleOverrideReview, roleOverrideDecisionSchema, ROLE_PERMISSION_REVIEW_REQUIRED,
} from '@/lib/admin/member-role-override-choice'
import { validateOrgRoleAssignment } from '@/lib/admin/org-role-authority'
import { requireAuth } from '@/lib/auth'
import { canManageSystemAuthorizations, loadCurrentOrganizationRoleAssignments } from '@/lib/org-role-permissions'
import { supabaseAdmin } from '@/lib/supabase'

const guid = z.guid().transform(id => id.toLowerCase())
const memberSelection = {
  expected_org_id: guid,
  user_ids: z.array(guid).min(1).max(200).transform(ids => [...new Set(ids)]),
}
const roleDecision = z.strictObject({ user_id: guid, ...roleOverrideDecisionSchema.shape })
const batchSchema = z.discriminatedUnion('action', [
  z.strictObject({ ...memberSelection, action: z.literal('suspend') }),
  z.strictObject({ ...memberSelection, action: z.literal('offboard') }),
  z.strictObject({ ...memberSelection, action: z.literal('remove_membership') }),
  z.strictObject({
    ...memberSelection,
    action: z.literal('assign_roles'),
    role_ids: z.array(guid).min(1).max(100),
    personal_permissions: z.array(roleDecision).min(1).max(200).optional(),
  }).refine(({ user_ids, personal_permissions }) => {
    const reviewedIds = personal_permissions?.map(decision => decision.user_id) ?? []
    const members = new Set(user_ids)
    return new Set(reviewedIds).size === reviewedIds.length && reviewedIds.every(userId => members.has(userId))
  }),
])

const memberErrors = {
  SELF_MUTATION_FORBIDDEN: '不能批量修改当前账号',
  MEMBER_NOT_ELIGIBLE: '该成员当前无法执行此操作',
  PROTECTED_ROLE_MUTATION_FORBIDDEN: '请先取消该成员的系统超管身份',
  LAST_SYSTEM_SUPER_ADMIN_PROTECTED: '组织必须保留至少一名可登录的系统超管',
  MEMBER_UPDATE_FORBIDDEN: '当前账号无权修改该成员',
  MEMBER_UPDATE_FAILED: '操作失败，请核对成员状态后重试',
  ROLE_OVERRIDE_REVIEW_CHANGED: '角色或个人权限设置已变更，请重新核对',
}

const batchRows = z.array(z.object({
  user_id: guid, outcome: z.string(), review_revision: z.unknown().optional(), affected_permissions: z.unknown().optional(),
}))

const lifecyclePermissions = {
  suspend: ORG_MEMBER_MANAGE_LOGIN,
  offboard: ORG_MEMBER_MANAGE_EMPLOYMENT,
  remove_membership: ORG_MEMBER_REMOVE_MEMBERSHIP,
} as const

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
      const access = await loadOrganizationPermissionAccess(actor.id)
      if (!access) return replyError('当前账号无权执行该操作', 'NO_PERMISSION', 403)
      orgId = access.orgId
      if (orgId !== request.expected_org_id) return replyError('当前组织已变更', 'ORGANIZATION_CHANGED', 409)
      if (!access.decision[lifecyclePermissions[request.action]]) {
        return replyError('当前账号无权执行该操作', 'NO_PERMISSION', 403)
      }
    }

    const requestId = req.headers.get('x-request-id')?.slice(0, 128) ?? null
    if (request.action === 'remove_membership') {
      const removals = await removeOrganizationMembers({ actorId: actor.id, orgId, userIds: request.user_ids, requestId })
      const results = removals.map(result => result.ok ? result : {
        user_id: result.user_id, ok: false, code: result.code, error: result.error,
      })
      const succeeded = results.filter(result => result.ok).length
      return NextResponse.json({ results, succeeded, failed: results.length - succeeded })
    }

    const scope = { p_actor_id: actor.id, p_org_id: orgId, p_user_ids: request.user_ids, p_request_id: requestId }
    const { data, error } = request.action === 'assign_roles'
      ? await supabaseAdmin.rpc('admin_assign_org_member_roles_batch_v1', {
        ...scope, p_role_ids: roleIds, p_decisions: request.personal_permissions ?? [],
      })
      : await supabaseAdmin.rpc('admin_apply_org_member_batch_v1', { ...scope, p_action: request.action, p_role_ids: [] })
    if (error?.code === '23503' && error.details === 'ORG_ROLE_NOT_FOUND') {
      return replyError('所选角色已变更，请重新选择', 'ROLE_ASSIGNMENT_CHANGED', 409)
    }
    if (error?.code === '42501') return replyError('当前账号无权执行该操作', 'NO_PERMISSION', 403)
    if (error?.code === 'PGRST202' || error?.code === '42883') {
      return replyError('批量操作服务正在更新', 'MEMBER_BATCH_UPDATING', 503)
    }
    if (error) throw error

    const applied = batchRows.parse(data)
    const outcomes = new Map(applied.map(row => [row.user_id, row]))
    if (applied.length !== request.user_ids.length || request.user_ids.some(id => !outcomes.has(id))) {
      throw new Error('Incomplete member batch response')
    }

    const results = request.user_ids.map(user_id => {
      const row = outcomes.get(user_id)
      const outcome = row?.outcome
      if (outcome === 'saved') return { user_id, ok: true }
      if (outcome === 'pending') return { user_id, ok: true, pending: true }
      if (outcome === ROLE_PERMISSION_REVIEW_REQUIRED && request.action === 'assign_roles') {
        const review = readRoleOverrideReview(row)
        if (!review) throw new Error('Incomplete member role review')
        return { user_id, ok: false, code: outcome, error: '请选择个人权限处理方式', ...review }
      }
      const code = outcome && Object.hasOwn(memberErrors, outcome)
        ? outcome as keyof typeof memberErrors
        : 'MEMBER_UPDATE_FAILED'
      return { user_id, ok: false, code, error: memberErrors[code] }
    })
    const succeeded = results.filter(result => result.ok).length
    const needsReview = results.filter(result => result.code === ROLE_PERMISSION_REVIEW_REQUIRED).length
    return NextResponse.json({
      results, succeeded, failed: results.length - succeeded - needsReview,
      ...(needsReview ? { needs_review: needsReview } : {}),
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') return replyError('请重新登录', 'UNAUTHORIZED', 401)
    console.error('Batch organization member action error:', error)
    return replyError('未能确认批量操作结果，请核对成员状态', 'MEMBER_BATCH_UNCONFIRMED', 500)
  }
}

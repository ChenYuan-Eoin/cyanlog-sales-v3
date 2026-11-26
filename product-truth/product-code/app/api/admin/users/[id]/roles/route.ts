// REQ:F003 - 用户角色管理 API
// PURPOSE: 为用户分配角色

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { canManageSystemAuthorizations, loadCurrentOrganizationRoleAssignments } from '@/lib/org-role-permissions'
import {
  userHasOrgRoleCode,
  validateOrgRoleAssignment,
} from '@/lib/admin/org-role-authority'

const orgRoleIds = z.array(z.string().regex(/^[0-9a-f-]{36}$/i, '角色 ID 格式不正确'))
const assignOrgRolesSchema = z.object({
  role_ids: orgRoleIds,
  expected_role_ids: orgRoleIds.optional(),
  scope_type: z.literal('org').optional().default('org'),
  scope_id: z.string().regex(/^[0-9a-f-]{36}$/i, '作用域 ID 格式不正确').nullable().optional(),
})
const memberOrgRolesSchema = assignOrgRolesSchema.extend({
  expected_org_id: z.guid(),
  expected_role_ids: orgRoleIds,
  system_admin: z.boolean(),
  expected_system_admin: z.boolean(),
})

function assignmentChanged() {
  return NextResponse.json({
    error: '该成员的角色已变更，请核对最新角色后重新选择。',
    code: 'ROLE_ASSIGNMENT_CHANGED',
  }, { status: 409 })
}

// POST /api/admin/users/:id/roles - 分配角色
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: userId } = await params
    const currentUser = await requireAuth(req)
    const authority = await loadCurrentOrganizationRoleAssignments(currentUser.id)
    if (!authority || !canManageSystemAuthorizations(authority.assignments, authority.orgId)) {
      return NextResponse.json({ error: '仅系统超级管理员可分配或撤销角色', code: 'NO_PERMISSION' }, { status: 403 })
    }
    const { orgId, assignments: actorAssignments } = authority

    // A user must never be able to alter the authorization source of their own
    // active session through this tenant API.
    if (userId === currentUser.id) {
      return NextResponse.json(
        { error: '不能在线修改自己的角色', code: 'SELF_ROLE_MUTATION_FORBIDDEN' },
        { status: 403 }
      )
    }

    const input: unknown = await req.json().catch(() => null)
    const hasMemberRoleSnapshot = input !== null && typeof input === 'object'
      && ['expected_org_id', 'system_admin', 'expected_system_admin'].some(key => Object.hasOwn(input, key))
    const memberRoleResult = hasMemberRoleSnapshot ? memberOrgRolesSchema.safeParse(input) : null
    const parseResult = memberRoleResult ?? assignOrgRolesSchema.safeParse(input)
    if (!parseResult.success) {
      const firstIssue = parseResult.error.issues[0]
      return NextResponse.json(
        { error: firstIssue?.message || '角色参数不正确', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const { role_ids, expected_role_ids } = parseResult.data
    const memberRoleEdit = memberRoleResult?.success ? memberRoleResult.data : null

    if (memberRoleEdit) {
      if (!z.guid().safeParse(userId).success) {
        return NextResponse.json({ error: '成员 ID 格式不正确', code: 'VALIDATION_ERROR' }, { status: 400 })
      }
      if (memberRoleEdit.expected_org_id !== orgId || (memberRoleEdit.scope_id && memberRoleEdit.scope_id !== orgId)) {
        return assignmentChanged()
      }
    } else {
      // Older callers keep their existing membership and role protections.
      const { data: userExists, error: userCheckError } = await supabaseAdmin
        .from('users')
        .select('id, display_name')
        .eq('id', userId)
        .eq('org_id', orgId)
        .single()

      if (userCheckError || !userExists) {
        return NextResponse.json({ error: '用户不存在' }, { status: 404 })
      }

      if (await userHasOrgRoleCode(userId, orgId, 'SUPER_ADMIN')) {
        return NextResponse.json(
          { error: '请从成员的「分配角色」管理系统超管及其他角色', code: 'PROTECTED_ROLE_MUTATION_FORBIDDEN' },
          { status: 403 }
        )
      }
    }

    const roleValidation = await validateOrgRoleAssignment(actorAssignments, orgId, role_ids, { action: 'replace' })
    if (!roleValidation.ok && roleValidation.reason === 'ROLE_NOT_FOUND') {
      return NextResponse.json({ error: '部分角色不存在' }, { status: 400 })
    }
    if (!roleValidation.ok) {
      return NextResponse.json(
        { error: '不能分配超过当前操作者权限上限的角色', code: 'ROLE_ESCALATION_FORBIDDEN' },
        { status: 403 }
      )
    }

    const args = {
      p_actor_id: currentUser.id,
      p_org_id: orgId,
      p_user_id: userId,
      p_role_ids: roleValidation.roleIds,
      p_reason: 'tenant role assignment',
      p_request_id: req.headers.get('x-request-id'),
    }
    const { data: replaced, error: replaceError } = memberRoleEdit
      ? await supabaseAdmin.rpc('admin_save_member_org_roles_v1', {
        p_actor_id: args.p_actor_id,
        p_org_id: args.p_org_id,
        p_user_id: args.p_user_id,
        p_role_ids: args.p_role_ids,
        p_expected_role_ids: [...new Set(memberRoleEdit.expected_role_ids)],
        p_system_admin: memberRoleEdit.system_admin,
        p_expected_system_admin: memberRoleEdit.expected_system_admin,
        p_request_id: args.p_request_id?.slice(0, 128) ?? null,
      })
      : expected_role_ids === undefined ? await supabaseAdmin.rpc('admin_replace_org_roles_v1', args)
        : await supabaseAdmin.rpc('admin_replace_org_roles_if_current_v1', {
        ...args,
        p_expected_role_ids: [...new Set(expected_role_ids)],
      })
    if (replaceError) {
      if (memberRoleEdit && replaceError.code === '40001') return assignmentChanged()
      if (memberRoleEdit && replaceError.code === '23514') {
        const lastAdministrator = replaceError.details === 'LAST_SYSTEM_SUPER_ADMIN_PROTECTED'
        return NextResponse.json({
          error: lastAdministrator ? '组织必须保留至少一名可登录的系统超管' : '仅可任命当前组织内已启用登录的在职成员',
          code: lastAdministrator ? replaceError.details : 'MEMBER_NOT_ELIGIBLE',
        }, { status: 409 })
      }
      if (replaceError.code === '23503' && replaceError.details === 'ORG_ROLE_NOT_FOUND') {
        return NextResponse.json({ error: '角色已变更，请刷新角色列表后重试。', code: 'ROLE_ASSIGNMENT_CHANGED' }, { status: 409 })
      }
      if (replaceError.code === '42501' && replaceError.details === 'LEGACY_BASELINE_ASSIGNMENT_FORBIDDEN') {
        return NextResponse.json({
          error: '历史纷享基础角色仅可撤销', code: replaceError.details,
        }, { status: 409 })
      }
      if (replaceError.code === '42501') {
        return NextResponse.json({
          error: memberRoleEdit ? '当前账号无权更改此成员的角色。' : '请从成员的「分配角色」管理系统超管及其他角色。',
          code: 'PROTECTED_ROLE_MUTATION_FORBIDDEN',
        }, { status: 403 })
      }
      if (expected_role_ids !== undefined && replaceError.code === 'PGRST202') {
        return NextResponse.json({
          error: '角色分配服务正在更新，请稍后刷新页面重试。',
          code: 'ROLE_ASSIGNMENT_UPDATING',
        }, { status: 503 })
      }
      console.error('Assign roles error:', replaceError)
      return NextResponse.json({ error: '分配角色失败' }, { status: 500 })
    }
    if (replaced === 'conflict') return assignmentChanged()
    if (replaced === false || replaced === 'ineligible') {
      return NextResponse.json({
        error: '该成员尚不能分配角色；请核对纷享身份、在职状态和组织归属。',
        code: 'MEMBER_NOT_ELIGIBLE',
      }, { status: 409 })
    }
    if (replaced !== true && replaced !== 'saved') {
      return NextResponse.json({ error: '未能确认角色保存结果' }, { status: 500 })
    }

    // Promotion moves pending rows into user_roles in one transaction. Read
    // pending first so promotion between these reads yields the effective role.
    const pending = await supabaseAdmin.from('fxiaoke_pending_org_roles')
      .select('role_id').eq('org_id', orgId).eq('user_id', userId)
    const tableMissing = ['42P01', 'PGRST205'].includes(pending.error?.code || '')
    const { data, error } = await supabaseAdmin
      .from('user_roles')
      .select(`
        role_id,
        role:role_id(id, name, code),
        scope_type,
        scope_id
      `)
      .eq('user_id', userId)
      .eq('org_id', orgId)
      .eq('scope_type', 'org')
      .eq('scope_id', orgId)
    if (error || (pending.error && !tableMissing)) {
      console.error('Load assigned roles error:', error || pending.error)
      return NextResponse.json({ error: '角色已保存，但读取最新授权失败' }, { status: 500 })
    }

    if (memberRoleEdit) {
      const stored = (data ?? []).map(binding => ({
        id: binding.role_id,
        code: (Array.isArray(binding.role) ? binding.role[0] : binding.role)?.code,
      }))
      if (stored.some(binding => !binding.code)) {
        return NextResponse.json({ error: '角色已保存，但读取最新授权失败' }, { status: 500 })
      }
      const systemAdmin = stored.some(binding => binding.code === 'SUPER_ADMIN')
      const selected = new Set(roleValidation.roleIds)
      const effective = new Set(stored.map(binding => binding.id))
      const retainedRevokedRole = memberRoleEdit.expected_role_ids.some(roleId => {
        const id = roleId.toLowerCase()
        return !selected.has(id) && effective.has(id)
      })
      if (systemAdmin !== memberRoleEdit.system_admin || retainedRevokedRole
        || !roleValidation.roleIds.every(id => effective.has(id))) return assignmentChanged()
    }

    const effectiveIds = new Set((data ?? []).map(role => role.role_id))
    const pendingRoleIds = (pending.data ?? []).map(row => row.role_id).filter(id => !effectiveIds.has(id))
    return NextResponse.json({
      success: true,
      data,
      pending_role_ids: pendingRoleIds,
      message: pendingRoleIds.length ? '组织角色已预分配，首次登录后生效' : '组织角色已保存',
    })
  } catch (err) {
    console.error('POST user roles error:', err)
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

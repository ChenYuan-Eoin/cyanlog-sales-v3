// REQ:F003 - 用户管理 API (单条操作)
// PURPOSE: 用户的更新和删除

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import {
  getFreshDefaultOrgId,
  getFreshUserScopedRoleAssignments,
} from '@/lib/scoped-access'
import {
  assertDepartmentInOrg,
} from '@/lib/admin/org-membership'
import { userHasOrgRoleCode } from '@/lib/admin/org-role-authority'
import { canPerformMemberAction } from '@/lib/admin/member-actions'
import { ORG_MEMBER_MANAGE_EMPLOYMENT, ORG_MEMBER_MANAGE_LOGIN } from '@/lib/admin/member-action-keys'
import { ORG_MEMBER_EDIT } from '@/lib/permissions'
import { normalizeIdentityPhone } from '@/lib/fxiaoke/identity'

const updateUserSchema = z.object({
  display_name: z.string().trim().min(1, '姓名不能为空').optional(),
  phone: z.string().trim().min(1, '手机号不能为空').optional(),
  title: z.string().trim().nullable().optional(),
  primary_dept_id: z.string().regex(/^[0-9a-f-]{36}$/i, '主部门 ID 格式不正确').nullable().optional(),
  status: z.enum(['active', 'inactive', 'suspended']).optional(),
  login_enabled: z.boolean().optional(),
  report_to_user_id: z.string().regex(/^[0-9a-f-]{36}$/i, '直属上级 ID 格式不正确').nullable().optional(),
})

// PATCH /api/admin/users/:id - 更新用户
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const currentUser = await requireAuth(req)
    const orgId = await getFreshDefaultOrgId(currentUser.id)

    const actorAssignments = await getFreshUserScopedRoleAssignments(currentUser.id)
    const canEditProfile = canPerformMemberAction(actorAssignments, orgId, ORG_MEMBER_EDIT)
    const canManageEmployment = canPerformMemberAction(actorAssignments, orgId, ORG_MEMBER_MANAGE_EMPLOYMENT)
    const canManageLogin = canPerformMemberAction(actorAssignments, orgId, ORG_MEMBER_MANAGE_LOGIN)
    if (!canEditProfile && !canManageEmployment && !canManageLogin) {
      return NextResponse.json({ error: 'Forbidden', code: 'NO_PERMISSION' }, { status: 403 })
    }

    const parseResult = updateUserSchema.safeParse(await req.json().catch(() => null))
    if (!parseResult.success) {
      const firstIssue = parseResult.error.issues[0]
      return NextResponse.json(
        { error: firstIssue?.message || '用户参数不正确', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const { display_name, title, primary_dept_id, status, login_enabled, report_to_user_id } = parseResult.data
    const phone = parseResult.data.phone === undefined
      ? undefined
      : normalizeIdentityPhone(parseResult.data.phone)
    if (parseResult.data.phone !== undefined && !phone) {
      return NextResponse.json({ error: '手机号格式不正确', code: 'INVALID_PHONE' }, { status: 400 })
    }
    const hasAccountStateMutation = status !== undefined || login_enabled !== undefined
    const hasProfileMutation = display_name !== undefined
      || phone !== undefined
      || title !== undefined
      || primary_dept_id !== undefined
      || report_to_user_id !== undefined

    if (
      (status !== undefined && !canManageEmployment)
      || (login_enabled !== undefined && !canManageLogin)
      || (hasProfileMutation && !canEditProfile)
    ) {
      return NextResponse.json({ error: 'Forbidden', code: 'NO_PERMISSION' }, { status: 403 })
    }

    if (!hasAccountStateMutation && !hasProfileMutation) {
      return NextResponse.json(
        { error: '未提供可更新的用户字段', code: 'NO_UPDATES' },
        { status: 400 }
      )
    }

    if (hasAccountStateMutation && id === currentUser.id) {
      return NextResponse.json(
        { error: '不能通过管理接口修改自己的账户状态', code: 'SELF_ACCOUNT_STATE_MUTATION_FORBIDDEN' },
        { status: 400 }
      )
    }

    // 账户状态需要和会话撤销保持原子性，不与普通资料更新混在同一请求。
    if (hasAccountStateMutation && hasProfileMutation) {
      return NextResponse.json(
        { error: '账户状态与用户资料请分开更新', code: 'MIXED_ACCOUNT_STATE_UPDATE' },
        { status: 400 }
      )
    }

    const { data: existing, error: checkError } = await supabaseAdmin
      .from('users')
      .select('id, email, phone, display_name, title, primary_dept_id, status, login_enabled, report_to_user_id')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle()

    if (checkError) {
      console.error('Update user target lookup error:', checkError)
      return NextResponse.json({ error: '更新用户失败' }, { status: 500 })
    }
    if (!existing) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }

    if (await userHasOrgRoleCode(id, orgId, 'SUPER_ADMIN')) {
      return NextResponse.json(
        { error: '不允许修改平台根管理员', code: 'PROTECTED_ROLE_MUTATION_FORBIDDEN' },
        { status: 403 }
      )
    }

    if (hasAccountStateMutation) {
      const { data: stateUpdated, error: stateError } = await supabaseAdmin.rpc(
        'admin_set_account_state_v1',
        {
          p_actor_id: currentUser.id,
          p_org_id: orgId,
          p_user_id: id,
          p_status: status ?? null,
          p_login_enabled: login_enabled ?? null,
          p_reason: 'tenant administrator account state update',
          p_request_id: req.headers.get('x-request-id'),
        }
      )

      if (stateError || stateUpdated !== true) {
        console.error('Update user account state transaction error:', stateError || 'target_not_updated')
        return NextResponse.json({ error: '更新用户状态失败' }, { status: 500 })
      }

      return NextResponse.json({
        success: true,
        data: {
          ...existing,
          status: status ?? existing.status,
          login_enabled: login_enabled ?? existing.login_enabled,
        },
        message: '用户状态更新成功',
      })
    }

    if (primary_dept_id) {
      const department = await assertDepartmentInOrg(orgId, primary_dept_id)
      if (!department) {
        return NextResponse.json({ error: '主部门不存在', code: 'INVALID_PRIMARY_DEPARTMENT' }, { status: 400 })
      }
    }

    if (phone) {
      const { data: phoneOwner } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('org_id', orgId)
        .eq('phone', phone)
        .eq('status', 'active')
        .neq('id', id)
        .maybeSingle()
      if (phoneOwner) {
        return NextResponse.json({ error: '该手机号已被使用', code: 'PHONE_EXISTS' }, { status: 409 })
      }
    }

    if (report_to_user_id) {
      if (report_to_user_id === id) {
        return NextResponse.json(
          { error: '不能将自己设为自己的汇报对象', code: 'INVALID_REPORT_TO_USER' },
          { status: 400 }
        )
      }

      const { data: manager } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('id', report_to_user_id)
        .eq('org_id', orgId)
        .maybeSingle()

      if (!manager) {
        return NextResponse.json({ error: '直属上级不存在', code: 'INVALID_REPORT_TO_USER' }, { status: 400 })
      }
    }

    // 更新数据
    const updateData: Record<string, unknown> = {}
    if (display_name !== undefined) updateData.display_name = display_name
    if (phone !== undefined) updateData.phone = phone
    if (title !== undefined) updateData.title = title
    if (report_to_user_id !== undefined) updateData.report_to_user_id = report_to_user_id || null

    let data: Record<string, unknown> = { ...existing }
    if (Object.keys(updateData).length > 0) {
      const { data: updated, error } = await supabaseAdmin
        .from('users')
        .update(updateData)
        .eq('id', id)
        .eq('org_id', orgId)
        .select('id, email, phone, display_name, title, primary_dept_id, status, login_enabled, report_to_user_id')
        .single()

      if (error) {
        console.error('Update user error:', error)
        return NextResponse.json({ error: '更新用户失败' }, { status: 500 })
      }
      data = updated
    }

    if (primary_dept_id !== undefined) {
      const { data: transferred, error: transferError } = await supabaseAdmin.rpc(
        'admin_transfer_primary_department_v1',
        {
          p_actor_id: currentUser.id,
          p_org_id: orgId,
          p_user_id: id,
          p_department_id: primary_dept_id,
          p_reason: 'profile update',
          p_request_id: req.headers.get('x-request-id'),
        },
      )
      if (transferError || transferred !== true) {
        console.error('Update user department transaction error:', transferError || 'target_not_updated')
        return NextResponse.json({ error: '更新成员部门关联失败' }, { status: 500 })
      }
      data = { ...data, primary_dept_id }
    }

    return NextResponse.json({
      success: true,
      data,
      message: '用户更新成功',
    })
  } catch (err) {
    console.error('PATCH user error:', err)
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// DELETE /api/admin/users/:id - 删除用户（软删除）
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const currentUser = await requireAuth(req)
    const orgId = await getFreshDefaultOrgId(currentUser.id)

    const actorAssignments = await getFreshUserScopedRoleAssignments(currentUser.id)
    if (!canPerformMemberAction(actorAssignments, orgId, ORG_MEMBER_MANAGE_EMPLOYMENT)) {
      return NextResponse.json({ error: 'Forbidden', code: 'NO_PERMISSION' }, { status: 403 })
    }

    // 不能删除自己
    if (id === currentUser.id) {
      return NextResponse.json({ error: '不能删除当前登录的用户' }, { status: 400 })
    }

    // 检查用户是否存在
    const { data: existing, error: checkError } = await supabaseAdmin
      .from('users')
      .select('id, display_name')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle()

    if (checkError) {
      console.error('Delete user target lookup error:', checkError)
      return NextResponse.json({ error: '删除用户失败' }, { status: 500 })
    }
    if (!existing) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }

    if (await userHasOrgRoleCode(id, orgId, 'SUPER_ADMIN')) {
      return NextResponse.json(
        { error: '不允许删除平台根管理员', code: 'PROTECTED_ROLE_MUTATION_FORBIDDEN' },
        { status: 403 }
      )
    }

    const body = await req.json().catch(() => ({})) as { reason?: unknown }
    const reason = typeof body.reason === 'string' && body.reason.trim()
      ? body.reason.trim().slice(0, 500)
      : 'tenant administrator offboarding'

    // Offboarding ends membership/employment, revokes authority and sessions,
    // writes role/department/space snapshots, and protects the last admin in one transaction.
    const { data: offboarded, error } = await supabaseAdmin.rpc(
      'admin_offboard_member_v1',
      {
        p_actor_id: currentUser.id,
        p_org_id: orgId,
        p_user_id: id,
        p_reason: reason,
        p_request_id: req.headers.get('x-request-id'),
      },
    )

    if (error || offboarded !== true) {
      console.error('Offboard user error:', error)
      return NextResponse.json({ error: '办理离职失败' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: `用户 "${existing.display_name}" 已离职，历史记录和审计已保留`,
    })
  } catch (err) {
    console.error('DELETE user error:', err)
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

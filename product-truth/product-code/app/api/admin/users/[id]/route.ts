// REQ:F003 - 用户管理 API (单条操作)
// PURPOSE: 用户的更新和删除

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import {
  canMutateOrgUsers,
  getDefaultOrgId,
  getFreshUserScopedRoleAssignments,
} from '@/lib/scoped-access'
import {
  assertDepartmentInOrg,
  syncPrimaryDepartmentMembership,
  syncUserSalesSpaces,
} from '@/lib/admin/org-membership'
import { userHasOrgRoleCode } from '@/lib/admin/org-role-authority'

const updateUserSchema = z.object({
  display_name: z.string().trim().min(1, '姓名不能为空').optional(),
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
    const orgId = await getDefaultOrgId(currentUser.id)

    const actorAssignments = await getFreshUserScopedRoleAssignments(currentUser.id)
    if (!canMutateOrgUsers(actorAssignments, orgId)) {
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
    const hasAccountStateMutation = status !== undefined || login_enabled !== undefined
    const hasProfileMutation = display_name !== undefined
      || title !== undefined
      || primary_dept_id !== undefined
      || report_to_user_id !== undefined

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
      .select('id, email, display_name, status, login_enabled')
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
        'set_org_user_account_state_and_revoke_sessions_v1',
        {
          p_target_user_id: id,
          p_org_id: orgId,
          p_status: status ?? null,
          p_login_enabled: login_enabled ?? null,
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
    if (title !== undefined) updateData.title = title
    if (primary_dept_id !== undefined) updateData.primary_dept_id = primary_dept_id
    if (report_to_user_id !== undefined) updateData.report_to_user_id = report_to_user_id || null

    const { data, error } = await supabaseAdmin
      .from('users')
      .update(updateData)
      .eq('id', id)
      .eq('org_id', orgId)
      .select('id, email, display_name, title, primary_dept_id, status, login_enabled, report_to_user_id')
      .single()

    if (error) {
      console.error('Update user error:', error)
      return NextResponse.json({ error: '更新用户失败' }, { status: 500 })
    }

    if (primary_dept_id !== undefined) {
      try {
        await syncPrimaryDepartmentMembership(id, primary_dept_id || null)
        await syncUserSalesSpaces(id, orgId, primary_dept_id || null)
      } catch (syncError) {
        console.error('Update user department sync error:', syncError)
        return NextResponse.json({ error: '更新成员部门关联失败' }, { status: 500 })
      }
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
    const orgId = await getDefaultOrgId(currentUser.id)

    const actorAssignments = await getFreshUserScopedRoleAssignments(currentUser.id)
    if (!canMutateOrgUsers(actorAssignments, orgId)) {
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

    // 软删除与禁止登录、撤销会话在同一数据库事务内完成。
    const { data: deleted, error } = await supabaseAdmin.rpc(
      'set_org_user_account_state_and_revoke_sessions_v1',
      {
        p_target_user_id: id,
        p_org_id: orgId,
        p_status: 'inactive',
        p_login_enabled: false,
      }
    )

    if (error || deleted !== true) {
      console.error('Delete user error:', error)
      return NextResponse.json({ error: '删除用户失败' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: `用户 "${existing.display_name}" 已删除`,
    })
  } catch (err) {
    console.error('DELETE user error:', err)
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

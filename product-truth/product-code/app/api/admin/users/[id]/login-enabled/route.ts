// REQ:F011 - 用户管理扩展：登录启用/禁用
// PURPOSE: 管理员控制用户是否可以登录系统

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import {
  canMutateOrgUsers,
  getDefaultOrgId,
  getFreshUserScopedRoleAssignments,
} from '@/lib/scoped-access'
import { userHasOrgRoleCode } from '@/lib/admin/org-role-authority'

const loginEnabledSchema = z.object({
  login_enabled: z.boolean(),
})

// PATCH /api/admin/users/:id/login-enabled - 修改登录状态
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const currentUser = await requireAuth(req)
    const orgId = await getDefaultOrgId(currentUser.id)
    const assignments = await getFreshUserScopedRoleAssignments(currentUser.id)

    if (!canMutateOrgUsers(assignments, orgId)) {
      return NextResponse.json({ error: 'Forbidden', code: 'NO_PERMISSION' }, { status: 403 })
    }

    // 不能禁用当前登录用户
    if (id === currentUser.id) {
      return NextResponse.json({ error: '不能禁用当前登录的用户' }, { status: 400 })
    }

    const parseResult = loginEnabledSchema.safeParse(await req.json().catch(() => null))
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'login_enabled 必须为布尔值', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }
    const { login_enabled } = parseResult.data

    // 检查用户是否存在
    const { data: existing, error: checkError } = await supabaseAdmin
      .from('users')
      .select('id, display_name, org_id')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle()

    if (checkError) {
      console.error('Update login_enabled target lookup error:', checkError)
      return NextResponse.json({ error: '更新登录状态失败' }, { status: 500 })
    }
    if (!existing) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }

    if (await userHasOrgRoleCode(id, orgId, 'SUPER_ADMIN')) {
      return NextResponse.json(
        { error: '不允许修改平台根管理员的登录状态', code: 'PROTECTED_ROLE_MUTATION_FORBIDDEN' },
        { status: 403 }
      )
    }

    // 任何登录状态变更都撤销旧会话，避免重新启用后历史 token 复活。
    const { data: stateUpdated, error: updateError } = await supabaseAdmin.rpc(
      'admin_set_account_state_v1',
      {
        p_actor_id: currentUser.id,
        p_org_id: orgId,
        p_user_id: id,
        p_status: null,
        p_login_enabled: login_enabled,
        p_reason: 'tenant administrator login state update',
        p_request_id: req.headers.get('x-request-id'),
      }
    )

    if (updateError || stateUpdated !== true) {
      console.error('Update login_enabled transaction error:', updateError || 'target_not_updated')
      return NextResponse.json({ error: '更新登录状态失败' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      data: { id, login_enabled },
      message: login_enabled ? '已允许登录' : '已禁止登录',
    })
  } catch (err) {
    console.error('PATCH login-enabled error:', err)
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

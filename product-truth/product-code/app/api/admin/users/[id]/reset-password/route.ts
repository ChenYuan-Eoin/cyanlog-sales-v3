// REQ:F011 - 用户管理扩展：重置密码
// PURPOSE: 管理员帮用户重置密码，生成临时密码

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import {
  canMutateOrgUsers,
  getDefaultOrgId,
  getFreshUserScopedRoleAssignments,
} from '@/lib/scoped-access'
import {
  createAdminTempPassword,
  hashAdminPassword,
} from '@/lib/admin/org-membership'
import { userHasOrgRoleCode } from '@/lib/admin/org-role-authority'

// POST /api/admin/users/:id/reset-password - 重置密码
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const currentUser = await requireAuth(req)
    const orgId = await getDefaultOrgId(currentUser.id)

    // 写操作必须直读当前组织角色，不接受客户端头也不使用短期缓存。
    const actorAssignments = await getFreshUserScopedRoleAssignments(currentUser.id)
    if (!canMutateOrgUsers(actorAssignments, orgId)) {
      return NextResponse.json({ error: 'Forbidden', code: 'NO_PERMISSION' }, { status: 403 })
    }

    // 不能重置自己的密码（安全考虑：应通过"改密"流程）
    if (id === currentUser.id) {
      return NextResponse.json(
        {
          error: '不能通过此接口重置自己的密码，请使用"修改密码"功能',
          code: 'SELF_PASSWORD_RESET_FORBIDDEN',
        },
        { status: 400 }
      )
    }

    // 先锁定当前组织内的目标，避免跨组织 IDOR。
    const { data: existing, error: checkError } = await supabaseAdmin
      .from('users')
      .select('id, display_name, email, org_id')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle()

    if (checkError) {
      console.error('Reset password target lookup error:', checkError)
      return NextResponse.json({ error: '重置密码失败' }, { status: 500 })
    }
    if (!existing) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }

    // 组织侧接口不允许接管平台根管理员。
    if (await userHasOrgRoleCode(id, orgId, 'SUPER_ADMIN')) {
      return NextResponse.json(
        { error: '不允许重置平台根管理员密码', code: 'PROTECTED_ROLE_MUTATION_FORBIDDEN' },
        { status: 403 }
      )
    }

    const tempPassword = createAdminTempPassword()
    const passwordHash = await hashAdminPassword(tempPassword)

    // 密码更新和旧会话撤销必须同一个数据库事务成功。
    const { data: resetApplied, error: resetError } = await supabaseAdmin.rpc(
      'admin_reset_password_v1',
      {
        p_actor_id: currentUser.id,
        p_org_id: orgId,
        p_user_id: id,
        p_password_hash: passwordHash,
        p_request_id: req.headers.get('x-request-id'),
      }
    )

    if (resetError || resetApplied !== true) {
      console.error('Reset password transaction error:', resetError || 'target_not_updated')
      return NextResponse.json({ error: '重置密码失败' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      data: {
        tempPassword,
        userId: id,
        displayName: existing.display_name,
      },
      message: '密码已重置',
    })
  } catch (err) {
    console.error('POST reset-password error:', err)
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

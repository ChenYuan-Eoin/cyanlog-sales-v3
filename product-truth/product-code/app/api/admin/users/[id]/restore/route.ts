import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import {
  canMutateOrgUsers,
  getFreshDefaultOrgId,
  getFreshUserScopedRoleAssignments,
} from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const currentUser = await requireAuth(req)
    const orgId = await getFreshDefaultOrgId(currentUser.id)
    const assignments = await getFreshUserScopedRoleAssignments(currentUser.id)
    if (!canMutateOrgUsers(assignments, orgId)) {
      return NextResponse.json({ error: 'Forbidden', code: 'NO_PERMISSION' }, { status: 403 })
    }
    if (id === currentUser.id) {
      return NextResponse.json({
        error: '不能通过管理接口恢复自己的成员关系',
        code: 'SELF_MEMBERSHIP_MUTATION_FORBIDDEN',
      }, { status: 403 })
    }

    const body = await req.json().catch(() => ({})) as { reason?: unknown }
    const reason = typeof body.reason === 'string' && body.reason.trim()
      ? body.reason.trim().slice(0, 500)
      : 'tenant administrator rehire'
    const { data, error } = await supabaseAdmin.rpc('admin_restore_membership_v1', {
      p_actor_id: currentUser.id,
      p_org_id: orgId,
      p_user_id: id,
      p_reason: reason,
      p_request_id: req.headers.get('x-request-id'),
    })
    if (error) {
      console.error('Restore membership error:', error)
      return NextResponse.json({ error: '恢复成员失败' }, { status: 500 })
    }
    if (data !== true) {
      return NextResponse.json({ error: '成员不存在或当前状态不可恢复', code: 'NOT_RESTORABLE' }, { status: 409 })
    }
    return NextResponse.json({
      success: true,
      data: { id, status: 'active', login_enabled: false },
      message: '成员已恢复为在职，需重新配置部门和角色后再允许登录',
    })
  } catch (error) {
    console.error('POST restore membership error:', error)
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

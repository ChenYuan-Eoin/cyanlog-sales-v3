import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { loadOrganizationPermissionAccess } from '@/lib/admin/member-actions'
import { ORG_MEMBER_REMOVE_MEMBERSHIP } from '@/lib/admin/member-action-keys'

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireAuth(req)
    const access = await loadOrganizationPermissionAccess(actor.id)
    if (!access?.decision[ORG_MEMBER_REMOVE_MEMBERSHIP]) {
      return NextResponse.json({ error: 'Forbidden', code: 'NO_PERMISSION' }, { status: 403 })
    }
    const { orgId } = access

    const { id } = await params
    if (id === actor.id) {
      return NextResponse.json(
        { error: '不能将自己移出当前组织', code: 'SELF_MEMBERSHIP_REMOVAL_FORBIDDEN' },
        { status: 403 },
      )
    }

    const body = await req.json().catch(() => ({})) as { reason?: unknown }
    const reason = typeof body.reason === 'string' && body.reason.trim()
      ? body.reason.trim().slice(0, 500)
      : 'tenant membership removed by administrator'

    const { data, error } = await supabaseAdmin.rpc('admin_remove_tenant_membership_v1', {
      p_actor_id: actor.id,
      p_org_id: orgId,
      p_user_id: id,
      p_reason: reason,
      p_request_id: req.headers.get('x-request-id'),
    })

    if (error) {
      if (String(error.code || '') === '42501') {
        return NextResponse.json(
          { error: '平台根管理员不能移出组织', code: 'PROTECTED_ROLE_MUTATION_FORBIDDEN' },
          { status: 403 },
        )
      }
      if (String(error.code || '') === '23514') {
        return NextResponse.json(
          { error: '不能移除当前组织最后一名有效控制管理员', code: 'LAST_ADMIN_PROTECTED' },
          { status: 409 },
        )
      }
      throw error
    }

    if (data !== true) {
      return NextResponse.json(
        { error: '目标成员不存在、已离开或不在当前组织', code: 'MEMBERSHIP_NOT_FOUND' },
        { status: 404 },
      )
    }

    return NextResponse.json({
      success: true,
      message: '成员已移出当前组织，人员账户与历史审计已保留',
    })
  } catch (error) {
    console.error('Remove tenant membership error:', error)
    if (error instanceof Error && error.name === 'AuthError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: '移出当前组织失败' }, { status: 500 })
  }
}

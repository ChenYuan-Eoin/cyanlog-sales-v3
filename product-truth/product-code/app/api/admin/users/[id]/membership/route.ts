import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { loadOrganizationPermissionAccess } from '@/lib/admin/member-actions'
import { ORG_MEMBER_REMOVE_MEMBERSHIP } from '@/lib/admin/member-action-keys'
import { removeOrganizationMembers } from '@/lib/admin/member-removal'

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
    const body = await req.json().catch(() => null) as { reason?: unknown } | null
    const reason = typeof body?.reason === 'string' && body.reason.trim()
      ? body.reason.trim().slice(0, 500)
      : 'tenant membership removed by administrator'

    const [result] = await removeOrganizationMembers({
      actorId: actor.id, orgId, userIds: [id], reason, requestId: req.headers.get('x-request-id')?.slice(0, 128) ?? null,
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error, code: result.code }, { status: result.status })
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

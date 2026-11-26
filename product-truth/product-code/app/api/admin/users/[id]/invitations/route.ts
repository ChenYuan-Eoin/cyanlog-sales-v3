import { createHash, randomBytes } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { loadOrganizationPermissionAccess } from '@/lib/admin/member-actions'
import { ORG_MEMBER_INVITE } from '@/lib/admin/member-action-keys'

async function authorize(req: NextRequest) {
  const user = await requireAuth(req)
  const access = await loadOrganizationPermissionAccess(user.id)
  if (!access?.decision[ORG_MEMBER_INVITE]) return null
  return { user, orgId: access.orgId }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authorize(req)
    if (!auth) return NextResponse.json({ error: 'Forbidden', code: 'NO_PERMISSION' }, { status: 403 })
    const { id } = await params
    const code = randomBytes(24).toString('base64url')
    const tokenHash = createHash('sha256').update(code).digest('hex')
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data, error } = await supabaseAdmin
      .from('personnel_invitations')
      .update({
        token_hash: tokenHash,
        status: 'pending',
        expires_at: expiresAt,
        last_sent_at: new Date().toISOString(),
        accepted_at: null,
        revoked_at: null,
      })
      .eq('org_id', auth.orgId)
      .eq('user_id', id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: '没有可重发的待激活邀请', code: 'INVITATION_NOT_FOUND' }, { status: 404 })
    return NextResponse.json({
      success: true,
      data: { activationCode: code, activationExpiresAt: expiresAt, deliveryMethod: 'manual_handoff' },
    })
  } catch (error) {
    console.error('Resend invitation error:', error)
    return NextResponse.json({ error: '重发邀请失败' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authorize(req)
    if (!auth) return NextResponse.json({ error: 'Forbidden', code: 'NO_PERMISSION' }, { status: 403 })
    const { id } = await params
    if (id === auth.user.id) {
      return NextResponse.json(
        { error: '不能撤销自己的成员邀请', code: 'SELF_INVITATION_REVOCATION_FORBIDDEN' },
        { status: 403 },
      )
    }

    const { data, error } = await supabaseAdmin.rpc('admin_revoke_personnel_invitation_v1', {
      p_actor_id: auth.user.id,
      p_org_id: auth.orgId,
      p_user_id: id,
      p_reason: 'invitation revoked by administrator',
      p_request_id: req.headers.get('x-request-id'),
    })
    if (error) throw error
    if (data !== true) {
      return NextResponse.json(
        { error: '没有可撤销的待激活邀请', code: 'INVITATION_NOT_FOUND' },
        { status: 404 },
      )
    }
    return NextResponse.json({ success: true, message: '邀请已撤销，受邀成员关系已结束' })
  } catch (error) {
    console.error('Revoke invitation error:', error)
    return NextResponse.json({ error: '撤销邀请失败' }, { status: 500 })
  }
}

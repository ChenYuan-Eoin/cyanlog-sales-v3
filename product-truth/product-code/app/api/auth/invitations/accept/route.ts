import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'

const acceptInvitationSchema = z.object({
  token: z.string().trim().min(24).max(500),
})

export async function POST(req: NextRequest) {
  const parsed = acceptInvitationSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({
      error: parsed.error.issues[0]?.message || '激活参数不正确',
      code: 'VALIDATION_ERROR',
    }, { status: 400 })
  }

  const tokenHash = createHash('sha256').update(parsed.data.token).digest('hex')
  const { data, error } = await supabaseAdmin.rpc('accept_personnel_invitation_v1', {
    p_token_hash: tokenHash,
    p_request_id: req.headers.get('x-request-id'),
  })
  if (error) {
    console.error('Accept invitation error:', error)
    return NextResponse.json({ error: '激活失败' }, { status: 500 })
  }
  if (!data || typeof data !== 'object') {
    return NextResponse.json({
      error: '激活码无效、已使用或已过期',
      code: 'INVITATION_INVALID',
    }, { status: 400 })
  }

  return NextResponse.json({
    success: true,
    data,
    message: '成员关系已激活，请使用企业统一登录',
  })
}

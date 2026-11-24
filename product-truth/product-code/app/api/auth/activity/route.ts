import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { getRequestAuthToken } from '@/lib/auth-token'
import { sessionDeadline, nextSessionDeadline } from '@/lib/auth/fxiaoke-session'
import { supabaseAdmin } from '@/lib/supabase'

async function activity(req: NextRequest, renew: boolean) {
  const respond = (body: object, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
  if (renew && req.headers.get('origin') !== req.nextUrl.origin) return respond({ error: '请求来源无效' }, 403)
  try {
    const user = await requireAuth(req)
    const token = getRequestAuthToken(req)
    const { data: session, error } = await supabaseAdmin.from('auth_tokens')
      .select('user_id,auth_method,created_at,expires_at').eq('token', token || '').maybeSingle()
    if (error) return respond({ error: '会话暂不可用' }, 503)
    if (!session || session.user_id !== user.id) return respond({ error: '登录已过期' }, 401)
    const now = Date.now()
    const deadline = sessionDeadline(session, now)
    if (!deadline) return respond({ error: '登录已过期' }, 401)
    if (!renew) return respond({ managed: true, authMethod: session.auth_method || 'local', expiresAt: new Date(deadline).toISOString() })
    const nextDeadline = new Date(nextSessionDeadline(session.created_at, now)).toISOString()
    // Do not resurrect an expired or concurrently revoked session.
    const result = await supabaseAdmin.from('auth_tokens').update({ expires_at: nextDeadline })
      .eq('token', token || '').eq('user_id', user.id)
      .gt('expires_at', new Date(now).toISOString()).lt('expires_at', nextDeadline).select('expires_at').maybeSingle()
    if (result.error) return respond({ error: '会话暂不可用' }, 503)
    if (!result.data) {
      const latest = await supabaseAdmin.from('auth_tokens').select('user_id,created_at,expires_at').eq('token', token || '').maybeSingle()
      if (latest.error) return respond({ error: '会话暂不可用' }, 503)
      if (!latest.data || latest.data.user_id !== user.id || !sessionDeadline(latest.data, Date.now())) return respond({ error: '登录已过期' }, 401)
      return respond({ managed: true, authMethod: session.auth_method || 'local', expiresAt: latest.data.expires_at })
    }
    // Never rewrite shared account cookies from a delayed renewal response.
    return respond({ managed: true, authMethod: session.auth_method || 'local', expiresAt: result.data.expires_at })
  } catch (error) {
    return respond({ error: '会话校验失败' }, error instanceof Error && error.name === 'AuthError' ? 401 : 503)
  }
}

export const GET = (req: NextRequest) => activity(req, false)
export const POST = (req: NextRequest) => activity(req, true)

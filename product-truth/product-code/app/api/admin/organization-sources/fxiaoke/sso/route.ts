// F003 / WP94: an explicit tenant administrator action controls SSO identity authority.
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { userHasOrgRoleCode } from '@/lib/admin/org-role-authority'
import { isLocalAccountLoginEnabled } from '@/lib/auth/local-account-config'
import { getFreshDefaultOrgId } from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function response(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function PATCH(request: NextRequest) {
  try {
    const origin = request.headers.get('origin')
    if (origin && origin !== request.nextUrl.origin) return response({ error: '请求来源无效。' }, 403)
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      return response({ error: '请求必须使用 JSON。' }, 415)
    }
    const actor = await requireAuth(request)
    const orgId = await getFreshDefaultOrgId(actor.id)
    if (!await userHasOrgRoleCode(actor.id, orgId, 'SUPER_ADMIN')) {
      return response({ error: '只有当前组织的超级管理员可以开关企业登录。' }, 403)
    }
    const raw = await request.text()
    if (raw.length > 1024) return response({ error: '请求过长。' }, 400)
    let body: unknown
    try { body = JSON.parse(raw) } catch { return response({ error: '请求格式无效。' }, 400) }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return response({ error: '请求格式无效。' }, 400)
    const input = body as Record<string, unknown>
    if (typeof input.enabled !== 'boolean' || typeof input.connectionRevision !== 'string' || !UUID.test(input.connectionRevision)) {
      return response({ error: '企业登录状态或连接版本无效。' }, 400)
    }
    if (!input.enabled && !isLocalAccountLoginEnabled()) {
      return response({ error: '当前没有开放的管理员恢复入口，不能停用唯一企业登录方式。' }, 409)
    }

    const { data, error } = await supabaseAdmin.rpc('set_fxiaoke_identity_authority_v1', {
      p_actor_id: actor.id,
      p_org_id: orgId,
      p_connection_revision: input.connectionRevision,
      p_enabled: input.enabled,
    })
    if (error) {
      console.error('Fxiaoke SSO authority update failed', error.code || 'unknown')
      return response({ error: '企业登录状态保存失败，请刷新后重试。' }, 503)
    }
    if (data !== true) {
      return response({
        error: input.enabled
          ? '开启前须有已匹配的在职纷享成员，且连接和目录主来源保持有效；请刷新状态核对。'
          : '企业登录状态已变化，请刷新后重试。',
      }, 409)
    }
    return response({ enabled: input.enabled })
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') return response({ error: '请先登录。' }, 401)
    console.error('Fxiaoke SSO authority update unavailable', error instanceof Error ? error.name : 'unknown')
    return response({ error: '企业登录状态暂不可用。' }, 503)
  }
}

// REQ: F003 / WP91. Organization managers only; never accepts arbitrary provider URLs.
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { canManageOrg, getFreshDefaultOrgId, getFreshUserScopedRoleAssignments } from '@/lib/scoped-access'
import { FxiaokeError } from '@/lib/fxiaoke/contracts'
import { loadConnection, previewSavedConnection, saveConnection } from '@/lib/fxiaoke/settings'

export const runtime = 'nodejs'
export const maxDuration = 60

async function authorized(req: NextRequest, run: (orgId: string, actorId: string) => Promise<unknown>) {
  try {
    const user = await requireAuth(req)
    const orgId = req.headers.get('x-org-id')?.trim() || await getFreshDefaultOrgId(user.id)
    if (!orgId || !canManageOrg(await getFreshUserScopedRoleAssignments(user.id), orgId)) {
      return NextResponse.json({ error: '无权管理此企业的组织接入。' }, { status: 403 })
    }
    return NextResponse.json({ data: await run(orgId, user.id) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    if (err instanceof Error && err.name === 'AuthError') return NextResponse.json({ error: '请先登录。' }, { status: 401 })
    if (err instanceof FxiaokeError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    return NextResponse.json({ error: '组织接入暂不可用，请稍后重试。' }, { status: 500 })
  }
}
export async function GET(req: NextRequest) {
  return authorized(req, async orgId => ({ connection: await loadConnection(orgId) }))
}
export async function POST(req: NextRequest) {
  return authorized(req, async (orgId, actorId) => {
    const raw = await req.text()
    if (raw.length > 8192) throw new FxiaokeError('INVALID_INPUT', '配置内容超出长度限制。')
    let body: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid')
      body = parsed as Record<string, unknown>
    } catch { throw new FxiaokeError('INVALID_INPUT', '请求格式无效。') }
    if (body.action === 'save') return { connection: await saveConnection(orgId, actorId, body.connection) }
    if (body.action === 'preview' && typeof body.revision === 'string' && /^[0-9a-f-]{36}$/i.test(body.revision)) {
      return { preview: await previewSavedConnection(orgId, body.revision) }
    }
    throw new FxiaokeError('INVALID_ACTION', '请选择保存配置或预览通讯录。')
  })
}

// REQ: F003 / WP91. Organization managers only; never accepts arbitrary provider URLs.
import { NextRequest, NextResponse } from 'next/server'
import { loadOrganizationSourceAccess, type OrganizationSourceAccess } from '@/lib/admin/organization-source-access'
import { discoveryInput, FxiaokeError } from '@/lib/fxiaoke/contracts'
import { discoverEnterprise } from '@/lib/fxiaoke/client'
import { loadConnection, previewSavedConnection, saveConnection } from '@/lib/fxiaoke/settings'
import { transportForOrganization } from '@/lib/fxiaoke/egress/server'

export const runtime = 'nodejs'
export const maxDuration = 60

async function authorized(req: NextRequest, run: (orgId: string, actorId: string, access: OrganizationSourceAccess) => Promise<unknown>) {
  try {
    const context = await loadOrganizationSourceAccess(req)
    if (!context?.access.view) {
      return NextResponse.json({ error: '无权管理此企业的组织接入。' }, { status: 403 })
    }
    return NextResponse.json({ data: await run(context.orgId, context.actor.id, context.access) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    if (err instanceof Error && err.name === 'AuthError') return NextResponse.json({ error: '请先登录。' }, { status: 401 })
    if (err instanceof FxiaokeError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    return NextResponse.json({ error: '组织接入暂不可用，请稍后重试。' }, { status: 500 })
  }
}
export async function GET(req: NextRequest) {
  return authorized(req, async (orgId, _actorId, access) => {
    const connection = await loadConnection(orgId)
    return { connection: connection && !access.connect ? { ...connection, appId: '', apiUserId: '' } : connection }
  })
}
export async function POST(req: NextRequest) {
  return authorized(req, async (orgId, actorId, access) => {
    if (!access.connect) throw new FxiaokeError('FORBIDDEN', '无权维护此企业的纷享连接。', 403)
    const raw = await req.text()
    if (raw.length > 8192) throw new FxiaokeError('INVALID_INPUT', '配置内容超出长度限制。')
    let body: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid')
      body = parsed as Record<string, unknown>
    } catch { throw new FxiaokeError('INVALID_INPUT', '请求格式无效。') }
    if (body.action === 'save') return { connection: await saveConnection(orgId, actorId, body.connection) }
    if (body.action === 'discover') {
      const parsed = discoveryInput.safeParse(body.credentials)
      if (!parsed.success) throw new FxiaokeError('INVALID_CONFIGURATION', '请先填写 AppID、APPSecret 和永久授权码。')
      const enterprise = await discoverEnterprise(parsed.data, transportForOrganization(orgId))
      return { enterprise: { ea: enterprise.ea } }
    }
    if (body.action === 'preview' && typeof body.revision === 'string' && /^[0-9a-f-]{36}$/i.test(body.revision)) {
      const preview = await previewSavedConnection(orgId, body.revision, actorId)
      return { preview: access.preview ? preview : null }
    }
    throw new FxiaokeError('INVALID_ACTION', '请选择保存配置或预览通讯录。')
  })
}

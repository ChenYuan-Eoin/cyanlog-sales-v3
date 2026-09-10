// REQ: WP10 阶段7
// PURPOSE: 从冻结报价版本派生标书数据包（供标书填写/审核盖章，字段逐位一致）
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { getDefaultOrgId } from '@/lib/scoped-access'
import { resolveIdParam, type AsyncRouteParams } from '@/lib/route-params'
import { deriveTender } from '@/lib/quote/downstream-derive'
import { loadDeriveContext, errorResponse } from '@/lib/quote/derive-route-helpers'

export async function POST(req: NextRequest, { params }: AsyncRouteParams) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    const id = await resolveIdParam(params)

    const ctx = await loadDeriveContext(orgId, id)
    if (!ctx.ok) return ctx.response

    const body = await req.json().catch(() => ({}))
    const title = typeof body?.title === 'string' && body.title.trim() ? body.title.trim() : undefined

    const result = await deriveTender({ ...ctx.source, actor_id: user.id, title })
    return NextResponse.json({ success: true, data: { ...result, message: '已从冻结版本派生标书数据包' } })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    if (error instanceof Error && error.message.includes('DERIVE_TABLES_MISSING')) {
      return errorResponse(error.message, 409, 'DERIVE_TABLES_MISSING')
    }
    console.error('[WP10] derive tender error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

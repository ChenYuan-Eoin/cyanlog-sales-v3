// REQ: WP10 阶段7
// PURPOSE: 从冻结报价版本派生盖章申请（字段逐位一致，quote_derivations 留痕）
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { getDefaultOrgId } from '@/lib/scoped-access'
import { resolveIdParam, type AsyncRouteParams } from '@/lib/route-params'
import { deriveSeal } from '@/lib/quote/downstream-derive'
import { loadDeriveContext, errorResponse } from '@/lib/quote/derive-route-helpers'

export async function POST(req: NextRequest, { params }: AsyncRouteParams) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    const id = await resolveIdParam(params)

    const ctx = await loadDeriveContext(orgId, id)
    if (!ctx.ok) return ctx.response

    const body = await req.json().catch(() => ({}))
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
    if (!reason) {
      return errorResponse('盖章申请必须填写申请原因', 400, 'VALIDATION_ERROR')
    }

    const result = await deriveSeal({ ...ctx.source, reason })
    return NextResponse.json({ success: true, data: { ...result, message: '已从冻结版本派生盖章申请' } })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    if (error instanceof Error && error.message.includes('DERIVE_TABLES_MISSING')) {
      return errorResponse(error.message, 409, 'DERIVE_TABLES_MISSING')
    }
    console.error('[WP10] derive seal error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

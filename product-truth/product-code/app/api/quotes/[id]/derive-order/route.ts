// REQ: WP10 阶段7
// PURPOSE: 从冻结报价版本派生销售订单草稿（字段逐位一致，quote_derivations 留痕）
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { getDefaultOrgId } from '@/lib/scoped-access'
import { resolveIdParam, type AsyncRouteParams } from '@/lib/route-params'
import { deriveOrder } from '@/lib/quote/downstream-derive'
import { loadDeriveContext, errorResponse } from '@/lib/quote/derive-route-helpers'

export async function POST(req: NextRequest, { params }: AsyncRouteParams) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    const id = await resolveIdParam(params)

    const ctx = await loadDeriveContext(orgId, id)
    if (!ctx.ok) return ctx.response

    // 生成订单号
    let orderNo: string | null = null
    try {
      const { data } = await supabaseAdmin.rpc('generate_quote_number')
      if (typeof data === 'string') orderNo = data.replace(/^QT-/, 'SO-')
    } catch {
      // 订单号生成失败不阻断（可后续补号）
    }

    const result = await deriveOrder({ ...ctx.source, actor_id: user.id, order_no: orderNo ?? undefined })
    return NextResponse.json({
      success: true,
      data: { ...result, order_no: orderNo, message: '已从冻结版本派生销售订单草稿' },
    })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    if (error instanceof Error && error.message.includes('DERIVE_TABLES_MISSING')) {
      return errorResponse(error.message, 409, 'DERIVE_TABLES_MISSING')
    }
    console.error('[WP10] derive order error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

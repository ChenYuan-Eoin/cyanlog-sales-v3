// REQ:F005 - 审核策略 API
// PURPOSE: 列出 / 创建 / 切换审核策略（强势/平衡/弱势）

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { getDefaultOrgId } from '@/lib/scoped-access'

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

// GET /api/admin/review-strategies - 列出当前可用的审核策略
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req).catch(() => null)
    // 允许未登录访问（用于合同详情页默认策略）
    const orgId = user ? await getDefaultOrgId(user.id) : null

    let query = supabaseAdmin
      .from('review_strategies')
      .select('id, code, name, description, risk_threshold, enabled_categories, is_default, org_id')
      .order('risk_threshold', { ascending: true })

    if (orgId) {
      query = query.or(`org_id.is.null,org_id.eq.${orgId}`)
    } else {
      query = query.is('org_id', null)
    }

    const { data, error } = await query
    if (error) return errorResponse('查询失败', 500, 'DB_ERROR')

    return NextResponse.json({ success: true, data: { strategies: data || [] } })
  } catch {
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

// POST /api/admin/review-strategies - 创建/切换策略
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)

    const body = (await req.json().catch(() => ({}))) as {
      code?: string
      name?: string
      description?: string
      risk_threshold?: number
      enabled_categories?: string[]
      is_default?: boolean
    }

    if (!body.code || !['AGGRESSIVE', 'BALANCED', 'CONSERVATIVE'].includes(body.code)) {
      return errorResponse('策略代码不合法', 400, 'INVALID_CODE')
    }
    if (!body.name) {
      return errorResponse('策略名称必填', 400, 'MISSING_NAME')
    }

    // upsert
    const { data, error } = await supabaseAdmin
      .from('review_strategies')
      .upsert({
        org_id: orgId,
        code: body.code,
        name: body.name,
        description: body.description || null,
        risk_threshold: body.risk_threshold ?? 50,
        enabled_categories: body.enabled_categories || [],
        is_default: body.is_default ?? false,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'org_id,code' })
      .select()
      .single()

    if (error) return errorResponse('保存失败', 500, 'DB_ERROR')
    return NextResponse.json({ success: true, data })
  } catch {
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

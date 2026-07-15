// REQ:F005 - 审核策略 API
// PURPOSE: 列出 / 创建 / 切换审核策略（强势/平衡/弱势）

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { userHasFreshOrgConfigAccess } from '@/lib/configs/access'
import { getDefaultOrgId } from '@/lib/scoped-access'

const reviewStrategySchema = z.object({
  code: z.enum(['AGGRESSIVE', 'BALANCED', 'CONSERVATIVE']),
  name: z.string().trim().min(1),
  description: z.string().nullable().optional(),
  risk_threshold: z.number().min(0).max(100).optional(),
  enabled_categories: z.array(z.string()).optional(),
  is_default: z.boolean().optional(),
})

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
    const canWrite = await userHasFreshOrgConfigAccess(user.id, orgId, 'write')

    if (!canWrite) {
      return errorResponse('无权管理合同审核资产', 403, 'NO_PERMISSION')
    }

    const parsed = reviewStrategySchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      const fields = parsed.error.flatten().fieldErrors
      if (fields.code) {
        return errorResponse('策略代码不合法', 400, 'INVALID_CODE')
      }
      if (fields.name) {
        return errorResponse('策略名称必填', 400, 'MISSING_NAME')
      }
      return errorResponse('请求参数无效', 400, 'INVALID_FIELDS')
    }
    const body = parsed.data

    if (!body.code) {
      return errorResponse('策略代码不合法', 400, 'INVALID_CODE')
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

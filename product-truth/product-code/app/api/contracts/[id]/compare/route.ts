// POST /api/contracts/:id/compare
// GET /api/contracts/:id/compare
// 文档比对 API

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { z } from 'zod'
import {
  errorResponse,
  createdResponse,
} from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'

const compareSchema = z.object({
  baseline_type: z.enum(['template', 'previous_version', 'uploaded']),
  baseline_doc_id: z.string().uuid().optional(),
  compare_doc_id: z.string().uuid(),
})

// POST - 发起比对
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, _orgId: string) => {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const parsed = compareSchema.safeParse(body)

    if (!parsed.success) {
      return errorResponse(
        createApiError('VALIDATION_ERROR', '参数验证失败')
      )
    }

    const { data: comparison, error } = await supabaseAdmin
      .from('contract_comparisons')
      .insert({
        contract_id: id,
        created_by: user.id,
        baseline_type: parsed.data.baseline_type,
        baseline_doc_id: parsed.data.baseline_doc_id,
        compare_doc_id: parsed.data.compare_doc_id,
        status: 'pending',
      })
      .select()
      .single()

    if (error) {
      return errorResponse(createApiError('DB_ERROR', '创建比对任务失败'))
    }

    // TODO: 在后台执行比对（Phase 5）
    // 现在直接标记为已完成并返回占位结果
    await supabaseAdmin
      .from('contract_comparisons')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        ai_summary: '比对结果（占位）：发现 3 处差异，其中 1 处高风险。',
      })
      .eq('id', comparison.id)

    // 插入占位差异项
    await supabaseAdmin.from('comparison_diffs').insert([
      {
        comparison_id: comparison.id,
        diff_type: 'deleted',
        baseline_text: '甲方应在5个工作日内支付...',
        semantic_change: '客户删除了具体的支付时限限制',
        risk_level: 'yellow',
        sort_order: 1,
      },
      {
        comparison_id: comparison.id,
        diff_type: 'added',
        compare_text: '乙方需承担额外差旅费用...',
        semantic_change: '客户新增了乙方差旅费用承担条款',
        risk_level: 'red',
        sort_order: 2,
      },
    ])

    return createdResponse({
      ...comparison,
      status: 'completed',
    })
  })
}

// GET - 查询比对结果
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (_user: AuthUser, _orgId: string) => {
    const { id } = await params

    const { data: comparisons, error } = await supabaseAdmin
      .from('contract_comparisons')
      .select(`
        *,
        comparison_diffs(id, diff_type, baseline_text, compare_text, semantic_change, risk_level, sort_order)
      `)
      .eq('contract_id', id)
      .order('created_at', { ascending: false })
      .limit(1)

    if (error) {
      return errorResponse(createApiError('DB_ERROR', '查询比对结果失败'))
    }

    const comparison = comparisons?.[0]

    if (!comparison) {
      return errorResponse(createApiError('NOT_FOUND', '无比对记录'))
    }

    return NextResponse.json({
      data: {
        ...comparison,
        diffs: comparison.comparison_diffs || [],
      },
    })
  })
}

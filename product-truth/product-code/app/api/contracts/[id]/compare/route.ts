// POST /api/contracts/:id/compare
// GET /api/contracts/:id/compare
// 文档比对 API

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { z } from 'zod'
import {
  errorResponse,
  createdResponse,
  successResponse,
} from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'
import { listAccessibleUserIds } from '@/lib/scoped-access'

const compareSchema = z.object({
  baseline_type: z.enum(['template', 'previous_version', 'uploaded']),
  baseline_doc_id: z.string().uuid().optional(),
  compare_doc_id: z.string().uuid(),
})

type ComparableContract = {
  id: string
  filename: string | null
  status: string | null
  parsed_text: string | null
  created_by: string
  org_id: string
}

type DiffInsert = {
  comparison_id: string
  diff_type: 'deleted' | 'added' | 'modified'
  baseline_text?: string
  compare_text?: string
  semantic_change: string
  risk_level: 'red' | 'yellow' | 'green'
  sort_order: number
}

const HIGH_RISK_TERMS = [
  '违约',
  '赔偿',
  '付款',
  '质保',
  '保证金',
  '解除',
  '终止',
  '知识产权',
  '保密',
  '管辖',
  '仲裁',
  '责任',
]

function splitComparableText(text: string): string[] {
  return text
    .replace(/\r/g, '\n')
    .split(/\n+|(?<=[。；;.!?？])\s*/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 6)
    .slice(0, 240)
}

function normalizeLine(line: string): string {
  return line.replace(/\s+/g, '').toLowerCase()
}

function inferRiskLevel(text: string): 'red' | 'yellow' | 'green' {
  if (!text.trim()) return 'green'
  return HIGH_RISK_TERMS.some((term) => text.includes(term)) ? 'red' : 'yellow'
}

function buildDiffRows(comparisonId: string, baselineText: string, compareText: string): DiffInsert[] {
  const baselineLines = splitComparableText(baselineText)
  const compareLines = splitComparableText(compareText)
  const baselineSet = new Set(baselineLines.map(normalizeLine))
  const compareSet = new Set(compareLines.map(normalizeLine))
  const rows: DiffInsert[] = []

  for (const line of baselineLines) {
    if (compareSet.has(normalizeLine(line))) continue
    rows.push({
      comparison_id: comparisonId,
      diff_type: 'deleted',
      baseline_text: line,
      semantic_change: '对比文档缺少该条款或表述已被删除',
      risk_level: inferRiskLevel(line),
      sort_order: rows.length + 1,
    })
    if (rows.length >= 50) return rows
  }

  for (const line of compareLines) {
    if (baselineSet.has(normalizeLine(line))) continue
    rows.push({
      comparison_id: comparisonId,
      diff_type: 'added',
      compare_text: line,
      semantic_change: '对比文档新增该条款或表述',
      risk_level: inferRiskLevel(line),
      sort_order: rows.length + 1,
    })
    if (rows.length >= 50) return rows
  }

  return rows
}

function comparisonSummary(diffRows: DiffInsert[], baselineName?: string | null, compareName?: string | null) {
  if (diffRows.length === 0) {
    return `未发现 ${baselineName || '当前合同'} 与 ${compareName || '对比合同'} 的明显文本差异。`
  }

  const red = diffRows.filter((row) => row.risk_level === 'red').length
  const yellow = diffRows.filter((row) => row.risk_level === 'yellow').length
  return `发现 ${diffRows.length} 处文本差异，其中高风险 ${red} 处、需关注 ${yellow} 处。`
}

async function loadComparableContract(id: string, orgId: string, accessibleUserIds: string[]) {
  const { data } = await supabaseAdmin
    .from('contracts')
    .select('id, filename, status, parsed_text, created_by, org_id')
    .eq('id', id)
    .eq('org_id', orgId)
    .in('created_by', accessibleUserIds)
    .maybeSingle()

  return data as ComparableContract | null
}

// POST - 发起比对
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const parsed = compareSchema.safeParse(body)

    if (!parsed.success) {
      return errorResponse(
        createApiError('VALIDATION_ERROR', '参数验证失败')
      )
    }

    const { userIds: accessibleUserIds } = await listAccessibleUserIds(user.id, orgId)
    const [contract, compareContract] = await Promise.all([
      loadComparableContract(id, orgId, accessibleUserIds),
      loadComparableContract(parsed.data.compare_doc_id, orgId, accessibleUserIds),
    ])

    if (!contract) {
      return errorResponse(createApiError('NOT_FOUND', '合同不存在或无权访问'))
    }
    if (!compareContract) {
      return errorResponse(createApiError('NOT_FOUND', '对比合同不存在或无权访问'))
    }
    if (contract.id === compareContract.id) {
      return errorResponse(createApiError('VALIDATION_ERROR', '不能与同一份合同比对'))
    }
    if (contract.status !== 'COMPLETED' || compareContract.status !== 'COMPLETED') {
      return errorResponse(createApiError('VALIDATION_ERROR', '只能比对已完成审核的合同'))
    }
    if (!contract.parsed_text?.trim() || !compareContract.parsed_text?.trim()) {
      return errorResponse(createApiError('VALIDATION_ERROR', '合同缺少可比对的解析文本'))
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

    const diffRows = buildDiffRows(comparison.id, contract.parsed_text, compareContract.parsed_text)
    const summary = comparisonSummary(diffRows, contract.filename, compareContract.filename)
    const recommendation = diffRows.some((row) => row.risk_level === 'red')
      ? '存在高风险差异，建议法务复核后再签署。'
      : '未发现高风险差异，可按内部流程继续复核。'

    const { error: updateError } = await supabaseAdmin
      .from('contract_comparisons')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        ai_summary: summary,
        ai_recommendation: recommendation,
      })
      .eq('id', comparison.id)

    if (updateError) {
      return errorResponse(createApiError('DB_ERROR', '更新比对任务失败'))
    }

    if (diffRows.length > 0) {
      const { error: diffError } = await supabaseAdmin.from('comparison_diffs').insert(diffRows)
      if (diffError) {
        return errorResponse(createApiError('DB_ERROR', '保存比对差异失败'))
      }
    }

    return createdResponse({
      ...comparison,
      status: 'completed',
      ai_summary: summary,
      ai_recommendation: recommendation,
      diffs: diffRows,
    })
  })
}

// GET - 查询比对结果
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const { id } = await params
    const { searchParams } = new URL(req.url)
    const comparisonId = searchParams.get('comparison_id')
    const { userIds: accessibleUserIds } = await listAccessibleUserIds(user.id, orgId)

    let query = supabaseAdmin
      .from('contract_comparisons')
      .select(`
        *,
        contracts!inner(id, org_id, created_by),
        comparison_diffs(id, diff_type, baseline_text, compare_text, semantic_change, risk_level, sort_order)
      `)
      .eq('contract_id', id)
      .eq('contracts.org_id', orgId)
      .in('contracts.created_by', accessibleUserIds)
      .order('created_at', { ascending: false })
      .limit(1)

    if (comparisonId) {
      query = query.eq('id', comparisonId)
    }

    const { data: comparisons, error } = await query

    if (error) {
      return errorResponse(createApiError('DB_ERROR', '查询比对结果失败'))
    }

    const comparison = comparisons?.[0]

    if (!comparison) {
      return successResponse(null)
    }

    return successResponse({
      ...comparison,
      diffs: comparison.comparison_diffs || [],
    })
  })
}

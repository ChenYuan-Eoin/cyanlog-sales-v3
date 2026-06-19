// POST /api/contracts/:id/compare-standard
// 合同 vs 标准模板对照

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (_user: AuthUser, _orgId: string) => {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const { template_id } = body

    if (!template_id) {
      return errorResponse(createApiError('VALIDATION_ERROR', '请选择标准模板'))
    }

    // 获取合同
    const { data: contract, error: contractError } = await supabaseAdmin
      .from('contracts')
      .select('id, parsed_text')
      .eq('id', id)
      .single()

    if (contractError || !contract) {
      return errorResponse(createApiError('NOT_FOUND', '合同不存在'))
    }

    // 获取标准模板条款
    const { data: templateClauses, error: templateError } = await supabaseAdmin
      .from('contract_templates')
      .select('id, clause_number, clause_title, standard_text')
      .eq('id', template_id)
      .order('position', { ascending: true })

    if (templateError) {
      return errorResponse(createApiError('DB_ERROR', '获取模板失败'))
    }

    // 简化对照逻辑：按条款标题匹配
    const results = (templateClauses || []).map((tpl) => {
      const contractText = (contract.parsed_text || '').toLowerCase()
      const _templateText = (tpl.standard_text || '').toLowerCase()

      // 简单文本包含判断（实际应使用NLP）
      const hasMatch = contractText.includes(tpl.clause_title?.toLowerCase() || '')
      const similarity = hasMatch ? 0.8 : 0

      let result: 'match' | 'minor' | 'major' | 'missing'
      if (similarity > 0.7) {
        result = 'match'
      } else if (similarity > 0.4) {
        result = 'minor'
      } else if (similarity > 0.1) {
        result = 'major'
      } else {
        result = 'missing'
      }

      return {
        template_clause: `${tpl.clause_number} ${tpl.clause_title}`,
        contract_clause: hasMatch ? tpl.clause_title : '',
        result,
        deviation_point: result !== 'match' ? '条款内容存在差异' : undefined,
        deviation_direction: result === 'major' ? '偏向甲方' : undefined,
      }
    })

    return successResponse({
      results,
      summary: {
        match: results.filter((r) => r.result === 'match').length,
        minor: results.filter((r) => r.result === 'minor').length,
        major: results.filter((r) => r.result === 'major').length,
        missing: results.filter((r) => r.result === 'missing').length,
      },
    })
  })
}

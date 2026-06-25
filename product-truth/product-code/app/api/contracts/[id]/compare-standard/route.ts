// POST /api/contracts/:id/compare-standard
// 合同 vs 标准模板对照

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'
import { getAccessibleContract } from '@/lib/scoped-access'
import { getContractTemplateById } from '@/lib/contracts/templates'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const { template_id } = body

    if (!template_id) {
      return errorResponse(createApiError('VALIDATION_ERROR', '请选择标准模板'))
    }

    const template = getContractTemplateById(template_id)
    if (!template) {
      return errorResponse(createApiError('VALIDATION_ERROR', '标准模板不存在'))
    }

    // 获取合同
    const { contract } = await getAccessibleContract<{
      id: string
      parsed_text?: string | null
    }>(id, user.id, orgId, 'id, parsed_text')

    if (!contract) {
      return errorResponse(createApiError('NOT_FOUND', '合同不存在'))
    }

    // 获取标准模板条款
    const { data: templateClauses, error: templateError } = await supabaseAdmin
      .from('clause_library')
      .select('id, name, category, template_text, stance')
      .or(`org_id.is.null,org_id.eq.${orgId}`)
      .contains('contract_types', [template.contractType])
      .in('stance', ['required', 'risky', 'dangerous'])
      .order('category', { ascending: true })
      .order('name', { ascending: true })

    if (templateError) {
      return errorResponse(createApiError('DB_ERROR', '获取模板失败'))
    }

    if (!templateClauses || templateClauses.length === 0) {
      return errorResponse(createApiError('NOT_FOUND', '标准模板暂无条款'))
    }

    // 简化对照逻辑：按条款标题匹配
    const results = (templateClauses || []).map((tpl) => {
      const contractText = (contract.parsed_text || '').toLowerCase()
      const templateText = (tpl.template_text || '').toLowerCase()

      // 简单文本包含判断（实际应使用NLP）
      const titleMatch = contractText.includes(tpl.name?.toLowerCase() || '')
      const textMatch = templateText.length > 12 && contractText.includes(templateText.slice(0, 12))
      const hasMatch = titleMatch || textMatch
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
        template_clause: tpl.name,
        contract_clause: hasMatch ? tpl.name : '',
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

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'
import {
  loadFrozenComparisonSource,
  type FrozenComparisonSource,
} from '@/lib/contracts/comparison-snapshot-server'

function publicSource(source: FrozenComparisonSource) {
  const { parsed_text: _parsedText, origin_storage_path: _originPath, ...identity } = source
  return identity
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withAuthAndOrg(req, async (_user: AuthUser, orgId: string) => {
    const { id } = await params
    const { data: comparison, error: comparisonError } = await supabaseAdmin
      .from('contract_comparisons')
      .select('id,org_id,contract_id,created_by,baseline_type,baseline_doc_id,compare_doc_id,ai_summary,ai_recommendation,status,error_message,created_at,completed_at')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle()

    if (comparisonError) {
      return errorResponse(createApiError('DB_ERROR', '查询比对记录失败'))
    }
    if (!comparison) {
      return errorResponse(createApiError('NOT_FOUND', '比对记录不存在或无权访问'))
    }

    const [{ data: diffs, error: diffsError }, oldSource, newSource] = await Promise.all([
      supabaseAdmin
        .from('comparison_diffs')
        .select('id,comparison_id,diff_type,baseline_position,compare_position,baseline_text,compare_text,semantic_change,risk_level,sort_order,created_at')
        .eq('comparison_id', id)
        .order('sort_order', { ascending: true }),
      loadFrozenComparisonSource(id, 'old', orgId),
      loadFrozenComparisonSource(id, 'new', orgId),
    ])

    if (diffsError) {
      return errorResponse(createApiError('DB_ERROR', '获取差异项失败'))
    }
    if (!oldSource || !newSource) {
      return errorResponse(createApiError(
        'CONFLICT',
        '该比对记录缺少创建时旧/新原文件快照，不能冒充可审计结果',
      ), 409)
    }

    return successResponse({
      ...comparison,
      sources: {
        old: publicSource(oldSource),
        new: publicSource(newSource),
      },
      diffs: diffs || [],
    })
  })
}

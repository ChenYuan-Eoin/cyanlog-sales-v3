// GET /api/contract-policies/rules/:id/versions
// POST /api/contract-policies/rules/:id/versions/:versionId/publish
// POST /api/contract-policies/rules/:id/versions/:versionId/rollback
// 规则版本管理 API

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  errorResponse,
  successResponse,
} from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuth } from '@/lib/api/auth-wrapper'

// GET - 获取规则的版本历史
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async () => {
    const { id } = await params

    // 获取规则基本信息
    const { data: rule, error: ruleError } = await supabaseAdmin
      .from('rules')
      .select('id, code, name, version, is_active')
      .eq('id', id)
      .single()

    if (ruleError || !rule) {
      return errorResponse(createApiError('NOT_FOUND', '规则不存在'))
    }

    // 获取版本历史
    const { data: versions, error: versionsError } = await supabaseAdmin
      .from('contract_policy_versions')
      .select('*')
      .eq('rule_id', id)
      .order('version', { ascending: false })

    if (versionsError) {
      return errorResponse(createApiError('DB_ERROR', '获取版本历史失败'))
    }

    // 获取影响分析报告
    const versionIds = versions?.map((v) => v.id) || []
    const { data: reports, error: reportsError } = await supabaseAdmin
      .from('contract_policy_impact_reports')
      .select('*')
      .in('version_id', versionIds.length > 0 ? versionIds : [''])

    if (reportsError) {
      console.error('获取影响报告失败:', reportsError)
    }

    const reportsMap = new Map(
      reports?.map((r) => [r.version_id, r]) || []
    )

    return successResponse({
      rule,
      versions: versions?.map((v) => ({
        ...v,
        impact_report: reportsMap.get(v.id) || null,
      })),
    })
  })
}

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
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'

// GET - 获取规则的版本历史
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (_user: AuthUser, orgId: string) => {
    const { id } = await params

    // 获取规则基本信息
    const { data: rule, error: ruleError } = await supabaseAdmin
      .from('contract_rules_v2')
      .select('*')
      .eq('id', id)
      .eq('org_id', orgId)
      .single()

    if (ruleError || !rule) {
      return errorResponse(createApiError('NOT_FOUND', '规则不存在'))
    }

    // 获取版本历史
    const { data: versions, error: versionsError } = await supabaseAdmin
      .from('contract_rule_snapshots')
      .select('*')
      .eq('rule_id', id)
      .order('version', { ascending: false })

    if (versionsError) {
      return errorResponse(createApiError('DB_ERROR', '获取版本历史失败'))
    }

    const snapshots = versions && versions.length > 0
      ? versions
      : [{
          id: `current-${rule.id}`,
          rule_id: rule.id,
          version: rule.version || 1,
          config_snapshot: rule,
          released_by: rule.published_by || null,
          released_at: rule.published_at || rule.updated_at,
          release_note: '当前线上生效版本',
          is_gray_release: false,
          gray_end_at: null,
          status: 'published',
          created_at: rule.created_at,
        }]

    return successResponse({
      rule,
      versions: snapshots.map((v) => ({ ...v, impact_report: null })),
    })
  })
}

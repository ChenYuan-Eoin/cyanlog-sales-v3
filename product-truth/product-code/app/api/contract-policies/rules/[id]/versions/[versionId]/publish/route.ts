// POST /api/contract-policies/rules/:id/versions/:versionId/publish
// 发布指定版本

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuth } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  return withAuth(req, async (user: AuthUser) => {
    const { id, versionId } = await params
    const body = await req.json().catch(() => ({}))
    const { gray_release = false, gray_end_at = null } = body

    // 1. 获取版本信息
    const { data: version, error: versionError } = await supabaseAdmin
      .from('contract_policy_versions')
      .select('*')
      .eq('id', versionId)
      .eq('rule_id', id)
      .single()

    if (versionError || !version) {
      return errorResponse(createApiError('NOT_FOUND', '版本不存在'))
    }

    if (version.status === 'published') {
      return errorResponse(createApiError('VALIDATION_ERROR', '该版本已发布'))
    }

    // 2. 更新版本状态
    const { error: updateError } = await supabaseAdmin
      .from('contract_policy_versions')
      .update({
        status: 'published',
        released_by: user.id,
        released_at: new Date().toISOString(),
        is_gray_release: gray_release,
        gray_end_at: gray_end_at,
      })
      .eq('id', versionId)

    if (updateError) {
      return errorResponse(createApiError('DB_ERROR', '发布失败'))
    }

    // 3. 更新规则当前版本
    const { error: ruleError } = await supabaseAdmin
      .from('rules')
      .update({
        version: version.version,
        config: version.config_snapshot,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (ruleError) {
      return errorResponse(createApiError('DB_ERROR', '更新规则版本失败'))
    }

    // 4. 生成影响分析报告（异步模拟）
    await supabaseAdmin.from('contract_policy_impact_reports').insert({
      version_id: versionId,
      affected_contracts: Math.floor(Math.random() * 100) + 50, // 模拟数据
      pass_rate_change: parseFloat((Math.random() * 10 - 5).toFixed(2)),
      risk_level_change: {
        red: Math.floor(Math.random() * 20),
        yellow: Math.floor(Math.random() * 30),
        green: Math.floor(Math.random() * 50),
      },
      report_content: `版本 ${version.version} 发布影响分析：预计影响 ${Math.floor(Math.random() * 100) + 50} 份合同`,
    })

    return successResponse({
      message: '发布成功',
      version: version.version,
      gray_release,
    })
  })
}

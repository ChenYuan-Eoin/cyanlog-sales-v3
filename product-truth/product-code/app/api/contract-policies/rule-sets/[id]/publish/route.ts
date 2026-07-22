import { NextRequest } from 'next/server'

import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import type { AuthUser } from '@/lib/auth'
import { getRuleAssetHealth } from '@/lib/rules/rule-assets'
import { loadRuleSetAssets } from '@/lib/rules/rule-assets-server'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const { id } = await params
    const body = await req.json().catch(() => ({})) as {
      release_note?: string
      test_results?: Record<string, unknown>
    }

    try {
      const { sets } = await loadRuleSetAssets(orgId)
      const ruleSet = sets.find((item) => item.id === id)
      if (!ruleSet) return errorResponse(createApiError('NOT_FOUND', '规则集不存在'))
      if (ruleSet.rules.length === 0) {
        return errorResponse(createApiError('CONFLICT', '空规则集不能发布'))
      }

      const blockers = ruleSet.rules.flatMap((rule) => (
        getRuleAssetHealth(rule).blockers.map((message) => `${rule.code}：${message}`)
      ))
      if (blockers.length > 0) {
        return errorResponse(createApiError('CONFLICT', '规则集尚未达到发布条件', { blockers }))
      }

      const activeRules = ruleSet.rules.filter((rule) => rule.is_active)
      const { data: evalRows, error: evalError } = await supabaseAdmin
        .from('contract_rule_eval_runs')
        .select('rule_id,status,created_at')
        .eq('org_id', orgId)
        .in('rule_id', activeRules.map((rule) => rule.id))
        .eq('status', 'passed')
        .order('created_at', { ascending: false })

      if (evalError) throw evalError
      const currentPassedRules = new Set(
        (evalRows || [])
          .filter((row) => {
            const rule = activeRules.find((item) => item.id === row.rule_id)
            return rule && new Date(row.created_at).getTime() >= new Date(rule.updated_at).getTime()
          })
          .map((row) => row.rule_id)
      )
      const missingEval = activeRules
        .filter((rule) => !currentPassedRules.has(rule.id))
        .map((rule) => `${rule.code}：缺少晚于当前规则版本的通过评测`)
      if (missingEval.length > 0) {
        return errorResponse(createApiError('CONFLICT', '规则集尚未通过发布评测', { blockers: missingEval }))
      }

      const { data, error } = await supabaseAdmin.rpc('publish_contract_rule_set_v1', {
        p_org_id: orgId,
        p_rule_set_id: id,
        p_user_id: user.id,
        p_release_note: body.release_note?.trim() || null,
        p_test_results: body.test_results || {},
      })

      if (error) {
        console.error('[rule-set-publish] transaction failed', error)
        return errorResponse(createApiError('DB_ERROR', '规则集发布事务失败'))
      }
      return successResponse(data)
    } catch (error) {
      console.error('[rule-set-publish] validation failed', error)
      return errorResponse(createApiError('DB_ERROR', '规则集发布失败'))
    }
  })
}

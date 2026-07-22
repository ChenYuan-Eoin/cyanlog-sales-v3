import { NextRequest } from 'next/server'

import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import type { AuthUser } from '@/lib/auth'
import { reviewWithFailoverSync } from '@/lib/ai/failover'
import type { TokenUsage } from '@/lib/ai/model-invocations'
import { evaluateRuleSample } from '@/lib/rules/rule-assets'
import { loadRuleAsset } from '@/lib/rules/rule-assets-server'
import { supabaseAdmin } from '@/lib/supabase'

function buildModelEvaluationPrompt(ruleName: string, rulePrompt: string, sample: string) {
  return `你正在执行单条合同规则的发布评测，不是在进行整份合同审核。

规则名称：${ruleName}
规则判定要求：${rulePrompt}

测试文本：
${sample}

只返回以下 JSON 结构：
{"risks":[{"level":"red|green","title":"MATCH 或 NO_MATCH","description":"判断依据","suggestion":"","source_quote":null,"rule_code":null,"rule_snapshot_id":null}],"summary":"一句话说明"}

若测试文本命中规则指出的风险，level=red 且 title=MATCH；否则 level=green 且 title=NO_MATCH。不要引用其他规则。`
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const { id } = await params
    const rule = await loadRuleAsset(orgId, id)
    if (!rule) return errorResponse(createApiError('NOT_FOUND', '规则不存在'))

    const body = await req.json().catch(() => ({})) as {
      fields?: Record<string, unknown>
      text?: string
      expected_triggered?: boolean
      preferred_provider?: string
    }
    if (typeof body.expected_triggered !== 'boolean') {
      return errorResponse(createApiError('VALIDATION_ERROR', '请明确测试用例预期命中或预期不命中'))
    }
    const startedAt = Date.now()
    let result = evaluateRuleSample(rule, body)
    let provider: string | null = null
    let degraded = false
    let usage: TokenUsage | undefined

    if (result.status === 'needs_model') {
      if (!body.text?.trim()) {
        return errorResponse(createApiError('VALIDATION_ERROR', '语义规则评测必须提供合同样例文本'))
      }
      const modelResult = await reviewWithFailoverSync(
        buildModelEvaluationPrompt(rule.name, rule.semantic_prompt || rule.description || rule.name, body.text),
        {
          orgId,
          preferredProvider: body.preferred_provider,
          tool: 'contract_review',
          capability: 'contract_review',
          phase: 'contract_rule_release_eval',
        },
        0
      )
      provider = modelResult.provider
      degraded = modelResult.degraded
      usage = modelResult.usage
      const triggered = modelResult.risks.some(
        (risk) => risk.level !== 'green' && risk.title.trim().toUpperCase() === 'MATCH'
      )
      result = triggered
        ? { status: 'matched', mode: 'model', level: 'A', action: rule.level_a_action, reason: modelResult.summary }
        : { status: 'not_matched', mode: 'model', reason: modelResult.summary }
    }

    const actualTriggered = result.status === 'matched'
    const evaluationStatus = degraded || provider === 'rule_engine' || provider === 'manual-fallback'
      ? 'error'
      : actualTriggered === body.expected_triggered
        ? 'passed'
        : 'failed'

    const { data: evalRun, error: evalError } = await supabaseAdmin
      .from('contract_rule_eval_runs')
      .insert({
        org_id: orgId,
        rule_id: rule.id,
        mode: result.mode,
        status: evaluationStatus,
        input_snapshot: { fields: body.fields || {}, text: body.text || '' },
        expected_snapshot: { triggered: body.expected_triggered ?? null },
        actual_snapshot: { triggered: actualTriggered, result },
        provider,
        degraded,
        token_usage: usage || null,
        latency_ms: Date.now() - startedAt,
        created_by: user.id,
      })
      .select('id')
      .single()

    if (evalError) {
      console.error('[contract-rule-eval] failed to persist evidence', evalError)
      return errorResponse(createApiError('DB_ERROR', '规则评测证据保存失败'))
    }

    return successResponse({
      ...result,
      evidence: {
        evaluation_status: evaluationStatus,
        evaluation_run_id: evalRun.id,
        provider,
        degraded,
        usage,
      },
    })
  })
}

// /api/rules/test - 规则测试沙箱 API
// 接收合同文本，立即显示所有规则的匹配结果

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { evaluateRuleContract } from '@/lib/rules/rule-contract'
import { executeRules, loadFlexibleRules } from '@/lib/rules/engine'
import { requireAuth } from '@/lib/auth'
import { getDefaultOrgId } from '@/lib/scoped-access'

export const runtime = 'nodejs'

const schema = z.object({
  text: z.string().min(10).max(50000),
  rule_id: z.string().uuid().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const body = await req.json().catch(() => null)
    const result = schema.safeParse(body)
    if (!result.success) {
      return NextResponse.json({ error: '文本长度需在 10-50000 字符之间' }, { status: 400 })
    }
    const orgId = await getDefaultOrgId(user.id)
    const analysis = await executeRules(result.data.text, orgId)
    if (!result.data.rule_id) {
      return NextResponse.json(analysis)
    }

    // 配置中心必须能测试尚未发布的草稿，但正式合同审核仍只读取已发布快照。
    const draftRules = await loadFlexibleRules({ orgId, includeUnpublished: true })
    const rule = draftRules.find((candidate) => candidate.id === result.data.rule_id)
    if (!rule) {
      return NextResponse.json({ error: '当前组织下未找到这条规则' }, { status: 404 })
    }

    const evaluation = evaluateRuleContract(rule, result.data.text)
    return NextResponse.json({
      ...analysis,
      test: {
        ruleId: rule.id,
        ruleCode: rule.code,
        ruleVersion: rule.version,
        ruleName: rule.name,
        status: evaluation.status,
        outcome: evaluation.outcome,
        riskLevel: evaluation.risk_level,
        decision: evaluation.decision
          ? {
              id: evaluation.decision.id,
              label: evaluation.decision.label,
              match: evaluation.decision.match,
              outcome: evaluation.decision.outcome,
              action: evaluation.decision.action,
              message: evaluation.decision.message,
            }
          : null,
        readings: Object.values(evaluation.readings),
        evidence: evaluation.evidence,
        missingPropertyKeys: evaluation.missing_property_keys,
        ambiguousPropertyKeys: evaluation.ambiguous_property_keys,
      },
    })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return NextResponse.json({ error: '未登录或登录已过期' }, { status: 401 })
    }
    console.error('Rule test error:', error)
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 })
  }
}

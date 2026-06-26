// /api/rules/simulate - 规则模拟执行
// 接收合同文本，返回所有规则的Level A/B/C匹配结果

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { executeRules } from '@/lib/rules/engine'
import { z } from 'zod'

const simulationSchema = z.object({
  text: z.string().min(1, '请提供合同文本'),
  orgId: z.string().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req)

    const parsed = simulationSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: '请提供合同文本' }, { status: 400 })
    }
    const { text, orgId } = parsed.data

    // 获取用户默认组织
    let effectiveOrgId = orgId
    if (!effectiveOrgId) {
      const { data: userOrg } = await supabaseAdmin
        .from('users')
        .select('org_id')
        .eq('id', user.id)
        .single()
      effectiveOrgId = userOrg?.org_id || '00000001-0000-0000-0000-000000000000'
    }

    // 执行规则引擎（返回 AnalysisResults）
    const result = await executeRules(text, effectiveOrgId)

    // 转换为SimulationResult格式
    const simulationResults = result.risks.map((risk) => ({
      ruleId: risk.ruleId || risk.ruleCode || 'unknown',
      ruleCode: risk.ruleCode,
      ruleVersion: risk.ruleVersion,
      ruleName: risk.title,
      matched: true,
      level: risk.level === 'red' ? 'C' as const : risk.level === 'yellow' ? 'B' as const : 'A' as const,
      action: risk.level === 'red' ? 'block' : risk.level === 'yellow' ? 'suggest_counterparty' : 'auto_approve',
      message: risk.description,
      counterparty: risk.suggestion || risk.counterparty,
      evidence: risk.evidence || [],
    }))

    return NextResponse.json({
      success: true,
      results: simulationResults,
      summary: {
        total: result.appliedRules,
        matched: result.matchedRules,
        red: result.risks.filter((r) => r.level === 'red').length,
        yellow: result.risks.filter((r) => r.level === 'yellow').length,
        green: result.risks.filter((r) => r.level === 'green').length,
      },
    })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return NextResponse.json({ error: '未登录或登录已过期' }, { status: 401 })
    }
    console.error('Rule simulation error:', error)
    return NextResponse.json({ error: '模拟执行失败' }, { status: 500 })
  }
}

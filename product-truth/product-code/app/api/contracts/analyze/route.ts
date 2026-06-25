// POST /api/contracts/analyze - 合同风险分析
// 转发到 /api/ai/analyze，并转换返回格式

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'
import { executeRules } from '@/lib/rules/engine'

interface RiskItem {
  id?: string
  ruleId?: string
  ruleVersion?: number
  level: 'red' | 'yellow' | 'green'
  title: string
  description: string
  suggestion?: string
  ruleCode?: string
  evidence?: string[]
}

const analyzeContractSchema = z.object({
  text: z.string().min(1, '请提供合同文本').max(100_000),
  pageCount: z.number().int().min(1).max(1000).optional(),
})

export async function POST(req: NextRequest) {
  return withAuthAndOrg(req, async (_user: AuthUser, orgId: string) => {
    const body = await req.json().catch(() => ({}))
    const parsed = analyzeContractSchema.safeParse({
      text: body.contractText || body.text || '',
      pageCount: body.pageCount || 1,
    })

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || '参数无效' },
        { status: 400 }
      )
    }

    const analysis = await executeRules(parsed.data.text, orgId)
    const risks: RiskItem[] = analysis.risks.map((risk, index) => ({
      id: risk.ruleId || risk.ruleCode || `risk-${index}`,
      ruleId: risk.ruleId,
      ruleVersion: risk.ruleVersion,
      level: risk.level,
      title: risk.title,
      description: risk.description,
      suggestion: risk.suggestion,
      ruleCode: risk.ruleCode,
      evidence: risk.evidence,
    }))

    const greenCount = risks.filter((r: RiskItem) => r.level === 'green').length
    const yellowCount = risks.filter((r: RiskItem) => r.level === 'yellow').length
    const redCount = risks.filter((r: RiskItem) => r.level === 'red').length

    return NextResponse.json({
      data: {
        risks,
        summary: analysis.summary,
        appliedRules: analysis.appliedRules,
        matchedRules: analysis.matchedRules,
        greenCount,
        yellowCount,
        redCount,
      },
    })
  })
}

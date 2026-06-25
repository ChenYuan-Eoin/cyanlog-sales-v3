// POST /api/contracts/analyze - 合同风险分析
// 转发到 /api/ai/analyze，并转换返回格式

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'

interface RiskItem {
  id?: string
  level: 'red' | 'yellow' | 'green'
  title: string
  description: string
  suggestion?: string
  ruleCode?: string
}

const analyzeContractSchema = z.object({
  text: z.string().min(1, '请提供合同文本').max(100_000),
  pageCount: z.number().int().min(1).max(1000).optional(),
})

export async function POST(req: NextRequest) {
  return withAuthAndOrg(req, async (_user: AuthUser, _orgId: string) => {
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

    const token = req.headers.get('authorization')

    const res = await fetch(`${req.nextUrl.origin}/api/ai/analyze`, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: token } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: parsed.data.text,
        pageCount: parsed.data.pageCount || 1,
        task: 'semantic',
      }),
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const message = typeof data.error === 'string'
        ? data.error
        : data.error?.message || '分析失败'

      return NextResponse.json(
        { error: message },
        { status: res.status }
      )
    }

    // 转换格式以匹配前端期望
    if (data.result) {
      const risks: RiskItem[] = (data.result.risks || []).map((risk: RiskItem, index: number) => ({
        id: risk.id || `risk-${index}`,
        level: risk.level,
        title: risk.title,
        description: risk.description,
        suggestion: risk.suggestion,
        ruleCode: risk.ruleCode,
      }))

      const greenCount = risks.filter((r: RiskItem) => r.level === 'green').length
      const yellowCount = risks.filter((r: RiskItem) => r.level === 'yellow').length
      const redCount = risks.filter((r: RiskItem) => r.level === 'red').length

      return NextResponse.json({
        data: {
          risks,
          summary: data.result.summary || '',
          appliedRules: risks.length,
          matchedRules: yellowCount + redCount,
          greenCount,
          yellowCount,
          redCount,
        },
      })
    }

    return NextResponse.json({
      data: {
        risks: [],
        summary: data.summary || '',
        appliedRules: 0,
        matchedRules: 0,
        greenCount: 0,
        yellowCount: 0,
        redCount: 0,
      },
    })
  })
}

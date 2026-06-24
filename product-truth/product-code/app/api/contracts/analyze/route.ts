// POST /api/contracts/analyze - 合同风险分析
// 转发到 /api/ai/analyze，并转换返回格式

import { NextRequest, NextResponse } from 'next/server'

interface RiskItem {
  id?: string
  level: 'red' | 'yellow' | 'green'
  title: string
  description: string
  suggestion?: string
  ruleCode?: string
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const token = req.headers.get('authorization')

    const res = await fetch(`${req.nextUrl.origin}/api/ai/analyze`, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: token } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: body.contractText || body.text || '',
        pageCount: body.pageCount || 1,
        task: 'semantic',
      }),
    })

    const data = await res.json()

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

    return NextResponse.json(data, { status: res.status })
  } catch (_err) {
    return NextResponse.json({ error: '分析失败' }, { status: 500 })
  }
}

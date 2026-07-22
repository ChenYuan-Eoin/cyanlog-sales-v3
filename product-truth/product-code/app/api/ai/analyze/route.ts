// AI 分析 API 端点
// 统一走 reviewWithFailover，删除原 ai-fallback 链路

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { reviewWithFailoverSync } from '@/lib/ai/failover'
import { getAuthUser } from '@/lib/auth'
import { getDefaultOrgId } from '@/lib/scoped-access'

export const runtime = 'nodejs'

const analyzeSchema = z.object({
  text: z.string().min(1).max(100_000),
  pageCount: z.number().int().min(1).max(1000),
  task: z.enum(['semantic', 'extract', 'classify']).optional(),
  forceCloud: z.boolean().optional(),
})

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const result = analyzeSchema.safeParse(body)
    if (!result.success) {
      const firstError = result.error.issues[0]
      return errorResponse(firstError.message, 400, 'VALIDATION_ERROR')
    }

    const input = result.data
    const user = await getAuthUser(req)
    const orgId = user?.id ? await getDefaultOrgId(user.id).catch(() => undefined) : undefined

    // 统一走 reviewWithFailover 降级链
    const analysis = await reviewWithFailoverSync(input.text, {
      orgId,
      preferredProvider: input.forceCloud ? 'sales_cloud_backup' : undefined,
      tool: input.task === 'extract' ? 'tender_parse' : input.task === 'classify' ? 'rule_translation' : 'contract_review',
      capability: input.task === 'extract' ? 'long_text' : input.task === 'classify' ? 'deterministic_rule_scan' : 'contract_review',
      phase: input.task ? `ai_analyze_${input.task}` : 'ai_analyze_semantic',
    })

    return NextResponse.json({
      level: analysis.degraded ? 3 : 1,
      source: analysis.provider,
      provider: analysis.provider,
      result: {
        risks: analysis.risks,
        summary: analysis.summary,
      },
      duration: 0,
      degraded: analysis.degraded,
    })
  } catch (error) {
    console.error('AI analyze error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

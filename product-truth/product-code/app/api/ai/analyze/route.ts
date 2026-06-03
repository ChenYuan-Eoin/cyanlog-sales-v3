// AI 分析 API 端点
// 接收文本，返回降级链结果

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { FallbackOrchestrator } from '@/lib/ai-fallback/orchestrator'
import { LocalModelClient } from '@/lib/ai-fallback/local-model'
import { CloudModelClient } from '@/lib/ai-fallback/cloud-model'
import { RuleEngineClient } from '@/lib/ai-fallback/rule-engine'

export const runtime = 'nodejs'

const analyzeSchema = z.object({
  text: z.string().min(1).max(100_000),
  pageCount: z.number().int().min(1).max(1000),
  task: z.enum(['semantic', 'extract', 'classify']),
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

    // 构造降级链：只在配置存在时注入云端客户端
    const local = new LocalModelClient()
    const cloudUrl = process.env.AI_GATEWAY_URL
    const cloudKey = process.env.AI_GATEWAY_API_KEY
    const cloud = cloudUrl && cloudKey
      ? new CloudModelClient(cloudUrl, cloudKey, process.env.AI_MODEL)
      : undefined
    const rules = new RuleEngineClient()

    const orch = new FallbackOrchestrator(local, cloud, rules)

    try {
      const analysis = await orch.analyze(input)
      return NextResponse.json({
        ...analysis,
        attempts: orch.getAttempts(),
      })
    } catch (err) {
      // 理论上不会到这里（rule engine 兜底）
      const msg = err instanceof Error ? err.message : 'Unknown error'
      return errorResponse(`降级链全部失败: ${msg}`, 500, 'FALLBACK_FAILED')
    }
  } catch (error) {
    console.error('AI analyze error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

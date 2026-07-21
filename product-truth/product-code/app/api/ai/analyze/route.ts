// AI 分析 API 端点：只消费已发布的六对象 AI 运行计划。

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AIExecutionError, executeAIUsePoint } from '@/lib/ai/runtime-executor'
import { getAuthUser } from '@/lib/auth'
import { getDefaultOrgId } from '@/lib/scoped-access'

export const runtime = 'nodejs'

const analyzeSchema = z.object({
  text: z.string().min(1).max(100_000),
  pageCount: z.number().int().min(1).max(1000),
  task: z.enum(['semantic', 'extract', 'classify']).optional(),
  forceCloud: z.boolean().optional(),
})

const analysisOutputSchema = z.object({
  risks: z.array(z.object({
    level: z.enum(['red', 'yellow', 'green']),
    title: z.string().min(1),
    description: z.string().min(1),
    suggestion: z.string().min(1),
  })).max(200),
  summary: z.string().min(1),
})

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

function parseStructuredAnalysis(text: string) {
  const normalized = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    const parsed = analysisOutputSchema.safeParse(JSON.parse(normalized))
    return parsed.success
      ? { ok: true as const, value: parsed.data }
      : { ok: false as const, error: parsed.error.issues.map((issue) => issue.message).join('；') }
  } catch {
    return { ok: false as const, error: '输出不是有效 JSON' }
  }
}

function executionEnvironment(): 'local' | 'hosted' {
  return process.env.VERCEL === '1' && Boolean(process.env.VERCEL_URL || process.env.VERCEL_REGION)
    ? 'hosted'
    : 'local'
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const result = analyzeSchema.safeParse(body)
    if (!result.success) {
      const firstError = result.error.issues[0]
      return errorResponse(firstError.message, 400, 'VALIDATION_ERROR')
    }

    const input = result.data
    const user = await getAuthUser(req)
    if (!user?.id) return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    const orgId = await getDefaultOrgId(user.id)
    if (input.forceCloud) {
      return errorResponse('模型选择由已发布 RoutePolicy 管理，业务接口不能临时改写路由。', 400, 'ROUTE_POLICY_CONTROLLED')
    }

    const analysis = await executeAIUsePoint({
      orgId,
      usePointId: 'generic.ai.analyze',
      executionEnvironment: executionEnvironment(),
      messages: [
        {
          role: 'system',
          content: [
            '你是结构化业务分析助手。',
            '只输出 JSON，不要 Markdown。',
            '格式：{"risks":[{"level":"red|yellow|green","title":"...","description":"...","suggestion":"..."}],"summary":"..."}',
          ].join('\n'),
        },
        {
          role: 'user',
          content: `任务：${input.task || 'semantic'}\n页数：${input.pageCount}\n正文：\n${input.text}`,
        },
      ],
      validateOutput: parseStructuredAnalysis,
      requestMeta: { task: input.task || 'semantic', page_count: input.pageCount },
    })

    return NextResponse.json({
      level: analysis.degraded ? 3 : 1,
      source: analysis.provider,
      provider: analysis.provider,
      model: analysis.model,
      result: analysis.value,
      duration: analysis.latencyMs,
      degraded: analysis.degraded,
      usage: analysis.usage,
      planSnapshotHash: analysis.planSnapshotHash,
      invocationIds: analysis.invocationIds,
    })
  } catch (error) {
    console.error('AI analyze error:', error)
    if (error instanceof AIExecutionError) {
      return errorResponse(
        error.failureAction === 'manual_review'
          ? '可用模型均失败，请转人工处理。'
          : '可用模型均失败，运行已停止。',
        503,
        error.failureAction === 'manual_review' ? 'AI_MANUAL_REVIEW_REQUIRED' : 'AI_RUNTIME_STOPPED',
      )
    }
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

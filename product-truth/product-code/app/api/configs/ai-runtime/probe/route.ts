// REQ: F012
// PURPOSE: Test an AI provider draft without storing credentials.

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import { successResponse, errorResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import {
  assessProviderRuntime,
  fetchOpenAICompatibleModelIds,
  probeOpenAICompatibleChatCompletion,
} from '@/lib/configs/ai-runtime-readiness'
import type { AuthUser } from '@/lib/auth'

const probeSchema = z.object({
  provider_kind: z.enum(['openai_compatible', 'builtin']).default('openai_compatible'),
  base_url: z.string().trim().optional(),
  api_key: z.string().optional(),
  model: z.string().trim().optional(),
  timeout_ms: z.number().int().min(1000).max(180000).optional(),
})

function clampProbeTimeout(timeoutMs: number | undefined, localEndpoint: boolean): number {
  const fallback = localEndpoint ? 15000 : 20000
  const lowerBound = localEndpoint ? 15000 : 8000
  const upperBound = localEndpoint ? 120000 : 60000
  const candidate = typeof timeoutMs === 'number' ? timeoutMs : fallback
  return Math.min(upperBound, Math.max(lowerBound, candidate))
}

export async function POST(req: NextRequest) {
  return withAuthAndOrg(req, async (_user: AuthUser, _orgId: string) => {
    const body = await req.json().catch(() => null)
    const parsed = probeSchema.safeParse(body)

    if (!parsed.success) {
      return errorResponse(createApiError(
        'VALIDATION_ERROR',
        `模型探测参数无效: ${parsed.error.issues.map((issue) => issue.message).join(', ')}`
      ))
    }

    const assessment = await assessProviderRuntime({
      providerKind: parsed.data.provider_kind,
      baseUrl: parsed.data.base_url,
      apiKey: parsed.data.api_key,
      model: parsed.data.model,
      allowLocalCliFallback: false,
      checkRemoteHealth: true,
    })

    const availableModels = (
      parsed.data.provider_kind !== 'builtin'
      && (assessment.runtime_state === 'local_health_ok' || assessment.runtime_state === 'remote_health_ok')
    )
      ? await fetchOpenAICompatibleModelIds(
        parsed.data.base_url || '',
        parsed.data.api_key,
        undefined,
        assessment.local_endpoint ? 1200 : 3000
      )
      : []
    const modelForChatProbe = parsed.data.model?.trim() || (availableModels.length === 1 ? availableModels[0] : '')
    const chatProbeTimeoutMs = clampProbeTimeout(parsed.data.timeout_ms, Boolean(assessment.local_endpoint))
    const chatProbe = (
      parsed.data.provider_kind !== 'builtin'
      && (assessment.runtime_state === 'local_health_ok' || assessment.runtime_state === 'remote_health_ok')
    )
      ? await probeOpenAICompatibleChatCompletion(
        parsed.data.base_url || '',
        parsed.data.api_key,
        modelForChatProbe,
        undefined,
        chatProbeTimeoutMs
      )
      : null
    const finalAssessment = chatProbe && !chatProbe.ok
      ? {
        ...assessment,
        runtime_state: assessment.local_endpoint ? 'local_generation_failed' as const : 'remote_generation_failed' as const,
        runtime_reason: `模型列表接口可达，但最小生成测试失败：${chatProbe.error || '未知错误'}`,
        runtime_action: modelForChatProbe
          ? assessment.local_endpoint
            ? '请确认 LM Studio 已加载对应模型、机器性能足够、模型未在忙碌队列中；最小生成通过前只能标记为本地服务可达，不能标记为本地模型可用。'
            : '请检查模型 ID、Token 权限、网关兼容性和供应商限流；只有最小生成通过后才能保存为可用模型。'
          : '请先选择或填写一个模型 ID，再重新测试连接。',
      }
      : chatProbe?.ok
        ? {
          ...assessment,
          runtime_reason: `${assessment.runtime_reason} 最小生成测试通过：${chatProbe.model} / ${chatProbe.latency_ms}ms。`,
        }
        : assessment

    return successResponse({
      ...finalAssessment,
      probe_scope: 'explicit_http_health_and_generation_check',
      available_models: availableModels,
      chat_probe: chatProbe,
      credential_checked: parsed.data.provider_kind === 'builtin'
        ? 'not_required'
        : parsed.data.api_key
          ? 'provided'
          : 'missing',
    })
  })
}

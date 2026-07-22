import { NextRequest } from 'next/server'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { getAIProviderRuntimeSignature, probeAIProvider } from '@/lib/ai/provider-probe'
import { recordModelInvocation } from '@/lib/ai/model-invocations'
import { supabaseAdmin } from '@/lib/supabase'
import { mergeStoredAIConfigValue } from '@/lib/configs/runtime'
import { aiProviderConfigValueSchema } from '@/lib/configs/validation'
import type { AuthUser } from '@/lib/auth'
import { getAIProviderInstanceId, type AIConfigValue } from '@/lib/configs/types'

export const preferredRegion = 'sin1'

interface StoredAIConfig {
  id: string
  key: string
  name: string
  value: Record<string, unknown> | null
  type: string
  status: string
}

export async function POST(req: NextRequest) {
  return withAuthAndOrg(req, async (_user: AuthUser, orgId: string) => {
    const body = await req.json().catch(() => null)
    const value = body?.value || body?.config?.value || body
    const parsed = aiProviderConfigValueSchema.safeParse(value)

    if (!parsed.success) {
      return errorResponse(createApiError(
        'VALIDATION_ERROR',
        `AI 配置草稿无效: ${parsed.error.issues.map((issue) => issue.message).join(', ')}`
      ))
    }

    let probeValue: AIConfigValue = parsed.data
    let storedConfig: StoredAIConfig | null = null
    if (typeof body?.config_id === 'string' && body.config_id) {
      const { data } = await supabaseAdmin
        .from('configs')
        .select('id, key, name, value, type, status')
        .eq('id', body.config_id)
        .eq('org_id', orgId)
        .maybeSingle()

      storedConfig = data as StoredAIConfig | null
      if (storedConfig?.type === 'AI_CONFIG') {
        probeValue = mergeStoredAIConfigValue(
          storedConfig.value as Record<string, unknown> | null,
          parsed.data as unknown as Record<string, unknown>
        ) as unknown as AIConfigValue
      }
    }

    const result = await probeAIProvider(probeValue)
    const runtimeSignature = getAIProviderRuntimeSignature(probeValue)
    const storedValue = storedConfig?.value && storedConfig.type === 'AI_CONFIG'
      ? storedConfig.value as unknown as AIConfigValue
      : null
    const publishedConfig = storedConfig?.status === 'PUBLISHED'
      && storedValue !== null
      && getAIProviderRuntimeSignature(storedValue) === runtimeSignature
    const isRuleEngine = probeValue.provider_kind === 'builtin'
      || probeValue.provider_kind === 'rule_engine'
      || result.model === 'rule-engine'

    const evidenceSaved = await recordModelInvocation({
      orgId,
      phase: 'provider_inference_probe',
      providerKey: getAIProviderInstanceId(probeValue, storedConfig?.key)
        || `draft:${probeValue.provider_kind || 'provider'}`,
      providerKind: result.provider_kind,
      providerName: storedConfig?.name || probeValue.name,
      model: result.model,
      status: isRuleEngine ? 'skipped' : result.ok ? 'succeeded' : 'failed',
      degraded: isRuleEngine,
      usage: result.usage ? {
        inputTokens: result.usage.prompt_tokens,
        outputTokens: result.usage.completion_tokens,
        totalTokens: result.usage.total_tokens,
      } : undefined,
      latencyMs: result.latency_ms,
      error: isRuleEngine ? 'deterministic_rule_engine_not_ai' : result.error,
      metadata: {
        probe_mode: isRuleEngine ? 'deterministic_fallback_check' : 'inference',
        config_id: storedConfig?.id || null,
        config_key: storedConfig?.key || null,
        provider_instance_id: getAIProviderInstanceId(probeValue, storedConfig?.key) || null,
        config_status: storedConfig?.status || 'DRAFT',
        published_config: publishedConfig,
        runtime_signature: runtimeSignature,
        api_format: result.api_format,
        base_url: result.base_url,
      },
    })

    return successResponse({
      ...result,
      evidence_saved: evidenceSaved,
      runtime_config_match: publishedConfig,
      evidence_note: isRuleEngine
        ? (publishedConfig
          ? '本次规则兜底检查已绑定当前发布配置；只证明确定性兜底可用，不代表 AI 推理成功。'
          : '本次规则兜底检查仅针对表单草稿；保存并发布相同配置后需要重新检查。')
        : (publishedConfig
          ? '本次推理测试已绑定当前发布配置，可用于运行状态判断。'
          : '本次测试仅针对表单草稿；保存并发布相同配置后需要重新测试。'),
    })
  })
}

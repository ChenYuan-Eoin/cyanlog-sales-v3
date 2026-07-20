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
import { userHasFreshOrgConfigAccess } from '@/lib/configs/access'
import { redactSecretsDeep } from '@/lib/configs/secret-redaction'
import { supabaseAdmin } from '@/lib/supabase'
import {
  isMaskedApiKey,
  providerCredentialBindingMatches,
} from '@/lib/configs/runtime'
import { isProviderCredentialValue } from '@/lib/configs/ai-platform'
import {
  createSafeProviderProbeTransport,
  type SafeProviderProbeTransport,
} from '@/lib/configs/provider-endpoint.server'
import { UnsafeProviderEndpointError } from '@/lib/configs/provider-endpoint'
import { getFreshDefaultOrgId } from '@/lib/scoped-access'

const probeSchema = z.object({
  provider_kind: z.enum(['openai_compatible', 'builtin']).default('openai_compatible'),
  base_url: z.string().trim().optional(),
  api_key: z.string().min(4).or(z.literal('')).optional(),
  auth_mode: z.enum(['none', 'bearer']).optional(),
  runtime_location: z.enum(['local', 'cloud']).optional(),
  model: z.string().trim().optional(),
  timeout_ms: z.number().int().min(1000).max(300000).optional(),
  config_id: z.string().trim().min(1).optional(),
  probe_mode: z.enum(['connection', 'model']).default('connection'),
}).superRefine((value, ctx) => {
  if (value.provider_kind === 'openai_compatible') {
    if (!value.base_url) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['base_url'], message: '必须填写 Provider 地址' })
    }
    if (!value.runtime_location) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['runtime_location'], message: '必须声明本地或云端位置' })
    }
    if (!value.auth_mode) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['auth_mode'], message: '必须声明认证方式' })
    }
    if (value.auth_mode === 'none' && value.api_key) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['api_key'], message: '免认证连接不能携带 Token' })
    }
  }
})

function clampProbeTimeout(timeoutMs: number | undefined, localEndpoint: boolean): number {
  const fallback = localEndpoint ? 15000 : 20000
  const lowerBound = localEndpoint ? 15000 : 8000
  const upperBound = localEndpoint ? 120000 : 60000
  const candidate = typeof timeoutMs === 'number' ? timeoutMs : fallback
  return Math.min(upperBound, Math.max(lowerBound, candidate))
}

function runtimeProbeEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: process.env.NODE_ENV,
    VERCEL: process.env.VERCEL,
    VERCEL_URL: process.env.VERCEL_URL,
    VERCEL_REGION: process.env.VERCEL_REGION,
    VERCEL_ENV: process.env.VERCEL_ENV,
  }
}

export async function POST(req: NextRequest) {
  return withAuthAndOrg(req, async (user: AuthUser, _cachedOrgId: string) => {
    const orgId = await getFreshDefaultOrgId(user.id).catch(() => null)
    if (!orgId) {
      return errorResponse(createApiError('NO_ORG'))
    }
    if (!await userHasFreshOrgConfigAccess(user.id, orgId, 'write')) {
      return errorResponse(createApiError('FORBIDDEN'))
    }

    const body = await req.json().catch(() => null)
    const parsed = probeSchema.safeParse(body)

    if (!parsed.success) {
      return errorResponse(createApiError(
        'VALIDATION_ERROR',
        `模型探测参数无效: ${parsed.error.issues.map((issue) => issue.message).join(', ')}`
      ))
    }

    const authMode = parsed.data.auth_mode || 'none'
    let effectiveApiKey = parsed.data.api_key && !isMaskedApiKey(parsed.data.api_key)
      ? parsed.data.api_key
      : undefined
    let credentialSource: 'provided' | 'stored' | 'missing' | 'not_required' = effectiveApiKey
      ? 'provided'
      : 'missing'

    if (parsed.data.provider_kind === 'builtin' || authMode === 'none') {
      effectiveApiKey = undefined
      credentialSource = 'not_required'
    } else if (!effectiveApiKey && parsed.data.config_id) {
      const { data: storedConfig, error: storedConfigError } = await supabaseAdmin
        .from('configs')
        .select('value, status')
        .eq('id', parsed.data.config_id)
        .eq('org_id', orgId)
        .eq('type', 'AI_CONFIG')
        .in('status', ['DRAFT', 'PUBLISHED'])
        .single()
      const storedValue = storedConfig?.value && typeof storedConfig.value === 'object'
        ? storedConfig.value as Record<string, unknown>
        : null
      const reusableStatus = storedConfig?.status === 'DRAFT' || storedConfig?.status === 'PUBLISHED'
      const sameConnection = storedValue !== null
        && reusableStatus
        && isProviderCredentialValue(storedValue)
        && providerCredentialBindingMatches(storedValue, {
          kind: 'provider_connection',
          provider_type: parsed.data.provider_kind,
          runtime_location: parsed.data.runtime_location,
          auth_mode: authMode,
          base_url: parsed.data.base_url,
        })
      if (storedConfigError || !sameConnection) {
        return errorResponse(createApiError(
          'VALIDATION_ERROR',
          '用于探测的 Provider 必须是同一连接的草稿或当前已发布版本；已归档版本不可作为凭据来源',
        ))
      }
      if (
        !effectiveApiKey
        && typeof storedValue?.api_key === 'string'
        && storedValue.api_key.length > 0
        && !isMaskedApiKey(storedValue.api_key)
      ) {
        effectiveApiKey = storedValue.api_key
        credentialSource = 'stored'
      }
    }

    let transport: SafeProviderProbeTransport | null = null
    if (parsed.data.provider_kind === 'openai_compatible') {
      try {
        transport = await createSafeProviderProbeTransport(
          parsed.data.base_url || '',
          parsed.data.runtime_location as 'local' | 'cloud',
        )
      } catch (error) {
        const message = error instanceof UnsafeProviderEndpointError
          ? error.message
          : 'Provider 地址安全校验失败'
        return errorResponse(createApiError('VALIDATION_ERROR', message))
      }
    }

    try {
      const effectiveBaseUrl = transport?.baseUrl || parsed.data.base_url
      const fetchImpl = transport?.fetch || fetch
      const probeTimeoutMs = clampProbeTimeout(
        parsed.data.timeout_ms,
        parsed.data.runtime_location === 'local',
      )
      const assessment = await assessProviderRuntime({
        providerKind: parsed.data.provider_kind,
        baseUrl: effectiveBaseUrl,
        apiKey: effectiveApiKey,
        authMode,
        model: parsed.data.model,
        allowLocalCliFallback: false,
        checkRemoteHealth: true,
        healthCheckTimeoutMs: probeTimeoutMs,
      }, runtimeProbeEnvironment(), fetchImpl)

      const availableModels = (
        parsed.data.provider_kind !== 'builtin'
        && (assessment.runtime_state === 'local_health_ok' || assessment.runtime_state === 'remote_health_ok')
      )
        ? await fetchOpenAICompatibleModelIds(
          effectiveBaseUrl || '',
          effectiveApiKey,
          fetchImpl,
          probeTimeoutMs
        )
        : []
      const modelForChatProbe = parsed.data.model?.trim() || (availableModels.length === 1 ? availableModels[0] : '')
      const chatProbe = (
        parsed.data.probe_mode === 'model'
        && modelForChatProbe.length > 0
        && parsed.data.provider_kind !== 'builtin'
        && (assessment.runtime_state === 'local_health_ok' || assessment.runtime_state === 'remote_health_ok')
      )
        ? await probeOpenAICompatibleChatCompletion(
          effectiveBaseUrl || '',
          effectiveApiKey,
          modelForChatProbe,
          fetchImpl,
          probeTimeoutMs
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

      return successResponse(redactSecretsDeep({
        ...finalAssessment,
        probe_scope: parsed.data.probe_mode === 'model'
          ? 'draft_model_health_and_generation_check'
          : 'draft_provider_connection_check',
        available_models: availableModels,
        chat_probe: chatProbe,
        credential_checked: credentialSource,
      }, [effectiveApiKey, parsed.data.api_key]))
    } finally {
      await transport?.close().catch(() => undefined)
    }
  })
}

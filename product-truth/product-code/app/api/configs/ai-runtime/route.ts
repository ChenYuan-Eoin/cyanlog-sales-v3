// REQ: F012
// PURPOSE: Read the published contract-review AI runtime policy used by F006.

import { NextRequest } from 'next/server'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import { successResponse, errorResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { listPublishedAIProviders } from '@/lib/configs/runtime'
import { resolvePublishedModelPolicy } from '@/lib/contracts/model-policy'
import type { AuthUser } from '@/lib/auth'
import type { PublishedAIProviderConfig } from '@/lib/configs/runtime'
import { assessProviderRuntime, type AIRuntimeAssessment } from '@/lib/configs/ai-runtime-readiness'

export async function GET(req: NextRequest) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    try {
      const policy = await resolvePublishedModelPolicy(orgId, user.id)
      const providerConfigs = await listPublishedAIProviders(orgId)
      const providerConfigById = new Map(providerConfigs.map((config) => [config.config_id, config]))
      const runtimeAssessments = new Map<string, AIRuntimeAssessment>()

      await Promise.all(policy.provider_chain.map(async (provider) => {
        const providerConfig: PublishedAIProviderConfig | null = provider.source_config_id
          ? providerConfigById.get(provider.source_config_id) || null
          : null
        runtimeAssessments.set(`${provider.level}:${provider.profile}:${provider.model}`, await assessProviderRuntime({
          providerKind: provider.provider_kind,
          baseUrl: providerConfig?.base_url,
          apiKey: providerConfig?.api_key,
        }))
      }))

      return successResponse({
        id: policy.id,
        key: policy.key,
        name: policy.name,
        version: policy.version,
        status: policy.status,
        is_current: policy.is_current,
        timeout_ms: policy.timeout_ms,
        routing_policy: policy.routing_policy,
        fallback_policy: policy.fallback_policy,
        audit_policy: policy.audit_policy,
        provider_chain: policy.provider_chain.map((provider) => {
          const providerConfig = provider.source_config_id
            ? providerConfigById.get(provider.source_config_id)
            : null

          return {
            profile: provider.profile,
            provider_kind: provider.provider_kind,
            provider: provider.provider,
            model: provider.model,
            level: provider.level,
            timeout_ms: provider.timeout_ms,
            stages: provider.stages,
            role: provider.role,
            capabilities: provider.capabilities,
            data_boundary: provider.data_boundary,
            health_check_required: provider.health_check_required,
            source_config_id: provider.source_config_id,
            base_url_configured: provider.provider_kind === 'builtin'
              ? true
              : Boolean(providerConfig?.base_url),
            credential_state: provider.provider_kind === 'builtin'
              ? 'not_required'
              : providerConfig?.api_key
                ? 'configured'
                : 'missing',
            ...runtimeAssessments.get(`${provider.level}:${provider.profile}:${provider.model}`),
          }
        }),
        source_config_ids: policy.source_config_ids,
        published_at: policy.published_at,
      })
    } catch (error) {
      console.error('[AI runtime policy] failed:', error)
      return errorResponse(createApiError('DB_ERROR', '读取 AI 运行时策略失败'))
    }
  })
}

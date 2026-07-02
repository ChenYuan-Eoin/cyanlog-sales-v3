// REQ: F012
// PURPOSE: Read the published contract-review AI runtime policy used by F006.

import { NextRequest } from 'next/server'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import { successResponse, errorResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { listPublishedAIProviders } from '@/lib/configs/runtime'
import { resolvePublishedModelPolicy } from '@/lib/contracts/model-policy'
import { supabaseAdmin } from '@/lib/supabase'
import type { AuthUser } from '@/lib/auth'
import type { PublishedAIProviderConfig } from '@/lib/configs/runtime'
import {
  assessProviderRuntime,
  type AIRuntimeAssessment,
  type RuntimeInvocationEvidence,
} from '@/lib/configs/ai-runtime-readiness'

type InvocationRow = RuntimeInvocationEvidence & {
  request_meta?: Record<string, unknown> | null
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function invocationProfiles(invocation: InvocationRow): string[] {
  const requestMeta = recordValue(invocation.request_meta)
  return [
    stringValue(requestMeta.intended_provider_profile),
    stringValue(requestMeta.requested_provider_profile),
    stringValue(invocation.provider),
  ].filter((value): value is string => Boolean(value))
}

function truncateError(value: string | null | undefined): string | null {
  if (!value) return null
  return value.length > 240 ? `${value.slice(0, 240)}...` : value
}

function sanitizeInvocation(invocation: InvocationRow | undefined) {
  if (!invocation) return null
  const responseMeta = recordValue(invocation.response_meta)
  return {
    id: invocation.id,
    provider: invocation.provider || null,
    model: invocation.model || null,
    status: invocation.status || null,
    degraded: Boolean(invocation.degraded),
    fallback_reason: invocation.fallback_reason || null,
    error_message: truncateError(invocation.error_message),
    transport: stringValue(responseMeta.transport),
    provider_kind: stringValue(responseMeta.provider_kind),
    attempt_errors: Array.isArray(responseMeta.attempt_errors)
      ? responseMeta.attempt_errors
        .filter((item): item is string => typeof item === 'string')
        .map(truncateError)
      : [],
    created_at: invocation.created_at || null,
  }
}

async function latestSemanticInvocationsByProfile(orgId: string) {
  return latestInvocationsByProfile(orgId, 'semantic_review')
}

async function latestTenderInvocationsByProfile(orgId: string) {
  return latestInvocationsByProfile(orgId, 'tender_long_document_parse')
}

async function latestInvocationsByProfile(orgId: string, phase: string) {
  const { data, error } = await supabaseAdmin
    .from('model_invocations')
    .select('id, provider, model, status, degraded, fallback_reason, error_message, request_meta, response_meta, created_at')
    .eq('org_id', orgId)
    .eq('phase', phase)
    .order('created_at', { ascending: false })
    .limit(80)

  if (error) throw error

  const latest = new Map<string, InvocationRow>()
  for (const row of (data || []) as InvocationRow[]) {
    for (const profile of invocationProfiles(row)) {
      if (!latest.has(profile)) {
        latest.set(profile, row)
      }
    }
  }
  return latest
}

export async function GET(req: NextRequest) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    try {
      const policy = await resolvePublishedModelPolicy(orgId, user.id)
      const providerConfigs = await listPublishedAIProviders(orgId)
      const providerConfigById = new Map(providerConfigs.map((config) => [config.config_id, config]))
      const latestInvocations = await latestSemanticInvocationsByProfile(orgId)
      const latestTenderInvocations = await latestTenderInvocationsByProfile(orgId)
      const runtimeAssessments = new Map<string, AIRuntimeAssessment>()
      const tenderRuntimeAssessments = new Map<string, AIRuntimeAssessment>()

      await Promise.all(policy.provider_chain.map(async (provider) => {
        const providerConfig: PublishedAIProviderConfig | null = provider.source_config_id
          ? providerConfigById.get(provider.source_config_id) || null
          : null
        const latestInvocation = latestInvocations.get(provider.profile)
        const assessmentKey = `${provider.level}:${provider.profile}:${provider.model}`
        runtimeAssessments.set(assessmentKey, await assessProviderRuntime({
          providerKind: provider.provider_kind,
          baseUrl: providerConfig?.base_url,
          apiKey: providerConfig?.api_key,
          model: provider.model,
          latestInvocation,
        }))
        tenderRuntimeAssessments.set(assessmentKey, await assessProviderRuntime({
          providerKind: provider.provider_kind,
          baseUrl: providerConfig?.base_url,
          apiKey: providerConfig?.api_key,
          model: provider.model,
          latestInvocation: latestTenderInvocations.get(provider.profile),
          phaseLabel: 'tender_long_document_parse',
          readyAction: '上传真实标书或长 PDF，确认 model_invocations 中 tender_long_document_parse 为 completed。',
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
            runtime_location: provider.runtime_location,
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
            latest_invocation: sanitizeInvocation(latestInvocations.get(provider.profile)),
            latest_tender_invocation: sanitizeInvocation(latestTenderInvocations.get(provider.profile)),
            tender_runtime: tenderRuntimeAssessments.get(`${provider.level}:${provider.profile}:${provider.model}`),
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

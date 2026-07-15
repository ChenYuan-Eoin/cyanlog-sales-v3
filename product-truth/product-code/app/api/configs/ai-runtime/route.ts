// REQ: F012
// PURPOSE: Read the published contract-review AI runtime policy used by F006.

import { NextRequest } from 'next/server'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import { successResponse, errorResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { listPublishedAIProviders } from '@/lib/configs/runtime'
import {
  getCurrentPublishedModelPolicy,
  validatePublishedModelPolicy,
} from '@/lib/contracts/model-policy'
import { supabaseAdmin } from '@/lib/supabase'
import type { AuthUser } from '@/lib/auth'
import type { PublishedAIProviderConfig } from '@/lib/configs/runtime'
import {
  assessProviderRuntime,
  type AIRuntimeAssessment,
} from '@/lib/configs/ai-runtime-readiness'
import {
  selectRuntimeInvocationEvidence,
  type RuntimeInvocationEvidenceRow,
} from '@/lib/configs/ai-runtime-invocation-evidence'
import {
  buildRuntimeSourceSummary,
  runtimeProviderSourceMeta,
} from '@/lib/configs/ai-runtime-source'
import { userHasOrgConfigAccess } from '@/lib/configs/access'
import { redactSecretsDeep } from '@/lib/configs/secret-redaction'

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function truncateError(value: string | null | undefined): string | null {
  if (!value) return null
  return value.length > 240 ? `${value.slice(0, 240)}...` : value
}

function sanitizeInvocation(invocation: RuntimeInvocationEvidenceRow | null | undefined) {
  if (!invocation) return null
  const requestMeta = recordValue(invocation.request_meta)
  const responseMeta = recordValue(invocation.response_meta)
  return {
    id: invocation.id,
    provider: invocation.provider || null,
    model: invocation.model || null,
    status: invocation.status || null,
    degraded: Boolean(invocation.degraded),
    fallback_reason: invocation.fallback_reason || null,
    error_message: truncateError(invocation.error_message),
    intended_provider_profile: stringValue(requestMeta.intended_provider_profile),
    intended_provider_model: stringValue(requestMeta.intended_provider_model),
    requested_provider_profile: stringValue(requestMeta.requested_provider_profile),
    requested_provider_model: stringValue(requestMeta.requested_provider_model),
    requested_provider_accepted: typeof requestMeta.requested_provider_accepted === 'boolean'
      ? requestMeta.requested_provider_accepted
      : null,
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

async function latestInvocationRowsByPhase(orgId: string, phase: string) {
  const { data, error } = await supabaseAdmin
    .from('model_invocations')
    .select('id, provider, model, status, degraded, fallback_reason, error_message, request_meta, response_meta, created_at')
    .eq('org_id', orgId)
    .eq('phase', phase)
    .order('created_at', { ascending: false })
    .limit(80)

  if (error) throw error

  return (data || []) as RuntimeInvocationEvidenceRow[]
}

export async function GET(req: NextRequest) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    try {
      if (!await userHasOrgConfigAccess(user.id, orgId, 'read')) {
        return errorResponse(createApiError('FORBIDDEN'))
      }

      const providerConfigs = await listPublishedAIProviders(orgId)
      const policy = await getCurrentPublishedModelPolicy(orgId)
      const validation = validatePublishedModelPolicy(policy, providerConfigs)
      if (!policy || !validation.ok) {
        return errorResponse(createApiError(
          'CONFLICT',
          'AI 运行时策略已阻断：当前发布策略不可安全消费，请先显式修复并发布。',
          { reasons: validation.ok ? ['没有当前已发布模型策略'] : validation.reasons },
        ))
      }
      const providerConfigById = new Map(providerConfigs.map((config) => [config.config_id, config]))
      const latestInvocationRows = await latestInvocationRowsByPhase(orgId, 'semantic_review')
      const latestTenderInvocationRows = await latestInvocationRowsByPhase(orgId, 'tender_long_document_parse')
      const runtimeAssessments = new Map<string, AIRuntimeAssessment>()
      const tenderRuntimeAssessments = new Map<string, AIRuntimeAssessment>()
      const semanticEvidence = new Map<string, ReturnType<typeof selectRuntimeInvocationEvidence>>()
      const tenderEvidence = new Map<string, ReturnType<typeof selectRuntimeInvocationEvidence>>()

      await Promise.all(policy.provider_chain.map(async (provider) => {
        const providerConfig: PublishedAIProviderConfig | null = provider.source_config_id
          ? providerConfigById.get(provider.source_config_id) || null
          : null
        const assessmentKey = `${provider.level}:${provider.profile}:${provider.model}`
        const evidenceTarget = {
          profile: provider.profile,
          providerKind: provider.provider_kind,
          provider: provider.provider,
          model: provider.model,
          sourceConfigId: provider.source_config_id,
          sourceConfigKey: providerConfig?.key,
        }
        const providerSemanticEvidence = selectRuntimeInvocationEvidence(latestInvocationRows, evidenceTarget)
        const providerTenderEvidence = selectRuntimeInvocationEvidence(latestTenderInvocationRows, evidenceTarget)
        semanticEvidence.set(assessmentKey, providerSemanticEvidence)
        tenderEvidence.set(assessmentKey, providerTenderEvidence)
        const [runtimeAssessment, tenderRuntimeAssessment] = await Promise.all([
          assessProviderRuntime({
            providerKind: provider.provider_kind,
            baseUrl: providerConfig?.base_url,
            apiKey: providerConfig?.api_key,
            model: provider.model,
            latestInvocation: providerSemanticEvidence.actual || undefined,
            checkRemoteHealth: false,
          }),
          assessProviderRuntime({
            providerKind: provider.provider_kind,
            baseUrl: providerConfig?.base_url,
            apiKey: providerConfig?.api_key,
            model: provider.model,
            latestInvocation: providerTenderEvidence.actual || undefined,
            checkRemoteHealth: false,
            phaseLabel: 'tender_long_document_parse',
            readyAction: '上传真实标书或长 PDF，确认 model_invocations 中 tender_long_document_parse 为 completed。',
          }),
        ])
        runtimeAssessments.set(assessmentKey, runtimeAssessment)
        tenderRuntimeAssessments.set(assessmentKey, tenderRuntimeAssessment)
      }))

      return successResponse(redactSecretsDeep({
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
          const providerSource = runtimeProviderSourceMeta({
            providerKind: provider.provider_kind,
            sourceConfigPresent: Boolean(providerConfig),
          })

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
            source_config_key: providerConfig?.key || null,
            source_kind: providerSource.source_kind,
            source_label: providerSource.source_label,
            base_url_configured: provider.provider_kind === 'builtin'
              ? true
              : Boolean(providerConfig?.base_url),
            credential_state: provider.provider_kind === 'builtin'
              ? 'not_required'
              : providerConfig?.api_key
                ? 'configured'
                : 'missing',
            latest_invocation: sanitizeInvocation(semanticEvidence.get(`${provider.level}:${provider.profile}:${provider.model}`)?.actual),
            latest_intended_invocation: sanitizeInvocation(semanticEvidence.get(`${provider.level}:${provider.profile}:${provider.model}`)?.intended),
            latest_requested_invocation: sanitizeInvocation(semanticEvidence.get(`${provider.level}:${provider.profile}:${provider.model}`)?.requested),
            latest_related_invocation: sanitizeInvocation(semanticEvidence.get(`${provider.level}:${provider.profile}:${provider.model}`)?.related),
            latest_tender_invocation: sanitizeInvocation(tenderEvidence.get(`${provider.level}:${provider.profile}:${provider.model}`)?.actual),
            latest_tender_intended_invocation: sanitizeInvocation(tenderEvidence.get(`${provider.level}:${provider.profile}:${provider.model}`)?.intended),
            latest_tender_requested_invocation: sanitizeInvocation(tenderEvidence.get(`${provider.level}:${provider.profile}:${provider.model}`)?.requested),
            tender_runtime: tenderRuntimeAssessments.get(`${provider.level}:${provider.profile}:${provider.model}`),
            ...runtimeAssessments.get(`${provider.level}:${provider.profile}:${provider.model}`),
          }
        }),
        source_config_ids: policy.source_config_ids,
        source_summary: buildRuntimeSourceSummary(),
        published_at: policy.published_at,
      }, providerConfigs.map((config) => config.api_key)))
    } catch (error) {
      console.error('[AI runtime policy] failed:', error)
      return errorResponse(createApiError('DB_ERROR', '读取 AI 运行时策略失败'))
    }
  })
}

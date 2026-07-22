import { supabaseAdmin } from '@/lib/supabase'

export interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

export interface ModelInvocationRecord {
  orgId?: string
  contractId?: string
  reviewId?: string
  jobId?: string
  skillBundleId?: string
  modelPolicyId?: string
  phase: string
  providerKey: string
  providerKind: string
  providerName?: string
  model?: string
  status: 'started' | 'succeeded' | 'failed' | 'skipped'
  degraded: boolean
  fallbackRank?: number
  usage?: TokenUsage
  latencyMs?: number
  error?: string
  requestId?: string
  metadata?: Record<string, unknown>
  responseMetadata?: Record<string, unknown>
}

export interface StoredModelInvocation {
  id: string
  org_id?: string | null
  contract_id?: string | null
  review_id?: string | null
  skill_bundle_id?: string | null
  model_policy_id?: string | null
  provider: string
  model: string
  phase: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'degraded'
  degraded: boolean
  fallback_reason?: string | null
  latency_ms?: number | null
  request_meta?: Record<string, unknown> | null
  response_meta?: Record<string, unknown> | null
  error_message?: string | null
  started_at?: string | null
  completed_at?: string | null
  created_at: string
}

export interface LatestProviderProbeEvidence {
  providerKey: string
  model: string
  status: 'completed' | 'failed' | 'degraded'
  runtimeSignature?: string
  latencyMs?: number
  usage?: TokenUsage
  error?: string
  checkedAt: string
}

export interface ModelInvocationWriteResult {
  saved: boolean
  id: string | null
  error?: string
}

type UsageRecord = Record<string, unknown>

function numberFromUsage(record: UsageRecord, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
  }
  return undefined
}

export function extractTokenUsage(payload: unknown): TokenUsage | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined
  }

  const record = payload as UsageRecord
  const usage = 'usage' in record && record.usage && typeof record.usage === 'object' && !Array.isArray(record.usage)
    ? record.usage as UsageRecord
    : record

  const inputTokens = numberFromUsage(usage, ['input_tokens', 'prompt_tokens', 'inputTokens', 'promptTokens'])
  const outputTokens = numberFromUsage(usage, ['output_tokens', 'completion_tokens', 'outputTokens', 'completionTokens'])
  const totalTokens = numberFromUsage(usage, ['total_tokens', 'totalTokens'])
    ?? (typeof inputTokens === 'number' && typeof outputTokens === 'number' ? inputTokens + outputTokens : undefined)

  if (
    typeof inputTokens !== 'number'
    && typeof outputTokens !== 'number'
    && typeof totalTokens !== 'number'
  ) {
    return undefined
  }

  return { inputTokens, outputTokens, totalTokens }
}

function mapInvocationStatus(status: ModelInvocationRecord['status']): 'running' | 'completed' | 'failed' | 'degraded' {
  switch (status) {
    case 'started':
      return 'running'
    case 'succeeded':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'skipped':
      return 'degraded'
  }
}

export async function recordModelInvocationWithId(
  record: ModelInvocationRecord,
): Promise<ModelInvocationWriteResult> {
  try {
    const completedAt = record.status === 'started' ? null : new Date().toISOString()
    const { data, error } = await supabaseAdmin.from('model_invocations').insert({
      org_id: record.orgId || null,
      contract_id: record.contractId || null,
      review_id: record.reviewId || null,
      skill_bundle_id: record.skillBundleId || null,
      model_policy_id: record.modelPolicyId || null,
      phase: record.phase,
      provider: record.providerKey || record.providerName || record.providerKind || 'unknown_provider',
      model: record.model || record.providerKind || 'unknown_model',
      status: mapInvocationStatus(record.status),
      degraded: record.degraded || record.status === 'skipped',
      fallback_reason: record.status === 'skipped' ? record.error || 'provider_skipped' : null,
      latency_ms: record.latencyMs ?? null,
      request_meta: {
        provider_key: record.providerKey,
        provider_kind: record.providerKind,
        provider_name: record.providerName || null,
        fallback_rank: record.fallbackRank ?? null,
        request_id: record.requestId || null,
        job_id: record.jobId || null,
        metadata: record.metadata || {},
      },
      response_meta: {
        usage: record.usage || null,
        metadata: record.responseMetadata || {},
      },
      error_message: record.error || null,
      started_at: new Date().toISOString(),
      completed_at: completedAt,
    }).select('id').single()
    if (error) {
      throw error
    }
    const id = data && typeof data.id === 'string' ? data.id : null
    if (!id) throw new Error('model_invocations insert returned no id')
    return { saved: true, id }
  } catch (error) {
    // 证据表不可用不能阻断业务审核，但必须让服务端日志可见。
    console.warn('[model_invocations] failed to record invocation', error)
    return {
      saved: false,
      id: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function recordModelInvocation(record: ModelInvocationRecord): Promise<boolean> {
  return (await recordModelInvocationWithId(record)).saved
}

function probeEvidenceFromInvocation(invocation: StoredModelInvocation): LatestProviderProbeEvidence | null {
  if (invocation.phase !== 'provider_inference_probe') {
    return null
  }

  const requestMeta = invocation.request_meta || {}
  const metadata = requestMeta.metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null
  }

  const probeMetadata = metadata as Record<string, unknown>
  if (probeMetadata.published_config !== true) {
    return null
  }

  const usage = extractTokenUsage(invocation.response_meta || undefined)
  const runtimeSignature = typeof probeMetadata.runtime_signature === 'string'
    ? probeMetadata.runtime_signature
    : undefined

  if (!['completed', 'failed', 'degraded'].includes(invocation.status)) {
    return null
  }

  return {
    providerKey: invocation.provider,
    model: invocation.model,
    status: invocation.status as LatestProviderProbeEvidence['status'],
    runtimeSignature,
    latencyMs: invocation.latency_ms ?? undefined,
    usage,
    error: invocation.error_message || invocation.fallback_reason || undefined,
    checkedAt: invocation.completed_at || invocation.created_at,
  }
}

export function latestProviderProbeEvidence(
  invocations: StoredModelInvocation[]
): Map<string, LatestProviderProbeEvidence> {
  const evidence = new Map<string, LatestProviderProbeEvidence>()
  for (const invocation of invocations) {
    const item = probeEvidenceFromInvocation(invocation)
    if (item && !evidence.has(item.providerKey)) {
      evidence.set(item.providerKey, item)
    }
  }
  return evidence
}

export async function listLatestProviderProbeEvidence(
  orgId: string,
  limit = 100
): Promise<Map<string, LatestProviderProbeEvidence>> {
  try {
    const { data, error } = await supabaseAdmin
      .from('model_invocations')
      .select('*')
      .eq('org_id', orgId)
      .eq('phase', 'provider_inference_probe')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      throw error
    }

    return latestProviderProbeEvidence((data || []) as StoredModelInvocation[])
  } catch (error) {
    console.warn('[model_invocations] failed to list provider probe evidence', error)
    return new Map()
  }
}

export async function listModelInvocationsForContract(options: {
  contractId: string
  reviewId?: string
  limit?: number
}): Promise<StoredModelInvocation[]> {
  const limit = options.limit ?? 20

  async function runQuery(scope: 'review' | 'contract') {
    let query = supabaseAdmin
      .from('model_invocations')
      .select('*')
      .eq('contract_id', options.contractId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (scope === 'review' && options.reviewId) {
      query = query.eq('review_id', options.reviewId)
    }

    const { data, error } = await query
    if (error) {
      throw error
    }
    return (data || []) as StoredModelInvocation[]
  }

  try {
    if (options.reviewId) {
      const reviewScoped = await runQuery('review')
      if (reviewScoped.length > 0) {
        return reviewScoped
      }
    }

    return await runQuery('contract')
  } catch (error) {
    console.warn('[model_invocations] failed to list invocation evidence', error)
    return []
  }
}

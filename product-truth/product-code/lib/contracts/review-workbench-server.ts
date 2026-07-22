import 'server-only'

import { supabaseAdmin } from '@/lib/supabase'
import {
  normalizePublishedReviewRuleSnapshot,
  resolveReviewBundleExecutionContract,
  type PublishedReviewRule,
  type ReviewBundleExecutionContract,
} from './review-workbench'

export interface PublishedReviewBundle {
  id: string
  version: number
  published_at: string | null
  rule_snapshot_ids: string[]
  rule_set_snapshot_ids: string[]
  model_policy_id: string | null
  model_policy: PublishedReviewModelPolicy | null
  output_schema: Record<string, unknown>
  release_meta: Record<string, unknown>
  execution_contract: ReviewBundleExecutionContract
  rules: PublishedReviewRule[]
}

export interface PublishedReviewModelPolicyProvider {
  role: string | null
  level: number | null
  profile: string | null
  model: string
  provider_kind: string | null
  source_config_id: string | null
  timeout_ms: number | null
  stages: string[]
}

export interface PublishedReviewModelPolicy {
  id: string
  version: number
  timeout_ms: number | null
  provider_chain: PublishedReviewModelPolicyProvider[]
  source_config_ids: string[]
}

interface PublishedReviewBundleRow {
  id: string
  version: number
  published_at: string | null
  rule_snapshot_ids: string[] | null
  rule_set_snapshot_ids: string[] | null
  model_policy_id: string | null
  output_schema: unknown
  release_meta: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

async function hydrateReviewBundle(bundle: PublishedReviewBundleRow): Promise<PublishedReviewBundle> {
  const executionContract = resolveReviewBundleExecutionContract({
    output_schema: bundle.output_schema,
    release_meta: bundle.release_meta,
  })
  if (!executionContract) {
    throw new Error(`Review bundle ${bundle.id} has an invalid candidate output contract`)
  }
  const snapshotIds = Array.isArray(bundle.rule_snapshot_ids) ? bundle.rule_snapshot_ids : []
  const { data: snapshots, error: snapshotError } = snapshotIds.length > 0
    ? await supabaseAdmin
      .from('contract_rule_snapshots')
      .select('id,version,config_snapshot')
      .in('id', snapshotIds)
    : { data: [], error: null }

  if (snapshotError) throw snapshotError

  const { data: modelPolicy, error: modelPolicyError } = bundle.model_policy_id
    ? await supabaseAdmin
      .from('model_policies')
      .select('id,version,status,timeout_ms,provider_chain,source_config_ids')
      .eq('id', bundle.model_policy_id)
      .eq('status', 'published')
      .maybeSingle()
    : { data: null, error: null }

  if (modelPolicyError) throw modelPolicyError

  const normalizedModelPolicy = modelPolicy ? {
    id: modelPolicy.id,
    version: modelPolicy.version,
    timeout_ms: typeof modelPolicy.timeout_ms === 'number' ? modelPolicy.timeout_ms : null,
    provider_chain: (Array.isArray(modelPolicy.provider_chain) ? modelPolicy.provider_chain : [])
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
      .map((entry) => ({
        role: typeof entry.role === 'string' ? entry.role : null,
        level: typeof entry.level === 'number' ? entry.level : null,
        profile: typeof entry.profile === 'string' ? entry.profile : null,
        model: typeof entry.model === 'string' ? entry.model : '',
        provider_kind: typeof entry.provider_kind === 'string' ? entry.provider_kind : null,
        source_config_id: typeof entry.source_config_id === 'string' ? entry.source_config_id : null,
        timeout_ms: typeof entry.timeout_ms === 'number' ? entry.timeout_ms : null,
        stages: Array.isArray(entry.stages)
          ? entry.stages.filter((stage): stage is string => typeof stage === 'string')
          : [],
      }))
      .filter((entry) => entry.model),
    source_config_ids: Array.isArray(modelPolicy.source_config_ids)
      ? modelPolicy.source_config_ids.filter((id): id is string => typeof id === 'string')
      : [],
  } satisfies PublishedReviewModelPolicy : null

  const rules = (snapshots || []).map((snapshot) => normalizePublishedReviewRuleSnapshot({
    snapshot_id: snapshot.id,
    version: snapshot.version,
    config_snapshot: snapshot.config_snapshot,
    execution_contract: executionContract,
  })).filter((rule): rule is NonNullable<typeof rule> => Boolean(rule))

  return {
    id: bundle.id,
    version: bundle.version,
    published_at: bundle.published_at,
    rule_snapshot_ids: snapshotIds,
    rule_set_snapshot_ids: Array.isArray(bundle.rule_set_snapshot_ids) ? bundle.rule_set_snapshot_ids : [],
    model_policy_id: bundle.model_policy_id,
    model_policy: normalizedModelPolicy,
    output_schema: isRecord(bundle.output_schema) ? bundle.output_schema : {},
    release_meta: isRecord(bundle.release_meta) ? bundle.release_meta : {},
    execution_contract: executionContract,
    rules,
  }
}

export async function loadPublishedReviewBundle(orgId: string): Promise<PublishedReviewBundle | null> {
  const { data: bundle, error: bundleError } = await supabaseAdmin
    .from('contract_skill_bundles')
    .select('id,version,published_at,rule_snapshot_ids,rule_set_snapshot_ids,model_policy_id,output_schema,release_meta')
    .eq('org_id', orgId)
    .eq('key', 'CONTRACT_REVIEW_DEFAULT')
    .eq('status', 'published')
    .eq('is_current', true)
    .maybeSingle()

  if (bundleError) throw bundleError
  if (!bundle) return null
  return hydrateReviewBundle(bundle as PublishedReviewBundleRow)
}

export async function loadReviewBundleSnapshot(
  orgId: string,
  bundleId: string,
  bundleVersion: number
): Promise<PublishedReviewBundle | null> {
  const { data: bundle, error: bundleError } = await supabaseAdmin
    .from('contract_skill_bundles')
    .select('id,version,published_at,rule_snapshot_ids,rule_set_snapshot_ids,model_policy_id,output_schema,release_meta')
    .eq('id', bundleId)
    .eq('org_id', orgId)
    .eq('key', 'CONTRACT_REVIEW_DEFAULT')
    .eq('status', 'published')
    .eq('version', bundleVersion)
    .maybeSingle()

  if (bundleError) throw bundleError
  return bundle ? hydrateReviewBundle(bundle as PublishedReviewBundleRow) : null
}

/**
 * Explicit Preview candidate lookup. Missing or malformed candidates return
 * null/throw; this path never falls back to the current release bundle.
 */
export async function loadPreviewCandidateReviewBundle(
  orgId: string,
): Promise<PublishedReviewBundle | null> {
  const { data: channel, error: channelError } = await supabaseAdmin
    .from('contract_skill_bundle_channels')
    .select('bundle_id,bundle_version')
    .eq('org_id', orgId)
    .eq('key', 'CONTRACT_REVIEW_DEFAULT')
    .eq('channel', 'preview_candidate')
    .maybeSingle()
  if (channelError) throw channelError
  if (!channel) return null

  const bundle = await loadReviewBundleSnapshot(orgId, channel.bundle_id, channel.bundle_version)
  if (!bundle || bundle.execution_contract !== 'facts_v1') {
    throw new Error('Preview candidate channel does not resolve to a facts_v1 bundle')
  }
  return bundle
}

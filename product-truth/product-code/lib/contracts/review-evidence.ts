type ReviewStatus = string | null | undefined

export type ReviewEvidenceReview = {
  id: string
  status?: ReviewStatus
  rule_version?: number | null
  skill_bundle_id?: string | null
  model_policy_id?: string | null
  rule_snapshot_ids?: string[] | null
  model_invocation_ids?: string[] | null
  review_trigger?: string | null
  created_at?: string | null
  completed_at?: string | null
}

export type ReviewEvidenceVersion = {
  id: string
} | null

export type ReviewEvidenceJob = {
  id?: string
  status?: ReviewStatus
  provider?: string | null
  degraded?: boolean | null
  last_error?: string | null
  started_at?: string | null
  completed_at?: string | null
} | null

export type ReviewEvidenceRisk = {
  rule_id?: string | null
  rule_code?: string | null
  rule_version?: number | null
}

export type ReviewEvidenceRule = {
  id: string
  code?: string | null
  version?: number | null
  engine_type?: string | null
  target_field?: string | null
  clause_category?: string | null
  published_at?: string | null
  updated_at?: string | null
}

export type ReviewEvidenceSnapshot = {
  id: string
  rule_id: string
  version?: number | null
  status?: string | null
  released_at?: string | null
  created_at?: string | null
  config_snapshot?: unknown
}

export type ReviewEvidenceSkillBundle = {
  id: string
  version?: number | null
  rule_snapshot_ids?: string[] | null
  template_snapshot_ids?: string[] | null
  model_policy_id?: string | null
  compiled_hash?: string | null
  status?: string | null
  published_at?: string | null
} | null

export type ReviewEvidenceModelPolicy = {
  id: string
  version?: number | null
  provider_chain?: unknown
  status?: string | null
  published_at?: string | null
} | null

export type ReviewEvidenceModelInvocation = {
  id: string
  provider?: string | null
  model?: string | null
  phase?: string | null
  status?: string | null
  degraded?: boolean | null
  fallback_reason?: string | null
  error_message?: string | null
  created_at?: string | null
}

export type RuleSnapshotRef = {
  id: string
  rule_id: string
  rule_code: string | null
  version: number | null
  engine_type: string | null
  released_at: string | null
  source: 'published_snapshot'
}

export type ReviewRunEvidenceStatus =
  | 'snapshot_bound'
  | 'partial_snapshot'
  | 'missing_snapshot'

export type ReviewRunEvidence = {
  id: string
  status: string
  contract_version_id: string | null
  skill_bundle_id: string
  rule_snapshot_id: string
  model_policy_id: string
  model_invocation_ids: string[]
  started_at: string | null
  completed_at: string | null
  evidence_status: ReviewRunEvidenceStatus
  rule_snapshot_refs: RuleSnapshotRef[]
  model_policy: {
    id: string
    provider: string
    source: 'model_policies' | 'analysis_job.provider' | 'fallback'
    model?: string | null
    degraded: boolean
    status: string | null
    last_error: string | null
    invocation_id?: string | null
    fallback_reason?: string | null
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function extractSnapshotCode(snapshot: ReviewEvidenceSnapshot): string | null {
  const record = asRecord(snapshot.config_snapshot)
  return stringValue(record?.code)
}

function extractSnapshotEngineType(snapshot: ReviewEvidenceSnapshot): string | null {
  const record = asRecord(snapshot.config_snapshot)
  return stringValue(record?.engine_type)
}

function snapshotReleasedAt(snapshot: ReviewEvidenceSnapshot): string | null {
  return snapshot.released_at || snapshot.created_at || null
}

function findSnapshotForRule(
  rule: ReviewEvidenceRule,
  snapshots: ReviewEvidenceSnapshot[]
): ReviewEvidenceSnapshot | null {
  const sameRule = snapshots.filter((snapshot) => snapshot.rule_id === rule.id)
  if (sameRule.length === 0) return null

  const ruleVersion = rule.version ?? null
  if (ruleVersion !== null) {
    const exact = sameRule.find((snapshot) => (snapshot.version ?? null) === ruleVersion)
    if (exact) return exact
  }

  return sameRule[0]
}

function formatRuleSet(refs: RuleSnapshotRef[]): string {
  if (refs.length === 0) return 'missing'
  const codes = refs
    .map((ref) => `${ref.rule_code || ref.rule_id.slice(0, 8)}@${ref.version ?? 'x'}`)
    .sort()
  if (codes.length <= 4) return codes.join(',')
  return `${codes.slice(0, 4).join(',')}+${codes.length - 4}`
}

function summarizeRuleSnapshotId(refs: RuleSnapshotRef[]): string {
  if (refs.length === 0) return 'contract_rule_snapshots:missing'
  if (refs.length === 1) {
    const ref = refs[0]
    return `contract_rule_snapshots:${ref.id}:v${ref.version ?? 'x'}`
  }
  return `contract_rule_snapshots:published:${refs.length}`
}

function summarizeBoundRuleSnapshotId(snapshotIds: string[] | null | undefined, refs: RuleSnapshotRef[]): string {
  if (snapshotIds && snapshotIds.length > 0) {
    return snapshotIds.length === 1
      ? `contract_rule_snapshots:${snapshotIds[0]}`
      : `contract_rule_snapshots:bound:${snapshotIds.length}`
  }
  return summarizeRuleSnapshotId(refs)
}

function buildSnapshotRefs(
  rules: ReviewEvidenceRule[],
  snapshots: ReviewEvidenceSnapshot[]
): RuleSnapshotRef[] {
  return rules
    .map((rule) => {
      const snapshot = findSnapshotForRule(rule, snapshots)
      if (!snapshot) return null
      return {
        id: snapshot.id,
        rule_id: rule.id,
        rule_code: rule.code || extractSnapshotCode(snapshot),
        version: snapshot.version ?? rule.version ?? numberValue(asRecord(snapshot.config_snapshot)?.version),
        engine_type: rule.engine_type || extractSnapshotEngineType(snapshot),
        released_at: snapshotReleasedAt(snapshot),
        source: 'published_snapshot' as const,
      }
    })
    .filter((ref): ref is RuleSnapshotRef => Boolean(ref))
}

function filterRefsByBoundSnapshots(refs: RuleSnapshotRef[], snapshotIds: string[] | null | undefined): RuleSnapshotRef[] {
  if (!snapshotIds || snapshotIds.length === 0) return refs
  const bound = new Set(snapshotIds)
  return refs.filter((ref) => bound.has(ref.id))
}

function firstProviderFromPolicy(modelPolicy: ReviewEvidenceModelPolicy): { provider: string; model: string | null } | null {
  if (!modelPolicy || !Array.isArray(modelPolicy.provider_chain)) return null
  const first = modelPolicy.provider_chain.find((provider) => (
    provider && typeof provider === 'object'
  )) as Record<string, unknown> | undefined
  if (!first) return null
  return {
    provider: typeof first.provider === 'string' ? first.provider : 'model-policy',
    model: typeof first.model === 'string' ? first.model : null,
  }
}

function representativeInvocation(
  modelInvocations: ReviewEvidenceModelInvocation[]
): ReviewEvidenceModelInvocation | null {
  return modelInvocations.find((invocation) => invocation.phase === 'semantic_review')
    || modelInvocations.find((invocation) => invocation.degraded || invocation.status === 'failed')
    || modelInvocations[0]
    || null
}

function evidenceStatus(
  risks: ReviewEvidenceRisk[],
  refs: RuleSnapshotRef[]
): ReviewRunEvidenceStatus {
  if (refs.length === 0) return 'missing_snapshot'

  const riskRuleIds = Array.from(new Set(
    risks
      .map((risk) => risk.rule_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
  ))

  if (riskRuleIds.length === 0) return 'snapshot_bound'

  const covered = new Set(refs.map((ref) => ref.rule_id))
  return riskRuleIds.every((id) => covered.has(id)) ? 'snapshot_bound' : 'partial_snapshot'
}

export function buildReviewRunEvidence(input: {
  latestReview: ReviewEvidenceReview | null
  latestJob: ReviewEvidenceJob
  currentVersion: ReviewEvidenceVersion
  risks: ReviewEvidenceRisk[]
  rules: ReviewEvidenceRule[]
  snapshots: ReviewEvidenceSnapshot[]
  skillBundle?: ReviewEvidenceSkillBundle
  modelPolicy?: ReviewEvidenceModelPolicy
  modelInvocations?: ReviewEvidenceModelInvocation[]
}): ReviewRunEvidence | null {
  const {
    latestReview,
    latestJob,
    currentVersion,
    risks,
    rules,
    snapshots,
    skillBundle,
    modelPolicy,
    modelInvocations = [],
  } = input
  if (!latestReview) return null

  const boundSnapshotIds = latestReview.rule_snapshot_ids || skillBundle?.rule_snapshot_ids || null
  const refs = filterRefsByBoundSnapshots(buildSnapshotRefs(rules, snapshots), boundSnapshotIds)
  const invocation = representativeInvocation(modelInvocations)
  const modelInvocationIds = latestReview.model_invocation_ids?.length
    ? latestReview.model_invocation_ids
    : modelInvocations.map((item) => item.id)
  const policyProvider = firstProviderFromPolicy(modelPolicy ?? null)
  const provider = invocation?.provider || policyProvider?.provider || latestJob?.provider || 'rule-engine'
  const modelPolicyId = latestReview.model_policy_id
    || skillBundle?.model_policy_id
    || modelPolicy?.id
    || `model-policy:${provider}${latestJob?.degraded ? ':degraded' : ''}`
  const status = evidenceStatus(risks, refs)
  const skillBundleId = latestReview.skill_bundle_id
    || skillBundle?.id
    || `contract-skill:ruleset:${formatRuleSet(refs)}`

  return {
    id: latestReview.id,
    status: latestReview.status || 'PENDING',
    contract_version_id: currentVersion?.id || null,
    skill_bundle_id: skillBundleId,
    rule_snapshot_id: summarizeBoundRuleSnapshotId(boundSnapshotIds, refs),
    model_policy_id: modelPolicyId,
    model_invocation_ids: modelInvocationIds,
    started_at: latestJob?.started_at || latestReview.created_at || null,
    completed_at: latestJob?.completed_at || latestReview.completed_at || null,
    evidence_status: status,
    rule_snapshot_refs: refs,
    model_policy: {
      id: modelPolicyId,
      provider,
      source: modelPolicy ? 'model_policies' : (latestJob?.provider ? 'analysis_job.provider' : 'fallback'),
      model: invocation?.model || policyProvider?.model || null,
      degraded: Boolean(
        invocation?.degraded
        ?? (
          modelInvocations.some((item) => item.degraded || item.status === 'failed')
          || latestJob?.degraded
        )
      ),
      status: invocation?.status || latestJob?.status || modelPolicy?.status || null,
      last_error: invocation?.error_message || latestJob?.last_error || null,
      invocation_id: invocation?.id || null,
      fallback_reason: invocation?.fallback_reason || null,
    },
  }
}

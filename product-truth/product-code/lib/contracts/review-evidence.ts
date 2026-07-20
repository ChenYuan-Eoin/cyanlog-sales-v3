type ReviewStatus = string | null | undefined

export type ReviewEvidenceReview = {
  id: string
  status?: ReviewStatus
  rule_version?: number | null
  skill_bundle_id?: string | null
  model_policy_id?: string | null
  rule_snapshot_ids?: string[] | null
  rule_set_snapshot_ids?: string[] | null
  rule_set_document_ids?: string[] | null
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

export type ReviewEvidenceSnapshot = {
  id: string
  rule_id: string
  version?: number | null
  status?: string | null
  released_at?: string | null
  created_at?: string | null
  config_snapshot?: unknown
}

export type ReviewEvidenceRuleSetSnapshot = {
  id: string
  org_id?: string | null
  rule_set_id?: string | null
  status?: string | null
  rule_snapshot_ids?: string[] | null
}

export type ReviewEvidenceSkillBundle = {
  id: string
  version?: number | null
  rule_snapshot_ids?: string[] | null
  rule_set_snapshot_ids?: string[] | null
  template_snapshot_ids?: string[] | null
  document_snapshot_ids?: string[] | null
  model_policy_id?: string | null
  output_schema?: unknown
  eval_case_ids?: string[] | null
  release_meta?: unknown
  compiled_from?: unknown
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
  latency_ms?: number | null
  request_meta?: unknown
  response_meta?: unknown
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
  rule_set_snapshot_ids: string[]
  rule_set_document_ids: string[]
  model_policy_id: string
  model_invocation_ids: string[]
  started_at: string | null
  completed_at: string | null
  evidence_status: ReviewRunEvidenceStatus
  rule_snapshot_refs: RuleSnapshotRef[]
  snapshot_integrity: {
    valid: boolean
    rule_binding_source: 'review_run' | 'skill_bundle' | 'missing'
    rule_set_binding_source: 'review_run' | 'skill_bundle' | 'missing'
    errors: string[]
  }
    skill_bundle: {
      id: string
      version: number | null
      status: string | null
      published_at: string | null
      compiled_hash: string | null
      production_source: {
        owner: string | null
        source_of_truth: string | null
        rules_table: string | null
        snapshot_table: string | null
        precedence: string | null
      }
      external_source: {
        repo: string | null
        commit: string | null
        version: string | null
        product_override: string | null
      }
    rules: {
      expected: number | null
      actual: number
      missing: string[]
    }
    references: string[]
      output_schema_version: string | null
      second_verification_required: boolean
      comment_author: string | null
      rule_translation_status: string | null
      rule_translation_ready: boolean
      rule_translation_blocking_reasons: string[]
      rule_set_document_status: string | null
      rule_set_document_ready: boolean
      rule_set_document_blocking_reasons: string[]
      rule_set_count: number | null
      rule_set_document_count: number | null
      official_review_allowed: boolean
      eval_status: string | null
      eval_gate: string | null
      static_eval_status: string | null
      runtime_eval_status: string | null
      eval_note: string | null
      eval_total_cases: number | null
    eval_passed_cases: number | null
    eval_failed_cases: string[]
  } | null
  model_policy: {
    id: string
    provider: string
    source: 'model_policies' | 'analysis_job.provider' | 'fallback'
    model?: string | null
    phase?: string | null
    provider_kind?: string | null
    transport?: string | null
    latency_ms?: number | null
    actual_provider_profile?: string | null
    actual_provider_model?: string | null
    intended_provider_profile?: string | null
    intended_provider_model?: string | null
    requested_provider_profile?: string | null
    requested_provider_model?: string | null
    requested_provider_accepted?: boolean | null
    attempt_error_count?: number | null
    degraded: boolean
    status: string | null
    last_error: string | null
    invocation_id?: string | null
    fallback_reason?: string | null
  }
  model_invocations: Array<{
    id: string
    phase: string | null
    provider: string | null
    model: string | null
    status: string | null
    degraded: boolean
    transport: string | null
    provider_kind: string | null
    latency_ms: number | null
    actual_provider_profile: string | null
    actual_provider_model: string | null
    intended_provider_profile: string | null
    intended_provider_model: string | null
    requested_provider_profile: string | null
    requested_provider_model: string | null
    requested_provider_accepted: boolean | null
    dropped_risk_count: number | null
    validation_warning_count: number | null
    attempt_error_count: number | null
    attempt_errors: string[]
    fallback_reason: string | null
    error_message: string | null
    created_at: string | null
  }>
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function stringListValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function sanitizeEvidenceMessage(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/api[_-]?key[=:]\s*[A-Za-z0-9._~+/=-]+/gi, 'api_key=[redacted]')
    .slice(0, 240)
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function nonEmptyStringList(value: unknown): string[] | null {
  const values = stringListValue(value)
  return values.length > 0 ? values : null
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return rightSet.size === right.length && left.every((value) => rightSet.has(value))
}

function hasDuplicates(values: string[]): boolean {
  return new Set(values).size !== values.length
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
    if (refs.length === 0) {
      return `contract_rule_snapshots:bound_unpublished_or_missing:${snapshotIds.length}`
    }
    if (refs.length < snapshotIds.length) {
      return `contract_rule_snapshots:bound_partial:${refs.length}/${snapshotIds.length}`
    }
    return snapshotIds.length === 1
      ? `contract_rule_snapshots:${snapshotIds[0]}`
      : `contract_rule_snapshots:bound:${snapshotIds.length}`
  }
  return summarizeRuleSnapshotId(refs)
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function nestedRecord(record: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
  return asRecord(record?.[key])
}

type RuntimeModelEvalSummary = {
  status: string | null
  note: string | null
  invocation_id: string | null
}

function deriveRuntimeModelEvalStatus(
  modelInvocations: ReviewEvidenceModelInvocation[]
): RuntimeModelEvalSummary {
  const semanticInvocation = modelInvocations.find((invocation) => invocation.phase === 'semantic_review')
  if (!semanticInvocation) {
    return {
      status: 'model_quality_eval_not_run',
      note: 'No semantic_review model invocation was recorded for the latest ReviewRun.',
      invocation_id: null,
    }
  }

  const responseMeta = invocationResponseMeta(semanticInvocation)
  const providerKind = stringValue(responseMeta?.provider_kind)
  const transport = stringValue(responseMeta?.transport)
  const warningCount = Array.isArray(responseMeta?.validation_warnings)
    ? responseMeta.validation_warnings.length
    : 0
  const droppedRiskCount = numberValue(responseMeta?.dropped_risk_count) ?? 0
  const usableRiskCount = numberValue(responseMeta?.usable_risk_count)

  if (
    semanticInvocation.status === 'completed'
    && !semanticInvocation.degraded
    && providerKind === 'openai_compatible'
    && transport === 'openai_compatible_http'
    && warningCount === 0
    && droppedRiskCount === 0
  ) {
    return {
      status: 'latest_review_model_invocation_passed',
      note: usableRiskCount === null
        ? 'Latest semantic_review model invocation completed without degradation or validation warnings.'
        : `Latest semantic_review model invocation completed with ${usableRiskCount} usable risk(s), no dropped risk, and no validation warning.`,
      invocation_id: semanticInvocation.id,
    }
  }

  if (
    semanticInvocation.status === 'completed'
    && !semanticInvocation.degraded
    && providerKind === 'openai_compatible'
    && transport === 'lm_studio_cli'
    && warningCount === 0
    && droppedRiskCount === 0
  ) {
    return {
      status: 'latest_review_model_invocation_local_cli',
      note: usableRiskCount === null
        ? 'Latest semantic_review completed through local LM Studio CLI; this proves local model execution but not OpenAI-compatible HTTP readiness.'
        : `Latest semantic_review completed through local LM Studio CLI with ${usableRiskCount} usable risk(s); HTTP readiness still requires LM Studio Token verification.`,
      invocation_id: semanticInvocation.id,
    }
  }

  if (semanticInvocation.status === 'completed' && !semanticInvocation.degraded && providerKind === 'openai_compatible') {
    return {
      status: 'latest_review_model_invocation_partial',
      note: `Latest semantic_review model invocation completed, but ${droppedRiskCount} risk(s) were dropped and ${warningCount} validation warning(s) were recorded.`,
      invocation_id: semanticInvocation.id,
    }
  }

  return {
    status: 'latest_review_model_invocation_not_passed',
    note: semanticInvocation.degraded
      ? `Latest semantic_review model invocation degraded: ${semanticInvocation.fallback_reason || semanticInvocation.error_message || 'unknown reason'}.`
      : `Latest semantic_review model invocation did not use a passing AI provider path: ${providerKind || semanticInvocation.provider || 'unknown'}.`,
    invocation_id: semanticInvocation.id,
  }
}

function buildSkillBundleSummary(
  skillBundle: ReviewEvidenceSkillBundle,
  refs: RuleSnapshotRef[],
  runtimeModelEval: RuntimeModelEvalSummary
): ReviewRunEvidence['skill_bundle'] {
  if (!skillBundle) return null

  const compiledFrom = asRecord(skillBundle.compiled_from)
  const outputSchema = asRecord(skillBundle.output_schema)
  const productionSource = nestedRecord(compiledFrom, 'production_rule_source')
  const externalSource = nestedRecord(compiledFrom, 'external_skill_source')
  const completeness = nestedRecord(compiledFrom, 'canonical_rule_completeness')
  const secondVerification = nestedRecord(compiledFrom, 'second_verification')
  const commentTemplate = nestedRecord(compiledFrom, 'comment_template')
  const evalResults = nestedRecord(compiledFrom, 'eval_results')
  const ruleTranslationGate = nestedRecord(compiledFrom, 'rule_translation_gate')
  const ruleSetDocumentGate = nestedRecord(compiledFrom, 'rule_set_document_gate')
  const releaseMeta = asRecord(skillBundle.release_meta)
  const referenceAssetItems = Array.isArray(compiledFrom?.reference_assets)
    ? compiledFrom.reference_assets
    : Array.isArray(compiledFrom?.external_skill_references)
      ? compiledFrom.external_skill_references
      : []
  const externalRefs = referenceAssetItems
      .map((item) => stringValue(asRecord(item)?.path))
      .filter((item): item is string => Boolean(item))
  const ruleTranslationStatus = stringValue(ruleTranslationGate?.status)
  const ruleSetDocumentStatus = stringValue(ruleSetDocumentGate?.status)
  const evalStatus = stringValue(evalResults?.status)
  const officialReviewAllowed = Boolean(releaseMeta?.official_review_allowed)
    && skillBundle.status === 'published'
    && ruleTranslationStatus === 'ready'
    && ruleSetDocumentStatus === 'ready'
    && evalStatus === 'passed'

  return {
    id: skillBundle.id,
    version: skillBundle.version ?? null,
    status: skillBundle.status ?? null,
    published_at: skillBundle.published_at ?? null,
    compiled_hash: skillBundle.compiled_hash ?? null,
    production_source: {
      owner: stringValue(productionSource?.owner),
      source_of_truth: stringValue(productionSource?.source_of_truth),
      rules_table: stringValue(productionSource?.rules_table),
      snapshot_table: stringValue(productionSource?.snapshot_table),
      precedence: stringValue(productionSource?.precedence),
    },
    external_source: {
      repo: stringValue(externalSource?.repo),
      commit: stringValue(externalSource?.commit),
      version: stringValue(externalSource?.version),
      product_override: stringValue(externalSource?.product_override),
    },
    rules: {
      expected: numberValue(completeness?.expected),
      actual: numberValue(completeness?.actual) ?? refs.length,
      missing: arrayOfStrings(completeness?.missing),
    },
    references: externalRefs,
    output_schema_version: stringValue(compiledFrom?.output_schema_version)
      || stringValue(outputSchema?.schema_version),
    second_verification_required: Boolean(secondVerification?.required_checks || secondVerification?.enforcement),
    comment_author: stringValue(commentTemplate?.author),
    rule_translation_status: ruleTranslationStatus,
    rule_translation_ready: ruleTranslationStatus === 'ready',
    rule_translation_blocking_reasons: arrayOfStrings(ruleTranslationGate?.blocking_reasons),
    rule_set_document_status: ruleSetDocumentStatus,
    rule_set_document_ready: ruleSetDocumentStatus === 'ready',
    rule_set_document_blocking_reasons: arrayOfStrings(ruleSetDocumentGate?.blocking_reasons),
    rule_set_count: numberValue(ruleSetDocumentGate?.total_rule_sets),
    rule_set_document_count: numberValue(ruleSetDocumentGate?.ready_documents),
    official_review_allowed: officialReviewAllowed,
    eval_status: evalStatus,
    eval_gate: stringValue(evalResults?.gate),
    static_eval_status: stringValue(evalResults?.static_eval_status),
    runtime_eval_status: runtimeModelEval.status || stringValue(evalResults?.runtime_eval_status),
    eval_note: runtimeModelEval.note || stringValue(evalResults?.note),
    eval_total_cases: numberValue(evalResults?.total_cases),
    eval_passed_cases: numberValue(evalResults?.passed_cases),
    eval_failed_cases: arrayOfStrings(evalResults?.failed_cases),
  }
}

type SnapshotBindingSource = 'review_run' | 'skill_bundle' | 'missing'

type SnapshotBinding = {
  ids: string[]
  source: SnapshotBindingSource
  reviewIds: string[] | null
  bundleIds: string[] | null
}

function selectSnapshotBinding(
  reviewIds: string[] | null | undefined,
  bundleIds: string[] | null | undefined
): SnapshotBinding {
  const nonEmptyReviewIds = nonEmptyStringList(reviewIds)
  const nonEmptyBundleIds = nonEmptyStringList(bundleIds)
  if (nonEmptyReviewIds) {
    return {
      ids: nonEmptyReviewIds,
      source: 'review_run',
      reviewIds: nonEmptyReviewIds,
      bundleIds: nonEmptyBundleIds,
    }
  }
  if (nonEmptyBundleIds) {
    return {
      ids: nonEmptyBundleIds,
      source: 'skill_bundle',
      reviewIds: null,
      bundleIds: nonEmptyBundleIds,
    }
  }
  return { ids: [], source: 'missing', reviewIds: null, bundleIds: null }
}

function validateSnapshotBindings(input: {
  ruleBinding: SnapshotBinding
  ruleSetBinding: SnapshotBinding
  snapshots: ReviewEvidenceSnapshot[]
  ruleSetSnapshots: ReviewEvidenceRuleSetSnapshot[]
  expectedOrgId?: string | null
}): string[] {
  const {
    ruleBinding,
    ruleSetBinding,
    snapshots,
    ruleSetSnapshots,
    expectedOrgId,
  } = input
  const errors: string[] = []

  if (ruleBinding.ids.length === 0) errors.push('rule_snapshot_binding_missing')
  if (ruleSetBinding.ids.length === 0) errors.push('rule_set_snapshot_binding_missing')
  if (hasDuplicates(ruleBinding.ids)) errors.push('rule_snapshot_binding_duplicated')
  if (hasDuplicates(ruleSetBinding.ids)) errors.push('rule_set_snapshot_binding_duplicated')

  if (
    ruleBinding.reviewIds
    && ruleBinding.bundleIds
    && !sameStringSet(ruleBinding.reviewIds, ruleBinding.bundleIds)
  ) {
    errors.push('review_bundle_rule_snapshot_mismatch')
  }
  if (
    ruleSetBinding.reviewIds
    && ruleSetBinding.bundleIds
    && !sameStringSet(ruleSetBinding.reviewIds, ruleSetBinding.bundleIds)
  ) {
    errors.push('review_bundle_rule_set_snapshot_mismatch')
  }

  const loadedRuleIds = snapshots.map((snapshot) => snapshot.id)
  if (hasDuplicates(loadedRuleIds)) errors.push('rule_snapshot_rows_duplicated')
  if (!sameStringSet(ruleBinding.ids, loadedRuleIds)) errors.push('rule_snapshot_rows_not_exact')

  for (const snapshot of snapshots) {
    if (snapshot.status !== 'published' && snapshot.status !== 'rolled_back') {
      errors.push(`rule_snapshot_status_invalid:${snapshot.id}`)
    }
    const snapshotOrgId = stringValue(asRecord(snapshot.config_snapshot)?.org_id)
    if (expectedOrgId && snapshotOrgId && snapshotOrgId !== expectedOrgId) {
      errors.push(`rule_snapshot_org_invalid:${snapshot.id}`)
    }
  }

  const loadedRuleSetIds = ruleSetSnapshots.map((snapshot) => snapshot.id)
  if (hasDuplicates(loadedRuleSetIds)) errors.push('rule_set_snapshot_rows_duplicated')
  if (!sameStringSet(ruleSetBinding.ids, loadedRuleSetIds)) errors.push('rule_set_snapshot_rows_not_exact')

  const memberRuleSnapshotIds: string[] = []
  for (const snapshot of ruleSetSnapshots) {
    if (snapshot.status !== 'published' && snapshot.status !== 'rolled_back') {
      errors.push(`rule_set_snapshot_status_invalid:${snapshot.id}`)
    }
    if (expectedOrgId && snapshot.org_id !== expectedOrgId) {
      errors.push(`rule_set_snapshot_org_invalid:${snapshot.id}`)
    }
    if (!Array.isArray(snapshot.rule_snapshot_ids)) {
      errors.push(`rule_set_snapshot_members_invalid:${snapshot.id}`)
      continue
    }
    if (hasDuplicates(snapshot.rule_snapshot_ids)) {
      errors.push(`rule_set_snapshot_members_duplicated:${snapshot.id}`)
    }
    memberRuleSnapshotIds.push(...snapshot.rule_snapshot_ids)
  }

  if (hasDuplicates(memberRuleSnapshotIds)) errors.push('rule_set_members_overlap')
  if (!sameStringSet(ruleBinding.ids, memberRuleSnapshotIds)) {
    errors.push('rule_set_members_not_exact')
  }

  return Array.from(new Set(errors))
}

function buildBoundSnapshotRefs(
  snapshots: ReviewEvidenceSnapshot[],
  integrityErrors: string[]
): RuleSnapshotRef[] {
  if (integrityErrors.length > 0) return []
  return snapshots.map((snapshot) => ({
    id: snapshot.id,
    rule_id: snapshot.rule_id,
    rule_code: extractSnapshotCode(snapshot),
    version: snapshot.version ?? numberValue(asRecord(snapshot.config_snapshot)?.version),
    engine_type: extractSnapshotEngineType(snapshot),
    released_at: snapshotReleasedAt(snapshot),
    source: 'published_snapshot',
  }))
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

function invocationRequestMeta(invocation: ReviewEvidenceModelInvocation | null): Record<string, unknown> | null {
  return invocation ? asRecord(invocation.request_meta) : null
}

function invocationResponseMeta(invocation: ReviewEvidenceModelInvocation | null): Record<string, unknown> | null {
  return invocation ? asRecord(invocation.response_meta) : null
}

function invocationAttemptErrorCount(invocation: ReviewEvidenceModelInvocation | null): number | null {
  const responseMeta = invocationResponseMeta(invocation)
  const attemptErrors = responseMeta?.attempt_errors
  return Array.isArray(attemptErrors) ? attemptErrors.length : null
}

function summarizeInvocation(invocation: ReviewEvidenceModelInvocation) {
  const requestMeta = invocationRequestMeta(invocation)
  const responseMeta = invocationResponseMeta(invocation)
  const attemptErrors = stringListValue(responseMeta?.attempt_errors).map(sanitizeEvidenceMessage)
  return {
    id: invocation.id,
    phase: invocation.phase || null,
    provider: invocation.provider || null,
    model: invocation.model || null,
    status: invocation.status || null,
    degraded: Boolean(invocation.degraded),
    transport: stringValue(responseMeta?.transport),
    provider_kind: stringValue(responseMeta?.provider_kind),
    latency_ms: invocation.latency_ms ?? null,
    actual_provider_profile: stringValue(responseMeta?.actual_provider_profile)
      || stringValue(responseMeta?.provider_profile)
      || invocation.provider
      || null,
    actual_provider_model: stringValue(responseMeta?.actual_provider_model)
      || invocation.model
      || null,
    intended_provider_profile: stringValue(requestMeta?.intended_provider_profile),
    intended_provider_model: stringValue(requestMeta?.intended_provider_model),
    requested_provider_profile: stringValue(requestMeta?.requested_provider_profile),
    requested_provider_model: stringValue(requestMeta?.requested_provider_model),
    requested_provider_accepted: typeof requestMeta?.requested_provider_accepted === 'boolean'
      ? requestMeta.requested_provider_accepted
      : null,
    dropped_risk_count: numberValue(responseMeta?.dropped_risk_count),
    validation_warning_count: Array.isArray(responseMeta?.validation_warnings)
      ? responseMeta.validation_warnings.length
      : null,
    attempt_error_count: attemptErrors.length,
    attempt_errors: attemptErrors.slice(0, 3),
    fallback_reason: invocation.fallback_reason || null,
    error_message: invocation.error_message || null,
    created_at: invocation.created_at || null,
  }
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
  snapshots: ReviewEvidenceSnapshot[]
  ruleSetSnapshots?: ReviewEvidenceRuleSetSnapshot[]
  expectedOrgId?: string | null
  skillBundle?: ReviewEvidenceSkillBundle
  modelPolicy?: ReviewEvidenceModelPolicy
  modelInvocations?: ReviewEvidenceModelInvocation[]
}): ReviewRunEvidence | null {
  const {
    latestReview,
    latestJob,
    currentVersion,
    risks,
    snapshots,
    ruleSetSnapshots = [],
    expectedOrgId,
    skillBundle,
    modelPolicy,
    modelInvocations = [],
  } = input
  if (!latestReview) return null

  const ruleBinding = selectSnapshotBinding(
    latestReview.rule_snapshot_ids,
    skillBundle?.rule_snapshot_ids
  )
  const ruleSetBinding = selectSnapshotBinding(
    latestReview.rule_set_snapshot_ids,
    skillBundle?.rule_set_snapshot_ids
  )
  const boundRuleSetDocumentIds = nonEmptyStringList(latestReview.rule_set_document_ids)
    || nonEmptyStringList(skillBundle?.document_snapshot_ids)
    || []
  const snapshotIntegrityErrors = validateSnapshotBindings({
    ruleBinding,
    ruleSetBinding,
    snapshots,
    ruleSetSnapshots,
    expectedOrgId,
  })
  const refs = buildBoundSnapshotRefs(snapshots, snapshotIntegrityErrors)
  const invocation = representativeInvocation(modelInvocations)
  const requestMeta = invocationRequestMeta(invocation)
  const responseMeta = invocationResponseMeta(invocation)
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
    rule_snapshot_id: summarizeBoundRuleSnapshotId(ruleBinding.ids, refs),
    rule_set_snapshot_ids: ruleSetBinding.ids,
    rule_set_document_ids: boundRuleSetDocumentIds,
    model_policy_id: modelPolicyId,
    model_invocation_ids: modelInvocationIds,
    started_at: latestJob?.started_at || latestReview.created_at || null,
    completed_at: latestJob?.completed_at || latestReview.completed_at || null,
    evidence_status: status,
    rule_snapshot_refs: refs,
    snapshot_integrity: {
      valid: snapshotIntegrityErrors.length === 0,
      rule_binding_source: ruleBinding.source,
      rule_set_binding_source: ruleSetBinding.source,
      errors: snapshotIntegrityErrors,
    },
    skill_bundle: buildSkillBundleSummary(
      skillBundle ?? null,
      refs,
      deriveRuntimeModelEvalStatus(modelInvocations)
    ),
    model_policy: {
      id: modelPolicyId,
      provider,
      source: modelPolicy ? 'model_policies' : (latestJob?.provider ? 'analysis_job.provider' : 'fallback'),
      model: invocation?.model || policyProvider?.model || null,
      phase: invocation?.phase || null,
      provider_kind: stringValue(responseMeta?.provider_kind),
      transport: stringValue(responseMeta?.transport),
      latency_ms: invocation?.latency_ms ?? null,
      actual_provider_profile: stringValue(responseMeta?.actual_provider_profile)
        || stringValue(responseMeta?.provider_profile)
        || invocation?.provider
        || null,
      actual_provider_model: stringValue(responseMeta?.actual_provider_model)
        || invocation?.model
        || null,
      intended_provider_profile: stringValue(requestMeta?.intended_provider_profile),
      intended_provider_model: stringValue(requestMeta?.intended_provider_model),
      requested_provider_profile: stringValue(requestMeta?.requested_provider_profile),
      requested_provider_model: stringValue(requestMeta?.requested_provider_model),
      requested_provider_accepted: typeof requestMeta?.requested_provider_accepted === 'boolean'
        ? requestMeta.requested_provider_accepted
        : null,
      attempt_error_count: invocationAttemptErrorCount(invocation),
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
    model_invocations: modelInvocations.map(summarizeInvocation),
  }
}

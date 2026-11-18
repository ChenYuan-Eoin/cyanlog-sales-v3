// configs/types.ts - 配置中心类型定义
// 从 ConfigsClient.tsx 提取

export interface Config {
  id: string
  key: string
  name: string
  value: Record<string, unknown>
  type: 'CONTRACT_RULE' | 'TAX_RULE' | 'APPROVAL_RULE' | 'AI_CONFIG' | 'UI_THEME'
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
  version: number
  description?: string
  created_at: string
  updated_at: string
}

export type EditableConfig = Partial<Config> & {
  revision_source_id?: string
  revision_asset_locked?: boolean
  credential_action?: 'reuse' | 'replace' | 'clear'
  credential_reuse_available?: boolean
}

export type ConfigPublishFeedback = {
  tone: 'success' | 'error'
  message: string
}

export interface ProductPriceTier {
  id?: string
  qty_from: number
  qty_to: number | null
  unit_price: number
  sort_order?: number
}

export interface ProductRecord {
  id: string
  code: string
  name: string
  specification?: string | null
  unit?: string | null
  base_price: number
  cost_price?: number | null
  min_price?: number | null
  tier_pricing_enabled: boolean
  status: 'active' | 'inactive' | 'discontinued'
  product_categories?: { name: string } | null
  product_price_tiers?: ProductPriceTier[]
}

import type { ContractPolicyRule } from '@/types/rules'

export interface ConfigsInitialData {
  products?: ProductRecord[]
  rules?: ContractPolicyRule[]
  roles?: unknown[]
  configs?: Config[]
  // Kept as a transport key for the existing warmup cache. The value is the
  // WP02 six-object runtime overview, never the legacy ModelPolicy.
  aiRuntimePolicy?: AIRuntimeOverview | null
}

export type AIRuntimeState =
  | 'builtin_ready'
  | 'missing_base_url'
  | 'missing_credential'
  | 'unreachable_in_vercel'
  | 'local_health_ok'
  | 'local_cli_ready'
  | 'local_auth_failed'
  | 'local_health_failed'
  | 'local_generation_failed'
  | 'remote_health_ok'
  | 'remote_auth_failed'
  | 'remote_health_failed'
  | 'remote_generation_failed'
  | 'ready_to_call'
  | 'recent_invocation_passed'
  | 'recent_invocation_partial'
  | 'recent_invocation_failed'

export type AIRuntimeAttemptOutcome =
  | 'passed'
  | 'fallback_passed'
  | 'failed'
  | 'incomplete_evidence'

export interface AIRuntimeAttempt {
  id: string
  execution_id: string | null
  execution_mode: 'route' | 'pinned' | null
  pinned_model_catalog_entry_id: string | null
  plan_snapshot_id: string | null
  plan_snapshot_hash: string | null
  snapshot_integrity: 'verified' | 'invalid'
  matches_current_plan: boolean
  business_use_point_id: string | null
  application_id: string | null
  route_policy_id: string | null
  model_catalog_entry_id: string | null
  provider_connection_id: string | null
  provider: string | null
  model: string | null
  attempt_no: number | null
  outcome: AIRuntimeAttemptOutcome
  status: string | null
  degraded: boolean
  failure_code: string | null
  error_message: string | null
  latency_ms: number | null
  tokens: {
    input: number | null
    output: number | null
    total: number | null
    evidence: 'provider' | 'missing'
  }
  review_run_required: boolean
  review_run_id: string | null
  occurred_at: string | null
  freshness: 'fresh' | 'stale' | 'unknown'
  age_ms: number | null
}

export interface AIRuntimePlanCandidate {
  position: number
  role: 'primary' | 'fallback'
  model_catalog_entry_id: string
  model_name: string
  model_id: string
  provider_connection_id: string
  provider_name: string
  runtime_location: 'local' | 'cloud' | 'builtin'
  auth_mode: 'none' | 'bearer'
  credential_state: 'not_required' | 'stored'
}

export interface AIRuntimeConfiguredCandidate {
  position: number
  model_catalog_entry_id: string
  model_name: string
  model_id: string
  provider_connection_id: string
  provider_name: string
  runtime_location: 'local' | 'cloud' | 'builtin'
  execution_status: 'effective' | 'excluded_from_hosted'
  effective_position: number | null
}

export interface AIRuntimeReadyPlan {
  state: 'ready'
  snapshot_hash: string
  execution_environment: 'local' | 'hosted'
  application: { asset_id: string; name: string }
  route: {
    asset_id: string
    name: string
    strategy: 'ordered_fallback'
    timeout_ms: number
    failure_action: 'manual_review' | 'stop'
  }
  configured_candidates: AIRuntimeConfiguredCandidate[]
  candidates: AIRuntimePlanCandidate[]
}

export interface AIRuntimeBlockedPlan {
  state: 'blocked'
  execution_environment: 'local' | 'hosted'
  code: string
  reason: string
  next_action: string
}

export type AIRuntimePlan = AIRuntimeReadyPlan | AIRuntimeBlockedPlan

export interface AIRuntimeEnvironmentProjections {
  local: AIRuntimePlan
  hosted: AIRuntimePlan
}

export type AIRuntimeVerificationState =
  | 'blocked'
  | 'evidence_unavailable'
  | 'not_verified'
  | 'stale'
  | 'passed'
  | 'fallback_passed'
  | 'failed'
  | 'incomplete_evidence'

export interface AIRuntimeUsePointOverview {
  use_point: {
    asset_id: string
    name: string
    module_id: string
    description: string
  }
  evidence_available: boolean
  /** The plan that applies to the environment serving this response. */
  plan: AIRuntimePlan
  /** Both projections are shown so administrators do not mistake local readiness for hosted readiness. */
  environment_projections: AIRuntimeEnvironmentProjections
  verification: AIRuntimeVerificationState
  latest_current_attempt: AIRuntimeAttempt | null
  latest_current_execution_complete: boolean
  latest_current_execution_attempts: AIRuntimeAttempt[]
  latest_pinned_attempt: AIRuntimeAttempt | null
  latest_attempts: AIRuntimeAttempt[]
}

export interface AIRuntimeOverview {
  schema_version: 'ai-runtime-overview.v1'
  source: 'published_ai_platform_assets'
  generated_at: string
  execution_environment: 'local' | 'hosted'
  evidence: {
    available: boolean
    source: 'immutable_plan_snapshots_and_model_invocations'
    freshness_window_hours: number
    unavailable_use_points: string[]
    error: string | null
  }
  summary: {
    registered_use_points: number
    ready_plans: number
    blocked_plans: number
    verified_current_plans: number
  }
  use_points: AIRuntimeUsePointOverview[]
  truth_contract: {
    legacy_model_policy_consumed: false
    environment_route_fallback_consumed: false
    configured_or_published_is_not_verified: true
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value)
}

function isRuntimeAttempt(value: unknown): value is AIRuntimeAttempt {
  if (!isRecord(value) || !isRecord(value.tokens)) return false
  const executionModeValid = value.execution_mode === null
    ? value.pinned_model_catalog_entry_id === null && value.matches_current_plan === false
    : value.execution_mode === 'route'
      ? isString(value.execution_id) && value.pinned_model_catalog_entry_id === null
      : value.execution_mode === 'pinned'
        && isString(value.execution_id)
        && value.attempt_no === 1
        && isString(value.pinned_model_catalog_entry_id)
        && value.pinned_model_catalog_entry_id === value.model_catalog_entry_id
  return isString(value.id)
    && isNullableString(value.execution_id)
    && (value.execution_mode === null || value.execution_mode === 'route' || value.execution_mode === 'pinned')
    && isNullableString(value.pinned_model_catalog_entry_id)
    && isNullableString(value.plan_snapshot_id)
    && isNullableString(value.plan_snapshot_hash)
    && (value.snapshot_integrity === 'verified' || value.snapshot_integrity === 'invalid')
    && typeof value.matches_current_plan === 'boolean'
    && isNullableString(value.business_use_point_id)
    && isNullableString(value.application_id)
    && isNullableString(value.route_policy_id)
    && isNullableString(value.model_catalog_entry_id)
    && isNullableString(value.provider_connection_id)
    && isNullableString(value.provider)
    && isNullableString(value.model)
    && isNullableNumber(value.attempt_no)
    && ['passed', 'fallback_passed', 'failed', 'incomplete_evidence'].includes(String(value.outcome))
    && isNullableString(value.status)
    && typeof value.degraded === 'boolean'
    && isNullableString(value.failure_code)
    && isNullableString(value.error_message)
    && isNullableNumber(value.latency_ms)
    && isNullableNumber(value.tokens.input)
    && isNullableNumber(value.tokens.output)
    && isNullableNumber(value.tokens.total)
    && (value.tokens.evidence === 'provider' || value.tokens.evidence === 'missing')
    && typeof value.review_run_required === 'boolean'
    && isNullableString(value.review_run_id)
    && isNullableString(value.occurred_at)
    && ['fresh', 'stale', 'unknown'].includes(String(value.freshness))
    && isNullableNumber(value.age_ms)
    && executionModeValid
}

function isRuntimePlanCandidate(value: unknown): value is AIRuntimePlanCandidate {
  if (!isRecord(value)) return false
  return isFiniteNumber(value.position)
    && (value.role === 'primary' || value.role === 'fallback')
    && isString(value.model_catalog_entry_id)
    && isString(value.model_name)
    && isString(value.model_id)
    && isString(value.provider_connection_id)
    && isString(value.provider_name)
    && ['local', 'cloud', 'builtin'].includes(String(value.runtime_location))
    && (value.auth_mode === 'none' || value.auth_mode === 'bearer')
    && (value.credential_state === 'not_required' || value.credential_state === 'stored')
}

function isRuntimeConfiguredCandidate(value: unknown): value is AIRuntimeConfiguredCandidate {
  if (!isRecord(value)) return false
  return isFiniteNumber(value.position)
    && isString(value.model_catalog_entry_id)
    && isString(value.model_name)
    && isString(value.model_id)
    && isString(value.provider_connection_id)
    && isString(value.provider_name)
    && ['local', 'cloud', 'builtin'].includes(String(value.runtime_location))
    && (value.execution_status === 'effective' || value.execution_status === 'excluded_from_hosted')
    && isNullableNumber(value.effective_position)
    && (value.execution_status === 'effective'
      ? value.effective_position !== null
      : value.effective_position === null)
}

function isRuntimePlan(value: unknown): value is AIRuntimePlan {
  if (!isRecord(value)) return false
  if (value.state === 'blocked') {
    return ['local', 'hosted'].includes(String(value.execution_environment))
      && isString(value.code)
      && isString(value.reason)
      && isString(value.next_action)
  }
  const configuredCandidates = value.configured_candidates
  const candidates = value.candidates
  if (
    value.state !== 'ready'
    || !isString(value.snapshot_hash)
    || !['local', 'hosted'].includes(String(value.execution_environment))
    || !isRecord(value.application)
    || !isString(value.application.asset_id)
    || !isString(value.application.name)
    || !isRecord(value.route)
    || !isString(value.route.asset_id)
    || !isString(value.route.name)
    || value.route.strategy !== 'ordered_fallback'
    || !isFiniteNumber(value.route.timeout_ms)
    || !['manual_review', 'stop'].includes(String(value.route.failure_action))
    || !Array.isArray(configuredCandidates)
    || !Array.isArray(candidates)
  ) return false
  if (
    !configuredCandidates.every(isRuntimeConfiguredCandidate)
    || !candidates.every(isRuntimePlanCandidate)
  ) return false

  const validConfiguredCandidates = configuredCandidates as AIRuntimeConfiguredCandidate[]
  const validCandidates = candidates as AIRuntimePlanCandidate[]
  const effectiveConfiguredCandidates = validConfiguredCandidates.filter((candidate) => (
    candidate.execution_status === 'effective'
  ))
  if (
    validCandidates.length === 0
    || effectiveConfiguredCandidates.length !== validCandidates.length
    || !validConfiguredCandidates.every((candidate, index) => candidate.position === index + 1)
    || !validCandidates.every((candidate, index) => candidate.position === index + 1)
    || !validCandidates.every((candidate) => (
      candidate.role === (candidate.position === 1 ? 'primary' : 'fallback')
    ))
    || !effectiveConfiguredCandidates
      .map((candidate) => candidate.effective_position)
      .sort((left, right) => Number(left) - Number(right))
      .every((position, index) => position === index + 1)
    || validConfiguredCandidates.some((candidate) => (
      candidate.execution_status === 'excluded_from_hosted'
      && (value.execution_environment !== 'hosted' || candidate.runtime_location !== 'local')
    ))
    || (value.execution_environment === 'hosted' && effectiveConfiguredCandidates.some((candidate) => (
      candidate.runtime_location === 'local'
    )))
    || new Set(effectiveConfiguredCandidates.map((candidate) => (
      `${candidate.model_catalog_entry_id}:${candidate.provider_connection_id}`
    ))).size !== effectiveConfiguredCandidates.length
    || new Set(validCandidates.map((candidate) => (
      `${candidate.model_catalog_entry_id}:${candidate.provider_connection_id}`
    ))).size !== validCandidates.length
  ) return false

  const configuredMatchesCandidates = effectiveConfiguredCandidates.every((configured) => validCandidates.some((candidate) => (
    configured.model_catalog_entry_id === candidate.model_catalog_entry_id
    && configured.provider_connection_id === candidate.provider_connection_id
    && configured.effective_position === candidate.position
  )))
  const candidatesMatchConfigured = validCandidates.every((candidate) => effectiveConfiguredCandidates.some((configured) => (
    configured.model_catalog_entry_id === candidate.model_catalog_entry_id
    && configured.provider_connection_id === candidate.provider_connection_id
    && configured.effective_position === candidate.position
  )))
  return configuredMatchesCandidates && candidatesMatchConfigured
}

function hasSameRuntimePlanIdentity(left: AIRuntimePlan, right: AIRuntimePlan): boolean {
  return left.state === right.state
    && left.execution_environment === right.execution_environment
    && JSON.stringify(left) === JSON.stringify(right)
}

function expectedRuntimeVerification(
  plan: AIRuntimePlan,
  evidenceAvailable: boolean,
  latestAttempt: AIRuntimeAttempt | null,
  executionComplete: boolean,
): AIRuntimeVerificationState {
  if (plan.state === 'blocked') return 'blocked'
  if (!evidenceAvailable) return 'evidence_unavailable'
  if (!latestAttempt) return 'not_verified'
  if (latestAttempt.freshness === 'stale') return 'stale'
  if (latestAttempt.freshness === 'unknown' || !executionComplete) return 'incomplete_evidence'
  if (latestAttempt.outcome === 'passed') return 'passed'
  if (latestAttempt.outcome === 'fallback_passed') return 'fallback_passed'
  if (latestAttempt.outcome === 'failed') return 'failed'
  return 'incomplete_evidence'
}

function isRuntimeUsePoint(value: unknown): value is AIRuntimeUsePointOverview {
  if (!isRecord(value) || !isRecord(value.use_point) || !isRecord(value.environment_projections)) return false
  if (
    typeof value.evidence_available !== 'boolean'
    || !Array.isArray(value.latest_current_execution_attempts)
    || !value.latest_current_execution_attempts.every((attempt) => (
      isRuntimeAttempt(attempt) && attempt.execution_mode === 'route'
    ))
    || !Array.isArray(value.latest_attempts)
    || !value.latest_attempts.every(isRuntimeAttempt)
  ) return false
  const currentPlan = value.plan
  const localProjection = value.environment_projections.local
  const hostedProjection = value.environment_projections.hosted
  if (
    !isRuntimePlan(currentPlan)
    || !isRuntimePlan(localProjection)
    || localProjection.execution_environment !== 'local'
    || !isRuntimePlan(hostedProjection)
    || hostedProjection.execution_environment !== 'hosted'
  ) return false

  const selectedProjection = currentPlan.execution_environment === 'local'
    ? localProjection
    : hostedProjection
  if (!hasSameRuntimePlanIdentity(currentPlan, selectedProjection)) return false

  if (value.latest_current_attempt !== null && !isRuntimeAttempt(value.latest_current_attempt)) return false
  if (value.latest_pinned_attempt !== null && !isRuntimeAttempt(value.latest_pinned_attempt)) return false
  const latestCurrentAttempt = value.latest_current_attempt as AIRuntimeAttempt | null
  const latestPinnedAttempt = value.latest_pinned_attempt as AIRuntimeAttempt | null
  const currentExecutionAttempts = value.latest_current_execution_attempts as AIRuntimeAttempt[]
  const currentExecutionId = currentExecutionAttempts[0]?.execution_id || null
  const continuousAttempts = currentExecutionAttempts.every((attempt, index) => attempt.attempt_no === index + 1)
  const currentExecutionIsConsistent = latestCurrentAttempt === null
    ? currentExecutionAttempts.length === 0
    : latestCurrentAttempt.execution_mode === 'route'
      && latestCurrentAttempt.matches_current_plan
      && currentExecutionAttempts.length > 0
      && continuousAttempts
      && currentExecutionAttempts.every((attempt) => (
        attempt.matches_current_plan
        && attempt.execution_id === latestCurrentAttempt.execution_id
      ))
      && JSON.stringify(currentExecutionAttempts.at(-1)) === JSON.stringify(latestCurrentAttempt)
  const pinnedAttemptIsConsistent = latestPinnedAttempt === null
    || (latestPinnedAttempt.execution_mode === 'pinned' && latestPinnedAttempt.matches_current_plan)
  const finalAttempt = currentExecutionAttempts.at(-1) || null
  const completedBySuccess = finalAttempt?.outcome === 'passed' || finalAttempt?.outcome === 'fallback_passed'
  const completedByExhaustion = currentPlan.state === 'ready'
    && currentExecutionAttempts.length === currentPlan.candidates.length
    && currentExecutionAttempts.every((attempt) => attempt.outcome === 'failed')
  const expectedExecutionComplete = currentExecutionAttempts.length > 0
    && continuousAttempts
    && (completedBySuccess || completedByExhaustion)
  const expectedVerification = expectedRuntimeVerification(
    currentPlan,
    value.evidence_available as boolean,
    latestCurrentAttempt,
    expectedExecutionComplete,
  )

  return isString(value.use_point.asset_id)
    && isString(value.use_point.name)
    && isString(value.use_point.module_id)
    && isString(value.use_point.description)
    && typeof value.evidence_available === 'boolean'
    && value.verification === expectedVerification
    && currentExecutionIsConsistent
    && typeof value.latest_current_execution_complete === 'boolean'
    && value.latest_current_execution_complete === expectedExecutionComplete
    && (!expectedExecutionComplete || Boolean(currentExecutionId && latestCurrentAttempt))
    && pinnedAttemptIsConsistent
    && (currentPlan.state !== 'blocked'
      || (latestCurrentAttempt === null && latestPinnedAttempt === null && currentExecutionAttempts.length === 0))
}

export function isAIRuntimeOverview(value: unknown): value is AIRuntimeOverview {
  if (!isRecord(value) || !isRecord(value.summary) || !isRecord(value.evidence) || !isRecord(value.truth_contract)) {
    return false
  }
  if (
    value.schema_version !== 'ai-runtime-overview.v1'
    || value.source !== 'published_ai_platform_assets'
    || !isString(value.generated_at)
    || (value.execution_environment !== 'local' && value.execution_environment !== 'hosted')
    || typeof value.evidence.available !== 'boolean'
    || value.evidence.source !== 'immutable_plan_snapshots_and_model_invocations'
    || !isFiniteNumber(value.evidence.freshness_window_hours)
    || !Array.isArray(value.evidence.unavailable_use_points)
    || !value.evidence.unavailable_use_points.every(isString)
    || !isNullableString(value.evidence.error)
    || !isFiniteNumber(value.summary.registered_use_points)
    || !isFiniteNumber(value.summary.ready_plans)
    || !isFiniteNumber(value.summary.blocked_plans)
    || !isFiniteNumber(value.summary.verified_current_plans)
    || !Array.isArray(value.use_points)
    || !value.use_points.every(isRuntimeUsePoint)
  ) return false

  const usePoints = value.use_points as AIRuntimeUsePointOverview[]
  const unavailableUsePoints = value.evidence.unavailable_use_points as string[]
  const expectedUnavailableUsePoints = usePoints
    .filter((item) => !item.evidence_available)
    .map((item) => item.use_point.asset_id)
  const summaryMatches = value.summary.registered_use_points === usePoints.length
    && value.summary.ready_plans === usePoints.filter((item) => item.plan.state === 'ready').length
    && value.summary.blocked_plans === usePoints.filter((item) => item.plan.state === 'blocked').length
    && value.summary.verified_current_plans === usePoints.filter((item) => (
      item.verification === 'passed' || item.verification === 'fallback_passed'
    )).length
  const evidenceMatches = value.evidence.available === (expectedUnavailableUsePoints.length === 0)
    && new Set(unavailableUsePoints).size === unavailableUsePoints.length
    && unavailableUsePoints.length === expectedUnavailableUsePoints.length
    && unavailableUsePoints.every((assetId, index) => assetId === expectedUnavailableUsePoints[index])
    && (value.evidence.available ? value.evidence.error === null : Boolean(value.evidence.error))
  const environmentMatches = usePoints.every((item) => (
    item.plan.execution_environment === value.execution_environment
  ))

  return summaryMatches
    && evidenceMatches
    && environmentMatches
    && value.source === 'published_ai_platform_assets'
    && value.truth_contract.legacy_model_policy_consumed === false
    && value.truth_contract.environment_route_fallback_consumed === false
    && value.truth_contract.configured_or_published_is_not_verified === true
}

export interface ScopedRoleAssignment {
  roleId: string
  roleName: string
  roleCode: string
  scopeType: 'org' | 'department' | 'space'
  scopeId: string | null
  scopeName: string
  grantedAt: string | null
}

export interface OrgSummaryUser {
  directory_identity_id?: string
  directory_external_id?: string
  directory_source?: string
  directory_status?: string
  directory_pending_account?: boolean
  department_ids?: string[]
  secondary_dept_names?: string[]
  id: string
  email: string
  phone?: string | null
  display_name: string
  title: string
  primary_dept_name: string
  primary_dept_id?: string | null
  role_names: string
  can_preassign_org_roles?: boolean
  pending_org_roles?: { id: string; code: string; name: string }[]
  role_ids?: string[]
  role_codes?: string[]
  scoped_roles?: ScopedRoleAssignment[]
  status: string
  membership_status?: 'invited' | 'active' | 'suspended' | 'ended'
  employment_status?: 'active' | 'suspended' | 'ended'
  login_enabled?: boolean
  report_to_user_id?: string | null
  report_to_user_name?: string | null
}

export interface OrgSummaryDepartment {
  source?: string
  external_id?: string | null
  status?: string
  id: string
  name: string
  code?: string | null
  depth?: number
  parent_id?: string | null
  parent_name: string | null
  member_count: number
  leader_id?: string | null
  leader_name?: string | null
}

export interface OrgSummaryRole {
  id: string
  code: string
  name: string
}

export interface OrgSummarySpace {
  id: string
  name: string
  description?: string | null
  department_id: string
  department_name: string
  owner_id?: string | null
}

export interface OrgSummaryPayload {
  organization?: {
    id: string
    name: string
    slug?: string | null
  }
  users: OrgSummaryUser[]
  departments: OrgSummaryDepartment[]
  roles: OrgSummaryRole[]
  spaces: OrgSummarySpace[]
}

export type FeishuSyncFeedbackStatus = 'success' | 'warning' | 'error'

export interface FeishuSyncFeedback {
  status: FeishuSyncFeedbackStatus
  title: string
  message: string
  detail?: string
}

export interface PermissionCatalogItem {
  key: string
  label: string
  description: string
}

export interface PermissionCatalogGroup {
  id: string
  label: string
  description: string
  items: PermissionCatalogItem[]
}

export type ConfigTabId =
  | 'price-list' | 'rules' | 'tax' | 'approval' | 'ai' | 'theme' | 'org-structure' | 'integrations' | 'role-access'
  | 'business-params' | 'field-dictionary' | 'numbering-rules'
  | 'product-versions' | 'price-matrix' | 'price-matrix-import'
  | 'approval-chains' | 'approval-rules' | 'clause-mappings' | 'output-templates' | 'shipping'
export type ConfigSectionId = 'trading' | 'contract-rules' | 'contract-ai' | 'ai-platform' | 'org-access' | 'experience' | 'quote-output' | 'shipping'

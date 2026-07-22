import { createHash } from 'node:crypto'

import {
  adjudicateExtractedCandidate,
  evaluateFactPredicate,
  resolveAdjudicationConflicts,
  validateExtractedFacts,
  validateDeterministicAdjudicationRule,
  type AdjudicationResult,
  type DeterministicAdjudicationRule,
  type DeterministicReviewCriteria,
  type ConflictResolution,
} from './deterministic-adjudicator'
import {
  resolveFrozenChunkSourceQuote,
  type FrozenReviewChunkProof,
  type PublishedReviewRule,
} from './review-workbench'

export interface FactsOnlyCandidate {
  rule_code: string
  source_quote: string
  facts: Record<string, unknown>
}

export interface FactsOnlyExtraction {
  candidates: FactsOnlyCandidate[]
  coverage: FactsOnlyRuleCoverage[]
  summary: string
}

export interface FactsOnlyRuleCoverage {
  rule_code: string
  status: 'observed' | 'not_observed' | 'uncertain'
}

export interface FactsOnlyCoverageNormalization {
  rule_code: string
  from: FactsOnlyRuleCoverage['status']
  to: 'observed' | 'uncertain'
  reason: 'observed_without_candidate' | 'candidate_present'
}

export interface FactsOnlyTrustedContextNormalization {
  candidate_index: number
  rule_code: string
  fact: string
  reason: 'model_value_discarded'
}

export interface FactsOnlyModelFactNormalization {
  candidate_index: number
  rule_code: string
  fact: string
  replacement: string | null
  reason: 'enum_alias_canonicalized' | 'out_of_enum_to_unknown' | 'out_of_enum_to_null'
}

export interface FactsOnlySourceAnchorNormalization {
  candidate_index: number
  rule_code: string
  source_quote_sha256: string
  reason: 'unrecoverable_source_quote_discarded'
}

const extractionCoverageNormalizations = new WeakMap<
  FactsOnlyExtraction,
  FactsOnlyCoverageNormalization[]
>()

const extractionTrustedContextNormalizations = new WeakMap<
  FactsOnlyExtraction,
  FactsOnlyTrustedContextNormalization[]
>()

const extractionModelFactNormalizations = new WeakMap<
  FactsOnlyExtraction,
  FactsOnlyModelFactNormalization[]
>()

const extractionSourceAnchorNormalizations = new WeakMap<
  FactsOnlyExtraction,
  FactsOnlySourceAnchorNormalization[]
>()

export function getFactsOnlyExtractionCoverageNormalizations(
  extraction: FactsOnlyExtraction,
): FactsOnlyCoverageNormalization[] {
  return (extractionCoverageNormalizations.get(extraction) || []).map((item) => ({ ...item }))
}

export function getFactsOnlyExtractionTrustedContextNormalizations(
  extraction: FactsOnlyExtraction,
): FactsOnlyTrustedContextNormalization[] {
  return (extractionTrustedContextNormalizations.get(extraction) || []).map((item) => ({ ...item }))
}

export function getFactsOnlyExtractionModelFactNormalizations(
  extraction: FactsOnlyExtraction,
): FactsOnlyModelFactNormalization[] {
  return (extractionModelFactNormalizations.get(extraction) || []).map((item) => ({ ...item }))
}

export function getFactsOnlyExtractionSourceAnchorNormalizations(
  extraction: FactsOnlyExtraction,
): FactsOnlySourceAnchorNormalization[] {
  return (extractionSourceAnchorNormalizations.get(extraction) || []).map((item) => ({ ...item }))
}

export interface FactsOnlyDocumentCoverage {
  rule_code: string
  presence: 'present' | 'missing_candidate' | 'unknown'
  /**
   * This describes the evidence we actually possess; it is not itself a legal
   * decision. In particular, complete_not_observed_coverage may only become a
   * missing-clause finding when the frozen rule contract explicitly says so.
   */
  evidence_basis:
    | 'source_span_candidates'
    | 'complete_not_observed_coverage'
    | 'uncertain_coverage'
  candidate_ids: string[]
  chunk_statuses: Array<{
    chunk_index: number
    status: FactsOnlyRuleCoverage['status']
  }>
}

export interface AdjudicatedFactsOnlyCandidate {
  candidate_id: string
  rule_code: string
  rule_snapshot_id: string
  candidate_source_quote: string
  source_exact_text: string
  source_quote_normalization: 'exact' | 'whitespace_only'
  source_start: number
  source_end: number
  source_chunk: FrozenReviewChunkProof
  raw_facts: Record<string, unknown>
  normalized_facts: Record<string, unknown>
  /** Diagnostic only. Database provenance must use its own frozen jsonb hash. */
  criteria_diagnostic_fingerprint: string
  level_results: { A: boolean; B: boolean; C: boolean }
  result: AdjudicationResult
}

export interface FactsOnlyChunkAdjudicationBatch {
  summary: string
  candidates: AdjudicatedFactsOnlyCandidate[]
  coverage: FactsOnlyRuleCoverage[]
  chunk: FrozenReviewChunkProof
  rule_catalog_fingerprint: string
  conflicts: ConflictResolution
  provisional_materialized_candidate_ids: string[]
}

export interface FactsOnlyAdjudicationBatch {
  summary: string
  candidates: AdjudicatedFactsOnlyCandidate[]
  coverage: FactsOnlyRuleCoverage[]
  document_coverage: FactsOnlyDocumentCoverage[]
  rule_catalog_fingerprint: string
  conflicts: ConflictResolution
  materialized_candidate_ids: string[]
}

export interface FactsOnlyAdjudicationTraceInput {
  model_invocation_id: string
  candidate_id: string
  rule_code: string
  candidate_source_quote: string
  source_start: number
  source_end: number
  raw_facts: Record<string, unknown>
  normalized_facts: Record<string, unknown>
  level_results: { A: boolean; B: boolean; C: boolean }
  matched_levels: Array<'A' | 'B' | 'C'>
  decision: 'no_risk' | 'materialize' | 'suppressed_unknown' | 'suppressed_conflict'
  reason_code: string
  suppressed_by_candidate_id: string | null
}

export interface FactsOnlyDocumentAdjudicationInput {
  rule_snapshot_id: string
  rule_code: string
  evidence_basis: 'complete_not_observed_coverage' | 'uncertain_coverage'
  decision: 'no_risk' | 'materialize'
  severity: 'yellow' | 'red' | null
  materialize: boolean
  reason_code:
    | 'complete_not_observed_no_finding'
    | 'required_clause_absent_yellow'
    | 'required_clause_absent_red'
    | 'uncertain_coverage_manual_review'
}

export interface FactsOnlyStageIdentity {
  run_id: string
  document_run_id: string
}

export interface FactsCompletionReviewResult {
  risks: Array<{
    level: 'red' | 'yellow' | 'green'
    title: string
    description: string
    suggestion: string
    source_quote?: string | null
    candidate_source_quote?: string | null
    source_quote_normalization?: 'exact' | 'whitespace_only' | null
    rule_code?: string | null
    rule_snapshot_id?: string | null
    source_start?: number | null
    source_end?: number | null
    source_chunk?: FrozenReviewChunkProof | null
  }>
  summary: string
  appliedRules: number
  matchedRules: number
  provider: string
  degraded: false
  usage: { inputTokens?: number; outputTokens?: number; totalTokens: number }
  evidence_contract: 'facts_v1'
  fact_run_id: string
  document_run_id: string
  completion_receipt_id: string
}

export interface FactsCompletionReceipt {
  receipt_id: string
  fact_run_id: string
  document_run_id: string
  risk_card_ids: string[]
  model_invocation_ids: string[]
  total_tokens: number
  provider: string
  degraded: false
  review_result: FactsCompletionReviewResult
  idempotent: boolean
  review_completed: true
}

export class FactsOnlyRuntimeError extends Error {
  constructor(
    public readonly code:
      | 'OUTPUT_INVALID'
      | 'RULE_CATALOG_INVALID'
      | 'CHUNK_PROVENANCE_INVALID'
      | 'SOURCE_ANCHOR_INVALID'
      | 'ADJUDICATION_REJECTED'
      | 'CONFLICT_RESOLUTION_REJECTED',
    message: string,
  ) {
    super(message)
    this.name = 'FactsOnlyRuntimeError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUniqueUuidArray(value: unknown, allowEmpty: boolean): value is string[] {
  return Array.isArray(value)
    && (allowEmpty || value.length > 0)
    && value.every((item) => typeof item === 'string' && UUID_PATTERN.test(item))
    && new Set(value).size === value.length
}

function describeFactsWorkerError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (isRecord(error)) {
    return ['code', 'message', 'details', 'hint'].flatMap((key) => {
      const value = error[key]
      return typeof value === 'string' && value.trim() ? [`${key}=${value.trim()}`] : []
    }).join(' | ')
  }
  return String(error)
}

export function isUncertainDatabaseTransportError(error: unknown): boolean {
  const record = isRecord(error) ? error : {}
  const code = typeof record.code === 'string' ? record.code.trim() : ''
  if (/^08[0-9A-Z]{3}$/i.test(code)) return true
  if (/^[0-9A-Z]{5}$/i.test(code)) return false
  const message = describeFactsWorkerError(error).toLowerCase()
  return [
    'fetch failed',
    'network',
    'connection reset',
    'connection closed',
    'socket hang up',
    'econnreset',
    'timed out',
    'timeout',
    'request aborted',
  ].some((fragment) => message.includes(fragment))
}

/**
 * Resume is reserved for failures that a new lease can actually repair. A
 * frozen-schema or source-validation rejection is deterministic for the same
 * canonical payload and must not spend a second full provider pass.
 */
export function isRetryableFactsOnlyRunError(error: unknown): boolean {
  const message = describeFactsWorkerError(error).toLowerCase()
  if (!message.startsWith('facts_only_extraction_failed:')
      && !message.startsWith('facts_only_invocation_checkpoint_write_failed:')) {
    return false
  }
  const deterministicFragments = [
    'deterministic_validation:',
    'failed the frozen schema',
    'facts-only output',
    'unknown or missing fields',
    'unknown rule_code',
    'coverage ',
    'source_anchor',
    'fact_chunk_checkpoint_',
    'facts_chunk_checkpoint_receipt_invalid',
    '23514',
    '42501',
  ]
  if (deterministicFragments.some((fragment) => message.includes(fragment))) return false
  return [
    'fetch failed',
    'network',
    'connection reset',
    'connection closed',
    'socket hang up',
    'econnreset',
    'timed out',
    'timeout',
    'request aborted',
    'provider_unhealthy',
  ].some((fragment) => message.includes(fragment))
}

export function parseFactsCompletionReceipt(
  value: unknown,
  expected: FactsOnlyStageIdentity,
): FactsCompletionReceipt {
  const candidate = Array.isArray(value) ? value[0] : value
  if (!isRecord(candidate)) throw new Error('facts_completion_receipt_invalid')
  if (
    typeof candidate.receipt_id !== 'string'
    || !UUID_PATTERN.test(candidate.receipt_id)
    || candidate.fact_run_id !== expected.run_id
    || candidate.document_run_id !== expected.document_run_id
    || !isUniqueUuidArray(candidate.risk_card_ids, true)
    || !isUniqueUuidArray(candidate.model_invocation_ids, false)
    || typeof candidate.total_tokens !== 'number'
    || !Number.isSafeInteger(candidate.total_tokens)
    || candidate.total_tokens <= 0
    || typeof candidate.provider !== 'string'
    || !candidate.provider.trim()
    || candidate.degraded !== false
    || typeof candidate.idempotent !== 'boolean'
    || candidate.review_completed !== true
    || !isRecord(candidate.review_result)
  ) {
    throw new Error('facts_completion_receipt_contract_invalid')
  }

  const review = candidate.review_result
  const usage = isRecord(review.usage) ? review.usage : null
  if (
    review.evidence_contract !== 'facts_v1'
    || review.fact_run_id !== expected.run_id
    || review.document_run_id !== expected.document_run_id
    || review.completion_receipt_id !== candidate.receipt_id
    || !Array.isArray(review.risks)
    || typeof review.summary !== 'string'
    || !review.summary.trim()
    || typeof review.appliedRules !== 'number'
    || !Number.isSafeInteger(review.appliedRules)
    || review.appliedRules <= 0
    || typeof review.matchedRules !== 'number'
    || !Number.isSafeInteger(review.matchedRules)
    || review.matchedRules < 0
    || review.matchedRules !== review.risks.length
    || candidate.risk_card_ids.length !== review.risks.length
    || review.provider !== candidate.provider
    || review.degraded !== false
    || !usage
    || usage.totalTokens !== candidate.total_tokens
  ) {
    throw new Error('facts_completion_review_result_invalid')
  }

  for (const risk of review.risks) {
    if (!isRecord(risk)) throw new Error('facts_completion_risk_invalid')
    const start = risk.source_start
    const end = risk.source_end
    const hasNoAnchor = start === null && end === null
    const hasExactRange = typeof start === 'number'
      && Number.isSafeInteger(start)
      && typeof end === 'number'
      && Number.isSafeInteger(end)
      && end > start
    if (
      !['red', 'yellow'].includes(String(risk.level))
      || typeof risk.title !== 'string'
      || !risk.title.trim()
      || typeof risk.description !== 'string'
      || !risk.description.trim()
      || typeof risk.suggestion !== 'string'
      || !risk.suggestion.trim()
      || (!hasNoAnchor && !hasExactRange)
    ) {
      throw new Error('facts_completion_risk_invalid')
    }
  }

  return {
    receipt_id: candidate.receipt_id,
    fact_run_id: expected.run_id,
    document_run_id: expected.document_run_id,
    risk_card_ids: candidate.risk_card_ids,
    model_invocation_ids: candidate.model_invocation_ids,
    total_tokens: candidate.total_tokens,
    provider: candidate.provider,
    degraded: false,
    review_result: review as unknown as FactsCompletionReviewResult,
    idempotent: candidate.idempotent,
    review_completed: true,
  }
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]) {
  const actual = Object.keys(value).sort()
  const target = [...expected].sort()
  return actual.length === target.length && actual.every((key, index) => key === target[index])
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function cloneFacts(facts: Record<string, unknown>): Record<string, unknown> {
  return Object.freeze(Object.fromEntries(Object.entries(facts).map(([key, value]) => [
    key,
    Array.isArray(value) ? Object.freeze([...value]) : value,
  ])))
}

function ruleCatalogFingerprint(
  compiled: Array<{ deterministic: DeterministicAdjudicationRule }>,
) {
  return sha256(canonicalJson(compiled.map(({ deterministic }) => deterministic)))
}

function toDeterministicRule(rule: PublishedReviewRule): DeterministicAdjudicationRule {
  const deterministicRule: DeterministicAdjudicationRule = {
    rule_code: rule.code,
    rule_snapshot_id: rule.snapshot_id,
    review_criteria: rule.review_criteria as unknown as DeterministicReviewCriteria,
    default_unknown: rule.default_unknown as DeterministicAdjudicationRule['default_unknown'],
    conflict_group: rule.conflict_group || null,
    mutually_exclusive_with: rule.mutually_exclusive_with || [],
    specificity: rule.specificity as number,
  }
  const errors = [
    ...(rule.criteria_schema_version === 1 ? [] : ['criteria_schema_version must be 1']),
    ...validateDeterministicAdjudicationRule(deterministicRule),
  ]
  if (errors.length > 0) {
    throw new FactsOnlyRuntimeError(
      'RULE_CATALOG_INVALID',
      `${rule.code || '(missing code)'}: ${errors.join('; ')}`,
    )
  }
  return deterministicRule
}

function compileRules(rules: PublishedReviewRule[]) {
  if (rules.length === 0) {
    throw new FactsOnlyRuntimeError('RULE_CATALOG_INVALID', 'facts-only runtime requires at least one frozen rule')
  }
  const codes = rules.map((rule) => rule.code)
  if (new Set(codes).size !== codes.length) {
    throw new FactsOnlyRuntimeError('RULE_CATALOG_INVALID', 'frozen rule codes must be unique')
  }
  return rules.map((published) => ({ published, deterministic: toDeterministicRule(published) }))
}

/**
 * Strict structured-output schema for the extraction stage. The model may
 * quote source text and return typed facts, but there is deliberately no
 * `level`, `severity`, title, suggestion or snapshot UUID field to hallucinate.
 */
export function buildFactsOnlyExtractionJsonSchema(rules: PublishedReviewRule[]) {
  const compiled = compileRules(rules)
  const ruleCodes = compiled.map(({ deterministic }) => deterministic.rule_code)
  return {
    type: 'object',
    additionalProperties: false,
    required: ['candidates', 'coverage', 'summary'],
    properties: {
      candidates: {
        type: 'array',
        // Keep the transport grammar compact. Expanding one object schema per
        // frozen rule duplicated the entire catalogue in llama.cpp's grammar
        // and produced unbounded generation time on real contract chunks.
        // validateFactsOnlyExtraction remains the authoritative per-rule fact
        // schema, trusted-context and 100/1000/5000 bound check.
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['rule_code', 'source_quote', 'facts'],
          properties: {
            rule_code: { type: 'string', enum: ruleCodes },
            source_quote: { type: 'string', minLength: 4 },
            facts: { type: 'object' },
          },
        },
      },
      coverage: {
        type: 'array',
        minItems: compiled.length,
        maxItems: compiled.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['rule_code', 'status'],
          properties: {
            rule_code: { type: 'string', enum: ruleCodes },
            status: { type: 'string', enum: ['observed', 'not_observed', 'uncertain'] },
          },
        },
      },
      summary: { type: 'string', minLength: 1 },
    },
  }
}

export function buildFactsOnlyExtractionInstruction(rules: PublishedReviewRule[]) {
  const compiled = compileRules(rules)
  const catalogue = compiled.map(({ published, deterministic }) => ({
    rule_code: deterministic.rule_code,
    name: published.name,
    description: published.description || null,
    clause_category: published.clause_category || null,
    fact_schema: deterministic.review_criteria.fact_schema,
  }))
  return [
    '只提取合同原文中的白名单事实，不判断风险等级。',
    '严格输出 JSON：{"candidates":[{"rule_code":"...","source_quote":"逐字原文","facts":{}}],"coverage":[{"rule_code":"...","status":"observed|not_observed|uncertain"}],"summary":"..."}。',
    '不得输出 level、severity、title、description、suggestion、candidate_id 或 rule_snapshot_id。',
    'source_quote 必须是当前输入分块中逐字可定位的连续原文；事实未知时使用 schema 允许的 null，不得猜测。',
    'fact_schema 中 source=trusted_context 的字段不属于模型权限，必须严格输出 null；服务端没有受信来源时也保持 null。',
    'string enum 字段只能逐字选择 fact_schema.enum 中的值，不得翻译或输出解释；无法分类且 enum 包含 unknown 时必须输出 unknown。',
    'coverage 必须逐条覆盖冻结目录中的全部 rule_code，且每个 code 恰好一次；只有实际输出了逐字引文 candidate 的 code 才能标记 observed。无法同时给出 candidate 时必须用 uncertain 或 not_observed；服务端会把无 candidate 的 observed 保守降级为 uncertain。',
    `冻结规则事实目录：${JSON.stringify(catalogue)}`,
  ].join('\n')
}

export function validateFactsOnlyExtraction(
  parsed: unknown,
  rules: PublishedReviewRule[],
): FactsOnlyExtraction {
  const compiled = compileRules(rules)
  const ruleCodes = new Set(compiled.map(({ deterministic }) => deterministic.rule_code))
  const ruleByCode = new Map(compiled.map(({ deterministic }) => [deterministic.rule_code, deterministic]))
  if (!isRecord(parsed) || !hasExactKeys(parsed, ['candidates', 'coverage', 'summary'])) {
    throw new FactsOnlyRuntimeError('OUTPUT_INVALID', 'facts-only output has unknown or missing top-level fields')
  }
  if (typeof parsed.summary !== 'string' || parsed.summary.length < 1 || parsed.summary.length > 5000) {
    throw new FactsOnlyRuntimeError('OUTPUT_INVALID', 'summary must contain 1-5000 characters')
  }
  if (!Array.isArray(parsed.candidates) || parsed.candidates.length > 100) {
    throw new FactsOnlyRuntimeError('OUTPUT_INVALID', 'candidates must be an array with at most 100 entries')
  }

  const duplicates = new Set<string>()
  const candidates = parsed.candidates.map((candidate, index): FactsOnlyCandidate => {
    if (!isRecord(candidate) || !hasExactKeys(candidate, ['rule_code', 'source_quote', 'facts'])) {
      throw new FactsOnlyRuntimeError('OUTPUT_INVALID', `candidate[${index}] has unknown or missing fields`)
    }
    if (typeof candidate.rule_code !== 'string' || !ruleCodes.has(candidate.rule_code)) {
      throw new FactsOnlyRuntimeError('OUTPUT_INVALID', `candidate[${index}] references an unknown rule_code`)
    }
    if (
      typeof candidate.source_quote !== 'string'
      || candidate.source_quote.trim().length < 4
      || candidate.source_quote.length > 1000
    ) {
      throw new FactsOnlyRuntimeError('OUTPUT_INVALID', `candidate[${index}].source_quote is invalid`)
    }
    if (!isRecord(candidate.facts)) {
      throw new FactsOnlyRuntimeError('OUTPUT_INVALID', `candidate[${index}].facts must be an object`)
    }
    const factSchema = ruleByCode.get(candidate.rule_code)!.review_criteria.fact_schema
    const factErrors = validateExtractedFacts(factSchema, candidate.facts)
    for (const [fact, definition] of Object.entries(factSchema)) {
      if (definition.source === 'trusted_context' && candidate.facts[fact] !== null) {
        factErrors.push(`facts.${fact} is reserved for trusted_context and must be null in model output`)
      }
    }
    if (factErrors.length > 0) {
      throw new FactsOnlyRuntimeError(
        'OUTPUT_INVALID',
        `candidate[${index}].facts failed the frozen schema: ${factErrors.join('; ')}`,
      )
    }
    const duplicateKey = `${candidate.rule_code}\u0000${candidate.source_quote}`
    if (duplicates.has(duplicateKey)) {
      throw new FactsOnlyRuntimeError('OUTPUT_INVALID', `candidate[${index}] duplicates the same rule and quote`)
    }
    duplicates.add(duplicateKey)
    return {
      rule_code: candidate.rule_code,
      source_quote: candidate.source_quote,
      facts: cloneFacts(candidate.facts),
    }
  })
  if (!Array.isArray(parsed.coverage) || parsed.coverage.length !== ruleCodes.size) {
    throw new FactsOnlyRuntimeError('OUTPUT_INVALID', 'coverage must contain every frozen rule exactly once')
  }
  const coverageCodes = new Set<string>()
  const coverage = parsed.coverage.map((item, index): FactsOnlyRuleCoverage => {
    if (!isRecord(item) || !hasExactKeys(item, ['rule_code', 'status'])) {
      throw new FactsOnlyRuntimeError('OUTPUT_INVALID', `coverage[${index}] has unknown or missing fields`)
    }
    if (typeof item.rule_code !== 'string' || !ruleCodes.has(item.rule_code)) {
      throw new FactsOnlyRuntimeError('OUTPUT_INVALID', `coverage[${index}] references an unknown rule_code`)
    }
    if (coverageCodes.has(item.rule_code)) {
      throw new FactsOnlyRuntimeError('OUTPUT_INVALID', `coverage duplicates ${item.rule_code}`)
    }
    if (!['observed', 'not_observed', 'uncertain'].includes(String(item.status))) {
      throw new FactsOnlyRuntimeError('OUTPUT_INVALID', `coverage[${index}].status is invalid`)
    }
    coverageCodes.add(item.rule_code)
    return {
      rule_code: item.rule_code,
      status: item.status as FactsOnlyRuleCoverage['status'],
    }
  })
  if (coverageCodes.size !== ruleCodes.size || [...ruleCodes].some((code) => !coverageCodes.has(code))) {
    throw new FactsOnlyRuntimeError('OUTPUT_INVALID', 'coverage does not match the frozen rule catalogue')
  }
  const candidateRuleCodes = new Set(candidates.map((candidate) => candidate.rule_code))
  const normalizations: FactsOnlyCoverageNormalization[] = []
  const normalizedCoverage = coverage.map((item): FactsOnlyRuleCoverage => {
    const hasCandidate = candidateRuleCodes.has(item.rule_code)
    if (item.status === 'observed' && !hasCandidate) {
      normalizations.push({
        rule_code: item.rule_code,
        from: 'observed',
        to: 'uncertain',
        reason: 'observed_without_candidate',
      })
      return { ...item, status: 'uncertain' }
    }
    if (item.status !== 'observed' && hasCandidate) {
      normalizations.push({
        rule_code: item.rule_code,
        from: item.status,
        to: 'observed',
        reason: 'candidate_present',
      })
      return { ...item, status: 'observed' }
    }
    return item
  })
  for (const item of normalizedCoverage) {
    if ((item.status === 'observed') !== candidateRuleCodes.has(item.rule_code)) {
      throw new FactsOnlyRuntimeError(
        'OUTPUT_INVALID',
        `coverage ${item.rule_code} is inconsistent with extracted candidates`,
      )
    }
  }
  const extraction = { candidates, coverage: normalizedCoverage, summary: parsed.summary }
  if (normalizations.length > 0) {
    extractionCoverageNormalizations.set(extraction, normalizations)
  }
  return extraction
}

function neutralizeTrustedContextFactsFromModel(
  parsed: unknown,
  rules: PublishedReviewRule[],
): FactsOnlyTrustedContextNormalization[] {
  const compiled = compileRules(rules)
  const ruleByCode = new Map(compiled.map(({ deterministic }) => [
    deterministic.rule_code,
    deterministic,
  ]))
  if (!isRecord(parsed) || !Array.isArray(parsed.candidates)) return []

  const normalizations: FactsOnlyTrustedContextNormalization[] = []
  parsed.candidates.forEach((candidate, candidateIndex) => {
    if (!isRecord(candidate) || typeof candidate.rule_code !== 'string' || !isRecord(candidate.facts)) {
      return
    }
    const rule = ruleByCode.get(candidate.rule_code)
    if (!rule) return
    for (const [fact, definition] of Object.entries(rule.review_criteria.fact_schema)) {
      if (
        definition.source === 'trusted_context'
        && Object.prototype.hasOwnProperty.call(candidate.facts, fact)
        && candidate.facts[fact] !== null
      ) {
        candidate.facts[fact] = null
        normalizations.push({
          candidate_index: candidateIndex,
          rule_code: candidate.rule_code,
          fact,
          reason: 'model_value_discarded',
        })
      }
    }
  })
  return normalizations
}

function normalizedEnumToken(value: string) {
  return value.trim().toLowerCase().replace(/[\s-]+/gu, '_')
}

/**
 * Models occasionally return a label or prose where the frozen contract asks
 * for one enum token. Transport may canonicalize only an unambiguous spelling
 * alias. Every other string becomes the explicitly configured `unknown` (or a
 * nullable null); it is never guessed into a business-bearing enum value.
 */
function normalizeModelFactEnums(
  parsed: unknown,
  rules: PublishedReviewRule[],
): FactsOnlyModelFactNormalization[] {
  const compiled = compileRules(rules)
  const ruleByCode = new Map(compiled.map(({ deterministic }) => [
    deterministic.rule_code,
    deterministic,
  ]))
  if (!isRecord(parsed) || !Array.isArray(parsed.candidates)) return []

  const normalizations: FactsOnlyModelFactNormalization[] = []
  parsed.candidates.forEach((candidate, candidateIndex) => {
    if (!isRecord(candidate) || typeof candidate.rule_code !== 'string' || !isRecord(candidate.facts)) {
      return
    }
    const rule = ruleByCode.get(candidate.rule_code)
    if (!rule) return
    for (const [fact, definition] of Object.entries(rule.review_criteria.fact_schema)) {
      if (
        definition.source === 'trusted_context'
        || definition.type !== 'string'
        || !definition.enum
        || !Object.prototype.hasOwnProperty.call(candidate.facts, fact)
      ) continue
      const value = candidate.facts[fact]
      if (typeof value !== 'string' || definition.enum.includes(value)) continue

      const token = normalizedEnumToken(value)
      const aliases = definition.enum.filter((allowed) => normalizedEnumToken(allowed) === token)
      let replacement: string | null | undefined
      let reason: FactsOnlyModelFactNormalization['reason'] | undefined
      if (aliases.length === 1) {
        replacement = aliases[0]
        reason = 'enum_alias_canonicalized'
      } else if (definition.enum.includes('unknown')) {
        replacement = 'unknown'
        reason = 'out_of_enum_to_unknown'
      } else if (definition.nullable) {
        replacement = null
        reason = 'out_of_enum_to_null'
      }
      if (reason === undefined || replacement === undefined) continue
      candidate.facts[fact] = replacement
      normalizations.push({
        candidate_index: candidateIndex,
        rule_code: candidate.rule_code,
        fact,
        replacement,
        reason,
      })
    }
  })
  return normalizations
}

export function parseFactsOnlyExtraction(rawOutput: string, rules: PublishedReviewRule[]): FactsOnlyExtraction {
  let parsed: unknown
  try {
    const trimmed = rawOutput.trim()
    const exactFence = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i.exec(trimmed)
    parsed = JSON.parse((exactFence?.[1] || trimmed).trim())
  } catch (error) {
    throw new FactsOnlyRuntimeError(
      'OUTPUT_INVALID',
      `facts-only output must be one JSON object: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const trustedContextNormalizations = neutralizeTrustedContextFactsFromModel(parsed, rules)
  const modelFactNormalizations = normalizeModelFactEnums(parsed, rules)
  const extraction = validateFactsOnlyExtraction(parsed, rules)
  if (trustedContextNormalizations.length > 0) {
    extractionTrustedContextNormalizations.set(extraction, trustedContextNormalizations)
  }
  if (modelFactNormalizations.length > 0) {
    extractionModelFactNormalizations.set(extraction, modelFactNormalizations)
  }
  return extraction
}

/**
 * A schema-valid model candidate is still not evidence until its quote can be
 * recovered exactly once inside the immutable executor chunk. Unrecoverable
 * candidates are discarded rather than retried or guessed; coverage is then
 * re-derived by the strict validator so the document decision remains a
 * conservative unknown/manual-review outcome.
 */
export function normalizeFactsOnlyExtractionSourceAnchors(
  extraction: FactsOnlyExtraction,
  chunkText: string,
  rules: PublishedReviewRule[],
): FactsOnlyExtraction {
  const inheritedCoverageNormalizations = getFactsOnlyExtractionCoverageNormalizations(extraction)
  const validated = validateFactsOnlyExtraction(extraction, rules)
  const normalizations: FactsOnlySourceAnchorNormalization[] = []
  const candidates = validated.candidates.filter((candidate, candidateIndex) => {
    if (resolveFrozenChunkSourceQuote(chunkText, candidate.source_quote)) return true
    normalizations.push({
      candidate_index: candidateIndex,
      rule_code: candidate.rule_code,
      source_quote_sha256: sha256(candidate.source_quote),
      reason: 'unrecoverable_source_quote_discarded',
    })
    return false
  })
  const normalized = validateFactsOnlyExtraction({
    candidates,
    coverage: validated.coverage,
    summary: validated.summary,
  }, rules)
  const coverageNormalizations = [
    ...inheritedCoverageNormalizations,
    ...getFactsOnlyExtractionCoverageNormalizations(normalized),
  ]
  if (coverageNormalizations.length > 0) {
    extractionCoverageNormalizations.set(normalized, coverageNormalizations)
  }
  if (normalizations.length > 0) {
    extractionSourceAnchorNormalizations.set(normalized, normalizations)
  }
  return normalized
}

export function serializeFactsOnlyExtractionForStage(
  extraction: FactsOnlyExtraction,
  rules: PublishedReviewRule[],
): string {
  return JSON.stringify(validateFactsOnlyExtraction(extraction, rules))
}

function verifyChunk(sourceText: string, chunk: FrozenReviewChunkProof) {
  if (
    !Number.isInteger(chunk.index)
    || !Number.isInteger(chunk.total)
    || !Number.isInteger(chunk.start)
    || !Number.isInteger(chunk.end)
    || chunk.index < 1
    || chunk.total < chunk.index
    || chunk.start < 0
    || chunk.end <= chunk.start
    || chunk.end > sourceText.length
    || !/^[0-9a-f]{64}$/i.test(chunk.hash)
  ) {
    throw new FactsOnlyRuntimeError('CHUNK_PROVENANCE_INVALID', 'frozen chunk coordinates are invalid')
  }
  const chunkText = sourceText.slice(chunk.start, chunk.end)
  if (sha256(chunkText) !== chunk.hash.toLowerCase()) {
    throw new FactsOnlyRuntimeError('CHUNK_PROVENANCE_INVALID', 'frozen chunk hash does not match source text')
  }
  return chunkText
}

export function adjudicateParsedFactsOnlyExtractionChunk(input: {
  extraction: FactsOnlyExtraction
  source_text: string
  chunk: FrozenReviewChunkProof
  rules: PublishedReviewRule[]
}): FactsOnlyChunkAdjudicationBatch {
  const compiled = compileRules(input.rules)
  const catalogFingerprint = ruleCatalogFingerprint(compiled)
  const ruleByCode = new Map(compiled.map((rule) => [rule.deterministic.rule_code, rule]))
  const chunkText = verifyChunk(input.source_text, input.chunk)
  const extraction = validateFactsOnlyExtraction(input.extraction, input.rules)
  const candidates = extraction.candidates.map((candidate, index): AdjudicatedFactsOnlyCandidate => {
    const bound = ruleByCode.get(candidate.rule_code)!
    const resolved = resolveFrozenChunkSourceQuote(chunkText, candidate.source_quote)
    if (!resolved) {
      throw new FactsOnlyRuntimeError(
        'SOURCE_ANCHOR_INVALID',
        `candidate[${index}] quote is not uniquely recoverable inside frozen chunk ${input.chunk.index}/${input.chunk.total}`,
      )
    }
    const sourceStart = input.chunk.start + resolved.start
    const sourceEnd = input.chunk.start + resolved.end
    const candidateId = `fact-${sha256(canonicalJson({
      rule_snapshot_id: bound.deterministic.rule_snapshot_id,
      source_start: sourceStart,
      source_end: sourceEnd,
      facts: candidate.facts,
    })).slice(0, 24)}`
    const rawFacts = cloneFacts(candidate.facts)
    const normalizedFacts = cloneFacts(candidate.facts)
    const extracted = {
      id: candidateId,
      rule_code: candidate.rule_code,
      source_start: sourceStart,
      source_end: sourceEnd,
      facts: normalizedFacts,
    }
    const result = adjudicateExtractedCandidate(bound.deterministic, extracted)
    if (!result.ok) {
      throw new FactsOnlyRuntimeError(
        'ADJUDICATION_REJECTED',
        `${candidate.rule_code}/${candidateId}: ${result.reason_code}: ${result.errors.join('; ')}`,
      )
    }
    const criteria = bound.deterministic.review_criteria
    return {
      candidate_id: candidateId,
      rule_code: candidate.rule_code,
      rule_snapshot_id: bound.deterministic.rule_snapshot_id,
      candidate_source_quote: candidate.source_quote,
      source_exact_text: resolved.exactText,
      source_quote_normalization: resolved.normalization,
      source_start: sourceStart,
      source_end: sourceEnd,
      source_chunk: input.chunk,
      raw_facts: rawFacts,
      normalized_facts: normalizedFacts,
      criteria_diagnostic_fingerprint: sha256(canonicalJson(criteria)),
      level_results: {
        A: evaluateFactPredicate(criteria.level_a, candidate.facts),
        B: evaluateFactPredicate(criteria.level_b, candidate.facts),
        C: evaluateFactPredicate(criteria.level_c, candidate.facts),
      },
      result,
    }
  })
  const conflicts = resolveAdjudicationConflicts(candidates.map((candidate) => candidate.result))
  if (!conflicts.ok) {
    throw new FactsOnlyRuntimeError(
      'CONFLICT_RESOLUTION_REJECTED',
      conflicts.errors.join('; '),
    )
  }

  return {
    summary: extraction.summary,
    candidates,
    coverage: extraction.coverage,
    chunk: input.chunk,
    rule_catalog_fingerprint: catalogFingerprint,
    conflicts,
    provisional_materialized_candidate_ids: conflicts.materialized.map((decision) => decision.candidate.id),
  }
}

export function adjudicateFactsOnlyExtractionChunk(input: {
  raw_output: string
  source_text: string
  chunk: FrozenReviewChunkProof
  rules: PublishedReviewRule[]
}): FactsOnlyChunkAdjudicationBatch {
  // Source identity is cheaper and more authoritative than parsing untrusted
  // model output, so stale chunks fail before any output work.
  verifyChunk(input.source_text, input.chunk)
  return adjudicateParsedFactsOnlyExtractionChunk({
    extraction: parseFactsOnlyExtraction(input.raw_output, input.rules),
    source_text: input.source_text,
    chunk: input.chunk,
    rules: input.rules,
  })
}

/**
 * Collapse overlapping executor chunks before persistence. The same frozen
 * rule and global source span may repeat with identical facts; conflicting
 * facts for that identity reject the entire document instead of producing two
 * cards. Conflict specificity is then evaluated once across all chunks.
 */
export function mergeFactsOnlyAdjudicationBatches(
  batches: FactsOnlyChunkAdjudicationBatch[],
  sourceText: string,
): FactsOnlyAdjudicationBatch {
  if (batches.length === 0) {
    throw new FactsOnlyRuntimeError('CHUNK_PROVENANCE_INVALID', 'facts-only merge requires every source chunk')
  }
  const orderedBatches = [...batches].sort((left, right) => left.chunk.index - right.chunk.index)
  const expectedTotal = orderedBatches[0].chunk.total
  const expectedCatalogFingerprint = orderedBatches[0].rule_catalog_fingerprint
  if (
    expectedTotal !== orderedBatches.length
    || new Set(orderedBatches.map((batch) => batch.chunk.index)).size !== orderedBatches.length
    || orderedBatches.some((batch, index) => (
      batch.chunk.total !== expectedTotal
      || batch.chunk.index !== index + 1
      || batch.rule_catalog_fingerprint !== expectedCatalogFingerprint
      || batch.chunk.end > sourceText.length
      || sha256(sourceText.slice(batch.chunk.start, batch.chunk.end)) !== batch.chunk.hash.toLowerCase()
    ))
  ) {
    throw new FactsOnlyRuntimeError(
      'CHUNK_PROVENANCE_INVALID',
      'facts-only merge requires one valid batch for every chunk index 1..N',
    )
  }
  const ranges = orderedBatches.map((batch) => batch.chunk)
  if (
    ranges[0].start !== 0
    || ranges[ranges.length - 1].end !== sourceText.length
    || ranges.some((range, index) => index > 0 && (
      range.start > ranges[index - 1].end
      || range.end <= ranges[index - 1].end
    ))
  ) {
    throw new FactsOnlyRuntimeError(
      'CHUNK_PROVENANCE_INVALID',
      'facts-only chunks do not cover the complete source in order',
    )
  }
  const expectedCoverageCodes = [...orderedBatches[0].coverage.map((item) => item.rule_code)].sort()
  if (orderedBatches.some((batch) => (
    JSON.stringify([...batch.coverage.map((item) => item.rule_code)].sort())
      !== JSON.stringify(expectedCoverageCodes)
  ))) {
    throw new FactsOnlyRuntimeError(
      'OUTPUT_INVALID',
      'facts-only chunk coverage catalogues do not match',
    )
  }

  const grouped = new Map<string, AdjudicatedFactsOnlyCandidate[]>()
  for (const candidate of orderedBatches.flatMap((batch) => batch.candidates)) {
    const key = [
      candidate.rule_snapshot_id,
      candidate.source_start,
      candidate.source_end,
    ].join(':')
    const current = grouped.get(key) || []
    current.push(candidate)
    grouped.set(key, current)
  }

  const candidates: AdjudicatedFactsOnlyCandidate[] = []
  for (const [identity, duplicates] of grouped) {
    const factFingerprints = new Set(duplicates.map((candidate) => canonicalJson(candidate.normalized_facts)))
    const exactTexts = new Set(duplicates.map((candidate) => candidate.source_exact_text))
    if (factFingerprints.size !== 1 || exactTexts.size !== 1) {
      throw new FactsOnlyRuntimeError(
        'ADJUDICATION_REJECTED',
        `overlapping chunks produced conflicting facts for ${identity}`,
      )
    }
    candidates.push([...duplicates].sort((left, right) => (
      left.source_chunk.index - right.source_chunk.index
      || left.candidate_id.localeCompare(right.candidate_id)
    ))[0])
  }
  candidates.sort((left, right) => (
    left.source_start - right.source_start
    || left.source_end - right.source_end
    || left.rule_snapshot_id.localeCompare(right.rule_snapshot_id)
  ))

  const conflicts = resolveAdjudicationConflicts(candidates.map((candidate) => candidate.result))
  if (!conflicts.ok) {
    throw new FactsOnlyRuntimeError(
      'CONFLICT_RESOLUTION_REJECTED',
      conflicts.errors.join('; '),
    )
  }
  const allRuleCodes = expectedCoverageCodes
  const documentCoverage = allRuleCodes.map((ruleCode): FactsOnlyDocumentCoverage => {
    const ruleCandidates = candidates.filter((candidate) => candidate.rule_code === ruleCode)
    const chunkStatuses = orderedBatches.map((batch) => {
      const coverage = batch.coverage.find((item) => item.rule_code === ruleCode)
      if (!coverage) {
        throw new FactsOnlyRuntimeError(
          'OUTPUT_INVALID',
          `chunk coverage is missing ${ruleCode}`,
        )
      }
      return {
        chunk_index: batch.chunk.index,
        status: coverage.status,
      }
    })
    const statuses = chunkStatuses.map((item) => item.status)
    const presence = statuses.includes('observed')
      ? 'present'
      : statuses.includes('uncertain')
        ? 'unknown'
        : 'missing_candidate'
    return {
      rule_code: ruleCode,
      presence,
      evidence_basis: presence === 'present'
        ? 'source_span_candidates'
        : presence === 'unknown'
          ? 'uncertain_coverage'
          : 'complete_not_observed_coverage',
      candidate_ids: ruleCandidates.map((candidate) => candidate.candidate_id),
      chunk_statuses: chunkStatuses,
    }
  })
  return {
    summary: orderedBatches.map((batch) => batch.summary).filter(Boolean).join('\n'),
    candidates,
    coverage: documentCoverage.map((item) => ({
      rule_code: item.rule_code,
      status: item.presence === 'present'
        ? 'observed'
        : item.presence === 'unknown'
          ? 'uncertain'
          : 'not_observed',
    })),
    document_coverage: documentCoverage,
    rule_catalog_fingerprint: expectedCatalogFingerprint,
    conflicts,
    materialized_candidate_ids: conflicts.materialized.map((decision) => decision.candidate.id),
  }
}

/**
 * Derive document-scope decisions without inventing a source candidate. The
 * frozen rule catalogue owns absence semantics; PostgreSQL independently
 * derives the same rows from immutable coverage before persistence.
 */
export function buildFactsOnlyDocumentAdjudicationInputs(
  batch: FactsOnlyAdjudicationBatch,
  rules: PublishedReviewRule[],
): FactsOnlyDocumentAdjudicationInput[] {
  const compiled = compileRules(rules)
  if (ruleCatalogFingerprint(compiled) !== batch.rule_catalog_fingerprint) {
    throw new FactsOnlyRuntimeError(
      'RULE_CATALOG_INVALID',
      'document adjudication rules do not match the merged frozen catalogue',
    )
  }
  const ruleByCode = new Map(compiled.map((item) => [item.deterministic.rule_code, item.deterministic]))
  return batch.document_coverage.flatMap((coverage): FactsOnlyDocumentAdjudicationInput[] => {
    if (coverage.presence === 'present') return []
    if (coverage.candidate_ids.length > 0) {
      throw new FactsOnlyRuntimeError(
        'ADJUDICATION_REJECTED',
        `${coverage.rule_code}: document-only evidence cannot reference source candidates`,
      )
    }
    const rule = ruleByCode.get(coverage.rule_code)
    if (!rule) {
      throw new FactsOnlyRuntimeError('RULE_CATALOG_INVALID', `${coverage.rule_code}: frozen rule is missing`)
    }
    if (coverage.evidence_basis === 'uncertain_coverage') {
      return [{
        rule_snapshot_id: rule.rule_snapshot_id,
        rule_code: rule.rule_code,
        evidence_basis: 'uncertain_coverage',
        decision: 'materialize',
        severity: 'yellow',
        materialize: true,
        reason_code: 'uncertain_coverage_manual_review',
      }]
    }
    if (coverage.evidence_basis !== 'complete_not_observed_coverage') {
      throw new FactsOnlyRuntimeError(
        'ADJUDICATION_REJECTED',
        `${coverage.rule_code}: unsupported document evidence basis`,
      )
    }
    const absenceDecision = rule.review_criteria.absence_decision
    if (absenceDecision === 'ignore') {
      return [{
        rule_snapshot_id: rule.rule_snapshot_id,
        rule_code: rule.rule_code,
        evidence_basis: 'complete_not_observed_coverage',
        decision: 'no_risk',
        severity: null,
        materialize: false,
        reason_code: 'complete_not_observed_no_finding',
      }]
    }
    const red = absenceDecision === 'red_risk'
    return [{
      rule_snapshot_id: rule.rule_snapshot_id,
      rule_code: rule.rule_code,
      evidence_basis: 'complete_not_observed_coverage',
      decision: 'materialize',
      severity: red ? 'red' : 'yellow',
      materialize: true,
      reason_code: red ? 'required_clause_absent_red' : 'required_clause_absent_yellow',
    }]
  })
}

/**
 * Convert the globally resolved document result into the only payload shape
 * accepted by the facts evidence staging RPC. Conflict losers are rewritten
 * here, after the full 1..N merge, so a provisional per-chunk `materialize`
 * decision can never be persisted as the final audit decision.
 */
export function buildFactsOnlyAdjudicationTraceInputs(
  batch: FactsOnlyAdjudicationBatch,
  invocationIdsByChunk: ReadonlyMap<number, string>,
): FactsOnlyAdjudicationTraceInput[] {
  if (!batch.conflicts.ok) {
    throw new FactsOnlyRuntimeError(
      'CONFLICT_RESOLUTION_REJECTED',
      batch.conflicts.errors.join('; ') || 'facts-only conflicts are unresolved',
    )
  }
  const suppressionByCandidate = new Map(
    batch.conflicts.suppressed.map((item) => [item.candidate_id, item]),
  )
  const expectedChunkIndices = new Set(
    batch.document_coverage.flatMap((item) => item.chunk_statuses.map((status) => status.chunk_index)),
  )
  if (
    expectedChunkIndices.size === 0
    || [...expectedChunkIndices].some((chunkIndex) => !invocationIdsByChunk.has(chunkIndex))
    || [...invocationIdsByChunk.keys()].some((chunkIndex) => !expectedChunkIndices.has(chunkIndex))
  ) {
    throw new FactsOnlyRuntimeError(
      'CHUNK_PROVENANCE_INVALID',
      'invocation identities must match every merged chunk exactly',
    )
  }
  return batch.candidates.map((candidate) => {
    if (!candidate.result.ok) {
      throw new FactsOnlyRuntimeError(
        'ADJUDICATION_REJECTED',
        `${candidate.candidate_id}: rejected candidate cannot enter the audit trace`,
      )
    }
    const invocationId = invocationIdsByChunk.get(candidate.source_chunk.index)
    if (!invocationId) {
      throw new FactsOnlyRuntimeError(
        'CHUNK_PROVENANCE_INVALID',
        `missing invocation identity for chunk ${candidate.source_chunk.index}`,
      )
    }
    const expectedCandidateId = `fact-${sha256(canonicalJson({
      rule_snapshot_id: candidate.rule_snapshot_id,
      source_start: candidate.source_start,
      source_end: candidate.source_end,
      facts: candidate.normalized_facts,
    })).slice(0, 24)}`
    if (
      candidate.candidate_id !== expectedCandidateId
      || canonicalJson(candidate.raw_facts) !== canonicalJson(candidate.normalized_facts)
      || sha256(canonicalJson(candidate.result.rule?.review_criteria))
        !== candidate.criteria_diagnostic_fingerprint
    ) {
      throw new FactsOnlyRuntimeError(
        'ADJUDICATION_REJECTED',
        `${candidate.candidate_id}: adjudicated facts changed after deterministic evaluation`,
      )
    }
    const replay = adjudicateExtractedCandidate(candidate.result.rule, {
      id: candidate.candidate_id,
      rule_code: candidate.rule_code,
      source_start: candidate.source_start,
      source_end: candidate.source_end,
      facts: candidate.normalized_facts,
    })
    const replayLevels = replay.ok ? replay.matched_levels : []
    if (
      !replay.ok
      || replay.decision !== candidate.result.decision
      || replay.reason_code !== candidate.result.reason_code
      || canonicalJson(replayLevels) !== canonicalJson(candidate.result.matched_levels)
      || candidate.level_results.A
        !== evaluateFactPredicate(candidate.result.rule.review_criteria.level_a, candidate.normalized_facts)
      || candidate.level_results.B
        !== evaluateFactPredicate(candidate.result.rule.review_criteria.level_b, candidate.normalized_facts)
      || candidate.level_results.C
        !== evaluateFactPredicate(candidate.result.rule.review_criteria.level_c, candidate.normalized_facts)
    ) {
      throw new FactsOnlyRuntimeError(
        'ADJUDICATION_REJECTED',
        `${candidate.candidate_id}: deterministic decision replay mismatch`,
      )
    }
    const suppression = suppressionByCandidate.get(candidate.candidate_id)
    return {
      model_invocation_id: invocationId,
      candidate_id: candidate.candidate_id,
      rule_code: candidate.rule_code,
      candidate_source_quote: candidate.candidate_source_quote,
      source_start: candidate.source_start,
      source_end: candidate.source_end,
      raw_facts: candidate.raw_facts,
      normalized_facts: candidate.normalized_facts,
      level_results: candidate.level_results,
      matched_levels: candidate.result.matched_levels,
      decision: suppression ? 'suppressed_conflict' : candidate.result.decision,
      reason_code: suppression ? suppression.reason_code : candidate.result.reason_code,
      suppressed_by_candidate_id: suppression?.suppressed_by_candidate_id || null,
    }
  })
}

export type FactScalar = string | number | boolean | null
export type FactValue = FactScalar | string[]

interface FactSchemaBase {
  required?: boolean
  nullable?: boolean
  /** Trusted facts are never accepted from model output. */
  source?: 'model' | 'trusted_context'
}

export type FactSchemaDefinition =
  | (FactSchemaBase & {
      type: 'string'
      enum?: string[]
      min_length?: number
    })
  | (FactSchemaBase & {
      type: 'number'
      min?: number
      max?: number
    })
  | (FactSchemaBase & {
      type: 'boolean'
    })
  | (FactSchemaBase & {
      type: 'string_array'
      enum?: string[]
      min_items?: number
      unique_items?: boolean
    })

export type FactSchema = Record<string, FactSchemaDefinition>

interface FactLeafPredicate {
  fact: string
}

export type FactPredicate =
  | { all: FactPredicate[] }
  | { any: FactPredicate[] }
  | { not: FactPredicate }
  | { eq: FactLeafPredicate & { value: FactScalar } }
  | { in: FactLeafPredicate & { values: FactScalar[] } }
  | { gt: FactLeafPredicate & { value: number } }
  | { gte: FactLeafPredicate & { value: number } }
  | { lt: FactLeafPredicate & { value: number } }
  | { lte: FactLeafPredicate & { value: number } }
  | { present: FactLeafPredicate }

export type DefaultUnknownDecision = 'yellow_review' | 'suppress' | 'reject_finding'
export type AbsenceDecision = 'ignore' | 'yellow_review' | 'red_risk'
export type AdjudicationLevel = 'A' | 'B' | 'C'
export type MaterializedSeverity = 'yellow' | 'red'

export interface DeterministicReviewCriteria {
  schema_version: 1
  /** Product-owned decision for complete 1..N not-observed coverage. */
  absence_decision: AbsenceDecision
  fact_schema: FactSchema
  level_a: FactPredicate
  level_b: FactPredicate
  level_c: FactPredicate
}

export interface DeterministicAdjudicationRule {
  rule_code: string
  rule_snapshot_id: string
  review_criteria: DeterministicReviewCriteria
  default_unknown: DefaultUnknownDecision
  conflict_group?: string | null
  mutually_exclusive_with: string[]
  specificity: number
}

export interface ExtractedAdjudicationCandidate {
  id: string
  rule_code: string
  source_start: number
  source_end: number
  facts: Record<string, unknown>
}

export interface AdjudicationDecision {
  ok: true
  candidate: ExtractedAdjudicationCandidate
  rule: DeterministicAdjudicationRule
  matched_levels: AdjudicationLevel[]
  matched_level: AdjudicationLevel | null
  decision: 'no_risk' | 'materialize' | 'suppressed_unknown'
  severity: MaterializedSeverity | null
  materialize: boolean
  reason_code: 'level_a' | 'level_b' | 'level_c' | 'default_unknown_yellow' | 'default_unknown_suppress'
}

export interface AdjudicationRejection {
  ok: false
  candidate: ExtractedAdjudicationCandidate | null
  rule: DeterministicAdjudicationRule | null
  matched_levels: AdjudicationLevel[]
  decision: 'reject'
  severity: null
  materialize: false
  reason_code: 'invalid_rule' | 'invalid_candidate' | 'invalid_facts' | 'multiple_levels' | 'default_unknown_reject'
  errors: string[]
}

export type AdjudicationResult = AdjudicationDecision | AdjudicationRejection

export interface ConflictSuppression {
  candidate_id: string
  suppressed_by_candidate_id: string
  conflict_group: string
  reason_code: 'lower_specificity'
}

export interface ConflictResolution {
  ok: boolean
  selected: AdjudicationDecision[]
  materialized: AdjudicationDecision[]
  suppressed: ConflictSuppression[]
  errors: string[]
}

const PREDICATE_OPERATORS = new Set([
  'all',
  'any',
  'not',
  'eq',
  'in',
  'gt',
  'gte',
  'lt',
  'lte',
  'present',
])

const MAX_PREDICATE_DEPTH = 20
const MAX_PREDICATE_NODES = 256

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function exactKeys(value: Record<string, unknown>, expected: string[]) {
  const actual = Object.keys(value).sort()
  const target = [...expected].sort()
  return actual.length === target.length && actual.every((key, index) => key === target[index])
}

function isFactScalar(value: unknown): value is FactScalar {
  return value === null || typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
}

function validateFactSchema(schema: unknown): string[] {
  if (!isPlainObject(schema)) return ['review_criteria.fact_schema must be an object']
  const errors: string[] = []

  for (const [fact, rawDefinition] of Object.entries(schema)) {
    const path = `review_criteria.fact_schema.${fact}`
    if (!fact.trim()) {
      errors.push('fact schema keys must be non-empty')
      continue
    }
    if (!isPlainObject(rawDefinition) || typeof rawDefinition.type !== 'string') {
      errors.push(`${path} must be a typed object`)
      continue
    }
    const allowedBase = ['type', 'required', 'nullable', 'source']
    if (rawDefinition.required !== undefined && typeof rawDefinition.required !== 'boolean') {
      errors.push(`${path}.required must be boolean`)
    }
    if (rawDefinition.nullable !== undefined && typeof rawDefinition.nullable !== 'boolean') {
      errors.push(`${path}.nullable must be boolean`)
    }
    if (
      rawDefinition.source !== undefined
      && rawDefinition.source !== 'model'
      && rawDefinition.source !== 'trusted_context'
    ) errors.push(`${path}.source is unsupported`)
    if (rawDefinition.source === 'trusted_context' && rawDefinition.nullable !== true) {
      errors.push(`${path} trusted_context facts must be nullable`)
    }

    if (rawDefinition.type === 'string') {
      const allowed = new Set([...allowedBase, 'enum', 'min_length'])
      for (const key of Object.keys(rawDefinition)) if (!allowed.has(key)) errors.push(`${path}.${key} is not allowed`)
      if (rawDefinition.enum !== undefined && (
        !Array.isArray(rawDefinition.enum)
        || rawDefinition.enum.length === 0
        || rawDefinition.enum.some((item) => typeof item !== 'string')
        || new Set(rawDefinition.enum).size !== rawDefinition.enum.length
      )) errors.push(`${path}.enum must contain unique strings`)
      if (rawDefinition.min_length !== undefined && (
        !Number.isSafeInteger(rawDefinition.min_length) || (rawDefinition.min_length as number) < 0
      )) errors.push(`${path}.min_length must be a non-negative integer`)
      continue
    }

    if (rawDefinition.type === 'number') {
      const allowed = new Set([...allowedBase, 'min', 'max'])
      for (const key of Object.keys(rawDefinition)) if (!allowed.has(key)) errors.push(`${path}.${key} is not allowed`)
      if (rawDefinition.min !== undefined && (typeof rawDefinition.min !== 'number' || !Number.isFinite(rawDefinition.min))) {
        errors.push(`${path}.min must be finite`)
      }
      if (rawDefinition.max !== undefined && (typeof rawDefinition.max !== 'number' || !Number.isFinite(rawDefinition.max))) {
        errors.push(`${path}.max must be finite`)
      }
      if (
        typeof rawDefinition.min === 'number'
        && typeof rawDefinition.max === 'number'
        && rawDefinition.min > rawDefinition.max
      ) errors.push(`${path}.min cannot exceed max`)
      continue
    }

    if (rawDefinition.type === 'boolean') {
      for (const key of Object.keys(rawDefinition)) if (!allowedBase.includes(key)) errors.push(`${path}.${key} is not allowed`)
      continue
    }

    if (rawDefinition.type === 'string_array') {
      const allowed = new Set([...allowedBase, 'enum', 'min_items', 'unique_items'])
      for (const key of Object.keys(rawDefinition)) if (!allowed.has(key)) errors.push(`${path}.${key} is not allowed`)
      if (rawDefinition.enum !== undefined && (
        !Array.isArray(rawDefinition.enum)
        || rawDefinition.enum.length === 0
        || rawDefinition.enum.some((item) => typeof item !== 'string')
        || new Set(rawDefinition.enum).size !== rawDefinition.enum.length
      )) errors.push(`${path}.enum must contain unique strings`)
      if (rawDefinition.min_items !== undefined && (
        !Number.isSafeInteger(rawDefinition.min_items) || (rawDefinition.min_items as number) < 0
      )) errors.push(`${path}.min_items must be a non-negative integer`)
      if (rawDefinition.unique_items !== undefined && typeof rawDefinition.unique_items !== 'boolean') {
        errors.push(`${path}.unique_items must be boolean`)
      }
      continue
    }

    errors.push(`${path}.type is unsupported`)
  }

  return errors
}

function validateLiteralForDefinition(
  definition: FactSchemaDefinition,
  value: FactScalar,
  path: string
): string[] {
  if (value === null) return definition.nullable ? [] : [`${path} cannot be null`]
  if (definition.type === 'number') {
    return typeof value === 'number' && Number.isFinite(value) ? [] : [`${path} must be numeric`]
  }
  if (definition.type === 'boolean') {
    return typeof value === 'boolean' ? [] : [`${path} must be boolean`]
  }
  if (definition.type === 'string' || definition.type === 'string_array') {
    if (typeof value !== 'string') return [`${path} must be a string`]
    if (definition.enum && !definition.enum.includes(value)) return [`${path} is outside the configured enum`]
    return []
  }
  return [`${path} has an unsupported schema type`]
}

function validatePredicate(
  predicate: unknown,
  schema: FactSchema,
  path: string,
  state: { nodes: number },
  depth: number = 0
): string[] {
  if (depth > MAX_PREDICATE_DEPTH) return [`${path} exceeds maximum predicate depth`]
  state.nodes += 1
  if (state.nodes > MAX_PREDICATE_NODES) return [`${path} exceeds maximum predicate nodes`]
  if (!isPlainObject(predicate)) return [`${path} must be an object`]
  const keys = Object.keys(predicate)
  if (keys.length !== 1 || !PREDICATE_OPERATORS.has(keys[0])) {
    return [`${path} must contain exactly one whitelisted predicate operator`]
  }

  const operator = keys[0]
  const operand = predicate[operator]
  if (operator === 'all' || operator === 'any') {
    if (!Array.isArray(operand) || operand.length === 0) return [`${path}.${operator} must be a non-empty array`]
    return operand.flatMap((child, index) => validatePredicate(child, schema, `${path}.${operator}[${index}]`, state, depth + 1))
  }
  if (operator === 'not') {
    return validatePredicate(operand, schema, `${path}.not`, state, depth + 1)
  }
  if (!isPlainObject(operand) || typeof operand.fact !== 'string' || !schema[operand.fact]) {
    return [`${path}.${operator} must reference a configured fact`]
  }
  const definition = schema[operand.fact]
  if (operator === 'present') {
    return exactKeys(operand, ['fact']) ? [] : [`${path}.present has unsupported fields`]
  }
  if (operator === 'eq') {
    if (!exactKeys(operand, ['fact', 'value']) || !isFactScalar(operand.value)) {
      return [`${path}.eq must contain fact and a scalar value`]
    }
    return validateLiteralForDefinition(definition, operand.value, `${path}.eq.value`)
  }
  if (operator === 'in') {
    if (
      !exactKeys(operand, ['fact', 'values'])
      || !Array.isArray(operand.values)
      || operand.values.length === 0
      || operand.values.some((value) => !isFactScalar(value))
    ) return [`${path}.in must contain fact and a non-empty scalar values array`]
    return (operand.values as FactScalar[]).flatMap((value, index) => (
      validateLiteralForDefinition(definition, value, `${path}.in.values[${index}]`)
    ))
  }
  if (!['gt', 'gte', 'lt', 'lte'].includes(operator)) return [`${path}.${operator} is unsupported`]
  if (
    definition.type !== 'number'
    || !exactKeys(operand, ['fact', 'value'])
    || typeof operand.value !== 'number'
    || !Number.isFinite(operand.value)
  ) return [`${path}.${operator} requires a numeric fact and finite value`]
  return []
}

export function validateDeterministicAdjudicationRule(rule: unknown): string[] {
  if (!isPlainObject(rule)) return ['rule must be an object']
  const errors: string[] = []
  if (typeof rule.rule_code !== 'string' || !rule.rule_code.trim()) errors.push('rule_code is required')
  if (typeof rule.rule_snapshot_id !== 'string' || !rule.rule_snapshot_id.trim()) errors.push('rule_snapshot_id is required')
  if (!['yellow_review', 'suppress', 'reject_finding'].includes(String(rule.default_unknown))) {
    errors.push('default_unknown is unsupported')
  }
  if (!Number.isSafeInteger(rule.specificity) || (rule.specificity as number) < 0) {
    errors.push('specificity must be a non-negative integer')
  }
  if (
    !Array.isArray(rule.mutually_exclusive_with)
    || rule.mutually_exclusive_with.some((code) => typeof code !== 'string' || !code.trim())
    || new Set(rule.mutually_exclusive_with).size !== rule.mutually_exclusive_with.length
  ) errors.push('mutually_exclusive_with must contain unique rule codes')
  if (
    Array.isArray(rule.mutually_exclusive_with)
    && typeof rule.rule_code === 'string'
    && rule.mutually_exclusive_with.includes(rule.rule_code)
  ) errors.push('a rule cannot be mutually exclusive with itself')
  if (
    Array.isArray(rule.mutually_exclusive_with)
    && rule.mutually_exclusive_with.length > 0
    && (typeof rule.conflict_group !== 'string' || !rule.conflict_group.trim())
  ) errors.push('mutually exclusive rules require conflict_group')

  if (!isPlainObject(rule.review_criteria)) return [...errors, 'review_criteria must be an object']
  if (rule.review_criteria.schema_version !== 1) errors.push('review_criteria.schema_version must be 1')
  if (!['ignore', 'yellow_review', 'red_risk'].includes(String(rule.review_criteria.absence_decision))) {
    errors.push('review_criteria.absence_decision is unsupported')
  }
  const schemaErrors = validateFactSchema(rule.review_criteria.fact_schema)
  errors.push(...schemaErrors)
  if (schemaErrors.length > 0 || !isPlainObject(rule.review_criteria.fact_schema)) return errors
  const schema = rule.review_criteria.fact_schema as FactSchema
  const state = { nodes: 0 }
  errors.push(...validatePredicate(rule.review_criteria.level_a, schema, 'review_criteria.level_a', state))
  errors.push(...validatePredicate(rule.review_criteria.level_b, schema, 'review_criteria.level_b', state))
  errors.push(...validatePredicate(rule.review_criteria.level_c, schema, 'review_criteria.level_c', state))
  return errors
}

export function validateExtractedFacts(schema: FactSchema, facts: unknown): string[] {
  if (!isPlainObject(facts)) return ['facts must be an object']
  const errors: string[] = []
  const schemaKeys = new Set(Object.keys(schema))
  for (const key of Object.keys(facts)) if (!schemaKeys.has(key)) errors.push(`facts.${key} is not configured`)

  for (const [fact, definition] of Object.entries(schema)) {
    const exists = Object.prototype.hasOwnProperty.call(facts, fact)
    if (!exists) {
      if (definition.required) errors.push(`facts.${fact} is required`)
      continue
    }
    const value = facts[fact]
    if (value === null) {
      if (!definition.nullable) errors.push(`facts.${fact} cannot be null`)
      continue
    }
    if (definition.type === 'string') {
      if (typeof value !== 'string') {
        errors.push(`facts.${fact} must be a string`)
        continue
      }
      if (definition.min_length !== undefined && value.length < definition.min_length) {
        errors.push(`facts.${fact} is shorter than min_length`)
      }
      if (definition.enum && !definition.enum.includes(value)) errors.push(`facts.${fact} is outside the configured enum`)
      continue
    }
    if (definition.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        errors.push(`facts.${fact} must be a finite number`)
        continue
      }
      if (definition.min !== undefined && value < definition.min) errors.push(`facts.${fact} is below min`)
      if (definition.max !== undefined && value > definition.max) errors.push(`facts.${fact} exceeds max`)
      continue
    }
    if (definition.type === 'boolean') {
      if (typeof value !== 'boolean') errors.push(`facts.${fact} must be boolean`)
      continue
    }
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      errors.push(`facts.${fact} must be a string array`)
      continue
    }
    if (definition.min_items !== undefined && value.length < definition.min_items) {
      errors.push(`facts.${fact} has fewer than min_items`)
    }
    if (definition.unique_items && new Set(value).size !== value.length) {
      errors.push(`facts.${fact} must contain unique items`)
    }
    if (definition.enum && value.some((item) => !definition.enum!.includes(item))) {
      errors.push(`facts.${fact} contains an item outside the configured enum`)
    }
  }
  return errors
}

export function evaluateFactPredicate(predicate: FactPredicate, facts: Record<string, unknown>): boolean {
  if ('all' in predicate) return predicate.all.every((child) => evaluateFactPredicate(child, facts))
  if ('any' in predicate) return predicate.any.some((child) => evaluateFactPredicate(child, facts))
  if ('not' in predicate) return !evaluateFactPredicate(predicate.not, facts)
  if ('present' in predicate) {
    return Object.prototype.hasOwnProperty.call(facts, predicate.present.fact)
      && facts[predicate.present.fact] !== null
      && facts[predicate.present.fact] !== undefined
  }
  if ('eq' in predicate) return facts[predicate.eq.fact] === predicate.eq.value
  if ('in' in predicate) {
    const actual = facts[predicate.in.fact]
    if (Array.isArray(actual)) return actual.some((item) => predicate.in.values.includes(item as FactScalar))
    return predicate.in.values.includes(actual as FactScalar)
  }
  const leaf = 'gt' in predicate
    ? predicate.gt
    : 'gte' in predicate
      ? predicate.gte
      : 'lt' in predicate
        ? predicate.lt
        : predicate.lte
  const actual = facts[leaf.fact]
  if (typeof actual !== 'number' || !Number.isFinite(actual)) return false
  if ('gt' in predicate) return actual > leaf.value
  if ('gte' in predicate) return actual >= leaf.value
  if ('lt' in predicate) return actual < leaf.value
  return actual <= leaf.value
}

function validateCandidate(candidate: unknown): string[] {
  if (!isPlainObject(candidate)) return ['candidate must be an object']
  const errors: string[] = []
  if (typeof candidate.id !== 'string' || !candidate.id.trim()) errors.push('candidate.id is required')
  if (typeof candidate.rule_code !== 'string' || !candidate.rule_code.trim()) errors.push('candidate.rule_code is required')
  if (!Number.isSafeInteger(candidate.source_start) || (candidate.source_start as number) < 0) {
    errors.push('candidate.source_start must be a non-negative integer')
  }
  if (
    !Number.isSafeInteger(candidate.source_end)
    || !Number.isSafeInteger(candidate.source_start)
    || (candidate.source_end as number) <= (candidate.source_start as number)
  ) errors.push('candidate.source_end must be greater than source_start')
  if (!isPlainObject(candidate.facts)) errors.push('candidate.facts must be an object')
  return errors
}

function reject(
  reason_code: AdjudicationRejection['reason_code'],
  errors: string[],
  candidate: ExtractedAdjudicationCandidate | null,
  rule: DeterministicAdjudicationRule | null,
  matched_levels: AdjudicationLevel[] = []
): AdjudicationRejection {
  return {
    ok: false,
    candidate,
    rule,
    matched_levels,
    decision: 'reject',
    severity: null,
    materialize: false,
    reason_code,
    errors,
  }
}

export function adjudicateExtractedCandidate(
  rawRule: DeterministicAdjudicationRule,
  rawCandidate: ExtractedAdjudicationCandidate
): AdjudicationResult {
  const ruleErrors = validateDeterministicAdjudicationRule(rawRule)
  if (ruleErrors.length > 0) return reject('invalid_rule', ruleErrors, null, null)
  const candidateErrors = validateCandidate(rawCandidate)
  if (candidateErrors.length > 0) return reject('invalid_candidate', candidateErrors, null, rawRule)
  if (rawCandidate.rule_code !== rawRule.rule_code) {
    return reject('invalid_candidate', ['candidate.rule_code does not match the bound rule'], rawCandidate, rawRule)
  }
  const factErrors = validateExtractedFacts(rawRule.review_criteria.fact_schema, rawCandidate.facts)
  if (factErrors.length > 0) return reject('invalid_facts', factErrors, rawCandidate, rawRule)

  const levels = [
    ['A', rawRule.review_criteria.level_a],
    ['B', rawRule.review_criteria.level_b],
    ['C', rawRule.review_criteria.level_c],
  ] as const
  const matchedLevels = levels
    .filter(([, predicate]) => evaluateFactPredicate(predicate, rawCandidate.facts))
    .map(([level]) => level)

  if (matchedLevels.length > 1) {
    return reject(
      'multiple_levels',
      [`facts matched multiple configured levels: ${matchedLevels.join(',')}`],
      rawCandidate,
      rawRule,
      matchedLevels
    )
  }
  const matchedLevel = matchedLevels[0] || null
  if (matchedLevel === 'A') {
    return {
      ok: true,
      candidate: rawCandidate,
      rule: rawRule,
      matched_levels: matchedLevels,
      matched_level: 'A',
      decision: 'no_risk',
      severity: null,
      materialize: false,
      reason_code: 'level_a',
    }
  }
  if (matchedLevel === 'B' || matchedLevel === 'C') {
    return {
      ok: true,
      candidate: rawCandidate,
      rule: rawRule,
      matched_levels: matchedLevels,
      matched_level: matchedLevel,
      decision: 'materialize',
      severity: matchedLevel === 'B' ? 'yellow' : 'red',
      materialize: true,
      reason_code: matchedLevel === 'B' ? 'level_b' : 'level_c',
    }
  }
  if (rawRule.default_unknown === 'yellow_review') {
    return {
      ok: true,
      candidate: rawCandidate,
      rule: rawRule,
      matched_levels: [],
      matched_level: null,
      decision: 'materialize',
      severity: 'yellow',
      materialize: true,
      reason_code: 'default_unknown_yellow',
    }
  }
  if (rawRule.default_unknown === 'suppress') {
    return {
      ok: true,
      candidate: rawCandidate,
      rule: rawRule,
      matched_levels: [],
      matched_level: null,
      decision: 'suppressed_unknown',
      severity: null,
      materialize: false,
      reason_code: 'default_unknown_suppress',
    }
  }
  return reject(
    'default_unknown_reject',
    ['facts did not match exactly one configured level'],
    rawCandidate,
    rawRule
  )
}

export function shouldMaterializeAdjudication(result: AdjudicationResult): result is AdjudicationDecision & {
  decision: 'materialize'
  severity: MaterializedSeverity
  materialize: true
} {
  return result.ok
    && result.decision === 'materialize'
    && result.materialize
    && (result.severity === 'yellow' || result.severity === 'red')
}

function anchorsOverlap(
  left: ExtractedAdjudicationCandidate,
  right: ExtractedAdjudicationCandidate
) {
  return left.source_start < right.source_end && right.source_start < left.source_end
}

export function resolveAdjudicationConflicts(results: AdjudicationResult[]): ConflictResolution {
  const rejected = results.filter((result): result is AdjudicationRejection => !result.ok)
  if (rejected.length > 0) {
    return {
      ok: false,
      selected: [],
      materialized: [],
      suppressed: [],
      errors: rejected.flatMap((result) => result.errors.map((error) => `${result.reason_code}: ${error}`)),
    }
  }

  const decisions = results as AdjudicationDecision[]
  const ids = new Set<string>()
  const errors: string[] = []
  for (const decision of decisions) {
    if (ids.has(decision.candidate.id)) errors.push(`duplicate candidate id: ${decision.candidate.id}`)
    ids.add(decision.candidate.id)
  }

  const suppressedBy = new Map<string, AdjudicationDecision[]>()
  for (let leftIndex = 0; leftIndex < decisions.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < decisions.length; rightIndex += 1) {
      const left = decisions[leftIndex]
      const right = decisions[rightIndex]
      if (!anchorsOverlap(left.candidate, right.candidate)) continue
      const leftMutual = left.rule.mutually_exclusive_with.includes(right.rule.rule_code)
      const rightMutual = right.rule.mutually_exclusive_with.includes(left.rule.rule_code)
      const sameGroup = Boolean(
        left.rule.conflict_group
        && right.rule.conflict_group
        && left.rule.conflict_group === right.rule.conflict_group
      )
      if (!sameGroup && !leftMutual && !rightMutual) continue
      if (!sameGroup) {
        errors.push(`overlapping mutually related rules ${left.rule.rule_code}/${right.rule.rule_code} do not share conflict_group`)
        continue
      }
      if (!leftMutual || !rightMutual) {
        errors.push(`conflict_group ${left.rule.conflict_group} requires bidirectional mutual exclusion for ${left.rule.rule_code}/${right.rule.rule_code}`)
        continue
      }
      if (left.rule.specificity === right.rule.specificity) {
        errors.push(`conflict_group ${left.rule.conflict_group} has non-unique specificity for ${left.rule.rule_code}/${right.rule.rule_code}`)
        continue
      }
      const winner = left.rule.specificity > right.rule.specificity ? left : right
      const loser = winner === left ? right : left
      const prior = suppressedBy.get(loser.candidate.id) || []
      prior.push(winner)
      suppressedBy.set(loser.candidate.id, prior)
    }
  }

  const suppressions: ConflictSuppression[] = []
  for (const [candidateId, winners] of suppressedBy) {
    const highestSpecificity = Math.max(...winners.map((winner) => winner.rule.specificity))
    const highest = winners.filter((winner) => winner.rule.specificity === highestSpecificity)
    if (highest.length !== 1) {
      errors.push(`candidate ${candidateId} has multiple equally specific suppressors`)
      continue
    }
    suppressions.push({
      candidate_id: candidateId,
      suppressed_by_candidate_id: highest[0].candidate.id,
      conflict_group: highest[0].rule.conflict_group!,
      reason_code: 'lower_specificity',
    })
  }

  if (errors.length > 0) {
    return { ok: false, selected: [], materialized: [], suppressed: [], errors }
  }
  const suppressedIds = new Set(suppressions.map((item) => item.candidate_id))
  const selected = decisions.filter((decision) => !suppressedIds.has(decision.candidate.id))
  return {
    ok: true,
    selected,
    materialized: selected.filter(shouldMaterializeAdjudication),
    suppressed: suppressions,
    errors: [],
  }
}

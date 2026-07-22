import { describe, expect, it } from 'vitest'

import {
  adjudicateExtractedCandidate,
  evaluateFactPredicate,
  resolveAdjudicationConflicts,
  shouldMaterializeAdjudication,
  validateDeterministicAdjudicationRule,
  validateExtractedFacts,
  type DeterministicAdjudicationRule,
  type ExtractedAdjudicationCandidate,
  type FactPredicate,
  type FactSchema,
} from './deterministic-adjudicator'

const enumFact = (values: string[], required = true) => ({
  type: 'string' as const,
  enum: values,
  required,
})

function candidate(
  ruleCode: string,
  facts: Record<string, unknown>,
  id = `${ruleCode}-candidate`,
  sourceStart = 10,
  sourceEnd = 30
): ExtractedAdjudicationCandidate {
  return { id, rule_code: ruleCode, source_start: sourceStart, source_end: sourceEnd, facts }
}

function rule(input: {
  code: string
  facts: FactSchema
  a: FactPredicate
  b: FactPredicate
  c: FactPredicate
  defaultUnknown?: DeterministicAdjudicationRule['default_unknown']
  group?: string | null
  mutual?: string[]
  specificity?: number
}): DeterministicAdjudicationRule {
  return {
    rule_code: input.code,
    rule_snapshot_id: `${input.code}-snapshot`,
    review_criteria: {
      schema_version: 1,
      absence_decision: 'ignore',
      fact_schema: input.facts,
      level_a: input.a,
      level_b: input.b,
      level_c: input.c,
    },
    default_unknown: input.defaultUnknown || 'yellow_review',
    conflict_group: input.group || null,
    mutually_exclusive_with: input.mutual || [],
    specificity: input.specificity || 0,
  }
}

const r002 = rule({
  code: 'R002',
  facts: {
    refund_scope: enumFact(['none', 'unused_only', 'full', 'other', 'unknown']),
    interest_required: enumFact(['yes', 'no', 'unknown']),
  },
  a: { eq: { fact: 'refund_scope', value: 'none' } },
  b: { all: [
    { eq: { fact: 'refund_scope', value: 'unused_only' } },
    { eq: { fact: 'interest_required', value: 'no' } },
  ] },
  c: { any: [
    { eq: { fact: 'refund_scope', value: 'full' } },
    { eq: { fact: 'interest_required', value: 'yes' } },
  ] },
})

const r004 = rule({
  code: 'R004',
  facts: {
    silent_acceptance: enumFact(['present', 'cancelled', 'unknown']),
    days: { type: 'number', required: false, nullable: true, min: 0 },
  },
  a: { all: [
    { eq: { fact: 'silent_acceptance', value: 'present' } },
    { lte: { fact: 'days', value: 10 } },
  ] },
  b: { all: [
    { eq: { fact: 'silent_acceptance', value: 'present' } },
    { gt: { fact: 'days', value: 10 } },
    { lte: { fact: 'days', value: 15 } },
  ] },
  c: { any: [
    { eq: { fact: 'silent_acceptance', value: 'cancelled' } },
    { gt: { fact: 'days', value: 30 } },
  ] },
})

const r007 = rule({
  code: 'R007',
  facts: {
    indirect_loss_treatment: enumFact(['excluded', 'accepted', 'not_mentioned', 'unknown']),
    loss_types: {
      type: 'string_array',
      required: true,
      unique_items: true,
      enum: ['indirect', 'profit', 'goodwill', 'punitive', 'business_loss'],
    },
  },
  a: { eq: { fact: 'indirect_loss_treatment', value: 'excluded' } },
  b: { eq: { fact: 'indirect_loss_treatment', value: 'not_mentioned' } },
  c: { all: [
    { eq: { fact: 'indirect_loss_treatment', value: 'accepted' } },
    { in: { fact: 'loss_types', values: ['indirect', 'profit', 'goodwill', 'punitive'] } },
  ] },
  group: 'loss_compensation_context',
  mutual: ['R013'],
  specificity: 100,
})

const r013 = rule({
  code: 'R013',
  facts: {
    deployment_type: enumFact(['public_cloud', 'private', 'unknown']),
    availability_percent: { type: 'number', required: false, nullable: true, min: 0, max: 100 },
    support_window: enumFact(['business_hours', '24x7', 'unknown']),
    compensation_basis: enumFact(['service_fee', 'contract_total', 'other', 'unknown']),
    covers_business_loss: enumFact(['yes', 'no', 'unknown']),
  },
  a: { all: [
    { eq: { fact: 'deployment_type', value: 'public_cloud' } },
    { eq: { fact: 'availability_percent', value: 99.5 } },
    { eq: { fact: 'compensation_basis', value: 'service_fee' } },
  ] },
  b: { eq: { fact: 'availability_percent', value: 99.9 } },
  c: { any: [
    { eq: { fact: 'deployment_type', value: 'private' } },
    { eq: { fact: 'support_window', value: '24x7' } },
    { eq: { fact: 'compensation_basis', value: 'contract_total' } },
    { eq: { fact: 'covers_business_loss', value: 'yes' } },
  ] },
  group: 'loss_compensation_context',
  mutual: ['R007'],
  specificity: 200,
})

const r015 = rule({
  code: 'R015',
  facts: {
    governing_law_country: enumFact(['CN', 'foreign', 'unknown']),
    forum_type: enumFact(['arbitration', 'court', 'unknown']),
    forum_city: enumFact(['Shenzhen', 'Beijing', 'Shanghai', 'Guangzhou', 'unknown']),
    forum_country: enumFact(['CN', 'foreign', 'unknown']),
    forum_identifiability: enumFact(['explicit', 'party_domicile', 'unknown']),
  },
  a: { all: [
    { eq: { fact: 'governing_law_country', value: 'CN' } },
    { eq: { fact: 'forum_type', value: 'arbitration' } },
    { eq: { fact: 'forum_city', value: 'Shenzhen' } },
  ] },
  b: { any: [
    { all: [
      { eq: { fact: 'forum_type', value: 'arbitration' } },
      { in: { fact: 'forum_city', values: ['Beijing', 'Shanghai'] } },
    ] },
    { all: [
      { eq: { fact: 'forum_type', value: 'court' } },
      { in: { fact: 'forum_city', values: ['Beijing', 'Shanghai', 'Guangzhou', 'Shenzhen'] } },
      { eq: { fact: 'forum_country', value: 'CN' } },
    ] },
  ] },
  c: { any: [
    { eq: { fact: 'governing_law_country', value: 'foreign' } },
    { eq: { fact: 'forum_country', value: 'foreign' } },
  ] },
})

function expectDecision(
  configuredRule: DeterministicAdjudicationRule,
  facts: Record<string, unknown>,
  expected: { level: 'A' | 'B' | 'C' | null; severity: 'yellow' | 'red' | null; materialize: boolean }
) {
  const result = adjudicateExtractedCandidate(configuredRule, candidate(configuredRule.rule_code, facts))
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.matched_level).toBe(expected.level)
  expect(result.severity).toBe(expected.severity)
  expect(result.materialize).toBe(expected.materialize)
}

describe('deterministic adjudicator legal-config truth tables', () => {
  it('R002 suppresses A, materializes B/C, and defaults unknown to yellow review', () => {
    expectDecision(r002, { refund_scope: 'none', interest_required: 'unknown' }, { level: 'A', severity: null, materialize: false })
    expectDecision(r002, { refund_scope: 'unused_only', interest_required: 'no' }, { level: 'B', severity: 'yellow', materialize: true })
    expectDecision(r002, { refund_scope: 'full', interest_required: 'no' }, { level: 'C', severity: 'red', materialize: true })
    expectDecision(r002, { refund_scope: 'other', interest_required: 'unknown' }, { level: null, severity: 'yellow', materialize: true })
  })

  it('R004 distinguishes 10, 15, uncovered 16-30, cancellation, and >30', () => {
    expectDecision(r004, { silent_acceptance: 'present', days: 10 }, { level: 'A', severity: null, materialize: false })
    expectDecision(r004, { silent_acceptance: 'present', days: 15 }, { level: 'B', severity: 'yellow', materialize: true })
    expectDecision(r004, { silent_acceptance: 'present', days: 25 }, { level: null, severity: 'yellow', materialize: true })
    expectDecision(r004, { silent_acceptance: 'cancelled', days: null }, { level: 'C', severity: 'red', materialize: true })
    expectDecision(r004, { silent_acceptance: 'present', days: 31 }, { level: 'C', severity: 'red', materialize: true })
  })

  it('R007 applies array membership without embedding its semantics in the engine', () => {
    expectDecision(r007, { indirect_loss_treatment: 'excluded', loss_types: ['indirect'] }, { level: 'A', severity: null, materialize: false })
    expectDecision(r007, { indirect_loss_treatment: 'not_mentioned', loss_types: [] }, { level: 'B', severity: 'yellow', materialize: true })
    expectDecision(r007, { indirect_loss_treatment: 'accepted', loss_types: ['indirect', 'profit'] }, { level: 'C', severity: 'red', materialize: true })
    expectDecision(r007, { indirect_loss_treatment: 'unknown', loss_types: ['business_loss'] }, { level: null, severity: 'yellow', materialize: true })
  })

  it('R013 assigns levels from extracted facts only', () => {
    const base = {
      deployment_type: 'public_cloud',
      availability_percent: null,
      support_window: 'business_hours',
      compensation_basis: 'other',
      covers_business_loss: 'no',
    }
    expectDecision(r013, { ...base, availability_percent: 99.5, compensation_basis: 'service_fee' }, { level: 'A', severity: null, materialize: false })
    expectDecision(r013, { ...base, availability_percent: 99.9 }, { level: 'B', severity: 'yellow', materialize: true })
    expectDecision(r013, { ...base, covers_business_loss: 'yes' }, { level: 'C', severity: 'red', materialize: true })
    expectDecision(r013, { ...base, deployment_type: 'unknown' }, { level: null, severity: 'yellow', materialize: true })
  })

  it('R015 keeps an unidentified party domicile at default yellow instead of red', () => {
    expectDecision(r015, {
      governing_law_country: 'CN', forum_type: 'arbitration', forum_city: 'Shenzhen', forum_country: 'CN', forum_identifiability: 'explicit',
    }, { level: 'A', severity: null, materialize: false })
    expectDecision(r015, {
      governing_law_country: 'CN', forum_type: 'court', forum_city: 'Shanghai', forum_country: 'CN', forum_identifiability: 'explicit',
    }, { level: 'B', severity: 'yellow', materialize: true })
    expectDecision(r015, {
      governing_law_country: 'foreign', forum_type: 'arbitration', forum_city: 'unknown', forum_country: 'foreign', forum_identifiability: 'explicit',
    }, { level: 'C', severity: 'red', materialize: true })
    expectDecision(r015, {
      governing_law_country: 'unknown', forum_type: 'court', forum_city: 'unknown', forum_country: 'unknown', forum_identifiability: 'party_domicile',
    }, { level: null, severity: 'yellow', materialize: true })
  })
})

describe('predicate DSL and strict fact validation', () => {
  it('supports all/any/not/eq/in/gt/gte/lt/lte/present', () => {
    const facts = { amount: 10, mode: 'alpha', tags: ['x', 'y'], enabled: true }
    const predicate: FactPredicate = { all: [
      { present: { fact: 'amount' } },
      { eq: { fact: 'mode', value: 'alpha' } },
      { in: { fact: 'tags', values: ['y'] } },
      { gt: { fact: 'amount', value: 9 } },
      { gte: { fact: 'amount', value: 10 } },
      { lt: { fact: 'amount', value: 11 } },
      { lte: { fact: 'amount', value: 10 } },
      { any: [{ eq: { fact: 'enabled', value: true } }, { eq: { fact: 'mode', value: 'beta' } }] },
      { not: { eq: { fact: 'mode', value: 'beta' } } },
    ] }
    expect(evaluateFactPredicate(predicate, facts)).toBe(true)
  })

  it('rejects extra, missing, mistyped, non-finite, and out-of-enum facts', () => {
    const schema: FactSchema = {
      mode: enumFact(['a', 'b']),
      amount: { type: 'number', required: true, min: 0 },
      tags: { type: 'string_array', required: true, enum: ['x'], unique_items: true },
    }
    expect(validateExtractedFacts(schema, { mode: 'a', amount: 1, tags: ['x'], extra: true })).toContain('facts.extra is not configured')
    expect(validateExtractedFacts(schema, { mode: 'a', tags: ['x'] })).toContain('facts.amount is required')
    expect(validateExtractedFacts(schema, { mode: 'a', amount: '1', tags: ['x'] })).toContain('facts.amount must be a finite number')
    expect(validateExtractedFacts(schema, { mode: 'a', amount: Number.NaN, tags: ['x'] })).toContain('facts.amount must be a finite number')
    expect(validateExtractedFacts(schema, { mode: 'c', amount: 1, tags: ['x'] })).toContain('facts.mode is outside the configured enum')
    expect(validateExtractedFacts(schema, { mode: 'a', amount: 1, tags: ['x', 'x'] })).toContain('facts.tags must contain unique items')
  })

  it('rejects invalid extracted facts before any level can materialize', () => {
    const result = adjudicateExtractedCandidate(r002, candidate('R002', {
      refund_scope: 'none',
      interest_required: 'unknown',
      invented_fact: true,
    }))
    expect(result).toMatchObject({
      ok: false,
      reason_code: 'invalid_facts',
      materialize: false,
      severity: null,
    })
  })

  it('rejects non-whitelisted or malformed predicates before facts are adjudicated', () => {
    const bad = structuredClone(r002) as unknown as Record<string, unknown>
    const criteria = bad.review_criteria as Record<string, unknown>
    criteria.level_a = { regex: { fact: 'refund_scope', value: 'none' } }
    expect(validateDeterministicAdjudicationRule(bad)).toContain(
      'review_criteria.level_a must contain exactly one whitelisted predicate operator'
    )

    const missingAbsenceDecision = structuredClone(r002) as unknown as Record<string, unknown>
    delete (missingAbsenceDecision.review_criteria as Record<string, unknown>).absence_decision
    expect(validateDeterministicAdjudicationRule(missingAbsenceDecision)).toContain(
      'review_criteria.absence_decision is unsupported'
    )

    const nonNullableTrustedFact = structuredClone(r002) as unknown as Record<string, unknown>
    ;((nonNullableTrustedFact.review_criteria as Record<string, unknown>).fact_schema as Record<string, unknown>).authority = {
      type: 'string',
      source: 'trusted_context',
      required: true,
      nullable: false,
    }
    expect(validateDeterministicAdjudicationRule(nonNullableTrustedFact)).toContain(
      'review_criteria.fact_schema.authority trusted_context facts must be nullable'
    )
  })
})

describe('level cardinality and materialization invariants', () => {
  const numericRule = (defaultUnknown: DeterministicAdjudicationRule['default_unknown']) => rule({
    code: 'NUM',
    facts: { value: { type: 'number', required: true } },
    a: { lt: { fact: 'value', value: 0 } },
    b: { eq: { fact: 'value', value: 1 } },
    c: { gt: { fact: 'value', value: 2 } },
    defaultUnknown,
  })

  it('handles zero matches according to each default_unknown mode', () => {
    expectDecision(numericRule('yellow_review'), { value: 2 }, { level: null, severity: 'yellow', materialize: true })
    expectDecision(numericRule('suppress'), { value: 2 }, { level: null, severity: null, materialize: false })
    const rejected = adjudicateExtractedCandidate(numericRule('reject_finding'), candidate('NUM', { value: 2 }))
    expect(rejected).toMatchObject({ ok: false, reason_code: 'default_unknown_reject', materialize: false })
  })

  it('rejects multiple matching levels instead of resolving by severity order', () => {
    const overlapping = rule({
      code: 'OVERLAP',
      facts: { value: { type: 'number', required: true } },
      a: { gte: { fact: 'value', value: 0 } },
      b: { gte: { fact: 'value', value: 0 } },
      c: { gt: { fact: 'value', value: 100 } },
    })
    const result = adjudicateExtractedCandidate(overlapping, candidate('OVERLAP', { value: 10 }))
    expect(result).toMatchObject({ ok: false, reason_code: 'multiple_levels', matched_levels: ['A', 'B'] })
  })

  it('allows only yellow/red decisions to materialize', () => {
    const a = adjudicateExtractedCandidate(r002, candidate('R002', { refund_scope: 'none', interest_required: 'unknown' }))
    const b = adjudicateExtractedCandidate(r002, candidate('R002', { refund_scope: 'unused_only', interest_required: 'no' }))
    const c = adjudicateExtractedCandidate(r002, candidate('R002', { refund_scope: 'full', interest_required: 'no' }))
    expect(shouldMaterializeAdjudication(a)).toBe(false)
    expect(shouldMaterializeAdjudication(b)).toBe(true)
    expect(shouldMaterializeAdjudication(c)).toBe(true)
    expect([b, c].filter(shouldMaterializeAdjudication).map((item) => item.severity)).toEqual(['yellow', 'red'])
  })
})

describe('overlap conflict resolver', () => {
  const r007Decision = () => adjudicateExtractedCandidate(r007, candidate(
    'R007',
    { indirect_loss_treatment: 'accepted', loss_types: ['business_loss', 'indirect'] },
    'broad',
    100,
    140
  ))
  const r013Decision = (start = 100, end = 140) => adjudicateExtractedCandidate(r013, candidate(
    'R013',
    {
      deployment_type: 'public_cloud', availability_percent: null, support_window: 'business_hours',
      compensation_basis: 'other', covers_business_loss: 'yes',
    },
    'specific',
    start,
    end
  ))

  it('suppresses only the lower-specificity bidirectional peer on an overlapping anchor', () => {
    const result = resolveAdjudicationConflicts([r007Decision(), r013Decision()])
    expect(result.ok).toBe(true)
    expect(result.selected.map((item) => item.candidate.id)).toEqual(['specific'])
    expect(result.materialized.map((item) => item.candidate.id)).toEqual(['specific'])
    expect(result.suppressed).toEqual([{
      candidate_id: 'broad',
      suppressed_by_candidate_id: 'specific',
      conflict_group: 'loss_compensation_context',
      reason_code: 'lower_specificity',
    }])
  })

  it('keeps mutually configured rules when their anchors do not overlap', () => {
    const result = resolveAdjudicationConflicts([r007Decision(), r013Decision(200, 240)])
    expect(result.ok).toBe(true)
    expect(result.selected.map((item) => item.candidate.id)).toEqual(['broad', 'specific'])
    expect(result.suppressed).toEqual([])
  })

  it('fails closed for one-way mutual exclusion', () => {
    const oneWay = { ...r013, mutually_exclusive_with: [] }
    const result = resolveAdjudicationConflicts([
      r007Decision(),
      adjudicateExtractedCandidate(oneWay, candidate('R013', {
        deployment_type: 'public_cloud', availability_percent: null, support_window: 'business_hours',
        compensation_basis: 'other', covers_business_loss: 'yes',
      }, 'specific', 100, 140)),
    ])
    expect(result.ok).toBe(false)
    expect(result.selected).toEqual([])
    expect(result.errors.join(' ')).toContain('bidirectional mutual exclusion')
  })

  it('fails closed for equal specificity', () => {
    const tied = { ...r013, specificity: 100 }
    const result = resolveAdjudicationConflicts([
      r007Decision(),
      adjudicateExtractedCandidate(tied, candidate('R013', {
        deployment_type: 'public_cloud', availability_percent: null, support_window: 'business_hours',
        compensation_basis: 'other', covers_business_loss: 'yes',
      }, 'specific', 100, 140)),
    ])
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('non-unique specificity')
  })

  it('fails closed when mutual rules do not share the same group', () => {
    const wrongGroup = { ...r013, conflict_group: 'other_group' }
    const result = resolveAdjudicationConflicts([
      r007Decision(),
      adjudicateExtractedCandidate(wrongGroup, candidate('R013', {
        deployment_type: 'public_cloud', availability_percent: null, support_window: 'business_hours',
        compensation_basis: 'other', covers_business_loss: 'yes',
      }, 'specific', 100, 140)),
    ])
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('do not share conflict_group')
  })
})

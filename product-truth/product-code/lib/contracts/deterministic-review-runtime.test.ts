import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import type { DeterministicReviewCriteria } from './deterministic-adjudicator'
import {
  adjudicateFactsOnlyExtractionChunk,
  adjudicateParsedFactsOnlyExtractionChunk,
  buildFactsOnlyExtractionInstruction,
  buildFactsOnlyExtractionJsonSchema,
  buildFactsOnlyAdjudicationTraceInputs,
  buildFactsOnlyDocumentAdjudicationInputs,
  FactsOnlyRuntimeError,
  getFactsOnlyExtractionCoverageNormalizations,
  getFactsOnlyExtractionModelFactNormalizations,
  getFactsOnlyExtractionSourceAnchorNormalizations,
  getFactsOnlyExtractionTrustedContextNormalizations,
  isRetryableFactsOnlyRunError,
  isUncertainDatabaseTransportError,
  mergeFactsOnlyAdjudicationBatches,
  normalizeFactsOnlyExtractionSourceAnchors,
  parseFactsCompletionReceipt,
  parseFactsOnlyExtraction,
  serializeFactsOnlyExtractionForStage,
  validateFactsOnlyExtraction,
} from './deterministic-review-runtime'
import type { PublishedReviewRule } from './review-workbench'

function criteria(levels: Pick<DeterministicReviewCriteria, 'level_a' | 'level_b' | 'level_c'>): DeterministicReviewCriteria {
  return {
    schema_version: 1,
    absence_decision: 'ignore',
    fact_schema: {
      decision: {
        type: 'string',
        enum: ['accept', 'review', 'reject', 'unknown'],
        required: true,
      },
    },
    ...levels,
  }
}

function rule(input: Partial<PublishedReviewRule> & Pick<PublishedReviewRule, 'code' | 'snapshot_id'>): PublishedReviewRule {
  return {
    snapshot_id: input.snapshot_id,
    code: input.code,
    name: input.name || input.code,
    review_criteria: (input.review_criteria || criteria({
      level_a: { eq: { fact: 'decision', value: 'accept' } },
      level_b: { eq: { fact: 'decision', value: 'review' } },
      level_c: { eq: { fact: 'decision', value: 'reject' } },
    })) as unknown as Record<string, unknown>,
    message_template: input.message_template || {},
    mutually_exclusive_with: input.mutually_exclusive_with || [],
    conflict_group: input.conflict_group || null,
    specificity: input.specificity ?? 100,
    default_unknown: input.default_unknown || 'yellow_review',
    criteria_schema_version: 1,
  }
}

const baseRules = [
  rule({ code: 'R001', snapshot_id: 'snapshot-r001' }),
  rule({ code: 'R002', snapshot_id: 'snapshot-r002', default_unknown: 'suppress' }),
  rule({ code: 'R003', snapshot_id: 'snapshot-r003' }),
]

function chunkFor(source: string) {
  return {
    index: 1,
    total: 1,
    start: 0,
    end: source.length,
    hash: createHash('sha256').update(source).digest('hex'),
  }
}

function coverageFor(rules: PublishedReviewRule[], observedCodes: string[] = []) {
  const observed = new Set(observedCodes)
  return rules.map((item) => ({
    rule_code: item.code,
    status: observed.has(item.code) ? 'observed' : 'not_observed',
  }))
}

describe('facts-only deterministic review runtime', () => {
  it('strictly parses zero-risk completion and retries only uncertain transport errors', () => {
    const stage = {
      run_id: '11111111-1111-4111-8111-111111111111',
      document_run_id: '22222222-2222-4222-8222-222222222222',
    }
    const receipt = {
      receipt_id: '33333333-3333-4333-8333-333333333333',
      fact_run_id: stage.run_id,
      document_run_id: stage.document_run_id,
      risk_card_ids: [],
      model_invocation_ids: ['44444444-4444-4444-8444-444444444444'],
      total_tokens: 42,
      provider: 'local-qwen35-9b',
      degraded: false,
      idempotent: false,
      review_completed: true,
      review_result: {
        risks: [],
        summary: '确定性事实审核完成：红色风险 0 项，黄色待复核 0 项。',
        appliedRules: 15,
        matchedRules: 0,
        provider: 'local-qwen35-9b',
        degraded: false,
        usage: { totalTokens: 42 },
        evidence_contract: 'facts_v1',
        fact_run_id: stage.run_id,
        document_run_id: stage.document_run_id,
        completion_receipt_id: '33333333-3333-4333-8333-333333333333',
      },
    }

    expect(parseFactsCompletionReceipt(receipt, stage)).toMatchObject({
      receipt_id: receipt.receipt_id,
      total_tokens: 42,
      review_completed: true,
    })
    expect(() => parseFactsCompletionReceipt({
      ...receipt,
      total_tokens: 43,
    }, stage)).toThrow('facts_completion_review_result_invalid')
    expect(isUncertainDatabaseTransportError({ code: '08006', message: 'lost' })).toBe(true)
    expect(isUncertainDatabaseTransportError(new Error('fetch failed'))).toBe(true)
    expect(isUncertainDatabaseTransportError({ code: '23514', message: 'invalid' })).toBe(false)
    expect(isUncertainDatabaseTransportError({ code: '55P03', message: 'lock timeout' })).toBe(false)
  })

  it('builds a strict extraction contract that gives the model no severity authority', () => {
    const schema = buildFactsOnlyExtractionJsonSchema(baseRules)
    const serialized = JSON.stringify(schema)
    expect(serialized).toContain('"rule_code"')
    expect(serialized).toContain('"source_quote"')
    expect(serialized).toContain('"facts"')
    expect(serialized).toContain('"coverage"')
    expect(serialized).not.toContain('"level"')
    expect(serialized).not.toContain('"severity"')
    expect(serialized).not.toContain('"suggestion"')
    expect(schema.properties.candidates.items).not.toHaveProperty('oneOf')
    expect(schema.properties.candidates.items.properties.rule_code.enum).toEqual([
      'R001', 'R002', 'R003',
    ])
    expect(schema.properties.coverage.items.properties.rule_code.enum).toEqual([
      'R001', 'R002', 'R003',
    ])
    expect(schema.properties.candidates.items.properties.facts).toEqual({ type: 'object' })
    expect(schema.properties.candidates).not.toHaveProperty('maxItems')
    expect(schema.properties.candidates.items.properties.source_quote).not.toHaveProperty('maxLength')
    expect(schema.properties.summary).not.toHaveProperty('maxLength')

    const instruction = buildFactsOnlyExtractionInstruction(baseRules)
    expect(instruction).toContain('不判断风险等级')
    expect(instruction).toContain('不得输出 level、severity')
  })

  it('reserves trusted-context facts for the service and deterministically discards model values', () => {
    const trustedRule = rule({
      code: 'R010',
      snapshot_id: 'snapshot-r010',
      review_criteria: {
        schema_version: 1,
        absence_decision: 'yellow_review',
        fact_schema: {
          internal_consistency: {
            type: 'string',
            enum: ['match', 'mismatch', 'unclear'],
            required: true,
          },
          authority_status: {
            type: 'string',
            enum: ['verified_match', 'verified_mismatch', 'stale'],
            source: 'trusted_context',
            required: true,
            nullable: true,
          },
        },
        level_a: { all: [
          { eq: { fact: 'internal_consistency', value: 'match' } },
          { eq: { fact: 'authority_status', value: 'verified_match' } },
        ] },
        level_b: { any: [
          { eq: { fact: 'internal_consistency', value: 'unclear' } },
          { eq: { fact: 'authority_status', value: null } },
        ] },
        level_c: { any: [
          { eq: { fact: 'internal_consistency', value: 'mismatch' } },
          { eq: { fact: 'authority_status', value: 'verified_mismatch' } },
        ] },
      },
    })
    const schema = buildFactsOnlyExtractionJsonSchema([trustedRule])
    expect(schema.properties.candidates.items.properties.facts).toEqual({ type: 'object' })
    expect(buildFactsOnlyExtractionInstruction([trustedRule])).toContain('source=trusted_context')

    expect(validateFactsOnlyExtraction({
      candidates: [{
        rule_code: 'R010',
        source_quote: '合同金额大小写一致。',
        facts: { internal_consistency: 'match', authority_status: null },
      }],
      coverage: [{ rule_code: 'R010', status: 'observed' }],
      summary: '仅提取合同内一致性。',
    }, [trustedRule]).candidates[0].facts.authority_status).toBeNull()

    const forged = {
      candidates: [{
        rule_code: 'R010',
        source_quote: '合同金额大小写一致。',
        facts: { internal_consistency: 'match', authority_status: 'verified_match' },
      }],
      coverage: [{ rule_code: 'R010', status: 'observed' }],
      summary: '模型伪造外部权威结论。',
    }
    expect(() => validateFactsOnlyExtraction(forged, [trustedRule])).toThrowError(
      /reserved for trusted_context/,
    )
    const normalized = parseFactsOnlyExtraction(JSON.stringify(forged), [trustedRule])
    expect(normalized.candidates[0].facts.authority_status).toBeNull()
    expect(getFactsOnlyExtractionTrustedContextNormalizations(normalized)).toEqual([{
      candidate_index: 0,
      rule_code: 'R010',
      fact: 'authority_status',
      reason: 'model_value_discarded',
    }])
    expect(serializeFactsOnlyExtractionForStage(normalized, [trustedRule])).toContain(
      '"authority_status":null',
    )
  })

  it('normalizes only safe enum transport variants and never guesses a business value', () => {
    const compensationRule = rule({
      code: 'R013',
      snapshot_id: 'snapshot-r013',
      review_criteria: {
        schema_version: 1,
        absence_decision: 'yellow_review',
        fact_schema: {
          compensation_basis: {
            type: 'string',
            enum: ['service_fee', 'contract_total', 'other', 'unknown'],
            required: true,
          },
        },
        level_a: { eq: { fact: 'compensation_basis', value: 'service_fee' } },
        level_b: { eq: { fact: 'compensation_basis', value: 'unknown' } },
        level_c: { eq: { fact: 'compensation_basis', value: 'contract_total' } },
      },
    })
    const nullableRule = rule({
      code: 'R014',
      snapshot_id: 'snapshot-r014',
      review_criteria: {
        schema_version: 1,
        absence_decision: 'ignore',
        fact_schema: {
          forum: {
            type: 'string',
            enum: ['domestic', 'foreign'],
            required: true,
            nullable: true,
          },
        },
        level_a: { eq: { fact: 'forum', value: 'domestic' } },
        level_b: { eq: { fact: 'forum', value: null } },
        level_c: { eq: { fact: 'forum', value: 'foreign' } },
      },
    })
    const rules = [compensationRule, nullableRule]
    const extraction = parseFactsOnlyExtraction(JSON.stringify({
      candidates: [
        {
          rule_code: 'R013',
          source_quote: '赔偿以年度服务费作为计算基础。',
          facts: { compensation_basis: 'SERVICE-FEE' },
        },
        {
          rule_code: 'R013',
          source_quote: '赔偿以双方另行协商的口径计算。',
          facts: { compensation_basis: '双方另行协商的计算口径' },
        },
        {
          rule_code: 'R014',
          source_quote: '争议提交双方后续确认的机构处理。',
          facts: { forum: '双方后续确认' },
        },
      ],
      coverage: coverageFor(rules, ['R013', 'R014']),
      summary: '只抽取赔偿与争议事实。',
    }), rules)

    expect(extraction.candidates.map((candidate) => candidate.facts)).toEqual([
      { compensation_basis: 'service_fee' },
      { compensation_basis: 'unknown' },
      { forum: null },
    ])
    expect(getFactsOnlyExtractionModelFactNormalizations(extraction)).toEqual([
      {
        candidate_index: 0,
        rule_code: 'R013',
        fact: 'compensation_basis',
        replacement: 'service_fee',
        reason: 'enum_alias_canonicalized',
      },
      {
        candidate_index: 1,
        rule_code: 'R013',
        fact: 'compensation_basis',
        replacement: 'unknown',
        reason: 'out_of_enum_to_unknown',
      },
      {
        candidate_index: 2,
        rule_code: 'R014',
        fact: 'forum',
        replacement: null,
        reason: 'out_of_enum_to_null',
      },
    ])
    expect(() => validateFactsOnlyExtraction({
      candidates: [{
        rule_code: 'R013',
        source_quote: '赔偿以双方另行协商的口径计算。',
        facts: { compensation_basis: '双方另行协商的计算口径' },
      }],
      coverage: coverageFor([compensationRule], ['R013']),
      summary: 'direct canonical input remains strict',
    }, [compensationRule])).toThrow(/outside the configured enum/)
  })

  it('does not resume deterministic schema failures but permits transient runtime recovery', () => {
    expect(isRetryableFactsOnlyRunError(
      'facts_only_extraction_failed:local-qwen[0]: facts.compensation_basis failed the frozen schema | local-gemma: provider_unhealthy',
    )).toBe(false)
    expect(isRetryableFactsOnlyRunError(
      'facts_only_invocation_checkpoint_write_failed:FACT_CHUNK_CHECKPOINT_SOURCE_INVALID',
    )).toBe(false)
    expect(isRetryableFactsOnlyRunError(
      'facts_only_extraction_failed:local-qwen[0]: fetch failed | local-gemma: provider_unhealthy',
    )).toBe(true)
    expect(isRetryableFactsOnlyRunError(
      'facts_only_invocation_checkpoint_write_failed:connection reset',
    )).toBe(true)
  })

  it('rejects model-invented levels, unknown rules and exact duplicate candidates', () => {
    expect(() => parseFactsOnlyExtraction(JSON.stringify({
      candidates: [{
        rule_code: 'R001',
        source_quote: '首付款比例为10%。',
        facts: { decision: 'reject' },
        level: 'red',
      }],
      coverage: coverageFor(baseRules, ['R001']),
      summary: 'x',
    }), baseRules)).toThrowError(/unknown or missing fields/)

    expect(() => parseFactsOnlyExtraction(JSON.stringify({
      candidates: [{ rule_code: 'R999', source_quote: '首付款比例为10%。', facts: {} }],
      coverage: coverageFor(baseRules),
      summary: 'x',
    }), baseRules)).toThrowError(/unknown rule_code/)

    expect(() => parseFactsOnlyExtraction(JSON.stringify({
      candidates: [
        { rule_code: 'R001', source_quote: '首付款比例为10%。', facts: { decision: 'reject' } },
        { rule_code: 'R001', source_quote: '首付款比例为10%。', facts: { decision: 'review' } },
      ],
      coverage: coverageFor(baseRules, ['R001']),
      summary: 'x',
    }), baseRules)).toThrowError(/duplicates the same rule and quote/)

    expect(() => parseFactsOnlyExtraction(JSON.stringify({
      candidates: [{
        rule_code: 'R001',
        source_quote: '首付款比例为10%。',
        facts: { decision: 42 },
      }],
      coverage: coverageFor(baseRules, ['R001']),
      summary: 'x',
    }), baseRules)).toThrowError(/failed the frozen schema/)
  })

  it('accepts one exact JSON code fence but rejects prose around the payload', () => {
    const payload = JSON.stringify({
      candidates: [],
      coverage: coverageFor(baseRules),
      summary: '未观察到相关条款。',
    })
    expect(parseFactsOnlyExtraction(`\`\`\`json\n${payload}\n\`\`\``, baseRules).summary)
      .toBe('未观察到相关条款。')
    expect(() => parseFactsOnlyExtraction(`结果如下：\n\`\`\`json\n${payload}\n\`\`\``, baseRules))
      .toThrowError(/must be one JSON object/)
  })

  it('conservatively downgrades unsupported observed coverage and records the normalization', () => {
    const extraction = parseFactsOnlyExtraction(JSON.stringify({
      candidates: [],
      coverage: coverageFor(baseRules).map((item) => (
        item.rule_code === 'R001' ? { ...item, status: 'observed' } : item
      )),
      summary: '模型声称观察到条款，但没有提供逐字引文。',
    }), baseRules)

    expect(extraction.coverage.find((item) => item.rule_code === 'R001')?.status).toBe('uncertain')
    expect(getFactsOnlyExtractionCoverageNormalizations(extraction)).toEqual([{
      rule_code: 'R001',
      from: 'observed',
      to: 'uncertain',
      reason: 'observed_without_candidate',
    }])
    expect(JSON.parse(serializeFactsOnlyExtractionForStage(extraction, baseRules)).coverage)
      .toContainEqual({ rule_code: 'R001', status: 'uncertain' })

    const promoted = parseFactsOnlyExtraction(JSON.stringify({
      candidates: [{ rule_code: 'R001', source_quote: '首付款比例为10%。', facts: { decision: 'review' } }],
      coverage: coverageFor(baseRules),
      summary: '有逐字证据却没有标记 observed。',
    }), baseRules)
    expect(promoted.coverage.find((item) => item.rule_code === 'R001')?.status).toBe('observed')
    expect(getFactsOnlyExtractionCoverageNormalizations(promoted)).toEqual([{
      rule_code: 'R001',
      from: 'not_observed',
      to: 'observed',
      reason: 'candidate_present',
    }])
  })

  it('requires explicit per-rule coverage even when a chunk has no candidates', () => {
    expect(() => parseFactsOnlyExtraction(JSON.stringify({
      candidates: [],
      coverage: coverageFor(baseRules).slice(0, 2),
      summary: '未观察到相关条款。',
    }), baseRules)).toThrowError(/coverage must contain every frozen rule/)

    const source = '本分块仅包含合同标题。'
    const batch = adjudicateFactsOnlyExtractionChunk({
      source_text: source,
      chunk: chunkFor(source),
      rules: baseRules,
      raw_output: JSON.stringify({
        candidates: [],
        coverage: coverageFor(baseRules),
        summary: '所有规则均未在本分块观察到。',
      }),
    })
    const merged = mergeFactsOnlyAdjudicationBatches([batch], source)
    expect(merged.document_coverage).toEqual(baseRules.map((item) => ({
      rule_code: item.code,
      presence: 'missing_candidate',
      evidence_basis: 'complete_not_observed_coverage',
      candidate_ids: [],
      chunk_statuses: [{ chunk_index: 1, status: 'not_observed' }],
    })))
    expect(merged.materialized_candidate_ids).toEqual([])

    const mixed = adjudicateFactsOnlyExtractionChunk({
      source_text: source,
      chunk: chunkFor(source),
      rules: baseRules,
      raw_output: JSON.stringify({
        candidates: [{
          rule_code: 'R001',
          source_quote: source,
          facts: { decision: 'accept' },
        }],
        coverage: [
          { rule_code: 'R001', status: 'observed' },
          { rule_code: 'R002', status: 'uncertain' },
          { rule_code: 'R003', status: 'not_observed' },
        ],
        summary: '区分三类文档级证据。',
      }),
    })
    const mixedMerged = mergeFactsOnlyAdjudicationBatches([mixed], source)
    const mixedCoverage = mixedMerged.document_coverage
    expect(mixedCoverage.map(({ rule_code, presence, evidence_basis, candidate_ids }) => ({
      rule_code,
      presence,
      evidence_basis,
      candidate_count: candidate_ids.length,
    }))).toEqual([
      {
        rule_code: 'R001',
        presence: 'present',
        evidence_basis: 'source_span_candidates',
        candidate_count: 1,
      },
      {
        rule_code: 'R002',
        presence: 'unknown',
        evidence_basis: 'uncertain_coverage',
        candidate_count: 0,
      },
      {
        rule_code: 'R003',
        presence: 'missing_candidate',
        evidence_basis: 'complete_not_observed_coverage',
        candidate_count: 0,
      },
    ])
    expect(buildFactsOnlyDocumentAdjudicationInputs(mixedMerged, baseRules)).toEqual([
      expect.objectContaining({
        rule_code: 'R002',
        evidence_basis: 'uncertain_coverage',
        decision: 'materialize',
        severity: 'yellow',
        reason_code: 'uncertain_coverage_manual_review',
      }),
      expect.objectContaining({
        rule_code: 'R003',
        evidence_basis: 'complete_not_observed_coverage',
        decision: 'no_risk',
        severity: null,
        reason_code: 'complete_not_observed_no_finding',
      }),
    ])
  })

  it('adjudicates the already-validated provider object without a JSON round trip', () => {
    const source = '首付款比例为10%。'
    const providerObject = {
      candidates: [{ rule_code: 'R001', source_quote: source, facts: { decision: 'reject' } }],
      coverage: coverageFor(baseRules, ['R001']),
      summary: '只提取付款事实。',
    }
    const extraction = validateFactsOnlyExtraction(providerObject, baseRules)
    const batch = adjudicateParsedFactsOnlyExtractionChunk({
      extraction,
      source_text: source,
      chunk: chunkFor(source),
      rules: baseRules,
    })

    expect(batch.candidates).toHaveLength(1)
    expect(batch.candidates[0].result).toMatchObject({
      ok: true,
      matched_level: 'C',
      decision: 'materialize',
      severity: 'red',
    })

    providerObject.candidates[0].facts.decision = 'accept'
    expect(batch.candidates[0].normalized_facts).toEqual({ decision: 'reject' })
    expect(() => {
      extraction.candidates[0].facts.decision = 'accept'
    }).toThrow()
    expect(() => {
      batch.candidates[0].raw_facts.decision = 'accept'
    }).toThrow()
  })

  it('discards unrecoverable source quotes before checkpointing and re-derives coverage', () => {
    const source = '唯一可定位条款：首付款比例为10%。'
    const extraction = parseFactsOnlyExtraction(JSON.stringify({
      candidates: [
        { rule_code: 'R001', source_quote: '首付款比例为10%。', facts: { decision: 'review' } },
        { rule_code: 'R002', source_quote: '模型编造且无法定位的条款。', facts: { decision: 'reject' } },
      ],
      coverage: coverageFor(baseRules, ['R001', 'R002']),
      summary: '候选中包含一条不可恢复引文。',
    }), baseRules)
    const normalized = normalizeFactsOnlyExtractionSourceAnchors(extraction, source, baseRules)

    expect(normalized.candidates.map((candidate) => candidate.rule_code)).toEqual(['R001'])
    expect(normalized.coverage.find((item) => item.rule_code === 'R002')?.status).toBe('uncertain')
    expect(getFactsOnlyExtractionSourceAnchorNormalizations(normalized)).toEqual([{
      candidate_index: 1,
      rule_code: 'R002',
      source_quote_sha256: createHash('sha256').update('模型编造且无法定位的条款。').digest('hex'),
      reason: 'unrecoverable_source_quote_discarded',
    }])
    expect(() => adjudicateParsedFactsOnlyExtractionChunk({
      extraction: normalized,
      source_text: source,
      chunk: chunkFor(source),
      rules: baseRules,
    })).not.toThrow()
  })

  it('preserves provider coverage normalization audit through source-anchor preparation', () => {
    const source = '唯一可定位条款：首付款比例为10%。'
    const extraction = parseFactsOnlyExtraction(JSON.stringify({
      candidates: [
        { rule_code: 'R001', source_quote: '首付款比例为10%。', facts: { decision: 'review' } },
      ],
      coverage: coverageFor(baseRules),
      summary: '模型错误地把有候选规则标为未观察。',
    }), baseRules)
    expect(getFactsOnlyExtractionCoverageNormalizations(extraction)).toHaveLength(1)

    const normalized = normalizeFactsOnlyExtractionSourceAnchors(extraction, source, baseRules)
    expect(getFactsOnlyExtractionCoverageNormalizations(normalized)).toEqual([{
      rule_code: 'R001',
      from: 'not_observed',
      to: 'observed',
      reason: 'candidate_present',
    }])
  })

  it('lets the server alone turn typed facts into A, B, C and explicit unknown outcomes', () => {
    const source = '条款甲可接受。\n条款乙需复核。\n条款丙应拒绝。\n条款丁尚不明确。'
    const batch = adjudicateFactsOnlyExtractionChunk({
      source_text: source,
      chunk: chunkFor(source),
      rules: baseRules,
      raw_output: JSON.stringify({
        candidates: [
          { rule_code: 'R001', source_quote: '条款甲可接受。', facts: { decision: 'accept' } },
          { rule_code: 'R001', source_quote: '条款乙需复核。', facts: { decision: 'review' } },
          { rule_code: 'R003', source_quote: '条款丙应拒绝。', facts: { decision: 'reject' } },
          { rule_code: 'R002', source_quote: '条款丁尚不明确。', facts: { decision: 'unknown' } },
        ],
        coverage: coverageFor(baseRules, ['R001', 'R002', 'R003']),
        summary: '只抽取事实。',
      }),
    })

    expect(batch.candidates.map((candidate) => ({
      level: candidate.result.ok ? candidate.result.matched_level : 'rejected',
      decision: candidate.result.decision,
      severity: candidate.result.severity,
    }))).toEqual([
      { level: 'A', decision: 'no_risk', severity: null },
      { level: 'B', decision: 'materialize', severity: 'yellow' },
      { level: 'C', decision: 'materialize', severity: 'red' },
      { level: null, decision: 'suppressed_unknown', severity: null },
    ])
    expect(batch.provisional_materialized_candidate_ids).toEqual([
      batch.candidates[1].candidate_id,
      batch.candidates[2].candidate_id,
    ])
    expect(batch.candidates.every((candidate) => (
      /^[0-9a-f]{64}$/.test(candidate.criteria_diagnostic_fingerprint)
    ))).toBe(true)
  })

  it('fails the whole batch for malformed facts or unprovable source anchors', () => {
    const source = '条款甲可接受。'
    expect(() => adjudicateFactsOnlyExtractionChunk({
      source_text: source,
      chunk: chunkFor(source),
      rules: baseRules,
      raw_output: JSON.stringify({
        candidates: [{ rule_code: 'R001', source_quote: source, facts: { decision: 42 } }],
        coverage: coverageFor(baseRules, ['R001']),
        summary: 'x',
      }),
    })).toThrowError(/failed the frozen schema/)

    expect(() => adjudicateFactsOnlyExtractionChunk({
      source_text: source,
      chunk: chunkFor(source),
      rules: baseRules,
      raw_output: JSON.stringify({
        candidates: [{ rule_code: 'R001', source_quote: '合同中不存在的原文', facts: { decision: 'reject' } }],
        coverage: coverageFor(baseRules, ['R001']),
        summary: 'x',
      }),
    })).toThrowError(/not uniquely recoverable/)
  })

  it('rejects stale chunk identity before parsing model output', () => {
    const source = '条款甲可接受。'
    expect(() => adjudicateFactsOnlyExtractionChunk({
      source_text: source,
      chunk: { ...chunkFor(source), hash: '0'.repeat(64) },
      rules: baseRules,
      raw_output: '{not-json',
    })).toThrowError(FactsOnlyRuntimeError)
    try {
      adjudicateFactsOnlyExtractionChunk({
        source_text: source,
        chunk: { ...chunkFor(source), hash: '0'.repeat(64) },
        rules: baseRules,
        raw_output: '{not-json',
      })
    } catch (error) {
      expect(error).toMatchObject({ code: 'CHUNK_PROVENANCE_INVALID' })
    }
  })

  it('suppresses only the less specific mutually exclusive result on the same source span', () => {
    const source = 'SLA赔偿包含全部营业损失。'
    const broad = rule({
      code: 'R007',
      snapshot_id: 'snapshot-r007',
      conflict_group: 'loss_liability_by_clause',
      mutually_exclusive_with: ['R013'],
      specificity: 120,
    })
    const specific = rule({
      code: 'R013',
      snapshot_id: 'snapshot-r013',
      conflict_group: 'loss_liability_by_clause',
      mutually_exclusive_with: ['R007'],
      specificity: 240,
    })
    const batch = adjudicateFactsOnlyExtractionChunk({
      source_text: source,
      chunk: chunkFor(source),
      rules: [broad, specific],
      raw_output: JSON.stringify({
        candidates: [
          { rule_code: 'R007', source_quote: source, facts: { decision: 'reject' } },
          { rule_code: 'R013', source_quote: source, facts: { decision: 'reject' } },
        ],
        coverage: coverageFor([broad, specific], ['R007', 'R013']),
        summary: '同一锚点的宽泛与具体规则。',
      }),
    })
    expect(batch.conflicts.suppressed).toEqual([{
      candidate_id: batch.candidates[0].candidate_id,
      suppressed_by_candidate_id: batch.candidates[1].candidate_id,
      conflict_group: 'loss_liability_by_clause',
      reason_code: 'lower_specificity',
    }])
    expect(batch.provisional_materialized_candidate_ids).toEqual([batch.candidates[1].candidate_id])

    const merged = mergeFactsOnlyAdjudicationBatches([batch], source)
    const traces = buildFactsOnlyAdjudicationTraceInputs(
      merged,
      new Map([[1, '11111111-1111-4111-8111-111111111111']]),
    )
    expect(traces).toEqual([
      expect.objectContaining({
        candidate_id: batch.candidates[0].candidate_id,
        decision: 'suppressed_conflict',
        reason_code: 'lower_specificity',
        suppressed_by_candidate_id: batch.candidates[1].candidate_id,
      }),
      expect.objectContaining({
        candidate_id: batch.candidates[1].candidate_id,
        decision: 'materialize',
        reason_code: 'level_c',
        suppressed_by_candidate_id: null,
      }),
    ])
    expect(() => buildFactsOnlyAdjudicationTraceInputs(merged, new Map()))
      .toThrowError(/match every merged chunk exactly/)
  })

  it('deduplicates identical overlap-chunk facts globally and rejects contradictory repeats', () => {
    const source = '前文。共同风险条款。后文。'
    const quote = '共同风险条款。'
    const start = source.indexOf(quote)
    const chunks = [
      { index: 1, total: 2, start: 0, end: start + quote.length },
      { index: 2, total: 2, start, end: source.length },
    ].map((chunk) => ({
      ...chunk,
      hash: createHash('sha256').update(source.slice(chunk.start, chunk.end)).digest('hex'),
    }))
    const makeBatch = (chunk: (typeof chunks)[number], decision: 'reject' | 'review') => (
      adjudicateFactsOnlyExtractionChunk({
        source_text: source,
        chunk,
        rules: [baseRules[0]],
        raw_output: JSON.stringify({
          candidates: [{ rule_code: 'R001', source_quote: quote, facts: { decision } }],
          coverage: coverageFor([baseRules[0]], ['R001']),
          summary: `chunk-${chunk.index}`,
        }),
      })
    )

    const left = makeBatch(chunks[0], 'reject')
    const right = makeBatch(chunks[1], 'reject')
    expect(left.candidates[0].candidate_id).toBe(right.candidates[0].candidate_id)
    const merged = mergeFactsOnlyAdjudicationBatches([left, right], source)
    expect(merged.candidates).toHaveLength(1)
    expect(merged.materialized_candidate_ids).toEqual([left.candidates[0].candidate_id])

    expect(() => mergeFactsOnlyAdjudicationBatches([
      left,
      makeBatch(chunks[1], 'review'),
    ], source)).toThrowError(/overlapping chunks produced conflicting facts/)
  })

  it('refuses a global result when any frozen chunk batch is missing, duplicated or mixed', () => {
    const source = '第一段。第二段。第三段。'
    const parts = [
      { index: 1, total: 2, start: 0, end: 8 },
      { index: 2, total: 2, start: 6, end: source.length },
    ].map((chunk) => ({
      ...chunk,
      hash: createHash('sha256').update(source.slice(chunk.start, chunk.end)).digest('hex'),
    }))
    const batchFor = (chunk: (typeof parts)[number]) => adjudicateFactsOnlyExtractionChunk({
      source_text: source,
      chunk,
      rules: [baseRules[0]],
      raw_output: JSON.stringify({
        candidates: [],
        coverage: coverageFor([baseRules[0]]),
        summary: `chunk-${chunk.index}`,
      }),
    })
    const first = batchFor(parts[0])
    const second = batchFor(parts[1])

    expect(() => mergeFactsOnlyAdjudicationBatches([first], source))
      .toThrowError(/one valid batch for every chunk/)
    expect(() => mergeFactsOnlyAdjudicationBatches([first, first], source))
      .toThrowError(/one valid batch for every chunk/)
    expect(() => mergeFactsOnlyAdjudicationBatches([
      first,
      { ...second, chunk: { ...second.chunk, total: 3 } },
    ], source)).toThrowError(/one valid batch for every chunk/)

    const changedRule = rule({ code: 'R001', snapshot_id: 'snapshot-r001-v2' })
    const mixedCatalogSecond = adjudicateFactsOnlyExtractionChunk({
      source_text: source,
      chunk: parts[1],
      rules: [changedRule],
      raw_output: JSON.stringify({
        candidates: [],
        coverage: coverageFor([changedRule]),
        summary: 'same code, different frozen snapshot',
      }),
    })
    expect(() => mergeFactsOnlyAdjudicationBatches([first, mixedCatalogSecond], source))
      .toThrowError(/one valid batch for every chunk/)

    const mergedEmpty = mergeFactsOnlyAdjudicationBatches([first, second], source)
    expect(() => buildFactsOnlyAdjudicationTraceInputs(
      mergedEmpty,
      new Map([[1, '11111111-1111-4111-8111-111111111111']]),
    )).toThrowError(/match every merged chunk exactly/)
    expect(buildFactsOnlyAdjudicationTraceInputs(mergedEmpty, new Map([
      [1, '11111111-1111-4111-8111-111111111111'],
      [2, '22222222-2222-4222-8222-222222222222'],
    ]))).toEqual([])
  })
})

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  adjudicateExtractedCandidate,
  validateDeterministicAdjudicationRule,
  type AdjudicationResult,
  type FactPredicate,
  type FactSchemaDefinition,
} from './deterministic-adjudicator'
import {
  buildDeterministicPreviewAdjudicationRule,
  DETERMINISTIC_PREVIEW_ABSENCE_DECISIONS,
  DETERMINISTIC_PREVIEW_RULES,
} from './deterministic-preview-candidate'

type ExampleSet = Record<'A' | 'B' | 'C' | 'unknown', Record<string, unknown>>

const EXAMPLES: Record<string, ExampleSet> = {
  R001: {
    A: { initial_payment_percent: 30, final_payment_days: 30, first_payment_after_acceptance: false },
    B: { initial_payment_percent: 20, final_payment_days: 30, first_payment_after_acceptance: false },
    C: { initial_payment_percent: 10, final_payment_days: 30, first_payment_after_acceptance: false },
    unknown: { initial_payment_percent: 30, final_payment_days: null, first_payment_after_acceptance: false },
  },
  R002: {
    A: { refund_scope: 'none', interest_required: false },
    B: { refund_scope: 'unconsumed', interest_required: false },
    C: { refund_scope: 'full', interest_required: false },
    unknown: { refund_scope: 'other', interest_required: null },
  },
  R003: {
    A: { delivery_type: 'private_deployment', tax_rate_percent: 13, mixed_itemized: null, mixed_uses_type_specific_rates: null },
    B: { delivery_type: 'unknown', tax_rate_percent: 6, mixed_itemized: null, mixed_uses_type_specific_rates: null },
    C: { delivery_type: 'saas_subscription', tax_rate_percent: 13, mixed_itemized: null, mixed_uses_type_specific_rates: null },
    unknown: { delivery_type: 'mixed', tax_rate_percent: null, mixed_itemized: null, mixed_uses_type_specific_rates: null },
  },
  R004: {
    A: { deemed_acceptance_present: true, acceptance_days: 10, day_unit: 'working_day' },
    B: { deemed_acceptance_present: true, acceptance_days: 20, day_unit: 'working_day' },
    C: { deemed_acceptance_present: false, acceptance_days: null, day_unit: 'unknown' },
    unknown: { deemed_acceptance_present: true, acceptance_days: 10, day_unit: 'calendar_day' },
  },
  R005: {
    A: { rectification_before_termination: true, rectification_attempts: 1, termination_without_rectification: false, termination_after_rectification: false, full_refund_required: false, indirect_loss_liability: false },
    B: { rectification_before_termination: true, rectification_attempts: 2, termination_without_rectification: false, termination_after_rectification: true, full_refund_required: false, indirect_loss_liability: false },
    C: { rectification_before_termination: false, rectification_attempts: 0, termination_without_rectification: true, termination_after_rectification: false, full_refund_required: true, indirect_loss_liability: false },
    unknown: { rectification_before_termination: true, rectification_attempts: 1, termination_without_rectification: false, termination_after_rectification: true, full_refund_required: false, indirect_loss_liability: false },
  },
  R006: {
    A: { liable_party: 'supplier', daily_rate_percent: 0.05, total_cap_percent: 10, cumulative_with_actual_loss: false },
    B: { liable_party: 'supplier', daily_rate_percent: 0.1, total_cap_percent: 50, cumulative_with_actual_loss: false },
    C: { liable_party: 'supplier', daily_rate_percent: 0.4, total_cap_percent: 50, cumulative_with_actual_loss: false },
    unknown: { liable_party: 'both', daily_rate_percent: 0.1, total_cap_percent: 50, cumulative_with_actual_loss: false },
  },
  R007: {
    A: { position: 'excluded', loss_types: ['indirect'] },
    B: { position: 'ambiguous', loss_types: [] },
    C: { position: 'assumed', loss_types: ['indirect', 'lost_profit'] },
    unknown: { position: null, loss_types: null },
  },
  R008: {
    A: { cap_status: 'capped', cap_percent: 50, cap_basis: 'contract_value', our_party_protection: 'mutual' },
    B: { cap_status: 'capped', cap_percent: 75, cap_basis: 'contract_value', our_party_protection: 'mutual' },
    C: { cap_status: 'uncapped', cap_percent: null, cap_basis: 'unspecified', our_party_protection: 'mutual' },
    unknown: { cap_status: 'capped', cap_percent: 50, cap_basis: 'contract_value', our_party_protection: null },
  },
  R009: {
    A: { direction: 'mutual', duration_mode: 'fixed', duration_years: 5, protected_scope: 'ordinary' },
    B: { direction: 'mutual', duration_mode: 'fixed', duration_years: 8, protected_scope: 'ordinary' },
    C: { direction: 'one_sided_against_us', duration_mode: 'fixed', duration_years: 5, protected_scope: 'ordinary' },
    unknown: { direction: null, duration_mode: 'fixed', duration_years: 5, protected_scope: 'ordinary' },
  },
  R010: {
    A: { authoritative_context_available: true, party_match: 'yes', bank_account_match: 'yes', amounts_consistent: true, dates_consistent: true, template_status: 'current' },
    B: { authoritative_context_available: true, party_match: 'yes', bank_account_match: 'yes', amounts_consistent: true, dates_consistent: true, template_status: 'old' },
    C: { authoritative_context_available: true, party_match: 'no', bank_account_match: 'yes', amounts_consistent: true, dates_consistent: true, template_status: 'current' },
    unknown: { authoritative_context_available: true, party_match: null, bank_account_match: null, amounts_consistent: null, dates_consistent: null, template_status: null },
  },
  R011: {
    A: { product_ip_owner: 'supplier', custom_development_owner: 'supplier', source_code_delivery_required: false, resale_or_transfer_allowed: false },
    B: { product_ip_owner: 'supplier', custom_development_owner: 'customer', source_code_delivery_required: false, resale_or_transfer_allowed: false },
    C: { product_ip_owner: 'customer', custom_development_owner: 'supplier', source_code_delivery_required: false, resale_or_transfer_allowed: false },
    unknown: { product_ip_owner: 'supplier', custom_development_owner: 'unclear', source_code_delivery_required: null, resale_or_transfer_allowed: false },
  },
  R012: {
    A: { customer_data_owner: 'customer', processing_limited_to_service: true, ai_training_without_authorization: false, external_context: 'domestic_only', dpa_present: null, additional_security_obligations: 'standard' },
    B: { customer_data_owner: 'customer', processing_limited_to_service: true, ai_training_without_authorization: false, external_context: null, dpa_present: null, additional_security_obligations: 'standard' },
    C: { customer_data_owner: 'customer', processing_limited_to_service: true, ai_training_without_authorization: true, external_context: 'domestic_only', dpa_present: null, additional_security_obligations: 'standard' },
    unknown: { customer_data_owner: 'unclear', processing_limited_to_service: null, ai_training_without_authorization: null, external_context: null, dpa_present: null, additional_security_obligations: 'unknown' },
  },
  R013: {
    A: { declared_deployment_mode: 'public_cloud', trusted_deployment_mode: 'public_cloud', availability_commitment_present: true, availability_percent: 99.5, compensation_basis: 'service_fee', support_24x7_required: false },
    B: { declared_deployment_mode: 'public_cloud', trusted_deployment_mode: 'public_cloud', availability_commitment_present: true, availability_percent: 99.9, compensation_basis: 'service_fee', support_24x7_required: false },
    C: { declared_deployment_mode: 'private_deployment', trusted_deployment_mode: 'private_deployment', availability_commitment_present: true, availability_percent: 99, compensation_basis: 'service_fee', support_24x7_required: false },
    unknown: { declared_deployment_mode: 'unclear', trusted_deployment_mode: null, availability_commitment_present: true, availability_percent: 99.5, compensation_basis: 'unknown', support_24x7_required: false },
  },
  R014: {
    A: { renewal_mode: 'written', expires_without_written_renewal: true, notice_days: null, exit_right: null, annual_price_increase_percent: null, permanent_price_lock: false },
    B: { renewal_mode: 'automatic', expires_without_written_renewal: false, notice_days: 30, exit_right: true, annual_price_increase_percent: 5, permanent_price_lock: false },
    C: { renewal_mode: 'automatic', expires_without_written_renewal: false, notice_days: 10, exit_right: true, annual_price_increase_percent: 5, permanent_price_lock: false },
    unknown: { renewal_mode: 'automatic', expires_without_written_renewal: false, notice_days: null, exit_right: true, annual_price_increase_percent: null, permanent_price_lock: false },
  },
  R015: {
    A: { forum_type: 'arbitration', city: 'shenzhen', arbitration_institution: 'scia', governing_law: 'china' },
    B: { forum_type: 'court', city: 'shanghai', arbitration_institution: 'not_applicable', governing_law: 'china' },
    C: { forum_type: 'arbitration', city: 'overseas', arbitration_institution: 'foreign', governing_law: 'foreign' },
    unknown: { forum_type: 'unclear', city: 'unclear', arbitration_institution: 'unclear', governing_law: 'unclear' },
  },
}

function adjudicate(code: string, facts: Record<string, unknown>): AdjudicationResult {
  const definition = DETERMINISTIC_PREVIEW_RULES.find((item) => item.code === code)
  if (!definition) throw new Error(`missing definition ${code}`)
  return adjudicateExtractedCandidate(
    buildDeterministicPreviewAdjudicationRule(definition, `preview-snapshot-${code}`),
    {
      id: `candidate-${code}`,
      rule_code: code,
      source_start: 0,
      source_end: 8,
      facts,
    },
  )
}

function collectNumericThresholds(
  predicate: FactPredicate,
  thresholds: Map<string, Set<number>>,
): void {
  if ('all' in predicate) {
    predicate.all.forEach((child) => collectNumericThresholds(child, thresholds))
    return
  }
  if ('any' in predicate) {
    predicate.any.forEach((child) => collectNumericThresholds(child, thresholds))
    return
  }
  if ('not' in predicate) {
    collectNumericThresholds(predicate.not, thresholds)
    return
  }
  const leaf = 'gt' in predicate
    ? predicate.gt
    : 'gte' in predicate
      ? predicate.gte
      : 'lt' in predicate
        ? predicate.lt
        : 'lte' in predicate
          ? predicate.lte
          : null
  if (!leaf) return
  const values = thresholds.get(leaf.fact) || new Set<number>()
  values.add(leaf.value)
  thresholds.set(leaf.fact, values)
}

function finiteDomain(
  definition: FactSchemaDefinition,
  numericThresholds: Set<number> | undefined,
): unknown[] {
  if (definition.type === 'string') {
    return [...(definition.enum || ['sample']), ...(definition.nullable ? [null] : [])]
  }
  if (definition.type === 'boolean') {
    return [true, false, ...(definition.nullable ? [null] : [])]
  }
  if (definition.type === 'string_array') {
    const members = definition.enum || ['sample']
    return [
      [],
      ...members.map((value) => [value]),
      members,
      ...(definition.nullable ? [null] : []),
    ]
  }
  const candidates = new Set<number>()
  if (definition.min !== undefined) candidates.add(definition.min)
  if (definition.max !== undefined) candidates.add(definition.max)
  for (const threshold of numericThresholds || []) {
    for (const value of [threshold - 0.01, threshold, threshold + 0.01]) {
      if (definition.min !== undefined && value < definition.min) continue
      if (definition.max !== undefined && value > definition.max) continue
      candidates.add(Number(value.toFixed(4)))
    }
  }
  return [...candidates, ...(definition.nullable ? [null] : [])]
}

function visitFiniteFactDomain(
  fields: Array<[string, unknown[]]>,
  visit: (facts: Record<string, unknown>) => void,
  index = 0,
  facts: Record<string, unknown> = {},
): void {
  if (index === fields.length) {
    visit({ ...facts })
    return
  }
  const [field, values] = fields[index]
  for (const value of values) {
    facts[field] = value
    visitFiniteFactDomain(fields, visit, index + 1, facts)
  }
  delete facts[field]
}

describe('deterministic Preview candidate contract', () => {
  it('defines exactly one valid, message-complete rule for R001-R015', () => {
    const expectedCodes = Array.from({ length: 15 }, (_, index) => `R${String(index + 1).padStart(3, '0')}`)
    expect(DETERMINISTIC_PREVIEW_RULES.map((item) => item.code)).toEqual(expectedCodes)
    expect(new Set(DETERMINISTIC_PREVIEW_RULES.map((item) => item.specificity)).size).toBe(15)

    for (const definition of DETERMINISTIC_PREVIEW_RULES) {
      const rule = buildDeterministicPreviewAdjudicationRule(definition, `preview-snapshot-${definition.code}`)
      expect(validateDeterministicAdjudicationRule(rule), definition.code).toEqual([])
      expect(Object.values(definition.message_template.levels).every(Boolean), definition.code).toBe(true)
      expect([
        definition.message_template.risk_title,
        definition.message_template.level_b_description,
        definition.message_template.level_c_description,
        definition.message_template.unknown_description,
        definition.message_template.absence_description,
        definition.message_template.comment_template,
        definition.message_template.negotiation_guidance,
        definition.message_template.bottom_line,
        definition.message_template.evidence_requirement,
      ].every((value) => value.trim().length > 0), definition.code).toBe(true)
    }
  })

  it('freezes the conservative v22.1 absence decisions', () => {
    expect(DETERMINISTIC_PREVIEW_ABSENCE_DECISIONS).toEqual({
      R001: 'yellow_review',
      R002: 'ignore',
      R003: 'red_risk',
      R004: 'yellow_review',
      R005: 'yellow_review',
      R006: 'yellow_review',
      R007: 'yellow_review',
      R008: 'red_risk',
      R009: 'yellow_review',
      R010: 'yellow_review',
      R011: 'yellow_review',
      R012: 'yellow_review',
      R013: 'ignore',
      R014: 'ignore',
      R015: 'yellow_review',
    })
  })

  it.each(Object.entries(EXAMPLES))('%s maps representative facts to disjoint A/B/C/unknown outcomes', (code, examples) => {
    const a = adjudicate(code, examples.A)
    const b = adjudicate(code, examples.B)
    const c = adjudicate(code, examples.C)
    const unknown = adjudicate(code, examples.unknown)

    expect(a).toMatchObject({ ok: true, matched_levels: ['A'], decision: 'no_risk', materialize: false, severity: null, reason_code: 'level_a' })
    expect(b).toMatchObject({ ok: true, matched_levels: ['B'], decision: 'materialize', materialize: true, severity: 'yellow', reason_code: 'level_b' })
    expect(c).toMatchObject({ ok: true, matched_levels: ['C'], decision: 'materialize', materialize: true, severity: 'red', reason_code: 'level_c' })
    expect(unknown).toMatchObject({ ok: true, matched_levels: [], decision: 'materialize', materialize: true, severity: 'yellow', reason_code: 'default_unknown_yellow' })
  })

  it('never turns missing external context into an automatic red decision', () => {
    expect(adjudicate('R010', {
      authoritative_context_available: null,
      party_match: 'no',
      bank_account_match: 'no',
      amounts_consistent: true,
      dates_consistent: true,
      template_status: 'old',
    })).toMatchObject({
      ok: true,
      severity: 'yellow',
    })

    expect(adjudicate('R012', {
      customer_data_owner: 'customer',
      processing_limited_to_service: true,
      ai_training_without_authorization: false,
      external_context: null,
      dpa_present: false,
      additional_security_obligations: 'onerous',
    })).toMatchObject({
      ok: true,
      severity: 'yellow',
    })
  })

  it('keeps customer-side R006 thresholds disjoint when the total cap is excessive', () => {
    expect(adjudicate('R006', {
      liable_party: 'customer',
      daily_rate_percent: 0.3,
      total_cap_percent: 101,
      cumulative_with_actual_loss: false,
    })).toMatchObject({
      ok: true,
      matched_levels: ['C'],
      severity: 'red',
      reason_code: 'level_c',
    })
  })

  it('keeps A/B/C mutually exclusive across enum, boolean, null and numeric boundaries', () => {
    let evaluated = 0
    for (const definition of DETERMINISTIC_PREVIEW_RULES) {
      const thresholds = new Map<string, Set<number>>()
      collectNumericThresholds(definition.review_criteria.level_a, thresholds)
      collectNumericThresholds(definition.review_criteria.level_b, thresholds)
      collectNumericThresholds(definition.review_criteria.level_c, thresholds)
      const fields = Object.entries(definition.review_criteria.fact_schema).map(([field, schema]) => [
        field,
        finiteDomain(schema, thresholds.get(field)),
      ] as [string, unknown[]])

      visitFiniteFactDomain(fields, (facts) => {
        evaluated += 1
        const result = adjudicate(definition.code, facts)
        expect(result.ok || result.reason_code !== 'multiple_levels', `${definition.code}: ${JSON.stringify(facts)}`).toBe(true)
      })
    }
    expect(evaluated).toBeGreaterThan(10_000)
  })
})

function canonicalManifestJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalManifestJson).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalManifestJson(item)}`)
    .join(',')}}`
}

describe('deterministic Preview candidate atomic freeze migration', () => {
  const expectedManifestHash = 'da8c818aeed5bd7abef2b3b9a28721a1ef9d10deb08ff0ac2eeb91d930fbf5e7'
  const migration = readFileSync(resolve(
    process.cwd(),
    'supabase/migrations/20260718053000_create_deterministic_preview_candidate.sql',
  ), 'utf8')
  const policyRecordFix = readFileSync(resolve(
    process.cwd(),
    'supabase/migrations/20260718055000_fix_deterministic_preview_candidate_policy_record.sql',
  ), 'utf8')

  it('binds the database RPC to the exact property-tested R001-R015 manifest', () => {
    const actualHash = createHash('sha256')
      .update(canonicalManifestJson(DETERMINISTIC_PREVIEW_RULES))
      .digest('hex')

    expect(actualHash).toBe(expectedManifestHash)
    expect(migration).toContain(expectedManifestHash)
    expect(migration).toContain('DETERMINISTIC_CANDIDATE_MANIFEST_HASH_MISMATCH')
    expect(migration).toContain('DETERMINISTIC_CANDIDATE_ABC_CONTRACT_INVALID')
    expect(migration).toContain('DETERMINISTIC_CANDIDATE_ABSENCE_MAP_INVALID')
    expect(migration).toContain('DETERMINISTIC_CANDIDATE_TRUSTED_CONTEXT_INVALID')
    expect(migration).toContain("v_output_schema->>'manifest_hash'")
    expect(migration).toContain('BUNDLE_CHANNEL_DETERMINISTIC_MANIFEST_INVALID')
  })

  it('forward-fixes PostgreSQL composite expansion before retrying candidate creation', () => {
    expect(policyRecordFix).toContain(
      'create or replace function public.create_deterministic_preview_candidate_v1(',
    )
    expect(policyRecordFix).toContain(
      'select (jsonb_populate_record(null::public.model_policies, v_candidate_policy_json)).*',
    )
    expect(policyRecordFix).not.toContain(
      'select jsonb_populate_record(null::public.model_policies, v_candidate_policy_json)\n  into v_candidate_policy;',
    )
    expect(policyRecordFix).toContain(
      'grant execute on function public.create_deterministic_preview_candidate_v1(',
    )
  })

  it('keeps v21 current while atomically freezing only a non-current Preview candidate', () => {
    expect(migration).toContain('bundle.version = 21')
    expect(migration).toContain('bundle.compiled_hash = p_expected_base_compiled_hash')
    expect(migration).toContain('public.create_contract_review_candidate_bundle_v1(')
    expect(migration).toContain("'release_eligible' = 'false'")
    expect(migration).toContain('and not bundle.is_current')
    expect(migration).not.toMatch(/update\s+public[.]contract_skill_bundles/i)
  })

  it('accepts only two existing local no-cost Qwen/Gemma configs for fact extraction', () => {
    expect(migration).toContain("config.type::text = 'AI_CONFIG'")
    expect(migration).toContain("config.status::text = 'PUBLISHED'")
    expect(migration).toContain("provider_kind' is distinct from 'lm_studio'")
    expect(migration).toContain("not like '%qwen%'")
    expect(migration).toContain("not like '%gemma%'")
    expect(migration).toContain('127[.]0[.]0[.]1|localhost|\\[::1\\]')
    expect(migration).toContain("value->>'api_key'")
    expect(migration).toContain("value->>'cost_tracking'")
    expect(migration).toContain("jsonb_build_array('fact_extraction')")
    expect(migration).toContain("v_policy_key is distinct from 'CONTRACT_REVIEW_DEFAULT'")
  })

  it('fences candidate movement during active work and exposes the creator RPC only to service_role', () => {
    expect(migration).toContain("job.status in ('preparing', 'queued', 'running')")
    expect(migration).toContain('PREVIEW_CANDIDATE_HAS_ACTIVE_REVIEW')
    expect(migration).toContain('DETERMINISTIC_PREVIEW_MODEL_POLICY_IMMUTABLE')
    expect(migration).toContain('RELEASE_CURRENT_FROZEN_DURING_DETERMINISTIC_PREVIEW')
    expect(migration).toContain('revoke update (is_current, updated_at)')
    expect(migration).toContain('public.publish_contract_rule_set_v1(uuid, uuid, uuid, text, jsonb)')
    expect(migration).toContain('DETERMINISTIC_PREVIEW_PROVIDER_CONFIG_IMMUTABLE')
    expect(migration).toContain('before insert or update or delete on public.contract_skill_bundle_channels')
    expect(migration).toContain("pg_catalog.convert_to(to_jsonb(v_candidate_policy)::text, 'UTF8')")
    expect(migration).toContain('from public, anon, authenticated')
    expect(migration).toContain(') to service_role;')
  })

  it('does not mislabel legacy rule-set evaluations as evidence for new criteria', () => {
    expect(migration).toContain("'status', 'unverified'")
    expect(migration).toContain("'scope', 'deterministic_preview_candidate'")
    expect(migration).toContain("'superseded_test_results_hash'")
    expect(migration).toContain("'verified_rule_snapshot_ids', jsonb_build_array()")
    expect(migration).not.toContain(
      "coalesce(v_base_rule_set_snapshot.test_results, '{}'::jsonb),",
    )
  })
})

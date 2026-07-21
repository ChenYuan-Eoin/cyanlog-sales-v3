import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mocks.from, rpc: mocks.rpc },
}))

import {
  getOrCompilePublishedContractSkillBundle,
  hashContractSkillBundleContent,
  isContractSkillBundleFormalReviewAllowed,
  loadFrozenRuleSetDocuments,
  loadPublishedRuleSetSnapshots,
  persistContractSkillBundle,
  summarizeRuleSetDocumentGate,
  summarizePublishedRuleEval,
  validatePublishedRuleSnapshot,
} from './skill-bundle'
import {
  RULE_CONTRACT_EVALUATOR_REVISION,
  ruleContractSha256,
} from '@/lib/rules/rule-release-readiness'

const skillBundleSource = readFileSync(join(process.cwd(), 'lib/contracts/skill-bundle.ts'), 'utf8')

function queryResult(data: unknown[], error: { message: string } | null = null) {
  const result = { data, error }
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    not: vi.fn(),
    in: vi.fn(),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => (
      Promise.resolve(result).then(resolve, reject)
    ),
  }
  chain.select.mockReturnValue(chain)
  chain.eq.mockReturnValue(chain)
  chain.not.mockReturnValue(chain)
  chain.in.mockReturnValue(chain)
  return chain
}

function formalBundle(overrides: Record<string, unknown> = {}) {
  return {
    status: 'published',
    is_current: true,
    published_at: '2026-07-02T00:00:00.000Z',
    release_meta: {
      official_review_allowed: true,
    },
    compiled_from: {
      rule_translation_gate: {
        status: 'ready',
        official_review_allowed: true,
      },
      rule_set_snapshot_gate: {
        status: 'ready',
      },
      rule_set_document_gate: {
        status: 'ready',
      },
      eval_results: {
        rule_acceptance_status: 'passed',
        model_quality_eval_status: 'blocked_without_independent_gold',
      },
    },
    ...overrides,
  }
}

function persistedBundle(status: 'compiled' | 'published' = 'compiled') {
  return {
    id: 'bundle-1', org_id: 'org-1', key: 'CONTRACT_REVIEW_DEFAULT', version: 3,
    status, is_current: status === 'published', rule_snapshot_ids: ['snapshot-1'],
    rule_set_snapshot_ids: ['set-snapshot-1'], template_snapshot_ids: [],
    document_snapshot_ids: [], output_schema: {}, model_policy_id: null,
    eval_case_ids: [],
    release_meta: { official_review_allowed: status === 'published' },
    compiled_from: {
      rule_translation_gate: { status: 'ready', official_review_allowed: true },
      rule_set_snapshot_gate: { status: 'ready' },
      rule_set_document_gate: { status: 'ready' },
      eval_results: {
        rule_acceptance_status: 'passed',
        model_quality_eval_status: 'blocked_without_independent_gold',
      },
    },
    compiled_hash: 'a'.repeat(64),
    published_at: status === 'published' ? '2026-07-21T00:00:00.000Z' : null,
  }
}

describe('SkillBundle formal review gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('compiles rule assets independently from AI routes and legacy ModelPolicy', () => {
    expect(skillBundleSource).not.toContain('resolvePublishedModelPolicy')
    expect(skillBundleSource).not.toContain("@/lib/contracts/model-policy")
    expect(skillBundleSource).not.toContain('provider_chain: modelPolicy')
    expect(skillBundleSource).toContain('model_policy_id: null')
    const reviewBinding = skillBundleSource.slice(
      skillBundleSource.indexOf('review_run_binding:'),
      skillBundleSource.indexOf('risk_finding:')
    )
    expect(reviewBinding).toContain("'plan_snapshot_id'")
    expect(reviewBinding).toContain("'plan_snapshot_hash'")
    expect(reviewBinding).toContain("'model_invocation_ids'")
    expect(reviewBinding).toContain("legacy_optional: ['model_policy_id']")
    expect(reviewBinding.slice(
      reviewBinding.indexOf('required:'),
      reviewBinding.indexOf('legacy_optional:')
    )).not.toContain("'model_policy_id'")
  })

  it('addresses only generation-1 compiled bundles by org, key, hash and status', () => {
    const reusableLoader = skillBundleSource.slice(
      skillBundleSource.indexOf('async function fetchReusableBundle'),
      skillBundleSource.indexOf('export async function persistContractSkillBundle')
    )
    expect(reusableLoader).toContain(".eq('org_id', orgId)")
    expect(reusableLoader).toContain(".eq('key', SKILL_BUNDLE_KEY)")
    expect(reusableLoader).toContain(".eq('compiled_hash', compiledHash)")
    expect(reusableLoader).toContain(".eq('status', status)")
    expect(reusableLoader).toContain(".eq('compiled_identity_generation', 1)")
    expect(reusableLoader).toContain(".order('version', { ascending: false })")
  })

  it('never serves a historical NULL-generation current bundle', () => {
    const currentLoader = skillBundleSource.slice(
      skillBundleSource.indexOf('async function fetchCurrentBundle'),
      skillBundleSource.indexOf('async function fetchReusableBundle')
    )
    expect(currentLoader).toContain(".eq('status', 'published')")
    expect(currentLoader).toContain(".eq('is_current', true)")
    expect(currentLoader).toContain(".eq('compiled_identity_generation', 1)")
  })

  it('hashes every immutable bundle input, not only compiled_from', () => {
    const content = {
      rule_snapshot_ids: ['rule-snapshot-1'],
      rule_set_snapshot_ids: ['set-snapshot-1'],
      template_snapshot_ids: [],
      document_snapshot_ids: ['document-1'],
      output_schema: { schema_version: 'v1', required: ['risk_findings'] },
      model_policy_id: null,
      eval_case_ids: ['eval-1'],
      compiled_from: { product_phase: 'contract_review_first_stage' },
    }
    const baseline = hashContractSkillBundleContent(content)
    expect(hashContractSkillBundleContent({
      ...content, output_schema: { ...content.output_schema, required: ['risk_findings', 'review_evidence'] },
    })).not.toBe(baseline)
    expect(hashContractSkillBundleContent({
      ...content, rule_snapshot_ids: ['rule-snapshot-2'],
    })).not.toBe(baseline)
    expect(hashContractSkillBundleContent({
      ...content, document_snapshot_ids: ['document-2'],
    })).not.toBe(baseline)
    expect(hashContractSkillBundleContent({
      ...content, model_policy_id: 'legacy-policy-id',
    })).not.toBe(baseline)
  })

  it('never clears current or inserts a bundle outside the atomic persistence RPC', () => {
    const compilerPersistence = skillBundleSource.slice(
      skillBundleSource.indexOf('export async function persistContractSkillBundle'),
      skillBundleSource.indexOf('export async function getOrCompilePublishedContractSkillBundle')
    )
    expect(compilerPersistence).toContain(".rpc('persist_contract_skill_bundle_v1'")
    expect(compilerPersistence).not.toContain(".from('contract_skill_bundles').insert")
    expect(compilerPersistence).not.toContain(".update({ is_current: false })")
    expect(skillBundleSource).not.toContain('fetchLatestBundleVersion')
  })

  it('persists compiled and published identities only through the atomic RPC', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: persistedBundle('compiled'), error: null })
    await expect(persistContractSkillBundle({
      orgId: 'org-1', status: 'compiled', compiledHash: 'a'.repeat(64), payload: {},
    })).resolves.toMatchObject({ id: 'bundle-1', status: 'compiled', is_current: false })
    expect(mocks.rpc).toHaveBeenCalledWith('persist_contract_skill_bundle_v1', expect.objectContaining({
      p_org_id: 'org-1', p_key: 'CONTRACT_REVIEW_DEFAULT', p_status: 'compiled',
      p_compiled_hash: 'a'.repeat(64),
    }))

    mocks.rpc.mockResolvedValueOnce({ data: persistedBundle('published'), error: null })
    await expect(persistContractSkillBundle({
      orgId: 'org-1', status: 'published', compiledHash: 'a'.repeat(64), payload: {},
    })).resolves.toMatchObject({ id: 'bundle-1', status: 'published', is_current: true })
  })

  it('fails closed on RPC errors or an invalid persisted lifecycle', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error('rpc failed') })
    await expect(persistContractSkillBundle({
      orgId: 'org-1', status: 'compiled', compiledHash: 'a'.repeat(64), payload: {},
    })).rejects.toThrow('rpc failed')

    mocks.rpc.mockResolvedValueOnce({
      data: { ...persistedBundle('compiled'), is_current: true }, error: null,
    })
    await expect(persistContractSkillBundle({
      orgId: 'org-1', status: 'compiled', compiledHash: 'a'.repeat(64), payload: {},
    })).rejects.toThrow('SKILL_BUNDLE_PERSIST_RESULT_INVALID')
  })

  it('only consumes atomic ruleset snapshots and never becomes a second ruleset publisher', () => {
    expect(skillBundleSource).toContain('loadPublishedRuleSetSnapshots')
    expect(skillBundleSource).toContain(".from('contract_rule_sets')")
    const pointerLoader = skillBundleSource.slice(
      skillBundleSource.indexOf('async function loadPublishedRuleSetSnapshots'),
      skillBundleSource.indexOf('function summarizeRuleSetSnapshotGate')
    )
    expect(pointerLoader).not.toContain(".eq('lifecycle_status', 'published')")
    expect(pointerLoader).not.toContain(".eq('translation_status', 'ready')")
    expect(skillBundleSource).toContain('current_snapshot_id')
    expect(skillBundleSource).toContain(".from('contract_rule_set_snapshots')")
    expect(skillBundleSource).toContain(".in('id', currentSnapshotIds)")
    expect(skillBundleSource).toContain('RULESET_CURRENT_POINTER_STATE_INVALID')
    expect(skillBundleSource).toContain('RULESET_CURRENT_SNAPSHOT_INVALID')
    expect(skillBundleSource).toContain('RULESET_CURRENT_MEMBERSHIP_INVALID')
    expect(skillBundleSource).not.toContain(".from('contract_rule_set_snapshots')\n    .upsert")
    expect(pointerLoader).not.toContain(".order('released_at'")
    expect(pointerLoader).not.toContain(".in('rule_set_id'")
    expect(pointerLoader).not.toContain(".not('published_at'")
  })

  it('keeps serving the immutable current release while the live set has a pending draft', async () => {
    const pointerQuery = queryResult([{
      id: 'set-1', org_id: 'org-1', current_snapshot_id: 'set-snapshot-1',
      published_at: '2026-07-20T00:00:00.000Z', lifecycle_status: 'ready_to_publish',
      translation_status: 'ready',
    }])
    const snapshotQuery = queryResult([{
      id: 'set-snapshot-1', org_id: 'org-1', rule_set_id: 'set-1', version: 1,
      status: 'published', rule_snapshot_ids: ['rule-snapshot-1'], document_snapshot_ids: [] as string[],
      config_snapshot: {}, test_results: {}, released_at: '2026-07-20T00:00:00.000Z',
    }])
    mocks.from.mockImplementation((table: string) => {
      if (table === 'contract_rule_sets') return pointerQuery
      if (table === 'contract_rule_set_snapshots') return snapshotQuery
      throw new Error(`unexpected table: ${table}`)
    })

    await expect(loadPublishedRuleSetSnapshots('org-1')).resolves.toMatchObject([{
      id: 'set-snapshot-1', status: 'published', rule_snapshot_ids: ['rule-snapshot-1'],
    }])
    expect(pointerQuery.eq).not.toHaveBeenCalledWith('lifecycle_status', 'published')
    expect(pointerQuery.eq).not.toHaveBeenCalledWith('translation_status', 'ready')
  })

  it('treats an omitted RuleSetDocument as optional but fails closed on every named document identity', async () => {
    const snapshots = [{
      id: 'set-snapshot-1', org_id: 'org-1', rule_set_id: 'set-1', version: 1,
      status: 'published', rule_snapshot_ids: ['rule-snapshot-1'], document_snapshot_ids: [] as string[],
      config_snapshot: {}, test_results: {}, released_at: '2026-07-20T00:00:00.000Z',
    }]

    await expect(loadFrozenRuleSetDocuments('org-1', snapshots)).resolves.toEqual([])
    expect(mocks.from).not.toHaveBeenCalled()

    snapshots[0].document_snapshot_ids = ['document-1']
    mocks.from.mockReturnValueOnce(queryResult([]))
    await expect(loadFrozenRuleSetDocuments('org-1', snapshots)).rejects.toThrow(
      'RULESET_CURRENT_DOCUMENT_INVALID:document-1[missing]'
    )
  })

  it.each([
    ['org mismatch', { org_id: 'org-2', rule_set_id: 'set-1', status: 'published', translation_status: 'ready' }, 'org_mismatch'],
    ['RuleSet mismatch', { org_id: 'org-1', rule_set_id: 'set-2', status: 'published', translation_status: 'ready' }, 'rule_set_mismatch'],
    ['unpublished state', { org_id: 'org-1', rule_set_id: 'set-1', status: 'draft', translation_status: 'ready' }, 'status_not_published'],
    ['unready translation', { org_id: 'org-1', rule_set_id: 'set-1', status: 'published', translation_status: 'needs_ai_translation' }, 'translation_not_ready'],
  ])('rejects a referenced RuleSetDocument with %s', async (_label, overrides, expectedReason) => {
    const snapshots = [{
      id: 'set-snapshot-1', org_id: 'org-1', rule_set_id: 'set-1', version: 1,
      status: 'published', rule_snapshot_ids: ['rule-snapshot-1'], document_snapshot_ids: ['document-1'],
      config_snapshot: {}, test_results: {}, released_at: '2026-07-20T00:00:00.000Z',
    }]
    mocks.from.mockReturnValueOnce(queryResult([{
      id: 'document-1', title: '审核规则说明', source_type: 'markdown', source_uri: null,
      content_hash: 'a'.repeat(64), version: 1, updated_at: '2026-07-20T00:00:00.000Z',
      ...overrides,
    }]))

    await expect(loadFrozenRuleSetDocuments('org-1', snapshots)).rejects.toThrow(
      `RULESET_CURRENT_DOCUMENT_INVALID:document-1[${expectedReason}]`
    )
  })

  it('loads every exact published and translated RuleSetDocument in stable identity order', async () => {
    const snapshots = [{
      id: 'set-snapshot-1', org_id: 'org-1', rule_set_id: 'set-1', version: 1,
      status: 'published', rule_snapshot_ids: ['rule-snapshot-1'],
      document_snapshot_ids: ['document-2', 'document-1'], config_snapshot: {}, test_results: {},
      released_at: '2026-07-20T00:00:00.000Z',
    }]
    mocks.from.mockReturnValueOnce(queryResult(['document-2', 'document-1'].map((id) => ({
      id, org_id: 'org-1', rule_set_id: 'set-1', title: id, source_type: 'markdown',
      source_uri: null, content_hash: 'a'.repeat(64), version: 1, status: 'published',
      translation_status: 'ready', updated_at: '2026-07-20T00:00:00.000Z',
    }))))

    await expect(loadFrozenRuleSetDocuments('org-1', snapshots)).resolves.toMatchObject([
      { id: 'document-1' }, { id: 'document-2' },
    ])
  })

  it('reports every ready document when one RuleSet freezes multiple references', () => {
    const ruleSet = {
      id: 'set-1', code: 'STANDARD', name: '标准规则集', description: null, version: 1,
      lifecycle_status: 'published', translation_status: 'ready',
      published_at: '2026-07-20T00:00:00.000Z',
    }
    const documents = ['document-1', 'document-2'].map((id) => ({
      id, org_id: 'org-1', rule_set_id: 'set-1', title: id, source_type: 'markdown',
      source_uri: null, content_hash: 'a'.repeat(64), version: 1, status: 'published',
      translation_status: 'ready', updated_at: '2026-07-20T00:00:00.000Z',
    }))

    expect(summarizeRuleSetDocumentGate([ruleSet], documents)).toMatchObject({
      status: 'ready', total_rule_sets: 1, ready_documents: 2,
    })
  })

  it('reports every immutable snapshot defect instead of silently using live or legacy fields', () => {
    expect(validatePublishedRuleSnapshot({
      snapshot: {
        id: 'snapshot-1',
        rule_id: 'rule-1',
        version: 4,
        status: 'published',
        released_at: '2026-07-21T00:00:00.000Z',
        created_at: '2026-07-21T00:00:00.000Z',
        config_snapshot: {
          id: 'rule-1',
          org_id: 'org-1',
          rule_set_id: 'set-1',
          version: 3,
          is_active: true,
          problem_category_id: null,
          rule_contract: null,
        },
      },
      orgId: 'org-1',
      ownerRuleSetId: 'set-1',
    })).toEqual([
      'version_mismatch',
      'problem_category_missing',
      'rule_contract_invalid',
    ])
  })

  it('accepts only a non-empty canonical rule contract frozen into the snapshot', () => {
    expect(validatePublishedRuleSnapshot({
      snapshot: {
        id: 'snapshot-1',
        rule_id: 'rule-1',
        version: 4,
        status: 'published',
        released_at: '2026-07-21T00:00:00.000Z',
        created_at: '2026-07-21T00:00:00.000Z',
        config_snapshot: {
          id: 'rule-1',
          org_id: 'org-1',
          rule_set_id: 'set-1',
          version: 4,
          is_active: true,
          problem_category_id: 'category-1',
          rule_contract: {
            schema_version: '1.0',
            properties: [{
              key: 'contract_amount', label: '合同金额', type: 'money', required: true, currency: 'CNY',
            }],
            decisions: [{
              id: 'amount_floor', label: '低于金额底线', outcome: 'block', priority: 100,
              match: 'all', conditions: [{ property_key: 'contract_amount', operator: '<', value: 50000 }],
            }],
            missing_evidence_outcome: 'manual_review',
          },
        },
      },
      orgId: 'org-1',
      ownerRuleSetId: 'set-1',
    })).toEqual([])
  })

  it('does not turn translation readiness into fake eval evidence', () => {
    const contract = {
      schema_version: '1.0' as const,
      properties: [{
        key: 'payment_method', label: '付款方式', type: 'enum' as const, required: true,
        options: [{ value: 'prepaid', label: '预付款' }],
      }],
      decisions: [{
        id: 'prepaid_ok', label: '预付款通过', outcome: 'pass' as const, priority: 100,
        match: 'all' as const,
        conditions: [{ property_key: 'payment_method', operator: '=' as const, value: 'prepaid' }],
      }],
      missing_evidence_outcome: 'manual_review' as const,
    }
    const summary = summarizePublishedRuleEval({
      ruleTranslationStatus: 'ready',
      ruleSetSnapshots: [{
        id: 'set-snapshot-1', org_id: 'org-1', rule_set_id: 'set-1', version: 1,
        status: 'published', rule_snapshot_ids: ['snapshot-1'], document_snapshot_ids: [],
        config_snapshot: {}, test_results: {}, released_at: '2026-07-21T00:00:00.000Z',
      }],
      ruleSnapshots: [{
        id: 'snapshot-1', rule_id: 'rule-1', version: 1, status: 'published',
        released_at: '2026-07-21T00:00:00.000Z', created_at: '2026-07-21T00:00:00.000Z',
        config_snapshot: { rule_contract: contract },
      }],
    })

    expect(summary).toMatchObject({
      status: 'runtime_eval_not_run',
      total_rules: 1,
      passed_rules: 0,
      passed_cases: 0,
    })
    expect(summary.blocking_reasons).toEqual(expect.arrayContaining([
      'ruleset_acceptance_gate_missing:set-snapshot-1',
      'rule_acceptance_missing:snapshot-1:判定“预付款通过”',
      'rule_acceptance_missing:snapshot-1:缺少证据转人工',
    ]))
  })

  it('passes eval only for a complete matrix frozen to the exact current snapshots', () => {
    const contract = {
      schema_version: '1.0' as const,
      properties: [{
        key: 'payment_method', label: '付款方式', type: 'enum' as const, required: true,
        options: [{ value: 'prepaid', label: '预付款' }],
      }],
      decisions: [{
        id: 'prepaid_ok', label: '预付款通过', outcome: 'pass' as const, priority: 100,
        match: 'all' as const,
        conditions: [{ property_key: 'payment_method', operator: '=' as const, value: 'prepaid' }],
      }],
      missing_evidence_outcome: 'manual_review' as const,
    }
    const binding = {
      assertion_passed: true,
      rule_snapshot_id: 'draft-snapshot-1',
      rule_contract_sha256: ruleContractSha256(contract),
      evaluator_revision: RULE_CONTRACT_EVALUATOR_REVISION,
      created_at: '2026-07-21T00:00:00.000Z',
    }
    const summary = summarizePublishedRuleEval({
      ruleTranslationStatus: 'ready',
      ruleSetSnapshots: [{
        id: 'set-snapshot-1', org_id: 'org-1', rule_set_id: 'set-1', version: 1,
        status: 'published', rule_snapshot_ids: ['snapshot-1'], document_snapshot_ids: [],
        config_snapshot: {},
        test_results: {
          gate: 'snapshot_bound_latest_asserted_rule_matrix',
          rule_count: 1,
          rule_runs: {
            'rule-1': [
              {
                ...binding, id: 'run-pass', case_kind: 'pass', expected_status: 'decided',
                expected_outcome: 'pass', expected_decision_id: 'prepaid_ok',
              },
              {
                ...binding, id: 'run-missing', case_kind: 'missing_evidence',
                expected_status: 'missing_evidence', expected_outcome: 'manual_review',
                expected_decision_id: null,
              },
            ],
          },
        },
        released_at: '2026-07-21T00:00:00.000Z',
      }],
      ruleSnapshots: [{
        id: 'snapshot-1', rule_id: 'rule-1', version: 1, status: 'published',
        released_at: '2026-07-21T00:00:00.000Z', created_at: '2026-07-21T00:00:00.000Z',
        config_snapshot: {
          rule_contract: contract,
          _release_evidence: { accepted_draft_snapshot_id: 'draft-snapshot-1' },
        },
      }],
    })

    expect(summary).toEqual({
      status: 'passed',
      total_rules: 1,
      passed_rules: 1,
      required_cases: 2,
      passed_cases: 2,
      blocking_reasons: [],
    })
  })

  it('fails closed when current snapshot pointer and published_at disagree', async () => {
    mocks.from.mockReturnValue(queryResult([{
      id: 'set-1',
      org_id: 'org-1',
      current_snapshot_id: 'set-snapshot-1',
      published_at: null,
    }]))

    await expect(getOrCompilePublishedContractSkillBundle({ orgId: 'org-1' })).rejects.toThrow(
      'RULESET_CURRENT_POINTER_STATE_INVALID:set-1'
    )
  })

  it('fails closed for each malformed current RuleSet membership', async () => {
    for (const memberIds of [
      [],
      ['snapshot-1', ''],
      ['snapshot-1', 'snapshot-1'],
    ]) {
      vi.clearAllMocks()
      const pointerQuery = queryResult([{
        id: 'set-1', org_id: 'org-1', current_snapshot_id: 'set-snapshot-1',
        published_at: '2026-07-20T00:00:00.000Z',
      }])
      const snapshotQuery = queryResult([{
        id: 'set-snapshot-1', org_id: 'org-1', rule_set_id: 'set-1', version: 1,
        status: 'published', rule_snapshot_ids: memberIds, document_snapshot_ids: [],
        config_snapshot: {}, released_at: '2026-07-20T00:00:00.000Z',
      }])
      mocks.from.mockImplementation((table: string) => {
        if (table === 'contract_rule_sets') return pointerQuery
        if (table === 'contract_rule_set_snapshots') return snapshotQuery
        throw new Error(`unexpected table: ${table}`)
      })

      await expect(getOrCompilePublishedContractSkillBundle({ orgId: 'org-1' })).rejects.toThrow(
        'RULESET_CURRENT_MEMBERSHIP_INVALID:set-1'
      )
    }
  })

  it('allows only published current bundles with translation and eval gates passed', () => {
    expect(isContractSkillBundleFormalReviewAllowed(formalBundle())).toBe(true)
  })

  it('rejects published-looking bundles when eval evidence is missing', () => {
    expect(isContractSkillBundleFormalReviewAllowed(formalBundle({
      compiled_from: {
        rule_translation_gate: {
          status: 'ready',
          official_review_allowed: true,
        },
        rule_set_snapshot_gate: {
          status: 'ready',
        },
        rule_set_document_gate: {
          status: 'ready',
        },
        eval_results: {
          rule_acceptance_status: 'runtime_eval_not_run',
          model_quality_eval_status: 'blocked_without_independent_gold',
        },
      },
    }))).toBe(false)
  })

  it('rejects bundles that were compiled but not formally published', () => {
    expect(isContractSkillBundleFormalReviewAllowed(formalBundle({
      status: 'compiled',
      is_current: false,
      published_at: null,
      release_meta: {
        official_review_allowed: false,
      },
    }))).toBe(false)
  })

  it('rejects bundles when rule translation still needs confirmation', () => {
    expect(isContractSkillBundleFormalReviewAllowed(formalBundle({
      compiled_from: {
        rule_translation_gate: {
          status: 'needs_ai_translation',
          official_review_allowed: false,
          blocking_reasons: ['rule_translation_needs_confirmation'],
        },
        rule_set_snapshot_gate: {
          status: 'ready',
        },
        rule_set_document_gate: {
          status: 'ready',
        },
        eval_results: {
          rule_acceptance_status: 'failed',
          model_quality_eval_status: 'blocked_without_independent_gold',
        },
      },
    }))).toBe(false)
  })

  it('allows an otherwise complete bundle when optional ruleset reference documents are absent', () => {
    expect(isContractSkillBundleFormalReviewAllowed(formalBundle({
      compiled_from: {
        rule_translation_gate: {
          status: 'ready',
          official_review_allowed: true,
        },
        rule_set_snapshot_gate: {
          status: 'ready',
        },
        rule_set_document_gate: {
          status: 'ready',
          total_rule_sets: 1,
          ready_documents: 0,
          blocking_reasons: [],
        },
        eval_results: {
          rule_acceptance_status: 'passed',
          model_quality_eval_status: 'blocked_without_independent_gold',
        },
      },
    }))).toBe(true)
  })

  it('rejects bundles when SkillBundle has no atomic published ruleset snapshot to consume', () => {
    expect(isContractSkillBundleFormalReviewAllowed(formalBundle({
      compiled_from: {
        rule_translation_gate: {
          status: 'ready',
          official_review_allowed: true,
        },
        rule_set_snapshot_gate: {
          status: 'failed',
          blocking_reasons: ['published_rule_set_snapshot_missing:set-1'],
        },
        rule_set_document_gate: {
          status: 'ready',
        },
        eval_results: {
          rule_acceptance_status: 'passed',
          model_quality_eval_status: 'blocked_without_independent_gold',
        },
      },
    }))).toBe(false)
  })
})

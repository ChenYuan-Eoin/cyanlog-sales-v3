import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildReviewRunEvidence } from './review-evidence'

const reviewRouteSource = readFileSync(
  join(process.cwd(), 'app/api/contracts/[id]/review/route.ts'),
  'utf8'
)

describe('buildReviewRunEvidence', () => {
  it('binds ReviewRun to published rule snapshots and analysis job provider', () => {
    const evidence = buildReviewRunEvidence({
      latestReview: {
        id: 'review-1',
        status: 'COMPLETED',
        rule_snapshot_ids: ['snapshot-1'],
        rule_set_snapshot_ids: ['rule-set-snapshot-1'],
        created_at: '2026-06-30T01:00:00.000Z',
        completed_at: '2026-06-30T01:02:00.000Z',
      },
      latestJob: {
        id: 'job-1',
        status: 'completed',
        provider: 'rule-engine',
        degraded: false,
        started_at: '2026-06-30T01:00:30.000Z',
        completed_at: '2026-06-30T01:01:30.000Z',
      },
      currentVersion: { id: 'version-1' },
      risks: [{ rule_id: 'rule-1', rule_code: 'R001', rule_version: 2 }],
      snapshots: [{
        id: 'snapshot-1',
        rule_id: 'rule-1',
        version: 2,
        status: 'published',
        released_at: '2026-06-30T00:59:00.000Z',
        config_snapshot: { code: 'R001', engine_type: 'structured', version: 2 },
      }],
      ruleSetSnapshots: [{
        id: 'rule-set-snapshot-1',
        org_id: 'org-1',
        status: 'published',
        rule_snapshot_ids: ['snapshot-1'],
      }],
      expectedOrgId: 'org-1',
    })

    expect(evidence).toMatchObject({
      id: 'review-1',
      contract_version_id: 'version-1',
      skill_bundle_id: 'contract-skill:ruleset:R001@2',
      rule_snapshot_id: 'contract_rule_snapshots:snapshot-1',
      model_policy_id: 'model-policy:rule-engine',
      evidence_status: 'snapshot_bound',
      model_policy: {
        provider: 'rule-engine',
        source: 'analysis_job.provider',
        degraded: false,
      },
    })
    expect(evidence?.rule_snapshot_refs).toEqual([{
      id: 'snapshot-1',
      rule_id: 'rule-1',
      rule_code: 'R001',
      version: 2,
      engine_type: 'structured',
      released_at: '2026-06-30T00:59:00.000Z',
      source: 'published_snapshot',
    }])
  })

  it('marks partial snapshot evidence when a risk references an uncovered rule', () => {
    const evidence = buildReviewRunEvidence({
      latestReview: {
        id: 'review-1',
        status: 'COMPLETED',
        rule_snapshot_ids: ['snapshot-1'],
        rule_set_snapshot_ids: ['rule-set-snapshot-1'],
      },
      latestJob: null,
      currentVersion: null,
      risks: [
        { rule_id: 'rule-1', rule_code: 'R001' },
        { rule_id: 'rule-missing', rule_code: 'R999' },
      ],
      snapshots: [{ id: 'snapshot-1', rule_id: 'rule-1', version: 1, status: 'published' }],
      ruleSetSnapshots: [{
        id: 'rule-set-snapshot-1',
        org_id: 'org-1',
        status: 'published',
        rule_snapshot_ids: ['snapshot-1'],
      }],
      expectedOrgId: 'org-1',
    })

    expect(evidence?.evidence_status).toBe('partial_snapshot')
    expect(evidence?.model_policy).toMatchObject({
      provider: 'rule-engine',
      source: 'fallback',
      degraded: false,
    })
  })

  it('marks missing snapshot evidence without published snapshots', () => {
    const evidence = buildReviewRunEvidence({
      latestReview: { id: 'review-1', status: 'COMPLETED' },
      latestJob: { provider: null, degraded: true, status: 'failed', last_error: 'model timeout' },
      currentVersion: null,
      risks: [{ rule_id: 'rule-1', rule_code: 'R001' }],
      snapshots: [],
    })

    expect(evidence?.rule_snapshot_id).toBe('contract_rule_snapshots:missing')
    expect(evidence?.skill_bundle_id).toBe('contract-skill:ruleset:missing')
    expect(evidence?.evidence_status).toBe('missing_snapshot')
    expect(evidence?.model_policy).toMatchObject({
      provider: 'rule-engine',
      source: 'fallback',
      degraded: true,
      last_error: 'model timeout',
    })
  })

  it('does not treat draft bound snapshots as formal published evidence', () => {
    const evidence = buildReviewRunEvidence({
      latestReview: {
        id: 'review-draft-bound',
        status: 'COMPLETED',
        rule_snapshot_ids: ['snapshot-draft'],
      },
      latestJob: { provider: 'rule-engine', degraded: false, status: 'completed' },
      currentVersion: { id: 'version-1' },
      risks: [{ rule_id: 'rule-1', rule_code: 'R001', rule_version: 3 }],
      snapshots: [{
        id: 'snapshot-draft',
        rule_id: 'rule-1',
        version: 3,
        status: 'draft',
        created_at: '2026-07-01T00:00:00.000Z',
        config_snapshot: { code: 'R001', engine_type: 'hybrid', version: 3 },
      }],
    })

    expect(evidence?.evidence_status).toBe('missing_snapshot')
    expect(evidence?.rule_snapshot_refs).toEqual([])
    expect(evidence?.rule_snapshot_id).toBe('contract_rule_snapshots:bound_unpublished_or_missing:1')
    expect(evidence?.skill_bundle_id).toBe('contract-skill:ruleset:missing')
  })

  it('keeps an explicitly bound historical snapshot after a later release rolls it back', () => {
    const evidence = buildReviewRunEvidence({
      latestReview: {
        id: 'review-historical-bound',
        status: 'COMPLETED',
        rule_snapshot_ids: ['snapshot-old'],
        rule_set_snapshot_ids: ['rule-set-snapshot-old'],
      },
      latestJob: { provider: 'rule-engine', degraded: false, status: 'completed' },
      currentVersion: { id: 'version-old' },
      risks: [{ rule_id: 'rule-1', rule_code: 'R001', rule_version: 2 }],
      snapshots: [{
        id: 'snapshot-old',
        rule_id: 'rule-1',
        version: 2,
        status: 'rolled_back',
        released_at: '2026-07-01T00:00:00.000Z',
        config_snapshot: { code: 'R001', engine_type: 'rule_contract_v1', version: 2 },
      }],
      ruleSetSnapshots: [{
        id: 'rule-set-snapshot-old',
        org_id: 'org-1',
        status: 'rolled_back',
        rule_snapshot_ids: ['snapshot-old'],
      }],
      expectedOrgId: 'org-1',
    })

    expect(evidence?.evidence_status).toBe('snapshot_bound')
    expect(evidence?.rule_snapshot_id).toBe('contract_rule_snapshots:snapshot-old')
    expect(evidence?.rule_snapshot_refs).toEqual([
      expect.objectContaining({ id: 'snapshot-old', version: 2 }),
    ])
  })

  it('does not accept an unbound rolled-back snapshot as current evidence', () => {
    const evidence = buildReviewRunEvidence({
      latestReview: { id: 'review-unbound-old', status: 'COMPLETED' },
      latestJob: { provider: 'rule-engine', degraded: false, status: 'completed' },
      currentVersion: { id: 'version-old' },
      risks: [{ rule_id: 'rule-1', rule_code: 'R001', rule_version: 2 }],
      snapshots: [{ id: 'snapshot-old', rule_id: 'rule-1', version: 2, status: 'rolled_back' }],
    })

    expect(evidence?.evidence_status).toBe('missing_snapshot')
    expect(evidence?.rule_snapshot_refs).toEqual([])
  })

  it('treats empty ReviewRun arrays as missing and falls back to its immutable SkillBundle bindings', () => {
    const evidence = buildReviewRunEvidence({
      latestReview: {
        id: 'review-empty-arrays',
        status: 'COMPLETED',
        skill_bundle_id: 'skill-1',
        rule_snapshot_ids: [],
        rule_set_snapshot_ids: [],
      },
      latestJob: { provider: 'rule-engine', degraded: false, status: 'completed' },
      currentVersion: { id: 'version-1' },
      risks: [{ rule_id: 'rule-1', rule_code: 'R001' }],
      snapshots: [{
        id: 'snapshot-1',
        rule_id: 'rule-1',
        version: 1,
        status: 'published',
        config_snapshot: { code: 'R001', engine_type: 'rule_contract_v1' },
      }],
      ruleSetSnapshots: [{
        id: 'rule-set-snapshot-1',
        org_id: 'org-1',
        status: 'published',
        rule_snapshot_ids: ['snapshot-1'],
      }],
      expectedOrgId: 'org-1',
      skillBundle: {
        id: 'skill-1',
        status: 'published',
        rule_snapshot_ids: ['snapshot-1'],
        rule_set_snapshot_ids: ['rule-set-snapshot-1'],
      },
    })

    expect(evidence?.evidence_status).toBe('snapshot_bound')
    expect(evidence?.rule_snapshot_id).toBe('contract_rule_snapshots:snapshot-1')
    expect(evidence?.snapshot_integrity).toEqual({
      valid: true,
      rule_binding_source: 'skill_bundle',
      rule_set_binding_source: 'skill_bundle',
      errors: [],
    })
  })

  it('fails closed when ReviewRun and its bound SkillBundle name different snapshots', () => {
    const evidence = buildReviewRunEvidence({
      latestReview: {
        id: 'review-bundle-mismatch',
        status: 'COMPLETED',
        skill_bundle_id: 'skill-1',
        rule_snapshot_ids: ['snapshot-run'],
        rule_set_snapshot_ids: ['rule-set-run'],
      },
      latestJob: null,
      currentVersion: null,
      risks: [],
      snapshots: [{ id: 'snapshot-run', rule_id: 'rule-1', status: 'published' }],
      ruleSetSnapshots: [{
        id: 'rule-set-run',
        org_id: 'org-1',
        status: 'published',
        rule_snapshot_ids: ['snapshot-run'],
      }],
      expectedOrgId: 'org-1',
      skillBundle: {
        id: 'skill-1',
        rule_snapshot_ids: ['snapshot-bundle'],
        rule_set_snapshot_ids: ['rule-set-bundle'],
      },
    })

    expect(evidence?.evidence_status).toBe('missing_snapshot')
    expect(evidence?.rule_snapshot_refs).toEqual([])
    expect(evidence?.snapshot_integrity.errors).toEqual(expect.arrayContaining([
      'review_bundle_rule_snapshot_mismatch',
      'review_bundle_rule_set_snapshot_mismatch',
    ]))
  })

  it('fails closed when a bound rule snapshot row is missing', () => {
    const evidence = buildReviewRunEvidence({
      latestReview: {
        id: 'review-missing-row',
        rule_snapshot_ids: ['snapshot-1', 'snapshot-2'],
        rule_set_snapshot_ids: ['rule-set-snapshot-1'],
      },
      latestJob: null,
      currentVersion: null,
      risks: [],
      snapshots: [{ id: 'snapshot-1', rule_id: 'rule-1', status: 'published' }],
      ruleSetSnapshots: [{
        id: 'rule-set-snapshot-1',
        org_id: 'org-1',
        status: 'published',
        rule_snapshot_ids: ['snapshot-1', 'snapshot-2'],
      }],
      expectedOrgId: 'org-1',
    })

    expect(evidence?.evidence_status).toBe('missing_snapshot')
    expect(evidence?.snapshot_integrity.errors).toContain('rule_snapshot_rows_not_exact')
  })

  it('fails closed when a RuleSet snapshot has missing or extra members', () => {
    const evidence = buildReviewRunEvidence({
      latestReview: {
        id: 'review-extra-member',
        rule_snapshot_ids: ['snapshot-1'],
        rule_set_snapshot_ids: ['rule-set-snapshot-1'],
      },
      latestJob: null,
      currentVersion: null,
      risks: [],
      snapshots: [{ id: 'snapshot-1', rule_id: 'rule-1', status: 'published' }],
      ruleSetSnapshots: [{
        id: 'rule-set-snapshot-1',
        org_id: 'org-1',
        status: 'published',
        rule_snapshot_ids: ['snapshot-1', 'snapshot-not-bound'],
      }],
      expectedOrgId: 'org-1',
    })

    expect(evidence?.evidence_status).toBe('missing_snapshot')
    expect(evidence?.snapshot_integrity.errors).toContain('rule_set_members_not_exact')
  })

  it('fails closed when a bound RuleSet snapshot row is missing', () => {
    const evidence = buildReviewRunEvidence({
      latestReview: {
        id: 'review-missing-rule-set-row',
        rule_snapshot_ids: ['snapshot-1'],
        rule_set_snapshot_ids: ['rule-set-snapshot-missing'],
      },
      latestJob: null,
      currentVersion: null,
      risks: [],
      snapshots: [{ id: 'snapshot-1', rule_id: 'rule-1', status: 'published' }],
      ruleSetSnapshots: [],
      expectedOrgId: 'org-1',
    })

    expect(evidence?.evidence_status).toBe('missing_snapshot')
    expect(evidence?.snapshot_integrity.errors).toEqual(expect.arrayContaining([
      'rule_set_snapshot_rows_not_exact',
      'rule_set_members_not_exact',
    ]))
  })

  it('fails closed when a RuleSet snapshot is cross-organization or not released history', () => {
    const evidence = buildReviewRunEvidence({
      latestReview: {
        id: 'review-corrupt-set',
        rule_snapshot_ids: ['snapshot-1'],
        rule_set_snapshot_ids: ['rule-set-snapshot-1'],
      },
      latestJob: null,
      currentVersion: null,
      risks: [],
      snapshots: [{ id: 'snapshot-1', rule_id: 'rule-1', status: 'published' }],
      ruleSetSnapshots: [{
        id: 'rule-set-snapshot-1',
        org_id: 'org-other',
        status: 'draft',
        rule_snapshot_ids: ['snapshot-1'],
      }],
      expectedOrgId: 'org-1',
    })

    expect(evidence?.evidence_status).toBe('missing_snapshot')
    expect(evidence?.snapshot_integrity.errors).toEqual(expect.arrayContaining([
      'rule_set_snapshot_status_invalid:rule-set-snapshot-1',
      'rule_set_snapshot_org_invalid:rule-set-snapshot-1',
    ]))
  })

  it('fails closed when a bound RuleSnapshot belongs to another organization', () => {
    const evidence = buildReviewRunEvidence({
      latestReview: {
        id: 'review-cross-org-rule',
        rule_snapshot_ids: ['snapshot-1'],
        rule_set_snapshot_ids: ['rule-set-snapshot-1'],
      },
      latestJob: null,
      currentVersion: null,
      risks: [],
      snapshots: [{
        id: 'snapshot-1',
        rule_id: 'rule-1',
        status: 'published',
        config_snapshot: { org_id: 'org-other' },
      }],
      ruleSetSnapshots: [{
        id: 'rule-set-snapshot-1',
        org_id: 'org-1',
        status: 'published',
        rule_snapshot_ids: ['snapshot-1'],
      }],
      expectedOrgId: 'org-1',
    })

    expect(evidence?.evidence_status).toBe('missing_snapshot')
    expect(evidence?.snapshot_integrity.errors).toContain('rule_snapshot_org_invalid:snapshot-1')
  })

  it('does not allow the review route to graft current rules onto an old run', () => {
    expect(reviewRouteSource).not.toContain(".from('contract_rules_v2')")
    expect(reviewRouteSource).not.toMatch(/\.in\(['"]rule_id['"]/)
    expect(reviewRouteSource).toContain(".from('contract_rule_snapshots')")
    expect(reviewRouteSource).toContain(".from('contract_rule_set_snapshots')")
    expect(reviewRouteSource).toMatch(
      /nonEmptyStrings\(latestReview\?\.rule_snapshot_ids\)[\s\S]*nonEmptyStrings\(skillBundle\?\.rule_snapshot_ids\)/
    )
  })

  it('summarizes intended, requested, and actual model providers for ReviewRun evidence', () => {
    const evidence = buildReviewRunEvidence({
      latestReview: {
        id: 'review-provider-routing',
        status: 'COMPLETED',
        model_invocation_ids: ['invocation-semantic'],
      },
      latestJob: { provider: 'rule-engine+AI_LEVEL_2', degraded: false, status: 'completed' },
      currentVersion: { id: 'version-1' },
      risks: [],
      snapshots: [],
      modelInvocations: [{
        id: 'invocation-semantic',
        provider: 'AI_LEVEL_2',
        model: 'gpt-5.5',
        phase: 'semantic_review',
        status: 'completed',
        degraded: false,
        request_meta: {
          intended_provider_profile: 'local_primary',
          intended_provider_model: 'gpt-oss-20b',
          requested_provider_profile: 'local_primary',
          requested_provider_model: 'gpt-oss-20b',
          requested_provider_accepted: false,
        },
        response_meta: {
          provider_kind: 'openai_compatible',
          transport: 'openai_compatible_http',
          actual_provider_profile: 'AI_LEVEL_2',
          actual_provider_model: 'gpt-5.5',
          dropped_risk_count: 0,
          validation_warnings: [],
        },
      }],
    })

    expect(evidence?.model_policy).toMatchObject({
      provider: 'AI_LEVEL_2',
      model: 'gpt-5.5',
      actual_provider_profile: 'AI_LEVEL_2',
      actual_provider_model: 'gpt-5.5',
      intended_provider_profile: 'local_primary',
      intended_provider_model: 'gpt-oss-20b',
      requested_provider_profile: 'local_primary',
      requested_provider_model: 'gpt-oss-20b',
      requested_provider_accepted: false,
    })
    expect(evidence?.model_invocations[0]).toMatchObject({
      actual_provider_profile: 'AI_LEVEL_2',
      actual_provider_model: 'gpt-5.5',
      intended_provider_profile: 'local_primary',
      intended_provider_model: 'gpt-oss-20b',
      requested_provider_profile: 'local_primary',
      requested_provider_model: 'gpt-oss-20b',
      requested_provider_accepted: false,
    })
  })

  it('prefers real SkillBundle, ModelPolicy, and ModelInvocation bindings when present', () => {
    const evidence = buildReviewRunEvidence({
      latestReview: {
        id: 'review-real',
        status: 'COMPLETED',
        skill_bundle_id: 'skill-1',
        model_policy_id: 'policy-1',
        rule_snapshot_ids: ['snapshot-1'],
        rule_set_snapshot_ids: ['rule-set-snapshot-1'],
        model_invocation_ids: ['invocation-1'],
      },
      latestJob: { provider: 'rule-engine', degraded: false, status: 'completed' },
      currentVersion: { id: 'version-1' },
      risks: [{ rule_id: 'rule-1', rule_code: 'R001', rule_version: 2 }],
      snapshots: [{
        id: 'snapshot-1',
        rule_id: 'rule-1',
        version: 2,
        status: 'published',
        released_at: '2026-07-01T01:00:00.000Z',
      }],
      skillBundle: {
        id: 'skill-1',
        version: 3,
        rule_snapshot_ids: ['snapshot-1'],
        rule_set_snapshot_ids: ['rule-set-snapshot-1'],
        model_policy_id: 'policy-1',
        status: 'published',
        compiled_hash: 'hash-1',
          output_schema: { schema_version: 'f006.review.v1' },
          compiled_from: {
            production_rule_source: {
              owner: 'F009',
              source_of_truth: 'config_center_published_rules',
              rules_table: 'contract_rules_v2',
              snapshot_table: 'contract_rule_snapshots',
              precedence: 'production_source_of_truth',
            },
            reference_assets: [
              {
                kind: 'github_skill_reference',
                repo: 'suoyidev/ones-internal-skills',
                commit: 'f8b0c27f5c19a499c1563923ca372a2171aaca58',
                path: 'references/09-二次验证清单.md',
                usage: 'reference_import_template_and_eval_cases_only',
              },
              {
                kind: 'github_skill_reference',
                repo: 'suoyidev/ones-internal-skills',
                commit: 'f8b0c27f5c19a499c1563923ca372a2171aaca58',
                path: 'references/13-结构化输出schema.md',
                usage: 'reference_import_template_and_eval_cases_only',
              },
            ],
            canonical_rule_completeness: {
              expected: 15,
            actual: 15,
            missing: [],
          },
          output_schema_version: 'f006.review.v1',
          second_verification: {
            enforcement: 'model_output_runtime_validation',
          },
            comment_template: {
              author: 'ONES 业务运营',
            },
            rule_translation_gate: {
              status: 'ready',
              total: 15,
              ready: 15,
              needs_ai_translation: 0,
              incomplete_source: 0,
              official_review_allowed: true,
              blocking_reasons: [],
            },
            eval_results: {
              gate: 'bundle_static_completeness',
              status: 'runtime_eval_not_run',
            total_cases: 14,
            passed_cases: 0,
            failed_cases: [],
          },
        },
      },
      ruleSetSnapshots: [{
        id: 'rule-set-snapshot-1',
        org_id: 'org-1',
        status: 'published',
        rule_snapshot_ids: ['snapshot-1'],
      }],
      expectedOrgId: 'org-1',
      modelPolicy: {
        id: 'policy-1',
        version: 4,
        status: 'published',
        provider_chain: [{
          provider: 'rule-engine',
          provider_kind: 'builtin',
          model: 'rule-engine',
          profile: 'rule_engine',
        }],
      },
      modelInvocations: [{
        id: 'invocation-1',
        provider: 'rule-engine',
        model: 'rule-engine',
        phase: 'semantic_review',
        status: 'completed',
        degraded: false,
        fallback_reason: 'rule_engine_selected_by_model_policy',
        latency_ms: 120,
        request_meta: {
          intended_provider_profile: 'rule_engine',
          intended_provider_model: 'rule-engine',
        },
        response_meta: {
          provider_kind: 'builtin',
          transport: 'builtin_rule_engine',
          attempt_errors: [],
        },
      }],
    })

    expect(evidence).toMatchObject({
      skill_bundle_id: 'skill-1',
      model_policy_id: 'policy-1',
      model_invocation_ids: ['invocation-1'],
      rule_snapshot_id: 'contract_rule_snapshots:snapshot-1',
      evidence_status: 'snapshot_bound',
      skill_bundle: {
          id: 'skill-1',
          version: 3,
          compiled_hash: 'hash-1',
          production_source: {
            owner: 'F009',
            source_of_truth: 'config_center_published_rules',
            rules_table: 'contract_rules_v2',
            snapshot_table: 'contract_rule_snapshots',
            precedence: 'production_source_of_truth',
          },
          rules: {
            expected: 15,
          actual: 15,
          missing: [],
        },
        references: ['references/09-二次验证清单.md', 'references/13-结构化输出schema.md'],
          output_schema_version: 'f006.review.v1',
          second_verification_required: true,
          comment_author: 'ONES 业务运营',
          rule_translation_status: 'ready',
          rule_translation_ready: true,
          official_review_allowed: false,
          rule_acceptance_status: 'runtime_eval_not_run',
          model_quality_eval_status: null,
          runtime_invocation_status: 'latest_review_model_invocation_not_passed',
          eval_gate: 'bundle_static_completeness',
        eval_total_cases: 14,
        eval_passed_cases: 0,
      },
      model_policy: {
        id: 'policy-1',
        provider: 'rule-engine',
        source: 'model_policies',
        model: 'rule-engine',
        phase: 'semantic_review',
        provider_kind: 'builtin',
        transport: 'builtin_rule_engine',
        latency_ms: 120,
        intended_provider_profile: 'rule_engine',
        intended_provider_model: 'rule-engine',
        attempt_error_count: 0,
        invocation_id: 'invocation-1',
        fallback_reason: 'rule_engine_selected_by_model_policy',
      },
      model_invocations: [{
        id: 'invocation-1',
        phase: 'semantic_review',
        provider: 'rule-engine',
        model: 'rule-engine',
        status: 'completed',
        degraded: false,
        transport: 'builtin_rule_engine',
        provider_kind: 'builtin',
        latency_ms: 120,
        fallback_reason: 'rule_engine_selected_by_model_policy',
        error_message: null,
        created_at: null,
      }],
    })
  })

  it('keeps rule acceptance, independent-gold model quality and ReviewRun invocation separate', () => {
    const evidence = buildReviewRunEvidence({
      latestReview: {
        id: 'review-separated-gates',
        status: 'COMPLETED',
        skill_bundle_id: 'skill-separated-gates',
      },
      latestJob: null,
      currentVersion: { id: 'version-1' },
      risks: [],
      snapshots: [],
      skillBundle: {
        id: 'skill-separated-gates',
        status: 'published',
        release_meta: { official_review_allowed: true },
        compiled_from: {
          rule_translation_gate: { status: 'ready' },
          rule_set_snapshot_gate: { status: 'ready' },
          rule_set_document_gate: { status: 'ready' },
          eval_results: {
            rule_acceptance_status: 'passed',
            model_quality_eval_status: 'blocked_without_independent_gold',
            static_eval_status: 'reference_only_not_release_evidence',
            runtime_eval_status: 'model_quality_eval_not_run',
          },
        },
      },
      modelInvocations: [],
    })

    expect(evidence?.skill_bundle).toMatchObject({
      official_review_allowed: true,
      rule_acceptance_status: 'passed',
      model_quality_eval_status: 'blocked_without_independent_gold',
      runtime_invocation_status: 'semantic_invocation_not_recorded',
    })
    expect(evidence?.skill_bundle).not.toHaveProperty('eval_status')
    expect(evidence?.skill_bundle).not.toHaveProperty('runtime_eval_status')
    expect(evidence?.skill_bundle).not.toHaveProperty('static_eval_status')
  })

  it('keeps all bound ReviewRun snapshots even when current risks reference only one rule', () => {
    const evidence = buildReviewRunEvidence({
      latestReview: {
        id: 'review-bound',
        status: 'DEGRADED',
        skill_bundle_id: 'skill-1',
        rule_snapshot_ids: ['snapshot-1', 'snapshot-2', 'snapshot-3'],
        rule_set_snapshot_ids: ['rule-set-snapshot-1'],
      },
      latestJob: { provider: 'rule-engine', degraded: true, status: 'completed' },
      currentVersion: { id: 'version-1' },
      risks: [{ rule_id: 'rule-1', rule_code: 'R001', rule_version: 2 }],
      snapshots: [{
        id: 'snapshot-1',
        rule_id: 'rule-1',
        version: 2,
        status: 'published',
        config_snapshot: { code: 'R001', engine_type: 'structured', version: 2 },
      }, {
        id: 'snapshot-2',
        rule_id: 'rule-2',
        version: 2,
        status: 'published',
        config_snapshot: { code: 'R002', engine_type: 'structured', version: 2 },
      }, {
        id: 'snapshot-3',
        rule_id: 'rule-3',
        version: 2,
        status: 'published',
        config_snapshot: { code: 'R003', engine_type: 'semantic', version: 2 },
      }],
      skillBundle: {
        id: 'skill-1',
        version: 3,
        rule_snapshot_ids: ['snapshot-1', 'snapshot-2', 'snapshot-3'],
        rule_set_snapshot_ids: ['rule-set-snapshot-1'],
        status: 'published',
        compiled_from: {
          canonical_rule_completeness: {
            expected: 3,
            actual: 3,
            missing: [],
          },
        },
      },
      ruleSetSnapshots: [{
        id: 'rule-set-snapshot-1',
        org_id: 'org-1',
        status: 'published',
        rule_snapshot_ids: ['snapshot-1', 'snapshot-2', 'snapshot-3'],
      }],
      expectedOrgId: 'org-1',
    })

    expect(evidence?.rule_snapshot_id).toBe('contract_rule_snapshots:bound:3')
    expect(evidence?.evidence_status).toBe('snapshot_bound')
    expect(evidence?.rule_snapshot_refs.map((ref) => ref.rule_code)).toEqual(['R001', 'R002', 'R003'])
    expect(evidence?.skill_bundle?.rules).toMatchObject({
      expected: 3,
      actual: 3,
      missing: [],
    })
  })

  it('surfaces semantic review degradation when structured rules also completed', () => {
    const evidence = buildReviewRunEvidence({
      latestReview: {
        id: 'review-real',
        status: 'COMPLETED',
        skill_bundle_id: 'skill-1',
        model_policy_id: 'policy-1',
        rule_snapshot_ids: ['snapshot-1'],
        model_invocation_ids: ['invocation-structured', 'invocation-semantic'],
      },
      latestJob: { provider: 'rule-engine', degraded: true, status: 'completed' },
      currentVersion: { id: 'version-1' },
      risks: [{ rule_id: 'rule-1', rule_code: 'R001', rule_version: 2 }],
      snapshots: [{
        id: 'snapshot-1',
        rule_id: 'rule-1',
        version: 2,
        status: 'published',
        released_at: '2026-07-01T01:00:00.000Z',
      }],
      skillBundle: {
        id: 'skill-1',
        version: 3,
        rule_snapshot_ids: ['snapshot-1'],
        model_policy_id: 'policy-1',
        status: 'published',
      },
      modelPolicy: {
        id: 'policy-1',
        version: 4,
        status: 'published',
        provider_chain: [{
          provider: 'openai-compatible',
          provider_kind: 'openai_compatible',
          model: 'gpt-review',
          profile: 'sales_cloud',
        }],
      },
      modelInvocations: [{
        id: 'invocation-structured',
        provider: 'rule-engine',
        model: 'rule-engine',
        phase: 'structured_rules',
        status: 'completed',
        degraded: false,
        fallback_reason: 'rule_engine_selected_by_model_policy',
      }, {
        id: 'invocation-semantic',
        provider: 'AI_LEVEL_3',
        model: 'rule-engine',
        phase: 'semantic_review',
        status: 'degraded',
        degraded: true,
        fallback_reason: 'semantic_review_degraded_to_rule_engine',
        latency_ms: 450,
        response_meta: {
          provider_kind: 'builtin',
          transport: 'builtin_rule_engine',
        },
      }],
    })

    expect(evidence?.model_policy).toMatchObject({
      provider: 'AI_LEVEL_3',
      model: 'rule-engine',
      degraded: true,
      status: 'degraded',
      transport: 'builtin_rule_engine',
      latency_ms: 450,
      invocation_id: 'invocation-semantic',
      fallback_reason: 'semantic_review_degraded_to_rule_engine',
    })
    expect(evidence?.skill_bundle?.runtime_invocation_status).toBe('latest_review_model_invocation_not_passed')
  })

  it('does not mark a builtin semantic invocation as a passing provider invocation', () => {
    const evidence = buildReviewRunEvidence({
      latestReview: {
        id: 'review-builtin-semantic',
        status: 'COMPLETED',
        skill_bundle_id: 'skill-1',
        model_invocation_ids: ['invocation-semantic'],
      },
      latestJob: { provider: 'rule-engine', degraded: false, status: 'completed' },
      currentVersion: { id: 'version-1' },
      risks: [],
      snapshots: [],
      skillBundle: {
        id: 'skill-1',
        version: 10,
        rule_snapshot_ids: [],
        status: 'published',
        compiled_from: {
          rule_translation_gate: { status: 'ready', official_review_allowed: true, blocking_reasons: [] },
          eval_results: {
            status: 'passed',
            runtime_eval_status: 'model_quality_eval_not_run',
            note: 'Static publication eval only.',
          },
        },
        release_meta: { official_review_allowed: true },
      },
      modelInvocations: [{
        id: 'invocation-semantic',
        provider: 'rule-engine',
        model: 'rule-engine',
        phase: 'semantic_review',
        status: 'completed',
        degraded: false,
        response_meta: {
          provider_kind: 'builtin',
          transport: 'builtin_rule_engine',
          usable_risk_count: 1,
          dropped_risk_count: 0,
          validation_warnings: [],
        },
      }],
    })

    expect(evidence?.skill_bundle?.runtime_invocation_status).toBe('latest_review_model_invocation_not_passed')
    expect(evidence?.skill_bundle?.eval_note).toContain('did not use a passing AI provider path')
  })

  it('keeps LM Studio CLI semantic invocation separate from HTTP model readiness', () => {
    const evidence = buildReviewRunEvidence({
      latestReview: {
        id: 'review-model-pass',
        status: 'COMPLETED',
        skill_bundle_id: 'skill-1',
        model_policy_id: 'policy-1',
        rule_snapshot_ids: ['snapshot-1'],
        model_invocation_ids: ['invocation-structured', 'invocation-semantic'],
      },
      latestJob: { provider: 'rule-engine+AI_LEVEL_1', degraded: false, status: 'completed' },
      currentVersion: { id: 'version-1' },
      risks: [{ rule_id: 'rule-1', rule_code: 'R001', rule_version: 3 }],
      snapshots: [{
        id: 'snapshot-1',
        rule_id: 'rule-1',
        version: 3,
        status: 'published',
        released_at: '2026-07-02T01:00:00.000Z',
      }],
      skillBundle: {
        id: 'skill-1',
        version: 10,
        rule_snapshot_ids: ['snapshot-1'],
        model_policy_id: 'policy-1',
        status: 'published',
        compiled_from: {
          rule_translation_gate: { status: 'ready', official_review_allowed: true, blocking_reasons: [] },
          eval_results: {
            status: 'passed',
            runtime_eval_status: 'model_quality_eval_not_run',
            note: 'Static publication eval only.',
          },
        },
        release_meta: { official_review_allowed: true },
      },
      modelPolicy: {
        id: 'policy-1',
        version: 8,
        status: 'published',
        provider_chain: [{
          provider: 'openai-compatible',
          provider_kind: 'openai_compatible',
          model: 'gpt-oss-20b',
          profile: 'AI_LEVEL_1',
        }],
      },
      modelInvocations: [{
        id: 'invocation-structured',
        provider: 'rule-engine',
        model: 'rule-engine',
        phase: 'structured_rules',
        status: 'completed',
        degraded: false,
        response_meta: {
          provider_kind: 'builtin',
          transport: 'builtin_rule_engine',
        },
      }, {
        id: 'invocation-semantic',
        provider: 'AI_LEVEL_1',
        model: 'gpt-oss-20b',
        phase: 'semantic_review',
        status: 'completed',
        degraded: false,
        latency_ms: 28000,
        response_meta: {
          provider_kind: 'openai_compatible',
          transport: 'lm_studio_cli',
          validation_item_kind: 'risk',
          usable_risk_count: 3,
          dropped_risk_count: 0,
          validation_warnings: [],
        },
      }],
    })

    expect(evidence?.skill_bundle?.runtime_invocation_status).toBe('latest_review_model_invocation_local_cli')
    expect(evidence?.skill_bundle?.eval_note).toContain('local LM Studio CLI with 3 usable risk')
    expect(evidence?.model_policy).toMatchObject({
      provider: 'AI_LEVEL_1',
      model: 'gpt-oss-20b',
      status: 'completed',
      degraded: false,
      transport: 'lm_studio_cli',
      latency_ms: 28000,
      invocation_id: 'invocation-semantic',
    })
  })

  it('marks runtime invocation passed only from a clean OpenAI-compatible HTTP semantic invocation', () => {
    const evidence = buildReviewRunEvidence({
      latestReview: {
        id: 'review-model-pass-http',
        status: 'COMPLETED',
        skill_bundle_id: 'skill-1',
        model_policy_id: 'policy-1',
        rule_snapshot_ids: ['snapshot-1'],
        model_invocation_ids: ['invocation-structured', 'invocation-semantic'],
      },
      latestJob: { provider: 'rule-engine+AI_LEVEL_1', degraded: false, status: 'completed' },
      currentVersion: { id: 'version-1' },
      risks: [{ rule_id: 'rule-1', rule_code: 'R001', rule_version: 3 }],
      snapshots: [{
        id: 'snapshot-1',
        rule_id: 'rule-1',
        version: 3,
        status: 'published',
      }],
      skillBundle: {
        id: 'skill-1',
        version: 10,
        rule_snapshot_ids: ['snapshot-1'],
        model_policy_id: 'policy-1',
        status: 'published',
        compiled_from: {
          rule_translation_gate: { status: 'ready', official_review_allowed: true, blocking_reasons: [] },
          eval_results: {
            status: 'passed',
            runtime_eval_status: 'model_quality_eval_not_run',
            note: 'Static publication eval only.',
          },
        },
        release_meta: { official_review_allowed: true },
      },
      modelInvocations: [{
        id: 'invocation-structured',
        provider: 'rule-engine',
        model: 'rule-engine',
        phase: 'structured_rules',
        status: 'completed',
        degraded: false,
        response_meta: {
          provider_kind: 'builtin',
          transport: 'builtin_rule_engine',
        },
      }, {
        id: 'invocation-semantic',
        provider: 'AI_LEVEL_1',
        model: 'gpt-oss-20b',
        phase: 'semantic_review',
        status: 'completed',
        degraded: false,
        latency_ms: 28000,
        response_meta: {
          provider_kind: 'openai_compatible',
          transport: 'openai_compatible_http',
          validation_item_kind: 'risk',
          usable_risk_count: 3,
          dropped_risk_count: 0,
          validation_warnings: [],
        },
      }],
    })

    expect(evidence?.skill_bundle?.runtime_invocation_status).toBe('latest_review_model_invocation_passed')
    expect(evidence?.skill_bundle?.eval_note).toContain('3 usable risk')
  })

  it('makes the immutable six-object plan primary and exposes every ordered model attempt', () => {
    const planSnapshot = {
      id: 'plan-snapshot-1',
      org_id: 'org-1',
      business_use_point_id: 'contract.review.semantic',
      application_id: 'app.contract.review',
      route_policy_id: 'route.contract.review',
      snapshot_sha256: 'a'.repeat(64),
      created_at: '2026-07-21T01:00:00.000Z',
      snapshot: {
        schemaVersion: 'ai-runtime-plan.v1',
        orgId: 'org-1',
        executionEnvironment: 'hosted',
        usePoint: {
          configId: 'config-use-point', configKey: 'USE_POINT', assetId: 'contract.review.semantic',
          moduleId: 'contract_review', requiredCapabilities: ['text_generation'],
        },
        binding: {
          configId: 'config-binding', configKey: 'BINDING', assetId: 'binding.contract.review',
          usePointId: 'contract.review.semantic', applicationId: 'app.contract.review',
        },
        application: {
          configId: 'config-app', configKey: 'APP', assetId: 'app.contract.review',
          capabilities: ['text_generation'],
        },
        route: {
          configId: 'config-route', configKey: 'ROUTE', assetId: 'route.contract.review',
          strategy: 'ordered_fallback', timeoutMs: 45000, failureAction: 'manual_review',
          orderedModelAssetIds: ['model.local', 'model.cloud'],
        },
        candidates: [{
          position: 0,
          model: {
            configId: 'config-model-local', configKey: 'MODEL_LOCAL', assetId: 'model.local',
            modelId: 'google/gemma-4-e4b', capabilities: ['text_generation'], contextWindow: 8192,
          },
          provider: {
            configId: 'config-provider-local', configKey: 'PROVIDER_LOCAL', assetId: 'provider.local',
            providerType: 'openai_compatible', runtimeLocation: 'local', authMode: 'bearer',
            credentialState: 'stored', connectionTimeoutMs: 1000,
          },
        }, {
          position: 1,
          model: {
            configId: 'config-model-cloud', configKey: 'MODEL_CLOUD', assetId: 'model.cloud',
            modelId: 'gpt-5.5', capabilities: ['text_generation'], contextWindow: 128000,
          },
          provider: {
            configId: 'config-provider-cloud', configKey: 'PROVIDER_CLOUD', assetId: 'provider.cloud',
            providerType: 'openai_compatible', runtimeLocation: 'cloud', authMode: 'bearer',
            credentialState: 'stored', connectionTimeoutMs: 1000,
          },
        }],
      },
    }
    const sharedInvocation = {
      plan_snapshot_id: 'plan-snapshot-1',
      business_use_point_id: 'contract.review.semantic',
      application_id: 'app.contract.review',
      route_policy_id: 'route.contract.review',
      phase: 'contract.review.semantic',
    }
    const evidence = buildReviewRunEvidence({
      latestReview: {
        id: 'review-plan-bound',
        status: 'COMPLETED',
        plan_snapshot_id: 'plan-snapshot-1',
        model_policy_id: 'legacy-policy-must-not-win',
        model_invocation_ids: ['stale-legacy-invocation'],
      },
      latestJob: { provider: 'legacy-job-provider', status: 'completed' },
      currentVersion: { id: 'version-1' },
      risks: [],
      snapshots: [],
      expectedOrgId: 'org-1',
      runtimePlanSnapshot: planSnapshot,
      modelPolicy: {
        id: 'legacy-policy-must-not-win',
        provider_chain: [{ provider: 'legacy-provider', model: 'legacy-model' }],
      },
      modelInvocations: [{
        id: 'invocation-1',
        ...sharedInvocation,
        model_catalog_entry_id: 'model.local',
        provider_connection_id: 'provider.local',
        attempt_no: 1,
        provider: 'provider.local',
        model: 'google/gemma-4-e4b',
        status: 'failed',
        degraded: true,
        fallback_reason: 'PROVIDER_UNAVAILABLE',
        error_message: '模型连接或传输失败。',
        latency_ms: 120,
        input_tokens: null,
        output_tokens: null,
        total_tokens: null,
        response_meta: { output_validation: 'failed' },
      }, {
        id: 'invocation-2',
        ...sharedInvocation,
        model_catalog_entry_id: 'model.cloud',
        provider_connection_id: 'provider.cloud',
        attempt_no: 2,
        provider: 'provider.cloud',
        model: 'gpt-5.5',
        status: 'completed',
        degraded: true,
        fallback_reason: 'PROVIDER_UNAVAILABLE',
        latency_ms: 450,
        input_tokens: 100,
        output_tokens: 20,
        total_tokens: 120,
        response_meta: { output_validation: 'passed', token_evidence: 'provider' },
      }],
    })

    expect(evidence).toMatchObject({
      plan_snapshot_id: 'plan-snapshot-1',
      runtime_source: 'runtime_plan',
      model_policy_id: 'runtime-plan:plan-snapshot-1',
      model_invocation_ids: ['invocation-1', 'invocation-2'],
      runtime_plan: {
        id: 'plan-snapshot-1',
        snapshot_sha256: 'a'.repeat(64),
        business_use_point: { asset_id: 'contract.review.semantic' },
        application_binding: { asset_id: 'binding.contract.review' },
        ai_application: { asset_id: 'app.contract.review' },
        route_policy: {
          asset_id: 'route.contract.review',
          ordered_model_catalog_entry_ids: ['model.local', 'model.cloud'],
        },
        integrity: { valid: true, errors: [] },
      },
      model_policy: {
        id: 'runtime-plan:plan-snapshot-1',
        source: 'runtime_plan',
        provider: 'provider.cloud',
        model: 'gpt-5.5',
        intended_provider_profile: 'provider.local',
        intended_provider_model: 'google/gemma-4-e4b',
        attempt_error_count: 1,
        degraded: true,
        invocation_id: 'invocation-2',
      },
      model_invocations: [{
        id: 'invocation-1', attempt_no: 1, provider_connection_id: 'provider.local',
        input_tokens: null, output_tokens: null, total_tokens: null,
      }, {
        id: 'invocation-2', attempt_no: 2, provider_connection_id: 'provider.cloud',
        input_tokens: 100, output_tokens: 20, total_tokens: 120,
      }],
    })
    expect(evidence?.runtime_plan?.model_catalog_entries.map((item) => item.asset_id)).toEqual([
      'model.local', 'model.cloud',
    ])
    expect(evidence?.runtime_plan?.provider_connections.map((item) => item.asset_id)).toEqual([
      'provider.local', 'provider.cloud',
    ])
  })

  it('passes a plan-bound invocation only for clean OpenAI-compatible HTTP provider evidence', () => {
    const buildPlanBoundEvidence = (responseMeta: Record<string, unknown>) => buildReviewRunEvidence({
      latestReview: {
        id: 'review-plan-quality-gate', status: 'COMPLETED', skill_bundle_id: 'skill-1',
        plan_snapshot_id: 'plan-snapshot-1', model_invocation_ids: ['invocation-semantic'],
      },
      latestJob: { provider: 'provider.cloud', status: 'completed', degraded: false },
      currentVersion: { id: 'version-1' },
      risks: [],
      snapshots: [],
      skillBundle: {
        id: 'skill-1', version: 1, rule_snapshot_ids: [], model_policy_id: null,
        status: 'published',
        compiled_from: {
          rule_translation_gate: { status: 'ready', official_review_allowed: true },
          rule_set_snapshot_gate: { status: 'ready' },
          rule_set_document_gate: { status: 'ready' },
          eval_results: { rule_acceptance_status: 'passed' },
        },
        release_meta: { official_review_allowed: true },
      },
      modelInvocations: [{
        id: 'invocation-semantic', plan_snapshot_id: 'plan-snapshot-1',
        phase: 'semantic_review', provider: 'provider.cloud', model: 'gpt-5.5',
        status: 'completed', degraded: false, input_tokens: 100, output_tokens: 20,
        total_tokens: 120, response_meta: responseMeta,
      }],
    })

    const cleanResponseMeta = {
      provider_kind: 'openai_compatible', transport: 'openai_compatible_http',
      output_validation: 'passed', token_evidence: 'provider',
      validation_item_kind: 'risk',
      validation_warnings: [], dropped_risk_count: 0, usable_risk_count: 2,
    }
    expect(buildPlanBoundEvidence(cleanResponseMeta)?.skill_bundle?.runtime_invocation_status)
      .toBe('latest_review_model_invocation_passed')
    expect(buildPlanBoundEvidence({
      ...cleanResponseMeta, validation_warnings: ['one result was normalized'], dropped_risk_count: 1,
    })?.skill_bundle?.runtime_invocation_status).toBe('latest_review_model_invocation_partial')
    expect(buildPlanBoundEvidence({
      ...cleanResponseMeta, transport: 'lm_studio_cli',
    })?.skill_bundle?.runtime_invocation_status).toBe('latest_review_model_invocation_partial')
    const { validation_warnings: _warnings, ...missingAudit } = cleanResponseMeta
    expect(buildPlanBoundEvidence(missingAudit)?.skill_bundle?.runtime_invocation_status)
      .toBe('latest_review_model_invocation_partial')
  })

  it('fails closed when a plan-bound ReviewRun cannot load its snapshot instead of using legacy ModelPolicy', () => {
    const evidence = buildReviewRunEvidence({
      latestReview: {
        id: 'review-plan-missing',
        status: 'COMPLETED',
        plan_snapshot_id: 'plan-missing',
        model_policy_id: 'legacy-policy',
      },
      latestJob: { provider: 'legacy-job-provider', status: 'completed' },
      currentVersion: null,
      risks: [],
      snapshots: [],
      expectedOrgId: 'org-1',
      runtimePlanSnapshot: null,
      modelPolicy: {
        id: 'legacy-policy',
        provider_chain: [{ provider: 'legacy-provider', model: 'legacy-model' }],
      },
      modelInvocations: [],
    })

    expect(evidence).toMatchObject({
      plan_snapshot_id: 'plan-missing',
      runtime_source: 'runtime_plan',
      model_policy_id: 'runtime-plan:plan-missing:invalid',
      runtime_plan: {
        id: 'plan-missing',
        integrity: {
          valid: false,
          errors: ['runtime_plan_snapshot_missing', 'runtime_plan_invocations_missing'],
        },
      },
      model_policy: {
        source: 'runtime_plan',
        provider: 'runtime-plan',
        model: null,
      },
    })
  })

  it('loads plan-bound attempts by ReviewRun and plan while keeping ModelPolicy legacy-only', () => {
    expect(reviewRouteSource).toContain(".from('ai_runtime_plan_snapshots')")
    expect(reviewRouteSource).toContain(".eq('id', latestReview.plan_snapshot_id)")
    expect(reviewRouteSource).toContain('const modelPolicyId = latestReview?.plan_snapshot_id')
    expect(reviewRouteSource).toContain(".eq('review_id', latestReview.id)")
    expect(reviewRouteSource).toContain(".eq('plan_snapshot_id', latestReview.plan_snapshot_id)")
    expect(reviewRouteSource).toContain(".order('attempt_no', { ascending: true })")
    expect(reviewRouteSource).toContain('input_tokens, output_tokens, total_tokens')
  })
})

import { describe, expect, it } from 'vitest'
import { buildReviewRunEvidence } from './review-evidence'

describe('buildReviewRunEvidence', () => {
  it('binds ReviewRun to published rule snapshots and analysis job provider', () => {
    const evidence = buildReviewRunEvidence({
      latestReview: {
        id: 'review-1',
        status: 'COMPLETED',
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
      rules: [{
        id: 'rule-1',
        code: 'R001',
        version: 2,
        engine_type: 'structured',
      }],
      snapshots: [{
        id: 'snapshot-1',
        rule_id: 'rule-1',
        version: 2,
        status: 'published',
        released_at: '2026-06-30T00:59:00.000Z',
        config_snapshot: { code: 'R001', engine_type: 'structured', version: 2 },
      }],
    })

    expect(evidence).toMatchObject({
      id: 'review-1',
      contract_version_id: 'version-1',
      skill_bundle_id: 'contract-skill:ruleset:R001@2',
      rule_snapshot_id: 'contract_rule_snapshots:snapshot-1:v2',
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
      latestReview: { id: 'review-1', status: 'COMPLETED' },
      latestJob: null,
      currentVersion: null,
      risks: [
        { rule_id: 'rule-1', rule_code: 'R001' },
        { rule_id: 'rule-missing', rule_code: 'R999' },
      ],
      rules: [{ id: 'rule-1', code: 'R001', version: 1 }],
      snapshots: [{ id: 'snapshot-1', rule_id: 'rule-1', version: 1, status: 'published' }],
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
      rules: [{ id: 'rule-1', code: 'R001', version: 1 }],
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
      rules: [{ id: 'rule-1', code: 'R001', version: 3, engine_type: 'hybrid' }],
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

  it('prefers real SkillBundle, ModelPolicy, and ModelInvocation bindings when present', () => {
    const evidence = buildReviewRunEvidence({
      latestReview: {
        id: 'review-real',
        status: 'COMPLETED',
        skill_bundle_id: 'skill-1',
        model_policy_id: 'policy-1',
        rule_snapshot_ids: ['snapshot-1'],
        model_invocation_ids: ['invocation-1'],
      },
      latestJob: { provider: 'rule-engine', degraded: false, status: 'completed' },
      currentVersion: { id: 'version-1' },
      risks: [{ rule_id: 'rule-1', rule_code: 'R001', rule_version: 2 }],
      rules: [{ id: 'rule-1', code: 'R001', version: 2, engine_type: 'structured' }],
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
          eval_status: 'runtime_eval_not_run',
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

  it('keeps all bound ReviewRun snapshots even when current risks reference only one rule', () => {
    const evidence = buildReviewRunEvidence({
      latestReview: {
        id: 'review-bound',
        status: 'DEGRADED',
        skill_bundle_id: 'skill-1',
        rule_snapshot_ids: ['snapshot-1', 'snapshot-2', 'snapshot-3'],
      },
      latestJob: { provider: 'rule-engine', degraded: true, status: 'completed' },
      currentVersion: { id: 'version-1' },
      risks: [{ rule_id: 'rule-1', rule_code: 'R001', rule_version: 2 }],
      rules: [{ id: 'rule-1', code: 'R001', version: 2, engine_type: 'structured' }],
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
        status: 'published',
        compiled_from: {
          canonical_rule_completeness: {
            expected: 3,
            actual: 3,
            missing: [],
          },
        },
      },
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
      rules: [{ id: 'rule-1', code: 'R001', version: 2, engine_type: 'structured' }],
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
    expect(evidence?.skill_bundle?.runtime_eval_status).toBe('latest_review_model_invocation_not_passed')
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
      rules: [{ id: 'rule-1', code: 'R001', version: 3, engine_type: 'hybrid' }],
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
          usable_risk_count: 3,
          dropped_risk_count: 0,
          validation_warnings: [],
        },
      }],
    })

    expect(evidence?.skill_bundle?.runtime_eval_status).toBe('latest_review_model_invocation_local_cli')
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

  it('marks runtime model quality passed only from clean OpenAI-compatible HTTP semantic invocation', () => {
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
      rules: [{ id: 'rule-1', code: 'R001', version: 3, engine_type: 'hybrid' }],
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
          usable_risk_count: 3,
          dropped_risk_count: 0,
          validation_warnings: [],
        },
      }],
    })

    expect(evidence?.skill_bundle?.runtime_eval_status).toBe('latest_review_model_invocation_passed')
    expect(evidence?.skill_bundle?.eval_note).toContain('3 usable risk')
  })
})

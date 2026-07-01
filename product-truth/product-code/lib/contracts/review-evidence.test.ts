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
      snapshots: [{ id: 'snapshot-1', rule_id: 'rule-1', version: 1 }],
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
        status: 'completed',
        degraded: false,
        fallback_reason: 'rule_engine_selected_by_model_policy',
      }],
    })

    expect(evidence).toMatchObject({
      skill_bundle_id: 'skill-1',
      model_policy_id: 'policy-1',
      model_invocation_ids: ['invocation-1'],
      rule_snapshot_id: 'contract_rule_snapshots:snapshot-1',
      evidence_status: 'snapshot_bound',
      model_policy: {
        id: 'policy-1',
        provider: 'rule-engine',
        source: 'model_policies',
        model: 'rule-engine',
        invocation_id: 'invocation-1',
        fallback_reason: 'rule_engine_selected_by_model_policy',
      },
    })
  })
})

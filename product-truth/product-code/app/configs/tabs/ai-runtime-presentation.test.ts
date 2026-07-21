import { describe, expect, it } from 'vitest'
import { isAIRuntimeOverview, type AIRuntimeAttempt } from '../types'
import {
  VERIFICATION_PRESENTATION,
  attemptOutcomeLabel,
  formatRuntimeTime,
} from './ai-runtime-presentation'

function attempt(overrides: Partial<AIRuntimeAttempt> = {}): AIRuntimeAttempt {
  return {
    id: 'invocation-1',
    execution_id: 'execution-1',
    execution_mode: 'route',
    pinned_model_catalog_entry_id: null,
    plan_snapshot_id: 'snapshot-1',
    plan_snapshot_hash: 'a'.repeat(64),
    snapshot_integrity: 'verified',
    matches_current_plan: true,
    business_use_point_id: 'contract.review.semantic',
    application_id: 'app.review',
    route_policy_id: 'route.review',
    model_catalog_entry_id: 'model.primary',
    provider_connection_id: 'provider.cloud',
    provider: 'provider.cloud',
    model: 'model-v1',
    attempt_no: 1,
    outcome: 'passed',
    status: 'completed',
    degraded: false,
    failure_code: null,
    error_message: null,
    latency_ms: 200,
    tokens: { input: 10, output: 5, total: 15, evidence: 'provider' },
    review_run_required: true,
    review_run_id: 'review-1',
    occurred_at: '2026-07-21T00:00:00.000Z',
    freshness: 'fresh',
    age_ms: 1_000,
    ...overrides,
  }
}

describe('AI runtime human presentation', () => {
  it('has distinct labels for every plan and evidence state', () => {
    expect(Object.fromEntries(Object.entries(VERIFICATION_PRESENTATION).map(([key, value]) => [key, value.label]))).toEqual({
      passed: '当前计划真实通过',
      fallback_passed: '降级后真实通过',
      failed: '最近真实调用失败',
      incomplete_evidence: '调用证据不完整',
      not_verified: '当前计划未验证',
      stale: '当前验证已过期',
      evidence_unavailable: '真实证据不可读',
      blocked: '运行计划被阻断',
    })
  })

  it('lets snapshot integrity and freshness override a nominal success label', () => {
    expect(attemptOutcomeLabel(attempt())).toBe('真实通过')
    expect(attemptOutcomeLabel(attempt({ freshness: 'stale' }))).toBe('验证已过期')
    expect(attemptOutcomeLabel(attempt({ snapshot_integrity: 'invalid' }))).toBe('快照证据无效')
    expect(attemptOutcomeLabel(attempt({ execution_mode: 'pinned' }))).toBe('指定模型探测通过')
    expect(attemptOutcomeLabel(attempt({ execution_mode: 'pinned', outcome: 'failed' }))).toBe('指定模型探测失败')
  })

  it('rejects the legacy RuntimePolicy cache shape and handles invalid timestamps', () => {
    expect(isAIRuntimeOverview({ provider_chain: [], status: 'published' })).toBe(false)
    expect(isAIRuntimeOverview({ schema_version: 'ai-runtime-overview.v1' })).toBe(false)
    const validEmptyOverview = {
      schema_version: 'ai-runtime-overview.v1',
      source: 'published_ai_platform_assets',
      generated_at: '2026-07-21T00:00:00.000Z',
      execution_environment: 'local',
      evidence: {
        available: true,
        source: 'immutable_plan_snapshots_and_model_invocations',
        freshness_window_hours: 24,
        unavailable_use_points: [],
        error: null,
      },
      summary: {
        registered_use_points: 0,
        ready_plans: 0,
        blocked_plans: 0,
        verified_current_plans: 0,
      },
      use_points: [],
      truth_contract: {
        legacy_model_policy_consumed: false,
        environment_route_fallback_consumed: false,
        configured_or_published_is_not_verified: true,
      },
    }
    expect(isAIRuntimeOverview(validEmptyOverview)).toBe(true)
    expect(isAIRuntimeOverview({ ...validEmptyOverview, use_points: [{}] })).toBe(false)
    expect(isAIRuntimeOverview({ ...validEmptyOverview, summary: {} })).toBe(false)
    expect(formatRuntimeTime('not-a-date')).toBe('时间未知')
  })
})

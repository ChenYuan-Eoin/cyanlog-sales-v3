import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import type { AIRuntimeAttempt } from '../types'
import {
  RuntimeAttemptOutcomeStatus,
  RuntimeOverviewUnavailable,
  RuntimeReviewRunStatus,
} from './ai-runtime-status'

afterEach(cleanup)

function attempt(overrides: Partial<AIRuntimeAttempt> = {}): AIRuntimeAttempt {
  return {
    id: 'invocation-1',
    execution_id: '11111111-1111-4111-8111-111111111111',
    execution_mode: 'route',
    pinned_model_catalog_entry_id: null,
    plan_snapshot_id: 'snapshot-1',
    plan_snapshot_hash: 'a'.repeat(64),
    snapshot_integrity: 'verified',
    matches_current_plan: true,
    business_use_point_id: 'contract.review.semantic',
    application_id: 'app.contract.review',
    route_policy_id: 'route.contract.review',
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

describe('AI runtime status components', () => {
  it('renders recoverable error and empty states with a working refresh action', async () => {
    const refreshError = vi.fn()
    const { rerender } = render(createElement(RuntimeOverviewUnavailable, {
      error: '证据库暂时不可读',
      onRefresh: refreshError,
    }))

    expect(screen.getByRole('alert').textContent).toContain('证据库暂时不可读')
    fireEvent.click(screen.getByRole('button', { name: '重新读取证据' }))
    expect(refreshError).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByRole('button', { name: '重新读取证据' })).toBeTruthy())

    rerender(createElement(RuntimeOverviewUnavailable, { error: '', onRefresh: vi.fn() }))
    expect(screen.getByRole('status').textContent).toContain('运行计划与真实调用证据尚未加载')
    expect(screen.getByRole('button', { name: '重新读取证据' })).toBeTruthy()
  })

  it('renders stale outcome and refuses to hide a required ReviewRun gap', () => {
    const stale = attempt({
      freshness: 'stale',
      review_run_id: null,
    })
    render(createElement('div', null,
      createElement(RuntimeAttemptOutcomeStatus, { attempt: stale }),
      createElement(RuntimeReviewRunStatus, { attempt: stale }),
    ))

    expect(screen.getByTestId('runtime-attempt-outcome').textContent).toBe('验证已过期')
    expect(screen.getByText('该业务用点必须绑定 ReviewRun；当前记录缺失绑定，不能作为完成证据。')).toBeTruthy()
  })
})

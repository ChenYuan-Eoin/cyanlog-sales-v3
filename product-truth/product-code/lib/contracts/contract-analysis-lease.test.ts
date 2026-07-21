import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { rpc: mocks.rpc, from: mocks.from },
}))
vi.mock('@/lib/configs/runtime', () => ({ getOrgIdForUser: vi.fn() }))
vi.mock('@/lib/rules/engine', () => ({ executeRules: vi.fn() }))
vi.mock('@/lib/ai/contract-semantic', () => ({ executeContractSemanticReview: vi.fn() }))
vi.mock('@/lib/ai/runtime-executor', () => ({
  AIExecutionError: class AIExecutionError extends Error {},
}))
vi.mock('@/lib/error-log', () => ({ logError: vi.fn() }))
vi.mock('@/lib/contracts/comment-patch', () => ({ buildCommentPatchesFromRiskCards: vi.fn() }))
vi.mock('@/lib/contracts/skill-bundle', () => ({
  getOrCompilePublishedContractSkillBundle: vi.fn(),
}))

import {
  ContractAnalysisLeaseError,
  claimContractAnalysisJobById,
  enqueueContractAnalysisJob,
  markContractAnalysisCompleted,
  markContractAnalysisFailed,
  markContractAnalysisRunning,
  type ContractAnalysisJobRecord,
  type ContractAnalysisResult,
} from '@/lib/contract-analysis'

const job: ContractAnalysisJobRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  contract_id: '22222222-2222-4222-8222-222222222222',
  review_id: '33333333-3333-4333-8333-333333333333',
  requested_by: '44444444-4444-4444-8444-444444444444',
  status: 'running',
  attempts: 1,
  provider: 'initial-review:req-1',
  degraded: false,
  last_error: null,
  locked_at: '2026-07-21T12:00:00.000Z',
  lock_token: '55555555-5555-4555-8555-555555555555',
  locked_by: 'initial-review:req-1',
  start_request_id: null,
  started_at: '2026-07-21T12:00:00.000Z',
  completed_at: null,
  created_at: '2026-07-21T12:00:00.000Z',
  updated_at: '2026-07-21T12:00:00.000Z',
}

const result: ContractAnalysisResult = {
  risks: [],
  summary: '审核完成',
  appliedRules: 15,
  matchedRules: 2,
  provider: 'provider-cloud',
  degraded: false,
}

describe('contract analysis lease transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('refreshes running state only through the exact job and lock token RPC', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [{ ...job, locked_at: '2026-07-21T12:01:00.000Z' }], error: null })

    const refreshed = await markContractAnalysisRunning(job)

    expect(refreshed.id).toBe(job.id)
    expect(mocks.rpc).toHaveBeenCalledWith('mark_contract_analysis_job_running', {
      p_job_id: job.id,
      p_lock_token: job.lock_token,
      p_provider: job.provider,
    })
  })

  it('rejects an unfenced job before attempting a database write', async () => {
    await expect(markContractAnalysisRunning({ ...job, lock_token: null }))
      .rejects.toMatchObject({ code: 'ANALYSIS_LEASE_LOST', jobId: job.id })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('treats a zero-row transition as an explicitly lost stale lease', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null })

    await expect(markContractAnalysisRunning(job)).rejects.toMatchObject({
      code: 'ANALYSIS_LEASE_LOST',
      jobId: job.id,
      name: ContractAnalysisLeaseError.name,
    })
  })

  it('does not hide a database transition error as successful business state', async () => {
    const databaseError = { code: '40001', message: 'contract state changed' }
    mocks.rpc.mockResolvedValueOnce({ data: null, error: databaseError })

    await expect(markContractAnalysisRunning(job)).rejects.toMatchObject({
      code: 'ANALYSIS_STATE_WRITE_FAILED',
      jobId: job.id,
      detail: databaseError,
    })
  })

  it('publishes completion through one fenced database transition', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [{ ...job, status: 'completed' }], error: null })

    await markContractAnalysisCompleted(job, result)

    expect(mocks.rpc).toHaveBeenCalledWith('mark_contract_analysis_job_completed', {
      p_job_id: job.id,
      p_lock_token: job.lock_token,
      p_provider: result.provider,
      p_degraded: false,
      p_result: result,
    })
  })

  it('prevents an old token from publishing completion after a lease replacement', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null })

    await expect(markContractAnalysisCompleted(job, result)).rejects.toMatchObject({
      code: 'ANALYSIS_LEASE_LOST',
      jobId: job.id,
    })
  })

  it('publishes failure through one fenced database transition', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [{ ...job, status: 'failed' }], error: null })

    await markContractAnalysisFailed(job, new Error('provider unavailable'))

    expect(mocks.rpc).toHaveBeenCalledWith('mark_contract_analysis_job_failed', {
      p_job_id: job.id,
      p_lock_token: job.lock_token,
      p_last_error: 'provider unavailable',
    })
  })

  it('wraps lease-claim database errors with a stable application code', async () => {
    const databaseError = { code: '57014', message: 'statement timeout' }
    mocks.rpc.mockResolvedValueOnce({ data: null, error: databaseError })

    await expect(claimContractAnalysisJobById(job.id, 'worker-1', job.lock_token!))
      .rejects.toMatchObject({
        code: 'ANALYSIS_STATE_WRITE_FAILED',
        jobId: job.id,
        detail: databaseError,
      })
  })

  it('keeps the existing re-review caller compatible by returning an already leased job', async () => {
    const queuedJob = { ...job, status: 'queued' as const, lock_token: null, locked_by: null }
    const insertQuery = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: queuedJob, error: null }),
    }
    mocks.from.mockReturnValueOnce(insertQuery)
    mocks.rpc.mockResolvedValueOnce({ data: [job], error: null })

    const leasedJob = await enqueueContractAnalysisJob(
      job.contract_id,
      job.review_id,
      job.requested_by!,
    )

    expect(leasedJob).toMatchObject({ id: job.id, status: 'running', lock_token: job.lock_token })
    expect(mocks.rpc).toHaveBeenCalledWith('claim_contract_analysis_job_by_id', {
      p_job_id: job.id,
      p_worker_id: `inline-review:${job.review_id}`,
      p_lock_token: expect.any(String),
    })
  })
})

describe('contract analysis fencing migration', () => {
  const migration = readFileSync(join(
    process.cwd(),
    'supabase/migrations/20260721203248_wp04_contract_analysis_lease_fencing.sql',
  ), 'utf8')

  it('fences every state transition by running status and exact lock token', () => {
    for (const functionName of [
      'mark_contract_analysis_job_running',
      'mark_contract_analysis_job_completed',
      'mark_contract_analysis_job_failed',
    ]) {
      const start = migration.indexOf(`create or replace function public.${functionName}`)
      const next = migration.indexOf('create or replace function public.', start + 1)
      const sql = migration.slice(start, next < 0 ? undefined : next)
      expect(start).toBeGreaterThanOrEqual(0)
      expect(sql).toContain("job.status = 'running'")
      expect(sql).toContain('job.lock_token = p_lock_token')
      expect(sql).toContain('set search_path = \'\'')
    }
  })

  it('atomically validates the optional source identity before starting a review', () => {
    expect(migration).toContain('start_initial_contract_review_fenced')
    expect(migration).toContain('pg_catalog.pg_advisory_xact_lock')
    expect(migration).toContain('for update of contract, version')
    expect(migration).toContain('current_version.upload_id is distinct from p_expected_upload_id')
    expect(migration).toContain('current_version.file_sha256 is distinct from p_expected_file_sha256')
  })

  it('keeps fenced functions private to the service role', () => {
    expect(migration).toContain('from public, anon, authenticated')
    expect(migration).toContain('to service_role')
  })
})

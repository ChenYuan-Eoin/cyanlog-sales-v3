// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'

const { rpc, readDifference } = vi.hoisted(() => ({ rpc: vi.fn(), readDifference: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { rpc } }))
vi.mock('./directory-cutover', () => ({ readFxiaokeDirectoryDifference: readDifference }))

import { checkFxiaokeDirectoryNow, runDueFxiaokeDirectoryChecks, setDirectoryCheckSchedule } from './directory-check-schedule'
import { OrganizationConnectionError } from './errors'

const claim = { org_id: 'org', source_id: 'source', effective_revision: 'effective', attempt_id: 'attempt' }
const state = { intervalDays: 1, sourceId: claim.source_id }
const checkedAt = '2026-11-27T03:00:00.000Z'
const difference = {
  organizationId: claim.org_id, targetProvider: 'fxiaoke', targetSourceId: claim.source_id,
  connectionRevision: claim.effective_revision,
  snapshot: { checkedAt, complete: true, connectionVerified: true, scopeVerified: false, scopeEvidence: null },
  summary: {
    departmentsAdded: 1, departmentsUpdated: 2, departmentsToDeactivate: 0,
    membersAdded: 3, membersLinked: 4, membersMoved: 5, membersOffboarded: 0, identitiesUpdated: 6, conflicts: 7,
  },
  beforeState: { phone: 'secret-phone' },
  identityChanges: [{ email: 'secret-email' }],
}

beforeEach(() => {
  rpc.mockReset()
  readDifference.mockReset().mockResolvedValue(difference)
})

it('does not read upstream when the database has already claimed the daily window or has no eligible sources', async () => {
  rpc.mockResolvedValueOnce({ data: [], error: null })
  expect(await runDueFxiaokeDirectoryChecks()).toEqual({ checked: 0, failed: 0 })
  expect(readDifference).not.toHaveBeenCalled()
  expect(rpc).toHaveBeenCalledTimes(1)
})

it('keeps an unverified report read-only and sends only sanitized counts to the durable receipt', async () => {
  rpc.mockResolvedValueOnce({ data: [claim] }).mockResolvedValueOnce({ data: true })
  expect(await runDueFxiaokeDirectoryChecks()).toEqual({ checked: 1, failed: 0 })
  expect(readDifference).toHaveBeenCalledWith(claim.org_id)
  expect(rpc).toHaveBeenNthCalledWith(2, 'finish_fxiaoke_directory_check_v1', {
    p_org_id: claim.org_id, p_source_id: claim.source_id, p_attempt_id: claim.attempt_id,
    p_effective_revision: claim.effective_revision, p_status: 'scope_unverified',
    p_report: { checkedAt, scopeVerified: false, ...difference.summary }, p_error_code: null,
  })
})

it('records failed or changed checks without replacing the previous report', async () => {
  rpc.mockResolvedValueOnce({ data: [claim] }).mockResolvedValueOnce({ data: true })
  readDifference.mockRejectedValueOnce(new OrganizationConnectionError('DIRECTORY_READ_FAILED', 'private details'))
  expect(await runDueFxiaokeDirectoryChecks()).toEqual({ checked: 1, failed: 1 })
  expect(rpc).toHaveBeenLastCalledWith('finish_fxiaoke_directory_check_v1', expect.objectContaining({
    p_status: 'failed', p_report: null, p_error_code: 'DIRECTORY_READ_FAILED',
  }))
  rpc.mockResolvedValueOnce({ data: [claim] }).mockResolvedValueOnce({ data: false })
  readDifference.mockResolvedValueOnce({ ...difference, connectionRevision: 'new' })
  expect(await runDueFxiaokeDirectoryChecks()).toEqual({ checked: 1, failed: 1 })
  expect(rpc).toHaveBeenLastCalledWith('finish_fxiaoke_directory_check_v1', expect.objectContaining({
    p_status: 'failed', p_report: null, p_error_code: 'CONFIG_CHANGED',
  }))
})

it('keeps a manual check and frequency selection scoped to the requested organization and source', async () => {
  rpc.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: state })
  expect(await checkFxiaokeDirectoryNow(claim.org_id, claim.source_id)).toBe(state)
  expect(rpc).toHaveBeenNthCalledWith(1, 'claim_fxiaoke_directory_checks_v1', {
    p_org_id: claim.org_id, p_source_id: claim.source_id, p_limit: 1,
  })
  expect(readDifference).not.toHaveBeenCalled()
  rpc.mockResolvedValueOnce({ data: { ...state, intervalDays: 0 } })
  expect(await setDirectoryCheckSchedule(claim.org_id, claim.source_id, 0)).toMatchObject({ intervalDays: 0 })
  expect(rpc).toHaveBeenLastCalledWith('set_fxiaoke_directory_check_schedule_v1', {
    p_org_id: claim.org_id, p_source_id: claim.source_id, p_interval_days: 0,
  })
})

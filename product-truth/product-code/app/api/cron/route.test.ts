// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { contracts, shipping, directory } = vi.hoisted(() => ({ contracts: vi.fn(), shipping: vi.fn(), directory: vi.fn() }))
vi.mock('@/lib/contract-analysis', () => ({ processQueuedContractAnalysisJobs: contracts }))
vi.mock('@/lib/shipping/collaboration', () => ({ createDueShipmentReviewReminders: shipping }))
vi.mock('@/lib/organization-connections/directory-check-schedule', () => ({ runDueFxiaokeDirectoryChecks: directory }))
vi.mock('@/lib/observability', () => ({ getRequestId: () => 'test', logRouteDone: vi.fn(), logRouteFailure: vi.fn(), logRouteStart: vi.fn() }))
import { GET } from './route'

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'cron-secret')
  contracts.mockReset().mockResolvedValue([])
  shipping.mockReset().mockResolvedValue({ orders: 3, reminders: 1 })
  directory.mockReset().mockResolvedValue({ checked: 1, failed: 0 })
})

describe('cron shipping review reminders', () => {
  it('runs the due shipping digest under cron authorization', async () => { const response = await GET(new NextRequest('http://localhost/api/cron', { headers: { authorization: 'Bearer cron-secret' } })); expect(response.status).toBe(200); expect(shipping).toHaveBeenCalledTimes(1); expect(await response.text()).toContain('shipping_review_reminders:3:1') })
  it('does not run without cron authorization', async () => { const response = await GET(new NextRequest('http://localhost/api/cron')); expect(response.status).toBe(401); expect(shipping).not.toHaveBeenCalled() })
})

it('checks the directory only in the authorized cron and preserves other task results when it fails', async () => {
  expect((await GET(new NextRequest('http://localhost/api/cron'))).status).toBe(401)
  expect(directory).not.toHaveBeenCalled()
  directory.mockResolvedValue({ checked: 2, failed: 1 })
  const response = await GET(new NextRequest('http://localhost/api/cron', {
    headers: { authorization: 'Bearer cron-secret' },
  }))
  expect(directory).toHaveBeenCalledTimes(1)
  expect((await response.json()).results).toEqual(expect.arrayContaining([
    expect.objectContaining({ task: 'shipping_review_reminders:3:1', status: 'completed' }),
    expect.objectContaining({ task: 'fxiaoke_directory_checks:2:1', status: 'failed' }),
  ]))
})

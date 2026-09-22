// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { contracts, shipping } = vi.hoisted(() => ({ contracts: vi.fn(), shipping: vi.fn() }))
vi.mock('@/lib/contract-analysis', () => ({ processQueuedContractAnalysisJobs: contracts }))
vi.mock('@/lib/shipping/collaboration', () => ({ createDueShipmentReviewReminders: shipping }))
vi.mock('@/lib/observability', () => ({ getRequestId: () => 'test', logRouteDone: vi.fn(), logRouteFailure: vi.fn(), logRouteStart: vi.fn() }))
import { GET } from './route'

beforeEach(() => { vi.stubEnv('CRON_SECRET', 'cron-secret'); contracts.mockReset(); contracts.mockResolvedValue([]); shipping.mockReset(); shipping.mockResolvedValue({ orders: 3, reminders: 1 }) })

describe('cron shipping review reminders', () => {
  it('runs the due shipping digest under cron authorization', async () => { const response = await GET(new NextRequest('http://localhost/api/cron', { headers: { authorization: 'Bearer cron-secret' } })); expect(response.status).toBe(200); expect(shipping).toHaveBeenCalledTimes(1); expect(await response.text()).toContain('shipping_review_reminders:3:1') })
  it('does not run without cron authorization', async () => { const response = await GET(new NextRequest('http://localhost/api/cron')); expect(response.status).toBe(401); expect(shipping).not.toHaveBeenCalled() })
})

// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const rpc = vi.hoisted(() => vi.fn().mockResolvedValue({ data: true, error: null }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { rpc } }))
import { enforceAnonymousShippingRate, enforceExternalTrackingRate } from './rate-limit'
it('cannot evade the anonymous intake limit by rotating the user-agent', async () => {
  const env = { SHIPPING_RECEIPT_SECRET: 's'.repeat(32) }
  for (const agent of ['browser-a', 'browser-b']) await enforceAnonymousShippingRate(new NextRequest('https://company.example/api/shipping/public/orders', { headers: { 'x-forwarded-for': '192.0.2.1', 'user-agent': agent } }), env)
  expect(rpc.mock.calls[0][1].p_bucket_hash).toBe(rpc.mock.calls[1][1].p_bucket_hash)
  expect(rpc.mock.calls[0][1].p_bucket_hash).not.toContain('192.0.2.1')
})

it('limits external verification attempts by actor and keeps counters separate from intake', async () => {
  rpc.mockClear(); rpc.mockResolvedValue({ data: true, error: null })
  const env = { SHIPPING_RECEIPT_SECRET: 's'.repeat(32) }
  await enforceExternalTrackingRate('org-a', 'user-a', env)
  await enforceExternalTrackingRate('org-a', 'user-a', env)
  await enforceExternalTrackingRate('org-b', 'user-a', env)
  expect(rpc.mock.calls[0][1].p_bucket_hash).toBe(rpc.mock.calls[1][1].p_bucket_hash)
  expect(rpc.mock.calls[0][1].p_bucket_hash).not.toBe(rpc.mock.calls[2][1].p_bucket_hash)
  expect(rpc.mock.calls[0][1]).toMatchObject({ p_window_seconds: 600, p_limit: 20 })
  rpc.mockResolvedValue({ data: false, error: null })
  await expect(enforceExternalTrackingRate('org-a', 'user-a', env)).rejects.toMatchObject({ status: 429 })
  rpc.mockResolvedValue({ data: null, error: { message: 'private detail' } })
  await expect(enforceExternalTrackingRate('org-a', 'user-a', env)).rejects.toMatchObject({ status: 503 })
})

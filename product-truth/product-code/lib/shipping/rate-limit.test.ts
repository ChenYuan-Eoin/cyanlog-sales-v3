// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const rpc = vi.hoisted(() => vi.fn().mockResolvedValue({ data: true, error: null }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { rpc } }))
import { enforceAnonymousShippingRate } from './rate-limit'
it('cannot evade the anonymous intake limit by rotating the user-agent', async () => {
  const env = { SHIPPING_RECEIPT_SECRET: 's'.repeat(32) }
  for (const agent of ['browser-a', 'browser-b']) await enforceAnonymousShippingRate(new NextRequest('https://company.example/api/shipping/public/orders', { headers: { 'x-forwarded-for': '192.0.2.1', 'user-agent': agent } }), env)
  expect(rpc.mock.calls[0][1].p_bucket_hash).toBe(rpc.mock.calls[1][1].p_bucket_hash)
  expect(rpc.mock.calls[0][1].p_bucket_hash).not.toContain('192.0.2.1')
})

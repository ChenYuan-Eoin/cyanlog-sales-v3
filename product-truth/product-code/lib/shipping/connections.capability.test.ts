// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ from: vi.fn(), update: vi.fn(), eq: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))

import { recordShippingCapability } from './connections'

beforeEach(() => {
  const builder = {
    update: mocks.update,
    eq: mocks.eq,
    then: (resolve: (value: { error: null }) => unknown) => Promise.resolve(resolve({ error: null }))
  }
  mocks.from.mockReset().mockReturnValue(builder)
  mocks.update.mockReset().mockReturnValue(builder)
  mocks.eq.mockReset().mockReturnValue(builder)
})

describe('carrier capability evidence', () => {
  it.each([
    ['order', { order_capability: 'verified' }],
    ['query', { query_capability: 'verified' }],
    ['tracking', { tracking_capability: 'verified' }],
    ['cancel', { cancel_capability: 'verified' }]
  ] as const)('records %s as verified only after the corresponding provider action succeeds', async (capability, expected) => {
    expect(await recordShippingCapability('org-1', 'connection-1', capability)).toBe(true)
    expect(mocks.from).toHaveBeenCalledWith('shipping_carrier_connections')
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining(expected))
    expect(mocks.eq).toHaveBeenNthCalledWith(1, 'org_id', 'org-1')
    expect(mocks.eq).toHaveBeenNthCalledWith(2, 'id', 'connection-1')
  })
})

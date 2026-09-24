// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ from: vi.fn(), updates: [] as Array<Record<string, unknown>> }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))

import { saveAuthorizedServices } from './connections'

const connection = {
  id: 'connection-1', carrier_key: 'sf', environment: 'sandbox', partner_id_tail: '8391',
  connection_status: 'connected', authorized_services: [], order_capability: 'not_tested',
  query_capability: 'verified', tracking_capability: 'not_tested', cancel_capability: 'not_tested', last_tested_at: null
}

beforeEach(() => {
  mocks.updates.length = 0
  mocks.from.mockReset().mockImplementation((table: string) => {
    const builder: Record<string, unknown> = {}
    builder.select = () => builder
    builder.eq = () => builder
    builder.update = (patch: Record<string, unknown>) => { mocks.updates.push(patch); return builder }
    builder.maybeSingle = async () => ({ data: table === 'shipping_carrier_connections' ? { id: connection.id } : null, error: null })
    builder.order = async () => ({ data: table === 'shipping_carrier_connections' ? [connection] : [], error: null })
    builder.then = (resolve: (value: { data: unknown; error: null }) => unknown) => Promise.resolve(resolve({ data: [], error: null }))
    return builder
  })
})

describe('authorized service configuration updates', () => {
  it('updates only the service matrix and resets order capability without rewriting credentials', async () => {
    const services = [{ id: 2, name: '顺丰标快', preference: 'standard' as const }]
    await saveAuthorizedServices('org-1', 'manager-1', { environment: 'sandbox', services })

    expect(mocks.updates).toHaveLength(1)
    expect(mocks.updates[0]).toMatchObject({ authorized_services: services, order_capability: 'not_tested', updated_by: 'manager-1' })
    expect(mocks.updates[0]).not.toHaveProperty('credentials_ciphertext')
    expect(mocks.updates[0]).not.toHaveProperty('partner_id_tail')
  })
})

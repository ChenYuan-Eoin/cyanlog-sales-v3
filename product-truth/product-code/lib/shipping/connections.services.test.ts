// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  updates: [] as Array<Record<string, unknown>>,
  memberships: [] as Array<{ user_id: string; org_id: string }>,
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))

import { hasLegacyShippingConfiguration, importLegacyShippingConfiguration, saveAuthorizedServices } from './connections'

const legacyUserId = '11111111-1111-4111-8111-111111111111'
const connection = {
  id: 'connection-1', carrier_key: 'sf', environment: 'sandbox', partner_id_tail: '8391',
  connection_status: 'connected', authorized_services: [], order_capability: 'not_tested',
  query_capability: 'verified', tracking_capability: 'not_tested', cancel_capability: 'not_tested', last_tested_at: null
}

beforeEach(() => {
  mocks.updates.length = 0
  connection.authorized_services = []
  connection.order_capability = 'not_tested'
  vi.stubEnv('SF_PARTNER_ID', '')
  vi.stubEnv('SF_CHECK_WORD', '')
  vi.stubEnv('SF_SERVICES_JSON', '')
  vi.stubEnv('SF_MONTHLY_CARD', '')
  vi.stubEnv('SF_SANDBOX_MONTHLY_CARD', '')
  vi.stubEnv('SHIPPING_SENDER_JSON', '')
  vi.stubEnv('SHIPPING_ALLOWED_USER_IDS', legacyUserId)
  mocks.memberships = [{ user_id: legacyUserId, org_id: 'org-1' }]
  mocks.from.mockReset().mockImplementation((table: string) => {
    const builder: Record<string, unknown> = {}
    builder.select = () => builder
    builder.eq = () => builder
    builder.in = async () => ({
      data: table === 'users' ? [{ id: legacyUserId, org_id: 'org-1' }] : mocks.memberships,
      error: null,
      count: table === 'users' ? 1 : mocks.memberships.length,
    })
    builder.update = (patch: Record<string, unknown>) => { mocks.updates.push(patch); if (table === 'shipping_carrier_connections') Object.assign(connection, patch); return builder }
    builder.maybeSingle = async () => ({ data: table === 'shipping_carrier_connections' ? { id: connection.id } : null, error: null })
    builder.order = async () => ({ data: table === 'shipping_carrier_connections' ? [connection] : [], error: null })
    builder.then = (resolve: (value: { data: unknown; error: null }) => unknown) => Promise.resolve(resolve({ data: [], error: null }))
    return builder
  })
})
afterEach(() => vi.unstubAllEnvs())

describe('authorized service configuration updates', () => {
  it('updates only the service matrix and resets order capability without rewriting credentials', async () => {
    const services = [{ id: 2, name: '顺丰标快', preference: 'standard' as const }]
    await saveAuthorizedServices('org-1', 'manager-1', { environment: 'sandbox', services })

    expect(mocks.updates).toHaveLength(1)
    expect(mocks.updates[0]).toMatchObject({ authorized_services: services, order_capability: 'not_tested', updated_by: 'manager-1' })
    expect(mocks.updates[0]).not.toHaveProperty('credentials_ciphertext')
    expect(mocks.updates[0]).not.toHaveProperty('partner_id_tail')
  })

  it('migrates only missing authorized services from the legacy environment value', async () => {
    vi.stubEnv('SF_SERVICES_JSON', '[{"id":2,"name":"顺丰标快"}]')
    const before = { connections: [{ id: connection.id, carrier: 'sf' as const, environment: 'sandbox' as const, partnerIdTail: connection.partner_id_tail, status: 'connected', services: [], capabilities: { order: 'not_tested', query: 'verified', tracking: 'not_tested', cancel: 'not_tested' }, lastTestedAt: null }], billingAccounts: [], sender: null }
    expect(hasLegacyShippingConfiguration('sandbox', before)).toBe(true)
    const result = await importLegacyShippingConfiguration('org-1', 'manager-1', 'sandbox')
    expect(result.imported).toEqual(['已授权服务产品'])
    expect(result.configuration.connections[0].services).toEqual([{ id: 2, name: '顺丰标快', preference: 'standard' }])
    expect(mocks.updates).toHaveLength(1)
    expect(mocks.updates[0]).not.toHaveProperty('credentials_ciphertext')
    expect(hasLegacyShippingConfiguration('sandbox', result.configuration)).toBe(false)
  })

  it.each(['other organization', 'multiple organizations', 'missing allowlist'])('rejects legacy import for %s before reading or writing configuration', async (scenario) => {
    vi.stubEnv('SF_SERVICES_JSON', '[{"id":2,"name":"顺丰标快"}]')
    if (scenario === 'multiple organizations') mocks.memberships.push({ user_id: legacyUserId, org_id: 'org-2' })
    if (scenario === 'missing allowlist') vi.stubEnv('SHIPPING_ALLOWED_USER_IDS', '')

    await expect(importLegacyShippingConfiguration(scenario === 'other organization' ? 'org-2' : 'org-1', 'manager-1', 'sandbox'))
      .rejects.toMatchObject({ status: 403 })

    expect(mocks.updates).toEqual([])
    expect(mocks.from.mock.calls.every(([table]) => table === 'users' || table === 'user_organizations')).toBe(true)
  })
})

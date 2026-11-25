// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ from: vi.fn(), filters: [] as Array<[string, string, unknown]>, waybill: {} as Record<string, unknown>, order: {} as Record<string, unknown> }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: m.from } }))
vi.mock('./operator-access', () => ({ listShippingOperatorRecipients: vi.fn() }))
import { getOrganizationShipmentProviderSnapshot } from './collaboration'
beforeEach(() => {
  m.filters = []
  m.waybill = { shipping_order_id: 'order-1', provider_order_id: 'provider-id', carrier_key: 'fixture-carrier' }
  m.order = { org_id: 'org-1', provider_key: 'fixture-carrier', provider_order_id: 'provider-id', carrier_connection_id: 'original-connection', billing_account_id: 'original-account', connection_environment: 'production' }
  m.from.mockReset().mockImplementation((table: string) => {
    const q = { select: () => q, eq: (key: string, value: unknown) => { m.filters.push([table, key, value]); return q }, maybeSingle: async () => ({ data: table === 'shipping_waybills' ? m.waybill : m.order, error: null }) }
    return q
  })
})
describe('stored shipment provider snapshot', () => {
  it('scopes the initial waybill lookup to the organization and preserves its carrier and environment', async () => {
    expect(await getOrganizationShipmentProviderSnapshot('org-1', 'TEST-WAYBILL')).toEqual(m.order)
    expect(m.filters).toContainEqual(['shipping_waybills', 'shipping_orders.org_id', 'org-1'])
    expect(m.filters).toContainEqual(['shipping_orders', 'org_id', 'org-1'])
    expect(m.filters).not.toContainEqual(['shipping_waybills', 'carrier_key', 'sf'])
  })
  it.each([{ org_id: 'foreign-org' }, { provider_key: 'different-carrier' }, { provider_order_id: 'different-order' }])('rejects inconsistent order metadata %j', async override => {
    Object.assign(m.order, override)
    await expect(getOrganizationShipmentProviderSnapshot('org-1', 'TEST-WAYBILL')).rejects.toMatchObject({ status: 409 })
  })
  it('preserves historical waybill lookup when the original order association is incomplete', async () => {
    m.waybill.provider_order_id = null
    expect(await getOrganizationShipmentProviderSnapshot('org-1', 'TEST-WAYBILL')).toMatchObject({ provider_order_id: null })
  })
})

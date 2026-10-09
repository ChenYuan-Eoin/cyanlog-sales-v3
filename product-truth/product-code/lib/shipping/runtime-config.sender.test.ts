// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Contact } from './types'
const m = vi.hoisted(() => ({ from: vi.fn(), decrypt: vi.fn(), rows: {} as Record<string, Record<string, unknown>[]> }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: m.from } }))
vi.mock('@/lib/scoped-access', () => ({ getDefaultOrgId: vi.fn() }))
vi.mock('./connections', () => ({ decryptShippingSecret: m.decrypt }))
import { getShippingRuntimeConfig } from './runtime-config'

const personal: Contact = { name: '  示例销售  ', phone: '13800000001', province: '广东省', city: '深圳市', county: '南山区', address: '本人示例寄件路9号' }
const selection = { orgId: 'org-A', billingAccountId: 'account-1', connectionId: 'connection-1' }
beforeEach(() => {
  m.rows = {
    shipping_billing_accounts: [{ id: 'account-1', org_id: 'org-A', connection_id: 'connection-1', status: 'active', account_ciphertext: 'example-account-ciphertext', account_tail: '0001' }],
    shipping_carrier_connections: [{ id: 'connection-1', org_id: 'org-A', carrier_key: 'sf', environment: 'production', connection_status: 'connected', credentials_ciphertext: 'example-credentials-ciphertext', order_capability: 'verified', authorized_services: [{ id: 2, name: '示例服务', preference: 'standard' }] }],
    shipping_sender_profiles: [{ ...personal, id: 'company-profile', org_id: 'org-A', name: '示例公司前台', address: '公司示例路8号', is_default: true }],
  }
  m.decrypt.mockReset().mockImplementation((value: string) => value === 'example-credentials-ciphertext' ? JSON.stringify({ partnerId: 'example-partner-id', checkWord: 'example-check-word' }) : '0000000001')
  m.from.mockReset().mockImplementation((table: string) => {
    const filters: Array<[string, unknown]> = []
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return query },
      maybeSingle: async () => ({ data: (m.rows[table] || []).find(row => filters.every(([key, value]) => row[key] === value)) || null, error: null }),
    }
    return query
  })
})

describe('carrier configuration and work-order sender are independent', () => {
  it('uses the validated personal sender without requiring or reading a company sender profile', async () => {
    m.rows.shipping_sender_profiles = []
    const config = await getShippingRuntimeConfig({ ...selection, senderOverride: personal })
    expect(config.sender).toEqual({ ...personal, name: '示例销售' })
    expect(config.senderProfileId).toBeNull()
    expect(config.snapshot).toMatchObject({ senderSource: 'workorder', senderProfileId: null })
    expect(m.from.mock.calls.some(([table]) => table === 'shipping_sender_profiles')).toBe(false)
    expect(config).toMatchObject({ orgId: 'org-A', connectionId: 'connection-1', billingAccountId: 'account-1', environment: 'production' })
  })
  it('keeps the company fallback when no work-order sender is supplied for a new owner order', async () => {
    const config = await getShippingRuntimeConfig(selection)
    expect(config.sender.name).toBe('示例公司前台')
    expect(config.senderProfileId).toBe('company-profile')
    expect(config.snapshot).toMatchObject({ senderSource: 'company_default' })
  })
  it('rejects malformed work-order sender instead of silently using company contact data', async () => {
    await expect(getShippingRuntimeConfig({ ...selection, senderOverride: { ...personal, address: '' } })).rejects.toMatchObject({ status: 400, requestStage: 'validation' })
    expect(m.from).not.toHaveBeenCalled()
    expect(m.decrypt).not.toHaveBeenCalled()
  })
  it('does not let personal sender override the organization scope of carrier credentials', async () => {
    m.rows.shipping_carrier_connections[0].org_id = 'org-B'
    await expect(getShippingRuntimeConfig({ ...selection, senderOverride: personal })).rejects.toMatchObject({ status: 409 })
    expect(m.decrypt).not.toHaveBeenCalled()
  })
  it('recovers original provider credentials for lookup or cancellation without a current company sender', async () => {
    m.rows.shipping_sender_profiles = []
    const before = structuredClone(m.rows)
    const config = await getShippingRuntimeConfig({ ...selection, requireOrderCapability: false, allowHistorical: true })
    expect(config.connectionId).toBe('connection-1')
    expect(config.billingAccountId).toBe('account-1')
    expect(config.snapshot.senderSource).toBe('not_required')
    expect(m.from.mock.calls.some(([table]) => table === 'shipping_sender_profiles')).toBe(false)
    expect(m.rows).toEqual(before)
  })
})

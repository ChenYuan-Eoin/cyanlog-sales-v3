// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyContact, type ShippingInput } from './types'
const m = vi.hoisted(() => ({ resolve: vi.fn(), select: vi.fn(), create: vi.fn(), lookup: vi.fn(), cancel: vi.fn(), track: vi.fn() }))
vi.mock('./runtime-config', () => ({ getShippingRuntimeConfig: m.resolve, selectAuthorizedShippingService: m.select }))
vi.mock('./sf-client', () => ({ createSfOrder: m.create, lookupSfOrder: m.lookup, cancelSfOrder: m.cancel, querySfTracking: m.track }))
import { getCarrierAdapter, getHistoricalCarrierAdapter } from './carrier-adapter'
const config = {
  orgId: 'org-1', connectionId: 'connection-1', environment: 'sandbox', connectionKey: 'synthetic-key',
  billingAccountId: 'billing-1', billingAccountTail: '1234', senderProfileId: null, sender: emptyContact(),
  services: [{ id: 1, name: '测试服务', preference: 'standard' }], snapshot: { carrier: 'sf' },
  partnerId: 'synthetic-partner', checkWord: 'synthetic-checkword', billingAccount: 'synthetic-private-account',
}
beforeEach(() => { vi.resetAllMocks(); m.resolve.mockResolvedValue(config); m.create.mockResolvedValue('TEST-WAYBILL'); m.lookup.mockResolvedValue(null) })
describe('installed carrier boundary', () => {
  it('rejects historical environment drift before any supplier operation', async () => {
    await expect(getCarrierAdapter('sf').connect({ orgId: 'org-1', expectedEnvironment: 'production' })).rejects.toMatchObject({ status: 409 })
    expect(m.lookup).not.toHaveBeenCalled()
    expect(m.cancel).not.toHaveBeenCalled()
    expect(m.track).not.toHaveBeenCalled()
  })
  it.each(['sandbox', 'production'] as const)('marks %s tracking provenance inside the adapter', async environment => {
    m.resolve.mockResolvedValue({ ...config, environment })
    m.track.mockResolvedValue({ waybill: 'TEST-WAYBILL', queriedAt: '2026-10-09T00:00:00Z', events: [], source: 'untrusted' })
    const carrier = await getCarrierAdapter('sf').connect({ orgId: 'org-1', expectedEnvironment: environment })
    expect(await carrier.track('TEST-WAYBILL', '1234')).toMatchObject({ source: environment === 'production' ? 'carrier' : 'sandbox_mock' })
    expect(m.track).toHaveBeenCalledWith('TEST-WAYBILL', '1234', { ...config, environment })
  })
  it('uses the legacy SF default only when metadata is absent, never for an invalid saved carrier', () => {
    expect(getHistoricalCarrierAdapter(undefined).key).toBe('sf')
    for (const key of ['', 'uninstalled', 123, {}]) expect(() => getHistoricalCarrierAdapter(key)).toThrow()
  })
  it('keeps provider credentials private while all operations use the selected connection', async () => {
    const selected = { orgId: 'org-1', connectionId: 'connection-1', allowHistorical: true, requireOrderCapability: false }
    const carrier = await getCarrierAdapter('sf').connect(selected)
    expect(m.resolve).toHaveBeenCalledWith(selected)
    for (const key of ['partnerId', 'checkWord', 'billingAccount']) expect(carrier.context).not.toHaveProperty(key)
    expect(JSON.stringify(carrier)).not.toContain('synthetic-checkword')
    const input = { sender: emptyContact(), recipient: emptyContact(), source: 'manual', serviceId: 1, cargo: '测试', weight: 1, remark: '' } as ShippingInput
    expect(await carrier.create('original-request', input)).toBe('TEST-WAYBILL')
    expect(await carrier.lookup('original-request')).toBeNull()
    await carrier.cancel('original-request')
    expect(m.create).toHaveBeenCalledWith('original-request', input, config)
    expect(m.lookup).toHaveBeenCalledWith('original-request', config)
    expect(m.cancel).toHaveBeenCalledWith('original-request', config)
  })
  it.each(['other-carrier', '', '__proto__', 'https://untrusted.invalid'])('rejects uninstalled adapter %s without loading credentials', key => {
    expect(() => getCarrierAdapter(key)).toThrow('尚未接入')
    expect(m.resolve).not.toHaveBeenCalled()
    expect(m.create).not.toHaveBeenCalled()
  })
})

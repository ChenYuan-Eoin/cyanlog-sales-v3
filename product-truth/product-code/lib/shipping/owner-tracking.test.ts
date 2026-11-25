// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ from: vi.fn(), connect: vi.fn(), track: vi.fn(), record: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: m.from } }))
vi.mock('./carrier-adapter', () => ({ getCarrierAdapter: () => ({ connect: m.connect }) }))
vi.mock('./tracking-store', () => ({ recordTrackingResult: m.record }))
import { refreshOwnerTracking } from './owner-tracking'
let row: Record<string, unknown> | null
let filters: Record<string, unknown>
beforeEach(() => {
  vi.resetAllMocks(); filters = {}
  row = { org_id: 'org', created_by: 'me', intake_source: 'owner_web', order_no: 'SO-20261118-87431B2C',
    provider_key: 'sf', provider_order_id: 'request', carrier_connection_id: 'original', billing_account_id: 'billing',
    connection_environment: 'production', shipping_waybills: [{ waybill_no: 'SF5169741550975', provider_order_id: 'request', carrier_key: 'sf' }] }
  const q = { select: vi.fn(() => q), eq: vi.fn((key, value) => { filters[key] = value; return q }),
    maybeSingle: vi.fn(async () => ({ data: row && Object.entries(filters).every(([key, value]) => row![key] === value) ? row : null, error: null })) }
  m.from.mockReturnValue(q)
  m.connect.mockResolvedValue({ trackOrder: m.track })
  m.track.mockResolvedValue({ source: 'carrier', waybill: 'SF5169741550975', events: [{ time: '2026-11-20 18:41:00', status: 'delivered', description: '您的快件已派送成功（公司前台）', location: '北京' }] })
  m.record.mockResolvedValue({ recorded: 1, shipmentStatus: 'delivered' })
})
it('refreshes only the employee original order and persists confirmed delivery', async () => {
  expect(await refreshOwnerTracking('org', 'me', 'SO-20261118-87431B2C')).toMatchObject({ verified: true, shipmentStatus: 'delivered', waybill: 'SF5169741550975' })
  expect(filters).toEqual({ org_id: 'org', created_by: 'me', intake_source: 'owner_web', order_no: 'SO-20261118-87431B2C' })
  expect(m.connect).toHaveBeenCalledWith(expect.objectContaining({ connectionId: 'original', billingAccountId: 'billing', expectedEnvironment: 'production', orgId: 'org' }))
  expect(m.track).toHaveBeenCalledWith('request', 'SF5169741550975')
  expect(m.record).toHaveBeenCalledWith('org', expect.objectContaining({ waybill: 'SF5169741550975' }), 'sf')
})
it.each([['other', 'me'], ['org', 'coworker']])('rejects foreign scope %s/%s without contacting SF', async (org, actor) => {
  await expect(refreshOwnerTracking(org, actor, 'SO-20261118-87431B2C')).rejects.toMatchObject({ status: 404 })
  expect(m.connect).not.toHaveBeenCalled()
})
it('does not fall back to a current connection when the original environment is missing', async () => {
  row!.connection_environment = null
  await expect(refreshOwnerTracking('org', 'me', 'SO-20261118-87431B2C')).rejects.toMatchObject({ status: 409 })
  expect(m.connect).not.toHaveBeenCalled()
})
it.each(['empty', 'unknown', 'invalid-time', 'wrong-waybill', 'mock'])('does not verify %s routes', async kind => {
  const event = { time: kind === 'invalid-time' ? 'invalid' : '2026-11-20 18:41:00', status: kind === 'unknown' ? 'unknown' : 'delivered' }
  m.track.mockResolvedValue({ source: kind === 'mock' ? 'sandbox_mock' : 'carrier', waybill: kind === 'wrong-waybill' ? 'SF999' : 'SF5169741550975', events: kind === 'empty' ? [] : [event] })
  await expect(refreshOwnerTracking('org', 'me', 'SO-20261118-87431B2C')).rejects.toMatchObject({ status: 503 })
})
it('does not report delivery if persistence fails', async () => {
  m.record.mockRejectedValue(new Error('write failed'))
  await expect(refreshOwnerTracking('org', 'me', 'SO-20261118-87431B2C')).rejects.toThrow()
})

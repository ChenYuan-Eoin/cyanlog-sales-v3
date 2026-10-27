// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  snapshot: vi.fn(),
  adapter: vi.fn(),
  connect: vi.fn(),
  track: vi.fn(),
}))

vi.mock('./collaboration', () => ({
  listEmployeeShipmentReceipts: mocks.list,
  getOrganizationShipmentProviderSnapshot: mocks.snapshot,
}))
vi.mock('./carrier-adapter', () => ({ getHistoricalCarrierAdapter: mocks.adapter }))

import { handleWecomBotQuery, signWecomBotRuntimeRequest, verifyWecomBotRuntimeRequest } from './wecom-bot-runtime'
import type { WecomBotRow } from './wecom-bot-settings'
import type { WecomProfile } from './wecom-session'

const bot = { id: 'bot-row', org_id: 'org-a', bot_id: 'bot-1', status: 'active', credentials_ciphertext: 'long-connection:v1:cipher' } as WecomBotRow
const employee = { id: 'employee-a', orgId: 'org-a' } as WecomProfile
const receipt = {
  orderNo: 'SO-20261023-ABCDEF12',
  status: 'waybill_created' as const,
  waybill: 'SF1234567890123',
  nextReviewAt: null,
  createdAt: '2026-10-23T10:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.list.mockResolvedValue([receipt])
  mocks.connect.mockResolvedValue({ track: mocks.track })
  mocks.adapter.mockReturnValue({ connect: mocks.connect })
  mocks.snapshot.mockResolvedValue({
    org_id: 'org-a',
    provider_key: 'sf',
    carrier_connection_id: 'connection-a',
    billing_account_id: 'account-a',
    connection_environment: 'production',
  })
  mocks.track.mockResolvedValue({
    waybill: receipt.waybill,
    events: [{ time: '2026-10-23 18:00:00', location: '深圳市', description: '运输中', status: 'in_transit' }],
  })
})

it('accepts a current signed runtime request and rejects stale or changed bodies', () => {
  const body = '{"action":"heartbeat"}'
  const timestamp = '1000'
  const signature = signWecomBotRuntimeRequest('secret', timestamp, body)
  expect(() => verifyWecomBotRuntimeRequest({ secret: 'secret', timestamp, signature, body, now: 1_000_000 })).not.toThrow()
  expect(() => verifyWecomBotRuntimeRequest({ secret: 'secret', timestamp, signature, body, now: 1_600_000 })).toThrow('过期')
  expect(() => verifyWecomBotRuntimeRequest({ secret: 'secret', timestamp, signature, body: `${body} `, now: 1_000_000 })).toThrow('签名')
})

it('returns only the current employee recent work orders', async () => {
  const reply = await handleWecomBotQuery('查询我的工单', bot, employee)
  expect(reply).toContain(receipt.orderNo)
  expect(reply).toContain('已出号')
  expect(mocks.list).toHaveBeenCalledWith('org-a', 'employee-a')
})

it('does not disclose an order that is not owned by the sender', async () => {
  await expect(handleWecomBotQuery('查询工单 SO-20261023-FFFFFFFF', bot, employee)).rejects.toMatchObject({ status: 403 })
})

it('rejects tracking for a waybill that is not in the sender own receipts', async () => {
  await expect(handleWecomBotQuery('查询轨迹 SF9999999999999', bot, employee)).rejects.toMatchObject({ status: 403 })
  expect(mocks.track).not.toHaveBeenCalled()
})

it('queries tracking only after matching the employee own waybill', async () => {
  const reply = await handleWecomBotQuery(`查询轨迹 ${receipt.waybill}`, bot, employee)
  expect(reply).toContain('运输中')
  expect(mocks.snapshot).toHaveBeenCalledWith('org-a', receipt.waybill)
  expect(mocks.connect).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-a', connectionId: 'connection-a' }))
  expect(mocks.track).toHaveBeenCalledWith(receipt.waybill)
})

it('returns null for non-query text so intake parsing remains the only creation path', async () => {
  await expect(handleWecomBotQuery('寄件\n收件人：张三', bot, employee)).resolves.toBeNull()
  expect(mocks.list).not.toHaveBeenCalled()
})

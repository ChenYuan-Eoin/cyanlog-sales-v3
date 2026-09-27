// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeTrackingStatus, normalizeTrackingTime } from './tracking-status'

const status = (description: string) => normalizeTrackingStatus({ description })

describe('conservative SF route status normalization', () => {
  it.each(['顺丰速运 已收取快件', '快件已揽收', '运输中', '快件已到达转运场'])('treats %s as transit, not delivery', (description) => {
    expect(status(description)).toBe('in_transit')
  })
  it.each(['快件已签收', '本人签收', '签收成功'])('recognizes explicit successful delivery: %s', (description) => {
    expect(status(description)).toBe('delivered')
  })
  it.each([
    ['签收失败，请联系快递员', 'exception'],
    ['未签收', 'unknown'],
    ['尚未签收', 'unknown'],
    ['尚未揽收', 'waybill_created'],
    ['待揽收', 'waybill_created'],
    ['快件正在派送', 'out_for_delivery'],
    ['签收后请评价', 'unknown'],
  ] as const)('does not confuse %s with a completed delivery', (description, expected) => {
    expect(status(description)).toBe(expected)
  })
  it('uses the documented structured status and verified pickup code', () => {
    expect(normalizeTrackingStatus({ firstStatusName: '已揽收', secondaryStatusName: '已揽收', opCode: '54', description: '顺丰速运 已收取快件' })).toBe('in_transit')
    expect(normalizeTrackingStatus({ firstStatusName: '待揽收', secondaryStatusName: '待揽收', opCode: '655', description: '合作点已代收' })).toBe('waybill_created')
    expect(normalizeTrackingStatus({ firstStatusName: '已签收', description: '已放至指定位置' })).toBe('delivered')
  })
  it('does not invent a meaning for an unknown operation code or future status name', () => {
    expect(normalizeTrackingStatus({ opCode: '99999', description: '节点更新' })).toBe('unknown')
    expect(normalizeTrackingStatus({ opCode: '99999', description: '顺丰速运 已收取快件' })).toBe('in_transit')
    expect(normalizeTrackingStatus({ opCode: '99999', description: '快件已签收' })).toBe('delivered')
    expect(normalizeTrackingStatus({ firstStatusName: '未来状态', description: '快件已签收' })).toBe('unknown')
    expect(normalizeTrackingStatus({ opCode: 'constructor', description: '节点更新' })).toBe('unknown')
  })
  it('recognizes delivery dispatch as a refinement of transit, not a conflicting status', () => {
    expect(normalizeTrackingStatus({ firstStatusName: '运输中', secondaryStatusName: '派送中', description: '快件已到达派送站' })).toBe('out_for_delivery')
    expect(normalizeTrackingStatus({ firstStatusName: '运输中', secondaryStatusName: '派送中', description: '正在派送' })).toBe('out_for_delivery')
  })
  it('does not promote conflicting structured and descriptive evidence to delivered', () => {
    expect(normalizeTrackingStatus({ firstStatusName: '已揽收', description: '已签收' })).toBe('in_transit')
    expect(normalizeTrackingStatus({ firstStatusName: '已签收', description: '未签收' })).toBe('unknown')
    expect(normalizeTrackingStatus({ firstStatusName: '已签收', description: '签收失败' })).toBe('exception')
    expect(normalizeTrackingStatus({ firstStatusName: '已签收', secondaryStatusName: '已揽收', description: '节点更新' })).toBe('unknown')
    expect(normalizeTrackingStatus({ firstStatusName: '待揽收', description: '快件已揽收' })).toBe('unknown')
  })
})

describe('SF route time normalization', () => {
  afterEach(() => vi.unstubAllEnvs())
  it.each(['UTC', 'America/New_York', 'Asia/Shanghai'])('interprets timezone-free SF dates in China time when the host uses %s', (timezone) => {
    vi.stubEnv('TZ', timezone)
    expect(normalizeTrackingTime('2026-09-27 18:09:07')).toBe('2026-09-27T10:09:07.000Z')
    expect(normalizeTrackingTime('2024-2-29 01:02:03')).toBe('2024-02-28T17:02:03.000Z')
  })
  it('preserves the instant from ISO timestamps with an explicit timezone', () => {
    expect(normalizeTrackingTime('2026-09-27T18:09:07+08:00')).toBe('2026-09-27T10:09:07.000Z')
    expect(normalizeTrackingTime('2026-09-27T10:09:07.123Z')).toBe('2026-09-27T10:09:07.123Z')
    expect(normalizeTrackingTime('2026-09-27T03:09:07-0700')).toBe('2026-09-27T10:09:07.000Z')
    expect(normalizeTrackingTime('2026-09-27T10:09Z')).toBe('2026-09-27T10:09:00.000Z')
  })
  it.each(['2026-02-29 12:00:00', '2026-02-30 12:00:00', '2026-13-01 12:00:00', '2026-09-27 24:00:00', '2026-09-27 12:60:00', '2026-09-27T12:00:00+25:00', '2026-09-27', '2026-09-27T12:00:00', 'not-a-date', ''])('rejects invalid or incomplete timestamp %s', (raw) => {
    expect(normalizeTrackingTime(raw)).toBeNull()
  })
})

// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { extractTracking } from './sf-client'

describe('SF route response normalization', () => {
  it('retains descriptions and raw time while attaching structured status and ordering by instants', () => {
    const result = extractTracking({ routeResps: [{ mailNo: 'synthetic-waybill', routes: [
      { acceptTime: '2026-09-27T11:00:00Z', remark: '快件正在派送', firstStatusName: '派送中' },
      { acceptTime: '2026-09-27 18:30:00', remark: '顺丰速运 已收取快件', firstStatusName: '已揽收', secondaryStatusName: '已揽收', opCode: '54' },
      { acceptTime: '2026-02-30 12:00:00', remark: '无效时间节点', firstStatusName: '已签收' },
    ] }] }, 'synthetic-waybill')
    expect(result.events).toEqual([
      { time: '2026-09-27T11:00:00Z', location: '', description: '快件正在派送', status: 'out_for_delivery' },
      { time: '2026-09-27 18:30:00', location: '', description: '顺丰速运 已收取快件', status: 'in_transit' },
      { time: '2026-02-30 12:00:00', location: '', description: '无效时间节点', status: 'delivered' },
    ])
  })
  it('keeps an unknown code unknown and refuses a different waybill', () => {
    const raw = { routeResps: [{ mailNo: 'synthetic-waybill', routes: [{ acceptTime: '2026-09-27 18:30:00', remark: '节点更新', opCode: '99999' }] }] }
    expect(extractTracking(raw, 'synthetic-waybill').events[0].status).toBe('unknown')
    expect(() => extractTracking(raw, 'another-waybill')).toThrow('顺丰返回的运单号不一致')
  })
  it('uses explicit remarks when the response provides only an unmapped code', () => {
    const result = extractTracking({ routeResps: [{ mailNo: 'synthetic-waybill', routes: [
      { acceptTime: '2026-09-27 18:30:00', remark: '快件已签收', opCode: 'unmapped' },
      { acceptTime: '2026-09-27 09:30:00', remark: '顺丰速运 已收取快件', opCode: 'unmapped' },
    ] }] }, 'synthetic-waybill')
    expect(result.events.map(event => event.status)).toEqual(['delivered', 'in_transit'])
  })
})

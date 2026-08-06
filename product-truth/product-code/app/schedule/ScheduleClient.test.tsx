import { describe, expect, it } from 'vitest'
import { buildTree, daySpan, flattenVisible } from '@/lib/agenda/schedule-tree'
import { computeCriticalPath, DependencyCycleError } from '@/lib/agenda/critical-path'
import type { AgendaItem } from '@/lib/agenda/types'

const base = {
  description: null,
  all_day: true,
  related_type: null,
  related_id: null,
  assignee_id: null,
  created_by: null,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
}

const makeItem = (overrides: Partial<AgendaItem>): AgendaItem =>
  ({ ...(base as unknown as AgendaItem), ...overrides }) as AgendaItem

const P = '11111111-1111-4111-8111-111111111111'
const C1 = '22222222-2222-4222-8222-222222222222'
const C2 = '33333333-3333-4333-8333-333333333333'
const A = '44444444-4444-4444-8444-444444444444'
const B = '55555555-5555-4555-8555-555555555555'
const D = '66666666-6666-4666-8666-666666666666'

const fixture: AgendaItem[] = [
  makeItem({ id: P, title: '报价跟进', agenda_type: 'FOLLOW_UP', start_at: '2026-08-04T09:00:00.000Z', end_at: '2026-08-06T18:00:00.000Z', status: 'PENDING', priority: 'URGENT', parent_id: null, depends_on: [] }),
  makeItem({ id: C1, title: '联系客户确认意向', agenda_type: 'TASK', start_at: '2026-08-04T09:00:00.000Z', end_at: '2026-08-04T12:00:00.000Z', status: 'DONE', priority: 'HIGH', parent_id: P, depends_on: [] }),
  makeItem({ id: C2, title: '发送方案材料', agenda_type: 'TASK', start_at: '2026-08-05T09:00:00.000Z', end_at: '2026-08-05T12:00:00.000Z', status: 'PENDING', priority: 'NORMAL', parent_id: P, depends_on: [C1] }),
  makeItem({ id: A, title: 'CRM 优化', agenda_type: 'TASK', start_at: '2026-08-03T09:00:00.000Z', end_at: '2026-08-04T18:00:00.000Z', status: 'DONE', priority: 'HIGH', parent_id: null, depends_on: [] }),
  makeItem({ id: B, title: '首月回款单整理', agenda_type: 'TASK', start_at: '2026-08-05T09:00:00.000Z', end_at: '2026-08-06T18:00:00.000Z', status: 'PENDING', priority: 'HIGH', parent_id: null, depends_on: [A] }),
  makeItem({ id: D, title: '次月回款单整理', agenda_type: 'TASK', start_at: '2026-08-07T09:00:00.000Z', end_at: '2026-08-08T18:00:00.000Z', status: 'PENDING', priority: 'NORMAL', parent_id: null, depends_on: [B] }),
]

describe('日程中心数据逻辑（WP11）', () => {
  it('buildTree 构建父子层级与深度', () => {
    const tree = buildTree(fixture)
    const parent = tree.find((n) => n.item.id === P)
    expect(parent).toBeTruthy()
    expect(parent?.children.map((c) => c.item.id)).toEqual([C1, C2])
    expect(parent?.children[1].depth).toBe(1)
    expect(parent?.children[1].children.length).toBe(0)
  })

  it('flattenVisible 折叠父任务后隐藏子任务', () => {
    const tree = buildTree(fixture)
    const collapsed = new Set([P])
    const visible = flattenVisible(tree, collapsed)
    const ids = visible.map((n) => n.item.id)
    expect(ids).toContain(P)
    expect(ids).not.toContain(C1)
    expect(ids).not.toContain(C2)
  })

  it('daySpan 返回开始/结束日跨度', () => {
    const item = makeItem({
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      title: '跨日任务',
      agenda_type: 'TASK',
      start_at: '2026-08-04T02:00:00.000Z',
      end_at: '2026-08-06T03:00:00.000Z',
      status: 'PENDING',
      priority: 'NORMAL',
      parent_id: null,
      depends_on: [],
    })
    const [start, end] = daySpan(item)
    expect(end - start).toBe(2 * 86_400_000)
  })

  it('关键路径由依赖自动计算：串行链全部关键', () => {
    const deps = new Map<string, string[]>([[B, [A]], [D, [B]]])
    const r = computeCriticalPath(
      fixture.map((i) => ({ id: i.id, startAt: i.start_at, endAt: i.end_at })),
      deps
    )
    expect(r.criticalIds.has(A)).toBe(true)
    expect(r.criticalIds.has(B)).toBe(true)
    expect(r.criticalIds.has(D)).toBe(true)
  })

  it('依赖成环抛出 DependencyCycleError', () => {
    const deps = new Map<string, string[]>([
      [A, [B]],
      [B, [A]],
    ])
    expect(() =>
      computeCriticalPath(
        fixture.slice(3, 5).map((i) => ({ id: i.id, startAt: i.start_at, endAt: i.end_at })),
        deps
      )
    ).toThrow(DependencyCycleError)
  })
})

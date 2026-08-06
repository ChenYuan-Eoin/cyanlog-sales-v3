import { describe, expect, it } from 'vitest'
import { computeCriticalPath, DependencyCycleError } from './critical-path'

const at = (iso: string) => ({ startAt: iso, endAt: null })

describe('computeCriticalPath', () => {
  it('单任务：自身即关键路径', () => {
    const r = computeCriticalPath([{ id: 'a', ...at('2026-08-06T09:00:00Z') }], new Map())
    expect(r.criticalIds.has('a')).toBe(true)
    expect(r.slack.get('a')).toBeCloseTo(0)
  })

  it('串行链：全部关键', () => {
    const nodes = [
      { id: 'a', ...at('2026-08-06T09:00:00Z') },
      { id: 'b', ...at('2026-08-06T10:00:00Z') },
      { id: 'c', ...at('2026-08-06T11:00:00Z') },
    ]
    const deps = new Map([
      ['b', ['a']],
      ['c', ['b']],
    ])
    const r = computeCriticalPath(nodes, deps)
    expect([...r.criticalIds].sort()).toEqual(['a', 'b', 'c'])
  })

  it('并行分支：只有最长路径关键', () => {
    const nodes = [
      { id: 'a', ...at('2026-08-06T09:00:00Z') },
      { id: 'b', ...at('2026-08-06T10:00:00Z') },
      { id: 'c', ...at('2026-08-06T11:00:00Z') },
      { id: 'd', ...at('2026-08-06T11:30:00Z') },
    ]
    const deps = new Map([
      ['b', ['a']],
      ['c', ['a']],
      ['d', ['c']],
    ])
    const r = computeCriticalPath(nodes, deps)
    expect(r.criticalIds.has('d')).toBe(true)
    expect(r.criticalIds.has('b')).toBe(false)
    expect(r.slack.get('b') || 0).toBeGreaterThan(0)
  })

  it('成环时抛出 DependencyCycleError', () => {
    const nodes = [
      { id: 'a', ...at('2026-08-06T09:00:00Z') },
      { id: 'b', ...at('2026-08-06T10:00:00Z') },
    ]
    const deps = new Map([
      ['a', ['b']],
      ['b', ['a']],
    ])
    expect(() => computeCriticalPath(nodes, deps)).toThrow(DependencyCycleError)
  })

  it('空依赖图的任务全部视为关键（无虚假路径）', () => {
    const nodes = [
      { id: 'a', ...at('2026-08-06T09:00:00Z') },
      { id: 'b', ...at('2026-08-06T09:00:00Z') },
    ]
    const r = computeCriticalPath(nodes, new Map())
    expect(r.criticalIds.size).toBe(2)
  })
})

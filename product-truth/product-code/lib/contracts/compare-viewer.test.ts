import { describe, expect, it } from 'vitest'
import {
  clampCompareViewerZoom,
  fitWidthScale,
  nextCompareViewerZoom,
  normalizedScrollProgress,
  proportionalScrollTop,
  scrollTopForProgress,
  synchronizedTargetScrollTop,
} from './compare-viewer'

describe('compare viewer math', () => {
  it('clamps manual zoom to 60-180 percent', () => {
    expect(clampCompareViewerZoom(12)).toBe(60)
    expect(clampCompareViewerZoom(137.4)).toBe(137)
    expect(clampCompareViewerZoom(Number.NaN)).toBe(100)
    expect(nextCompareViewerZoom(175, 'in')).toBe(180)
    expect(nextCompareViewerZoom(60, 'out')).toBe(60)
  })

  it('maps different document heights by normalized progress', () => {
    const source = { scrollTop: 900, scrollHeight: 1400, clientHeight: 400 }
    const target = { scrollHeight: 2400, clientHeight: 400 }

    expect(proportionalScrollTop(source, target)).toBe(1800)
    expect(normalizedScrollProgress({ ...target, scrollTop: 1800 })).toBe(0.9)
    expect(scrollTopForProgress(0.9, target)).toBe(1800)
  })

  it('clamps overscroll and handles panes without a scroll range', () => {
    expect(normalizedScrollProgress({ scrollTop: 900, scrollHeight: 400, clientHeight: 400 })).toBe(0)
    expect(normalizedScrollProgress({ scrollTop: -20, scrollHeight: 1000, clientHeight: 400 })).toBe(0)
    expect(normalizedScrollProgress({ scrollTop: 900, scrollHeight: 1000, clientHeight: 400 })).toBe(1)
  })

  it('does not mutate the opposite pane in independent mode', () => {
    const source = { scrollTop: 300, scrollHeight: 1000, clientHeight: 400 }
    const target = { scrollHeight: 1600, clientHeight: 400 }

    expect(synchronizedTargetScrollTop('independent', source, target)).toBeNull()
    expect(synchronizedTargetScrollTop('synchronized', source, target)).toBe(600)
  })

  it('fits width while respecting the supported zoom limits', () => {
    expect(fitWidthScale(620, 800)).toBeCloseTo(0.75)
    expect(fitWidthScale(2000, 800)).toBe(1.8)
    expect(fitWidthScale(100, 800)).toBe(0.6)
    expect(fitWidthScale(Number.NaN, 800)).toBe(1)
  })
})

import { describe, expect, it } from 'vitest'
import {
  clampCompareViewerZoom,
  fitWidthScale,
  nextCompareViewerZoom,
  normalizedScrollProgress,
  proportionalScrollTop,
} from './compare-viewer'

describe('compare viewer math', () => {
  it('clamps manual zoom to the supported 60-180 range', () => {
    expect(clampCompareViewerZoom(12)).toBe(60)
    expect(clampCompareViewerZoom(137)).toBe(137)
    expect(nextCompareViewerZoom(175, 'in')).toBe(180)
    expect(nextCompareViewerZoom(60, 'out')).toBe(60)
  })

  it('maps scroll by normalized progress when document heights differ', () => {
    const targetTop = proportionalScrollTop(
      { scrollTop: 900, scrollHeight: 1400, clientHeight: 400 },
      { scrollHeight: 2400, clientHeight: 400 }
    )

    expect(targetTop).toBe(1800)
    expect(normalizedScrollProgress({ scrollTop: targetTop, scrollHeight: 2400, clientHeight: 400 })).toBe(0.9)
  })

  it('handles documents without a scroll range', () => {
    expect(normalizedScrollProgress({ scrollTop: 30, scrollHeight: 400, clientHeight: 400 })).toBe(0)
    expect(proportionalScrollTop(
      { scrollTop: 30, scrollHeight: 400, clientHeight: 400 },
      { scrollHeight: 900, clientHeight: 400 }
    )).toBe(0)
  })

  it('fits a natural page into the available viewport without exceeding the supported fit range', () => {
    expect(fitWidthScale(620, 800)).toBeCloseTo(0.745)
    expect(fitWidthScale(2000, 800)).toBe(1.8)
    expect(fitWidthScale(100, 800)).toBe(0.4)
  })
})

import { describe, expect, it } from 'vitest'

import { calculateFaviconPlacement } from './favicon-canvas'

describe('favicon transparent square placement', () => {
  it('竖向、横向和方形 Logo 都保持比例并在 512 透明画布留 64 安全边距', () => {
    expect(calculateFaviconPlacement(714, 884)).toEqual({
      x: expect.closeTo(100.923, 3),
      y: 64,
      width: expect.closeTo(310.154, 3),
      height: 384,
    })
    expect(calculateFaviconPlacement(2520, 666)).toEqual({
      x: expect.closeTo(64, 6),
      y: expect.closeTo(205.257, 3),
      width: expect.closeTo(384, 6),
      height: expect.closeTo(101.486, 3),
    })
    expect(calculateFaviconPlacement(100, 100)).toEqual({ x: 64, y: 64, width: 384, height: 384 })
  })

  it('拒绝无效尺寸而不是生成损坏图标', () => {
    expect(() => calculateFaviconPlacement(0, 100)).toThrow('品牌图形尺寸无效')
  })
})

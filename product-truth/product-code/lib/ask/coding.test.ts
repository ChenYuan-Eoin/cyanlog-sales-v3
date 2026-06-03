// lib/ask/coding.test.ts
// REQ: F005 - ASK 编码测试
// Feature Packet: F005-contract-ASK-upgrade.md v2

import { describe, it, expect } from 'vitest'
import { generateAskCode, isValidAskCode, parseAskCode } from './coding'

describe('ASK 编码生成器', () => {
  describe('generateAskCode', () => {
    it('生成 3 位补零编码', () => {
      expect(generateAskCode(1)).toBe('ASK-001')
      expect(generateAskCode(9)).toBe('ASK-009')
      expect(generateAskCode(10)).toBe('ASK-010')
      expect(generateAskCode(100)).toBe('ASK-100')
    })

    it('超过 3 位也能正常生成（999+）', () => {
      expect(generateAskCode(1000)).toBe('ASK-1000')
    })

    it('拒绝 0 和负数', () => {
      expect(() => generateAskCode(0)).toThrow()
      expect(() => generateAskCode(-1)).toThrow()
    })

    it('拒绝非整数', () => {
      expect(() => generateAskCode(1.5)).toThrow()
    })
  })

  describe('isValidAskCode', () => {
    it('验证合法编码', () => {
      expect(isValidAskCode('ASK-001')).toBe(true)
      expect(isValidAskCode('ASK-999')).toBe(true)
      expect(isValidAskCode('ASK-1000')).toBe(true)
    })

    it('拒绝不合法编码', () => {
      expect(isValidAskCode('ASK-12')).toBe(false)  // 不足 3 位
      expect(isValidAskCode('BAD-001')).toBe(false)
      expect(isValidAskCode('ask-001')).toBe(false)  // 大小写
      expect(isValidAskCode('ASK-')).toBe(false)
      expect(isValidAskCode('ASK-abc')).toBe(false)
      expect(isValidAskCode('')).toBe(false)
    })
  })

  describe('parseAskCode', () => {
    it('从合法编码提取序号', () => {
      expect(parseAskCode('ASK-001')).toBe(1)
      expect(parseAskCode('ASK-042')).toBe(42)
      expect(parseAskCode('ASK-1000')).toBe(1000)
    })

    it('不合法编码抛出错误', () => {
      expect(() => parseAskCode('ASK-12')).toThrow()
      expect(() => parseAskCode('BAD-001')).toThrow()
    })

    it('round-trip 一致性', () => {
      for (const idx of [1, 5, 42, 999, 1000]) {
        const code = generateAskCode(idx)
        expect(parseAskCode(code)).toBe(idx)
      }
    })
  })
})

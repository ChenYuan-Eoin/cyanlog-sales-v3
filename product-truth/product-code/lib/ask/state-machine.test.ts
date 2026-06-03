// lib/ask/state-machine.test.ts
// REQ: F005 ASK v2 - 状态机单元测试
// Feature Packet: F005-contract-ASK-upgrade.md v2

import { describe, it, expect } from 'vitest'
import { canTransition, checkReportGate } from './state-machine'

describe('ASK v2 状态机转换', () => {
  describe('canTransition', () => {
    it('pending → responded (录入回应)', () => {
      const result = canTransition('pending', 'respond')
      expect(result.allowed).toBe(true)
      expect(result.toStatus).toBe('responded')
    })

    it('pending → closed (法务关闭)', () => {
      const result = canTransition('pending', 'close')
      expect(result.allowed).toBe(true)
      expect(result.toStatus).toBe('closed')
    })

    it('responded → pending (法务重开)', () => {
      const result = canTransition('responded', 'reopen')
      expect(result.allowed).toBe(true)
      expect(result.toStatus).toBe('pending')
    })

    it('closed → pending (法务重开)', () => {
      const result = canTransition('closed', 'reopen')
      expect(result.allowed).toBe(true)
      expect(result.toStatus).toBe('pending')
    })

    it('responded → responded 拒绝（已回应不能再回应）', () => {
      const result = canTransition('responded', 'respond')
      expect(result.allowed).toBe(false)
      expect(result.error).toContain('Invalid transition')
    })

    it('closed → closed 拒绝', () => {
      const result = canTransition('closed', 'close')
      expect(result.allowed).toBe(false)
    })

    it('closed → responded 拒绝（必须先 reopen）', () => {
      const result = canTransition('closed', 'respond')
      expect(result.allowed).toBe(false)
    })
  })

  describe('checkReportGate（硬关单）', () => {
    it('无 ASK 时可生成报告', () => {
      const result = checkReportGate([])
      expect(result.canGenerate).toBe(true)
      expect(result.pendingCount).toBe(0)
      expect(result.totalCount).toBe(0)
    })

    it('所有 ASK 已回应时可生成', () => {
      const result = checkReportGate([
        { status: 'responded' },
        { status: 'responded' },
        { status: 'closed' },
      ])
      expect(result.canGenerate).toBe(true)
      expect(result.totalCount).toBe(3)
      expect(result.pendingCount).toBe(0)
    })

    it('存在 pending 时拒绝生成（硬关单）', () => {
      const result = checkReportGate([
        { status: 'responded' },
        { status: 'pending' }, // ← 阻塞
        { status: 'closed' },
      ])
      expect(result.canGenerate).toBe(false)
      expect(result.pendingCount).toBe(1)
    })

    it('所有 ASK 都 pending 时拒绝', () => {
      const result = checkReportGate([
        { status: 'pending' },
        { status: 'pending' },
      ])
      expect(result.canGenerate).toBe(false)
      expect(result.pendingCount).toBe(2)
    })
  })
})

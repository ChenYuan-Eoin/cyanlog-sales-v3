// 业务地图数据源单元测试
// 验证：模块数、链路数、状态机数、字段完整性

import { describe, it, expect } from 'vitest'
import { modules, links, stateMachines, entryRules } from './data'

describe('Business Map Data Source', () => {
  describe('modules', () => {
    it('包含 6 个核心模块', () => {
      expect(modules).toHaveLength(6)
    })

    it('每个模块都有必要字段', () => {
      modules.forEach((m) => {
        expect(m.id).toBeTruthy()
        expect(m.name).toBeTruthy()
        expect(m.href).toMatch(/^\//)
        expect(['current', 'phase2']).toContain(m.phase)
        expect(m.description).toBeTruthy()
      })
    })

    it('当前阶段模块至少 4 个（Account/报价/合同/配置）', () => {
      const current = modules.filter((m) => m.phase === 'current')
      expect(current.length).toBeGreaterThanOrEqual(4)
    })

    it('Phase 2 模块至少 1 个', () => {
      const phase2 = modules.filter((m) => m.phase === 'phase2')
      expect(phase2.length).toBeGreaterThanOrEqual(1)
    })

    it('每个模块 id 唯一', () => {
      const ids = modules.map((m) => m.id)
      expect(new Set(ids).size).toBe(ids.length)
    })
  })

  describe('links', () => {
    it('包含 2 条核心业务链路', () => {
      expect(links).toHaveLength(2)
    })

    it('链路 A 至少 5 个步骤（主线）', () => {
      const linkA = links.find((l) => l.id === 'link-main')
      expect(linkA).toBeDefined()
      expect(linkA!.steps.length).toBeGreaterThanOrEqual(5)
    })

    it('链路 B 至少 5 个步骤（投标线）', () => {
      const linkB = links.find((l) => l.id === 'link-tender')
      expect(linkB).toBeDefined()
      expect(linkB!.steps.length).toBeGreaterThanOrEqual(5)
    })

    it('每条链路有清晰的起始和结束', () => {
      links.forEach((link) => {
        expect(link.steps[0].label).toBeTruthy()
        expect(link.steps[link.steps.length - 1].label).toBeTruthy()
      })
    })
  })

  describe('stateMachines', () => {
    it('包含 3 个核心对象状态机', () => {
      expect(stateMachines).toHaveLength(3)
    })

    it('状态机的所有 transition 引用已知状态', () => {
      stateMachines.forEach((sm) => {
        sm.transitions.forEach((t) => {
          expect(sm.states).toContain(t.from)
          expect(sm.states).toContain(t.to)
        })
      })
    })

    it('每个状态至少有一个出向 transition', () => {
      // 终态：成功/失败类状态不会有出向
      const terminalStates = [
        'REJECTED', 'CONFIRMED', 'COMPLETED', 'FAILED', 'TIMEOUT',
        'APPROVED', 'TRANSFERRED', // 审批通过和转交也是终态
      ]
      stateMachines.forEach((sm) => {
        sm.states.forEach((state) => {
          if (terminalStates.includes(state)) return
          const out = sm.transitions.filter((t) => t.from === state)
          expect(out.length, `状态 ${state} in ${sm.id} 没有出向 transition`).toBeGreaterThan(0)
        })
      })
    })

    it('状态机 id 唯一', () => {
      const ids = stateMachines.map((sm) => sm.id)
      expect(new Set(ids).size).toBe(ids.length)
    })
  })

  describe('entryRules', () => {
    it('至少 3 条规则', () => {
      expect(entryRules.length).toBeGreaterThanOrEqual(3)
    })

    it('每条规则有标题和说明', () => {
      entryRules.forEach((r) => {
        expect(r.title).toBeTruthy()
        expect(r.description).toBeTruthy()
      })
    })
  })
})

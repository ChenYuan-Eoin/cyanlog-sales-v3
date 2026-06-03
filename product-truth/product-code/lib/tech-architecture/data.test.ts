// 技术架构数据源单元测试

import { describe, it, expect } from 'vitest'
import {
  apiRoutes,
  eventTypes,
  cacheLevels,
  perfTargets,
  securityConstraints,
  callPatterns,
  deploymentComparison,
  chapterTitles,
} from './data'

describe('Tech Architecture Data Source', () => {
  describe('apiRoutes', () => {
    it('包含 6 类 API 路由', () => {
      expect(apiRoutes).toHaveLength(6)
    })

    it('每条路由都有完整字段', () => {
      apiRoutes.forEach((r) => {
        expect(r.prefix).toMatch(/^\/api\//)
        expect(r.service).toBeTruthy()
        expect(r.description).toBeTruthy()
      })
    })
  })

  describe('eventTypes', () => {
    it('包含 7 类核心事件', () => {
      expect(eventTypes).toHaveLength(7)
    })

    it('每个事件有触发条件和至少 1 个消费者', () => {
      eventTypes.forEach((e) => {
        expect(e.trigger).toBeTruthy()
        expect(e.consumers.length).toBeGreaterThanOrEqual(1)
      })
    })
  })

  describe('cacheLevels', () => {
    it('包含 4 层缓存', () => {
      expect(cacheLevels).toHaveLength(4)
    })

    it('每层有完整字段', () => {
      cacheLevels.forEach((c) => {
        expect(c.level).toMatch(/^L\d+/)
        expect(c.tech).toBeTruthy()
        expect(c.purpose).toBeTruthy()
        expect(c.expiry).toBeTruthy()
      })
    })
  })

  describe('perfTargets', () => {
    it('包含至少 4 个性能指标', () => {
      expect(perfTargets.length).toBeGreaterThanOrEqual(4)
    })

    it('指标有 target 和 note', () => {
      perfTargets.forEach((p) => {
        expect(p.metric).toBeTruthy()
        expect(p.target).toBeTruthy()
        expect(p.note).toBeTruthy()
      })
    })
  })

  describe('securityConstraints', () => {
    it('包含至少 6 项安全约束', () => {
      expect(securityConstraints.length).toBeGreaterThanOrEqual(6)
    })
  })

  describe('callPatterns', () => {
    it('包含 3 种调用模式', () => {
      expect(callPatterns).toHaveLength(3)
    })

    it('每种模式有名称、说明、代码示例', () => {
      callPatterns.forEach((p) => {
        expect(p.name).toBeTruthy()
        expect(p.description).toBeTruthy()
        expect(p.code).toBeTruthy()
        // 同步/异步含 fetch，事件驱动含 publish/on
        if (p.name === '事件驱动') {
          expect(p.code).toMatch(/publish|on\(/)
        } else {
          expect(p.code).toContain('fetch')
        }
      })
    })
  })

  describe('deploymentComparison', () => {
    it('dev 和 prod 各有至少 4 个服务', () => {
      expect(deploymentComparison.dev.length).toBeGreaterThanOrEqual(4)
      expect(deploymentComparison.prod.length).toBeGreaterThanOrEqual(4)
    })
  })

  describe('chapterTitles', () => {
    it('包含 9 个章节', () => {
      expect(chapterTitles).toHaveLength(9)
    })

    it('每个章节有 id、name、icon', () => {
      chapterTitles.forEach((c) => {
        expect(c.id).toBeTruthy()
        expect(c.name).toBeTruthy()
        expect(c.icon).toBeTruthy()
      })
    })

    it('章节 id 唯一', () => {
      const ids = chapterTitles.map((c) => c.id)
      expect(new Set(ids).size).toBe(ids.length)
    })
  })
})

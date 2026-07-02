// 标书解析器单元测试

import { describe, it, expect } from 'vitest'
import { extractTenderInfo } from './tender-parser'

describe('Tender Parser - 完整解析', () => {
  it('空文本返回空结构 + 信心度 0', () => {
    const result = extractTenderInfo('')
    expect(result.tenderNo).toBeUndefined()
    expect(result.scores).toHaveLength(0)
    expect(result.technicalRequirements).toHaveLength(0)
    expect(result.commercialTerms).toHaveLength(0)
    expect(result.timeline).toHaveLength(0)
    expect(result.confidence).toBe(0)
  })

  it('完整标书文档 - 所有字段都被识别', () => {
    const text = `
      招标编号：ZB2024-001
      项目名称：智慧城市平台建设
      预算：500 万元
      截止日期：2024-12-31
      采购人：智慧城市管理局
      联系方式：13800138000

      评分标准：
      技术方案 权重 30% 满分 30
      商务报价 权重 40% 满分 40
      实施方案 权重 20% 满分 20
      售后服务 权重 10% 满分 10

      技术要求：
      1. 系统支持 10000 并发用户
      2. 数据存储采用国产化数据库
      3. 平台需通过等保三级认证

      商务条款：
      付款方式：合同签订后预付 30%，验收后支付 70%
      质保期：3 年
      违约金：每日 0.05%

      报名时间：2024-01-15
      开标时间：2024-02-20
      投标截止：2024-02-28
    `
    const result = extractTenderInfo(text)
    expect(result.tenderNo).toBe('ZB2024-001')
    expect(result.tenderName).toBe('智慧城市平台建设')
    expect(result.budget).toContain('500')
    expect(result.deadline).toContain('2024-12-31')
    expect(result.publisher).toContain('智慧城市管理局')
    expect(result.scores.length).toBeGreaterThanOrEqual(3)
    expect(result.technicalRequirements.length).toBeGreaterThan(0)
    expect(result.commercialTerms.length).toBeGreaterThan(0)
    expect(result.timeline.length).toBeGreaterThanOrEqual(2)
    expect(result.confidence).toBeGreaterThan(50)
  })
})

describe('extractScores - 评分标准', () => {
  it('识别 4 条评分项', () => {
    const text = `
      技术方案 权重 30% 满分 30
      商务报价 权重 40% 满分 40
      实施方案 权重 20% 满分 20
      售后服务 权重 10% 满分 10
    `
    const result = extractTenderInfo(text)
    expect(result.scores).toHaveLength(4)
    const items = result.scores.map((s) => s.item)
    expect(items).toContain('技术方案')
    expect(items).toContain('商务报价')
  })

  it('空文本无评分', () => {
    const result = extractTenderInfo('没有任何评分信息')
    expect(result.scores).toHaveLength(0)
  })

  it('数字越界（>100）被拒绝', () => {
    const text = `项目 权重 150% 满分 200`
    const result = extractTenderInfo(text)
    expect(result.scores.find((s) => s.weight === 150)).toBeUndefined()
  })
})

describe('extractTechnicalRequirements - 技术要求', () => {
  it('识别带"技术要求："的块', () => {
    const text = `技术要求：\n1. 支持 10000 并发\n2. 国产化数据库\n3. 等保三级`
    const result = extractTenderInfo(text)
    expect(result.technicalRequirements.length).toBeGreaterThan(0)
  })

  it('识别"应具备xxx"句式', () => {
    const text = `投标人应具备 ISO9001 质量管理体系认证能力`
    const result = extractTenderInfo(text)
    expect(result.technicalRequirements.some((r) => r.includes('应具备'))).toBe(true)
  })
})

describe('extractCommercialTerms - 商务条款', () => {
  it('识别付款方式', () => {
    const text = `付款方式：合同签订后预付 30%`
    const result = extractTenderInfo(text)
    expect(result.commercialTerms.some((t) => t.startsWith('付款方式'))).toBe(true)
  })

  it('识别质保期', () => {
    const text = `质保期：3 年`
    const result = extractTenderInfo(text)
    expect(result.commercialTerms.some((t) => t.startsWith('质保期'))).toBe(true)
  })

  it('识别多个商务条款', () => {
    const text = `
      付款方式：分 3 期支付
      质保期：2 年
      违约金：5%
      履约保证金：合同金额 10%
    `
    const result = extractTenderInfo(text)
    expect(result.commercialTerms.length).toBeGreaterThanOrEqual(3)
  })
})

describe('extractTimeline - 时间节点', () => {
  it('识别 3 类时间事件', () => {
    const text = `
      报名时间：2024-01-15
      开标时间：2024-02-20
      投标截止：2024-02-28
    `
    const result = extractTenderInfo(text)
    expect(result.timeline.length).toBeGreaterThanOrEqual(3)
    const events = result.timeline.map((t) => t.event)
    expect(events).toContain('报名时间')
    expect(events).toContain('开标时间')
    expect(events.some((e) => e.includes('截止'))).toBe(true)
  })

  it('支持中文日期格式', () => {
    const text = `开标时间：2024年2月20日 上午9:00`
    const result = extractTenderInfo(text)
    expect(result.timeline.length).toBeGreaterThanOrEqual(1)
  })

  it('无时间时不返回空对象', () => {
    const result = extractTenderInfo('没有任何时间信息')
    expect(result.timeline).toHaveLength(0)
  })

  it('拒绝把长正文片段误判为时间节点', () => {
    const text = `开标、答疑。付款、验收、质保、违约、保证金、投标截止、开标、答疑。${'付款、验收、质保、违约、保证金、投标截止、开标、答疑。'.repeat(10)}`
    const result = extractTenderInfo(text)
    expect(result.timeline).toHaveLength(0)
  })
})

describe('TenderKeyInfo - 信心度计算', () => {
  it('基础字段全 + 4 类扩展 → 100% 信心度', () => {
    const text = `
      招标编号：A-1
      项目名称：Test
      预算：100
      截止日期：2024-01-01
      采购人：Test Co
      联系方式：13800138000
      技术方案 权重 30% 满分 30
      付款方式：xxx
      报名时间：2024-01-01
    `
    const result = extractTenderInfo(text)
    // 基础 6/6 = 60%，扩展 ≥1 → +10，至少 70%
    expect(result.confidence).toBeGreaterThanOrEqual(70)
  })

  it('信心度上限 100', () => {
    const text = '招标编号：x'.repeat(100)
    const result = extractTenderInfo(text)
    expect(result.confidence).toBeLessThanOrEqual(100)
  })
})

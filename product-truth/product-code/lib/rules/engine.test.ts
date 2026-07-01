// REQ:F006 - 规则引擎单元测试
import { describe, it, expect } from 'vitest'
import { evaluateFlexibleRule } from './flexible-engine'
import type { FlexibleRule, RuleCategory, RuleType } from './types'

// 直接测试规则引擎核心逻辑（不依赖 Supabase）

interface RuleConfig {
  pattern?: string
  field?: string
  operator?: string
  value?: string | number
}

interface Rule {
  id: string
  name: string
  rule_type: 'structured' | 'semantic'
  risk_level: 'red' | 'yellow' | 'green'
  description?: string
  config?: RuleConfig
}

// 测试用的简化版规则引擎逻辑（与 engine.ts 核心一致）
function executeStructuredRule(
  rule: Rule,
  contractText: string
): { matched: boolean; level: string; title: string; description: string } {
  const config = rule.config || {}
  const pattern = config.pattern
  const field = config.field
  const operator = config.operator
  const value = config.value

  if (!pattern && !field) {
    return {
      matched: false,
      level: rule.risk_level,
      title: rule.name,
      description: rule.description || '',
    }
  }

  let matched = false

  // 正则匹配
  if (pattern) {
    try {
      const regex = new RegExp(pattern, 'i')
      matched = regex.test(contractText)
    } catch {
      return {
        matched: false,
        level: rule.risk_level,
        title: rule.name,
        description: 'Invalid regex pattern',
      }
    }
  }

  // 字段条件匹配
  if (field && operator && value !== undefined) {
    const fieldPattern = new RegExp(`${field}[:：]\\s*(\\d+)`, 'i')
    const match = contractText.match(fieldPattern)

    if (match) {
      const extractedValue = parseFloat(match[1])
      const compareValue = typeof value === 'string' ? parseFloat(value) : value

      switch (operator) {
        case 'gt':
          matched = extractedValue > compareValue
          break
        case 'lt':
          matched = extractedValue < compareValue
          break
        case 'eq':
          matched = extractedValue === compareValue
          break
        case 'contains':
          matched = contractText.includes(String(value))
          break
      }
    }
  }

  return {
    matched,
    level: rule.risk_level,
    title: rule.name,
    description: matched
      ? `检测到匹配: ${pattern || `${field} ${operator} ${value}`}`
      : '未匹配',
  }
}

describe('规则引擎 - 结构化规则', () => {
  describe('正则模式匹配', () => {
    it('应检测到付款方式缺失（正则）', () => {
      const contract = '合同内容：价格 100 万元'
      const rule: Rule = {
        id: 'R1.1',
        name: '付款方式缺失',
        rule_type: 'structured',
        risk_level: 'red',
        config: { pattern: '付款方式|支付方式|付款条款' },
      }

      const result = executeStructuredRule(rule, contract)

      expect(result.matched).toBe(false)
    })

    it('应检测到合同包含付款方式（正则）', () => {
      const contract = '付款方式：银行转账'
      const rule: Rule = {
        id: 'R1.1',
        name: '付款方式缺失',
        rule_type: 'structured',
        risk_level: 'red',
        config: { pattern: '付款方式|支付方式|付款条款' },
      }

      const result = executeStructuredRule(rule, contract)

      expect(result.matched).toBe(true)
    })
  })

  describe('字段条件匹配', () => {
    it('应检测到价格大于阈值', () => {
      const contract = '价格：100万元'
      const rule: Rule = {
        id: 'R2.1',
        name: '价格超过限额',
        rule_type: 'structured',
        risk_level: 'red',
        config: { field: '价格', operator: 'gt', value: '50' },
      }

      const result = executeStructuredRule(rule, contract)

      expect(result.matched).toBe(true)
    })

    it('不应检测到价格小于阈值', () => {
      const contract = '价格：30万元'
      const rule: Rule = {
        id: 'R2.1',
        name: '价格超过限额',
        rule_type: 'structured',
        risk_level: 'red',
        config: { field: '价格', operator: 'gt', value: '50' },
      }

      const result = executeStructuredRule(rule, contract)

      expect(result.matched).toBe(false)
    })

    it('应检测到价格等于阈值', () => {
      const contract = '价格：100万元'
      const rule: Rule = {
        id: 'R3.1',
        name: '价格等于阈值',
        rule_type: 'structured',
        risk_level: 'yellow',
        config: { field: '价格', operator: 'eq', value: '100' },
      }

      const result = executeStructuredRule(rule, contract)

      expect(result.matched).toBe(true)
    })
  })

  describe('空规则处理', () => {
    it('空规则应返回不匹配', () => {
      const contract = '任意合同内容'
      const rule: Rule = {
        id: 'R9.9',
        name: '空规则',
        rule_type: 'structured',
        risk_level: 'green',
      }

      const result = executeStructuredRule(rule, contract)

      expect(result.matched).toBe(false)
    })
  })

  describe('风险等级传递', () => {
    it('应正确传递 red 风险等级', () => {
      const rule: Rule = {
        id: 'R1',
        name: '测试',
        rule_type: 'structured',
        risk_level: 'red',
        config: { pattern: '测试' },
      }

      const result = executeStructuredRule(rule, '测试内容')

      expect(result.level).toBe('red')
    })

    it('应正确传递 yellow 风险等级', () => {
      const rule: Rule = {
        id: 'R2',
        name: '测试',
        rule_type: 'structured',
        risk_level: 'yellow',
        config: { pattern: '测试' },
      }

      const result = executeStructuredRule(rule, '测试内容')

      expect(result.level).toBe('yellow')
    })

    it('应正确传递 green 风险等级', () => {
      const rule: Rule = {
        id: 'R3',
        name: '测试',
        rule_type: 'structured',
        risk_level: 'green',
        config: { pattern: '测试' },
      }

      const result = executeStructuredRule(rule, '测试内容')

      expect(result.level).toBe('green')
    })
  })
})

function makeFlexibleRule(overrides: Partial<FlexibleRule>): FlexibleRule {
  return {
    id: overrides.id || overrides.code || 'rule-id',
    org_id: 'org-1',
    code: overrides.code || 'R000',
    name: overrides.name || '测试规则',
    description: overrides.description ?? null,
    category: (overrides.category || 'text') as RuleCategory,
    engine_type: (overrides.engine_type || 'structured') as RuleType,
    target_field: overrides.target_field,
    clause_category: overrides.clause_category,
    field_hints: overrides.field_hints || [],
    semantic_prompt: overrides.semantic_prompt,
    applicable_scenarios: [],
    scope: 'org',
    level_a: {
      operator: '<=',
      threshold: 30,
      unit: 'percent',
      action: 'auto_approve',
    },
    level_b: {
      operator: '>',
      threshold: 30,
      unit: 'percent',
      action: 'suggest_counterparty',
      counterparty: '法务复核',
    },
    level_c: {
      operator: '>',
      threshold: 60,
      unit: 'percent',
      action: 'block',
      message: '红线风险',
    },
    approval_roles: [],
    version: 1,
    priority: 100,
    is_active: true,
    created_by: 'u1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('柔性规则引擎 - 合同审核事实判定', () => {
  it('R001 付款节奏不应把服务费 6% 误判为首付款比例', () => {
    const rule = makeFlexibleRule({
      code: 'R001',
      name: '付款节奏',
      category: 'ratio',
      engine_type: 'hybrid',
      target_field: 'payment_schedule',
      clause_category: 'payment',
      field_hints: ['首期', '首付款', '预付款', '付款节奏'],
    })

    const result = evaluateFlexibleRule(rule, '服务费率为合同总价的 6%，甲方应在验收后 30 个工作日内支付。')

    expect(result.risk_label).toBe('white')
    expect(result.matched).toBe(false)
  })

  it('R001 付款节奏只在首付款上下文中提取比例', () => {
    const rule = makeFlexibleRule({
      code: 'R001',
      name: '付款节奏',
      category: 'ratio',
      engine_type: 'hybrid',
      target_field: 'payment_schedule',
      clause_category: 'payment',
      field_hints: ['首期', '首付款', '预付款', '付款节奏'],
      level_a: {
        operator: '>=',
        threshold: 30,
        unit: 'percent',
        action: 'auto_accept',
      },
      level_b: {
        operator: '>=',
        threshold: 15,
        unit: 'percent',
        action: 'negotiate_with_counterparty',
      },
      level_c: {
        operator: '<',
        threshold: 15,
        unit: 'percent',
        action: 'block_or_escalate',
      },
    })

    const result = evaluateFlexibleRule(rule, '付款节奏：首付款 10%，验收合格后支付尾款 90%。')

    expect(result.risk_label).toBe('red')
    expect(result.level).toBe('C')
    expect(result.source).toContain('首付款 10%')
  })

  it('R009 保密期不应复用合同期限数值', () => {
    const rule = makeFlexibleRule({
      code: 'R009',
      name: '保密期',
      category: 'duration',
      engine_type: 'hybrid',
      target_field: 'confidentiality_years',
      clause_category: 'confidentiality',
      field_hints: ['保密期', '保密义务', '永久'],
    })

    const result = evaluateFlexibleRule(rule, '合同期限为 5 年，未单独约定保密期。')

    expect(result.risk_label).toBe('white')
    expect(result.matched).toBe(false)
  })

  it('R009 保密期能识别永久保密为红线', () => {
    const rule = makeFlexibleRule({
      code: 'R009',
      name: '保密期',
      category: 'duration',
      engine_type: 'hybrid',
      target_field: 'confidentiality_years',
      clause_category: 'confidentiality',
      field_hints: ['保密期', '保密义务', '永久'],
      level_a: {
        operator: '<=',
        threshold: 2555,
        unit: 'day',
        action: 'auto_accept',
      },
      level_b: {
        operator: '<=',
        threshold: 3650,
        unit: 'day',
        action: 'negotiate_with_counterparty',
      },
      level_c: {
        operator: '>',
        threshold: 3650,
        unit: 'day',
        action: 'block_or_escalate',
      },
    })

    const result = evaluateFlexibleRule(rule, '双方同意保密义务永久有效。')

    expect(result.risk_label).toBe('red')
    expect(result.level).toBe('C')
    expect(result.source).toContain('永久')
  })

  it('R013 SLA 不应把产品名 ONES 误判为 SLA 命中', () => {
    const rule = makeFlexibleRule({
      code: 'R013',
      name: 'SLA 承诺',
      category: 'enum',
      engine_type: 'hybrid',
      target_field: 'sla_commitment',
      clause_category: 'sla',
      field_hints: ['SLA', '可用性', '99.5%', '7×24', '营业损失'],
      level_c: {
        operator: 'contains',
        threshold: 0,
        unit: 'text',
        action: 'block_or_escalate',
      },
    })

    const result = evaluateFlexibleRule(rule, '乙方为甲方提供 ONES 系统服务，具体功能以订单为准。')

    expect(result.risk_label).toBe('white')
    expect(result.matched).toBe(false)
  })

  it('R013 SLA 能识别高风险服务可用性承诺', () => {
    const rule = makeFlexibleRule({
      code: 'R013',
      name: 'SLA 承诺',
      category: 'enum',
      engine_type: 'hybrid',
      target_field: 'sla_commitment',
      clause_category: 'sla',
      field_hints: ['SLA', '可用性', '99.5%', '7×24', '营业损失'],
      level_c: {
        operator: 'contains',
        threshold: 0,
        unit: 'text',
        action: 'block_or_escalate',
      },
    })

    const result = evaluateFlexibleRule(rule, '乙方承诺系统可用性不低于 99.9%，并承担甲方营业损失。')

    expect(result.risk_label).toBe('red')
    expect(result.level).toBe('C')
    expect(result.source).toContain('可用性')
  })
})

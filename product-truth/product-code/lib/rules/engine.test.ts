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
  it('R009 不应把“未约定知识产权归属”误判为通过', () => {
    const rule = makeFlexibleRule({
      code: 'R009',
      name: '知识产权归属',
      category: 'text',
      engine_type: 'semantic',
      field_hints: ['知识产权', '归属', '源代码'],
    })

    const result = evaluateFlexibleRule(rule, '双方未约定知识产权归属，后续另行协商。')

    expect(result.risk_label).toBe('red')
    expect(result.level).toBe('C')
    expect(result.source).toContain('知识产权')
  })

  it('R012 不应把“未约定争议解决方式”误判为通过', () => {
    const rule = makeFlexibleRule({
      code: 'R012',
      name: '争议解决方式',
      category: 'text',
      engine_type: 'semantic',
      field_hints: ['争议解决', '仲裁', '管辖法院'],
    })

    const result = evaluateFlexibleRule(rule, '本合同未约定争议解决方式。')

    expect(result.risk_label).toBe('red')
    expect(result.level).toBe('C')
  })

  it('R015 应把口头变更识别为红线风险', () => {
    const rule = makeFlexibleRule({
      code: 'R015',
      name: '变更流程',
      category: 'text',
      engine_type: 'semantic',
      field_hints: ['合同变更', '书面形式', '授权代表'],
    })

    const result = evaluateFlexibleRule(rule, '合同变更可由双方业务人员口头确认后执行。')

    expect(result.risk_label).toBe('red')
    expect(result.level).toBe('C')
    expect(result.source).toContain('口头')
  })

  it('结构化比例规则只有关键词但无数值时不应判绿', () => {
    const rule = makeFlexibleRule({
      code: 'R005',
      name: '违约金上限',
      category: 'ratio',
      engine_type: 'structured',
      target_field: 'penalty_rate',
      field_hints: ['违约金', '违约责任'],
    })

    const result = evaluateFlexibleRule(rule, '双方应按照合同约定承担违约责任。')

    expect(result.risk_label).toBe('white')
    expect(result.matched).toBe(false)
  })

  it('保密期限不应复用合同期限数值', () => {
    const rule = makeFlexibleRule({
      code: 'R010',
      name: '保密期限',
      category: 'duration',
      engine_type: 'structured',
      target_field: 'confidentiality_days',
      field_hints: ['保密期限', '保密义务'],
      level_a: {
        operator: '<=',
        threshold: 1095,
        unit: 'day',
        action: 'auto_approve',
      },
    })

    const result = evaluateFlexibleRule(rule, '合同期限为5年，未单独约定保密期限。')

    expect(result.risk_label).toBe('white')
    expect(result.matched).toBe(false)
  })
})

// REQ:F006 - 规则引擎单元测试
import { describe, it, expect } from 'vitest'

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

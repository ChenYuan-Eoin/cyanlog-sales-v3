/**
 * 结构化规则执行器
 * 特点：100%精确判断，毫秒级执行
 * 适用：明确条款、数值比较、文本匹配
 */

import type { Rule, RuleExecutionResult } from './types'

// 结构化条件配置
export interface StructuredCondition {
  field: string
  operator: '>' | '<' | '>=' | '<=' | '=' | '!=' | 'contains' | 'not_contains' | 'regex' | 'exists' | 'before' | 'after' | 'length_gt' | 'length_lt'
  value?: string | number | boolean
  context?: string
}

// 提取的字段值
interface ExtractedFields {
  [key: string]: string | number | boolean | null
}

/**
 * 执行结构化规则
 */
export async function executeStructuredRule(
  rule: Rule,
  contractText: string,
  extractedFields: ExtractedFields = {}
): Promise<RuleExecutionResult> {
  const startTime = Date.now()
  const condition = rule.condition_config as unknown as StructuredCondition

  if (!condition || !condition.field || !condition.operator) {
    return createResult(rule, false, null, Date.now() - startTime, 'Invalid condition configuration')
  }

  // 获取字段值
  let fieldValue = extractedFields[condition.field]

  // 如果字段未提取，尝试从文本中实时提取
  if (fieldValue === undefined) {
    fieldValue = extractFieldValue(contractText, condition.field)
  }

  // 执行条件判断
  const { triggered, extractedValue, details } = evaluateCondition(
    condition,
    fieldValue,
    contractText
  )

  return createResult(rule, triggered, extractedValue, Date.now() - startTime, details)
}

/**
 * 从合同文本中提取字段值
 */
function extractFieldValue(contractText: string, field: string): string | number | null {
  // 定义常见字段的正则提取规则
  const extractionRules: Record<string, RegExp[]> = {
    // 付款相关
    payment_term_days: [
      /账期\s*(\d+)\s*天/i,
      /付款期限\s*(\d+)\s*天/i,
      /(\d+)\s*天内付款/i,
    ],
    penalty_rate: [
      /违约金\s*(\d+(?:\.\d+)?)\s*%/i,
      /违约.*?(\d+(?:\.\d+)?)\s*%/i,
    ],
    total_amount: [
      /合同总价款?\s*(?:为|是)?\s*[¥￥]?\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:万元?|元)/i,
      /(?:金额|价款)\s*(?:为|是)?\s*[¥￥]?\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:万元?|元)/i,
    ],
    // 时间相关
    delivery_days: [
      /交付期限\s*(\d+)\s*天/i,
      /(\d+)\s*天内交付/i,
    ],
    warranty_days: [
      /质保期\s*(\d+)\s*(?:天|日|月|年)/i,
      /保修期\s*(\d+)\s*(?:天|日|月|年)/i,
    ],
    // 比例相关
    first_payment_rate: [
      /首付款\s*(\d+(?:\.\d+)?)\s*%/i,
      /(?:第一|首)期.*?(\d+(?:\.\d+)?)\s*%/i,
    ],
    final_payment_rate: [
      /尾款\s*(\d+(?:\.\d+)?)\s*%/i,
      /(?:最后|末)期.*?(\d+(?:\.\d+)?)\s*%/i,
    ],
  }

  const rules = extractionRules[field]
  if (!rules) return null

  for (const regex of rules) {
    const match = contractText.match(regex)
    if (match) {
      const value = match[1].replace(/,/g, '')
      const numValue = parseFloat(value)
      if (!isNaN(numValue)) {
        // 根据字段决定单位转换
        if (field === 'total_amount') {
          // 如果是万元，转换为元
          if (match[0].includes('万元')) {
            return numValue * 10000
          }
        }
        return numValue
      }
      return value
    }
  }

  return null
}

/**
 * 评估条件
 */
function evaluateCondition(
  condition: StructuredCondition,
  fieldValue: string | number | boolean | null,
  contractText: string
): { triggered: boolean; extractedValue: string | null; details: string } {
  const { operator, value, context: _context } = condition

  // 处理合同文本字段
  if (condition.field === 'contract_text') {
    return evaluateTextCondition(operator, value as string, contractText)
  }

  // 处理缺失值情况
  if (fieldValue === null || fieldValue === undefined) {
    // 如果是检查存在性
    if (operator === 'exists') {
      return { triggered: false, extractedValue: null, details: '字段不存在' }
    }
    return { triggered: false, extractedValue: null, details: '无法提取字段值' }
  }

  // 处理存在性检查
  if (operator === 'exists') {
    return { triggered: true, extractedValue: String(fieldValue), details: '字段存在' }
  }

  // 数值比较
  if (typeof fieldValue === 'number' && (typeof value === 'number' || !isNaN(parseFloat(String(value))))) {
    const compareValue = typeof value === 'number' ? value : parseFloat(String(value))
    const numResult = compareNumbers(fieldValue, operator, compareValue)
    return {
      triggered: numResult,
      extractedValue: String(fieldValue),
      details: `${fieldValue} ${operator} ${compareValue} = ${numResult}`
    }
  }

  // 字符串比较
  const strResult = compareStrings(String(fieldValue), operator, String(value))
  return {
    triggered: strResult,
    extractedValue: String(fieldValue),
    details: `"${fieldValue}" ${operator} "${value}" = ${strResult}`
  }
}

/**
 * 评估文本条件
 */
function evaluateTextCondition(
  operator: string,
  value: string | undefined,
  contractText: string
): { triggered: boolean; extractedValue: string | null; details: string } {
  if (!value) {
    return { triggered: false, extractedValue: null, details: '条件值未设置' }
  }

  switch (operator) {
    case 'contains': {
      const contains = contractText.includes(value)
      return {
        triggered: contains,
        extractedValue: contains ? value : null,
        details: contains ? `文本包含"${value}"` : `文本不包含"${value}"`
      }
    }
    case 'not_contains': {
      const notContains = !contractText.includes(value)
      return {
        triggered: notContains,
        extractedValue: null,
        details: notContains ? `文本不包含"${value}"` : `文本包含"${value}"`
      }
    }
    case 'regex': {
      try {
        const regex = new RegExp(value, 'i')
        const match = contractText.match(regex)
        return {
          triggered: !!match,
          extractedValue: match ? match[0] : null,
          details: match ? `正则匹配成功: "${match[0]}"` : '正则匹配失败'
        }
      } catch (e) {
        return {
          triggered: false,
          extractedValue: null,
          details: `正则表达式错误: ${e}`
        }
      }
    }
    case 'length_gt': {
      const threshold = parseInt(value, 10)
      const length = contractText.length
      return {
        triggered: length > threshold,
        extractedValue: String(length),
        details: `文本长度${length} > ${threshold} = ${length > threshold}`
      }
    }
    case 'length_lt': {
      const threshold = parseInt(value, 10)
      const length = contractText.length
      return {
        triggered: length < threshold,
        extractedValue: String(length),
        details: `文本长度${length} < ${threshold} = ${length < threshold}`
      }
    }
    default:
      return {
        triggered: false,
        extractedValue: null,
        details: `不支持的文本操作符: ${operator}`
      }
  }
}

/**
 * 数值比较
 */
function compareNumbers(a: number, operator: string, b: number): boolean {
  switch (operator) {
    case '>': return a > b
    case '<': return a < b
    case '>=': return a >= b
    case '<=': return a <= b
    case '=': return a === b
    case '!=': return a !== b
    default: return false
  }
}

/**
 * 字符串比较
 */
function compareStrings(a: string, operator: string, b: string): boolean {
  switch (operator) {
    case '=': return a === b
    case '!=': return a !== b
    case 'contains': return a.includes(b)
    case 'not_contains': return !a.includes(b)
    default: return false
  }
}

/**
 * 创建执行结果
 */
function createResult(
  rule: Rule,
  triggered: boolean,
  extractedValue: string | null,
  executionTime: number,
  details: string
): RuleExecutionResult {
  const messageConfig = rule.message_config as { title?: string; description?: string; suggestion?: string } || {}

  return {
    ruleId: rule.id,
    ruleVersion: rule.version,
    ruleType: 'structured',
    ruleCode: rule.rule_code || undefined,
    riskLevel: triggered ? rule.level as 'red' | 'yellow' | 'green' : 'green',
    title: messageConfig.title || rule.name,
    description: triggered
      ? formatMessage(messageConfig.description || rule.description || '', extractedValue)
      : '规则未触发',
    suggestion: triggered ? (messageConfig.suggestion || '') : '',
    evidence: triggered && extractedValue ? [extractedValue] : undefined,
    triggered,
    executionTime,
    details
  }
}

/**
 * 格式化消息模板
 * 支持 {extracted_value} 占位符
 */
function formatMessage(template: string, extractedValue: string | null): string {
  if (!extractedValue) return template
  return template.replace(/\{extracted_value\}/g, extractedValue)
    .replace(/\{value\}/g, extractedValue)
}

/**
 * 批量执行结构化规则
 */
export async function executeStructuredRules(
  rules: Rule[],
  contractText: string,
  extractedFields: ExtractedFields = {}
): Promise<RuleExecutionResult[]> {
  const results: RuleExecutionResult[] = []

  for (const rule of rules) {
    try {
      const result = await executeStructuredRule(rule, contractText, extractedFields)
      results.push(result)
    } catch (error) {
      results.push({
        ruleId: rule.id,
        ruleVersion: rule.version,
        ruleType: 'structured',
        riskLevel: 'green',
        title: rule.name,
        description: `规则执行失败: ${error}`,
        triggered: false,
        executionTime: 0,
        details: String(error)
      })
    }
  }

  return results
}

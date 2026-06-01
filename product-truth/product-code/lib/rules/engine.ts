// REQ:F006
// PURPOSE: Rule engine - execute structured and semantic rules against contract text

import { supabaseAdmin } from '@/lib/supabase'
import type { Rule } from '@/types/rules'

export interface RuleResult {
  ruleId: string
  ruleName: string
  matched: boolean
  level: 'red' | 'yellow' | 'green'
  title: string
  description: string
  suggestion: string
}

export interface AnalysisResults {
  risks: Array<{
    level: 'red' | 'yellow' | 'green'
    title: string
    description: string
    suggestion: string
  }>
  summary: string
  appliedRules: number
  matchedRules: number
}

// 执行所有启用的规则
export async function executeRules(contractText: string): Promise<AnalysisResults> {
  // 获取所有启用的规则
  const { data: rules, error } = await supabaseAdmin
    .from('rules')
    .select('*')
    .eq('enabled', true)
    .order('created_at', { ascending: false })

  if (error || !rules) {
    console.error('Failed to fetch rules:', error)
    return {
      risks: [],
      summary: '规则引擎未能加载规则配置',
      appliedRules: 0,
      matchedRules: 0,
    }
  }

  const results: RuleResult[] = []

  for (const rule of rules) {
    try {
      const result = await executeSingleRule(rule, contractText)
      if (result.matched) {
        results.push(result)
      }
    } catch (err) {
      console.error(`Rule execution failed for ${rule.id}:`, err)
    }
  }

  // 按风险等级排序：red > yellow > green
  const sortedResults = results.sort((a, b) => {
    const levelOrder = { red: 0, yellow: 1, green: 2 }
    return levelOrder[a.level] - levelOrder[b.level]
  })

  // 生成摘要
  const summary = generateSummary(sortedResults)

  return {
    risks: sortedResults.map(r => ({
      level: r.level,
      title: r.title,
      description: r.description,
      suggestion: r.suggestion,
    })),
    summary,
    appliedRules: rules.length,
    matchedRules: results.length,
  }
}

// 执行单条规则
async function executeSingleRule(rule: Rule, contractText: string): Promise<RuleResult> {
  const baseResult: RuleResult = {
    ruleId: rule.id,
    ruleName: rule.name,
    matched: false,
    level: rule.risk_level,
    title: rule.name,
    description: rule.description || '未提供描述',
    suggestion: '请检查相关条款',
  }

  if (rule.rule_type === 'structured') {
    return executeStructuredRule(rule, contractText, baseResult)
  } else {
    return executeSemanticRule(rule, contractText, baseResult)
  }
}

// 执行结构化规则（基于正则/关键字）
function executeStructuredRule(
  rule: Rule,
  contractText: string,
  baseResult: RuleResult
): RuleResult {
  const config = rule.config || {}
  const pattern = config.pattern
  const field = config.field
  const operator = config.operator
  const value = config.value

  // 如果没有配置，直接返回不匹配
  if (!pattern && !field) {
    return { ...baseResult, matched: false }
  }

  let matched = false

  // 正则匹配
  if (pattern) {
    try {
      const regex = new RegExp(pattern, 'i')
      matched = regex.test(contractText)
    } catch {
      console.error(`Invalid regex pattern in rule ${rule.id}:`, pattern)
      return { ...baseResult, matched: false }
    }
  }

  // 字段条件匹配（简化实现）
  if (field && operator && value !== undefined) {
    // 从合同文本中提取字段值（简化处理）
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

  // 生成具体描述
  let description = rule.description || ''
  let suggestion = '请检查相关条款'

  if (matched) {
    if (pattern) {
      description = `检测到匹配模式: ${pattern}`
    }
    if (field && operator && value !== undefined) {
      const operatorText = { gt: '大于', lt: '小于', eq: '等于', contains: '包含' }
      description = `${field} ${operatorText[operator] || operator} ${value}`
    }
    suggestion = getSuggestionByLevel(rule.risk_level)
  }

  return {
    ...baseResult,
    matched,
    description,
    suggestion,
  }
}

// 执行语义规则（基于 AI 分析）
async function executeSemanticRule(
  rule: Rule,
  contractText: string,
  baseResult: RuleResult
): Promise<RuleResult> {
  const config = rule.config || {}
  const prompt = config.prompt

  if (!prompt) {
    return { ...baseResult, matched: false }
  }

  // 模拟语义分析（实际应调用 AI 服务）
  // 简化：检查 prompt 中的关键词是否出现在合同文本中
  const keywords = prompt.split(/\s+/).filter(w => w.length > 2)
  const matchCount = keywords.filter(kw =>
    contractText.toLowerCase().includes(kw.toLowerCase())
  ).length

  const matchRate = keywords.length > 0 ? matchCount / keywords.length : 0
  // 如果匹配率超过 30%，认为触发规则
  const matched = matchRate > 0.3

  return {
    ...baseResult,
    matched,
    description: matched
      ? `语义分析检测到相关问题: ${prompt.substring(0, 50)}...`
      : `未检测到语义规则"${rule.name}"相关问题`,
    suggestion: matched ? getSuggestionByLevel(rule.risk_level) : '无特别建议',
  }
}

// 根据风险等级获取建议
function getSuggestionByLevel(level: 'red' | 'yellow' | 'green'): string {
  switch (level) {
    case 'red':
      return '建议立即修改此条款，风险较高'
    case 'yellow':
      return '建议协商调整此条款'
    case 'green':
      return '可作为参考建议，非强制性'
    default:
      return '请检查相关条款'
  }
}

// 生成审核摘要
function generateSummary(results: RuleResult[]): string {
  if (results.length === 0) {
    return '未发现明显风险，合同条款符合常规标准'
  }

  const redCount = results.filter(r => r.level === 'red').length
  const yellowCount = results.filter(r => r.level === 'yellow').length
  const greenCount = results.filter(r => r.level === 'green').length

  const parts: string[] = []

  if (redCount > 0) {
    parts.push(`发现 ${redCount} 项高风险问题，建议立即处理`)
  }
  if (yellowCount > 0) {
    parts.push(`${yellowCount} 项中风险建议协商调整`)
  }
  if (greenCount > 0) {
    parts.push(`${greenCount} 项低风险提示供参考`)
  }

  return parts.join('；') + '。'
}

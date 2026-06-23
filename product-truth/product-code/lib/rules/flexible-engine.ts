// lib/rules/flexible-engine.ts
// 柔性化规则引擎（F005-derive.md §4）
// 支持 Level A/B/C 3级阈值区间判定
//
// 判定逻辑：
// - Level A (🟢): 通过区间 → auto_approve
// - Level B (🟡): 偏离区间 → suggest_counterparty（带对价建议）
// - Level C (🔴): 红线区间 → block
// - 未匹配: 无判定（可能是不适用的场景）

import { supabaseAdmin } from '@/lib/supabase'
import type {
  FlexibleRule,
  RuleCategory,
  LevelOperator,
  LevelMatchResult,
  RuleExecutionResult,
} from './types'

// ═══════════════════════════════════════════════════════════════
// 1. 规则加载（从 contract_rules_v2 表）
// ═══════════════════════════════════════════════════════════════

export interface LoadRulesOptions {
  orgId: string
  category?: RuleCategory
  scenario?: string              // 按场景过滤（如 'subscription', 'buyout'）
  isActive?: boolean
}

/**
 * 加载柔性化规则（contract_rules_v2）
 */
export async function loadFlexibleRules(
  options: LoadRulesOptions
): Promise<FlexibleRule[]> {
  const { orgId, category, scenario, isActive = true } = options

  let query = supabaseAdmin
    .from('contract_rules_v2')
    .select('*')
    .eq('org_id', orgId)
    .eq('is_active', isActive)
    .order('priority', { ascending: false })

  if (category) {
    query = query.eq('category', category)
  }

  const { data: rules, error } = await query

  if (error) {
    console.error('Failed to load flexible rules:', error)
    return []
  }

  // 按场景过滤（如果指定了场景）
  let filteredRules = rules || []
  if (scenario) {
    filteredRules = filteredRules.filter((r) =>
      r.applicable_scenarios?.includes(scenario) ||
      r.applicable_scenarios?.length === 0 ||
      r.applicable_scenarios?.includes('all')
    )
  }

  return filteredRules.map(parseFlexibleRule)
}

/**
 * 解析数据库规则为 FlexibleRule 对象
 */
function parseFlexibleRule(row: Record<string, unknown>): FlexibleRule {
  return {
    id: row.id as string,
    org_id: row.org_id as string,
    code: row.code as string,
    name: row.name as string,
    description: row.description as string | null,
    category: row.category as RuleCategory,
    applicable_scenarios: (row.applicable_scenarios as string[]) || [],
    scope: (row.scope as 'org' | 'dept' | 'user') || 'org',

    level_a: {
      operator: row.level_a_operator as LevelOperator,
      threshold: Number(row.level_a_threshold) || 0,
      unit: (row.level_a_unit as string) || 'percent',
      action: (row.level_a_action as string) || 'auto_approve',
    },

    level_b: {
      operator: row.level_b_operator as LevelOperator,
      threshold: Number(row.level_b_threshold) || 0,
      unit: (row.level_b_unit as string) || 'percent',
      action: (row.level_b_action as string) || 'suggest_counterparty',
      counterparty: row.level_b_counterparty as string | undefined,
    },

    level_c: {
      operator: row.level_c_operator as LevelOperator,
      threshold: Number(row.level_c_threshold) || 0,
      unit: (row.level_c_unit as string) || 'percent',
      action: (row.level_c_action as string) || 'block',
      message: row.level_c_message as string | undefined,
    },

    approval_roles: (row.approval_roles as string[]) || [],
    script_id: row.script_id as string | undefined,

    version: Number(row.version) || 1,
    priority: Number(row.priority) || 100,
    is_active: row.is_active as boolean,
    created_by: row.created_by as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  }
}

// ═══════════════════════════════════════════════════════════════
// 2. 字段提取器（从合同文本中提取数值）
// ═══════════════════════════════════════════════════════════════

export interface ExtractedField {
  name: string
  value: number
  unit: string
  source: string          // 从哪段文本提取
  confidence: number      // 0-1 置信度
}

/**
 * 根据规则类别提取合同字段
 */
export function extractField(
  contractText: string,
  category: RuleCategory,
  fieldHints?: string[]
): ExtractedField | null {
  const text = contractText.toLowerCase()

  switch (category) {
    case 'ratio':
      return extractRatioField(text, fieldHints)
    case 'amount':
      return extractAmountField(text, fieldHints)
    case 'duration':
      return extractDurationField(text, fieldHints)
    case 'enum':
      return extractEnumField(text, fieldHints)
    case 'text':
      return extractTextField(text, fieldHints)
    default:
      return null
  }
}

/**
 * 提取比例字段（如：首期款比例 30%）
 */
function extractRatioField(
  text: string,
  _hints?: string[]
): ExtractedField | null {
  // 常见比例模式：首期款、尾款、违约金比例等
  const patterns = [
    // 首期款/首付款 XX%
    /(?:首付|首期|定金|预付款)[款金]?[:：]?\s*(\d+(?:\.\d+)?)\s*%/i,
    // 尾款/余款 XX%
    /(?:尾款|余款|结算款)[款金]?[:：]?\s*(\d+(?:\.\d+)?)\s*%/i,
    // 比例 XX%
    /比例[:：]?\s*(\d+(?:\.\d+)?)\s*%/i,
    // XX% 作为首付/尾款
    /(\d+(?:\.\d+)?)\s*%\s*(?:作为|为)?\s*(?:首付|首期|尾款|余款)/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      const value = parseFloat(match[1])
      // 转换为万分比存储（避免浮点精度问题）
      const normalizedValue = Math.round(value * 10000)
      return {
        name: 'ratio',
        value: normalizedValue,
        unit: 'percent',
        source: match[0],
        confidence: 0.9,
      }
    }
  }

  return null
}

/**
 * 提取金额字段（如：合同总额 100万元）
 */
function extractAmountField(
  text: string,
  _hints?: string[]
): ExtractedField | null {
  const patterns = [
    // 合同总额/金额 XX万元/元
    /(?:合同总?额|合同金?额|总价|总金额)[:：]?\s*[￥¥]?\s*(\d+(?:\.\d+)?)\s*(万)?元?/i,
    // 人民币 XX万元
    /人民币\s*[￥¥]?\s*(\d+(?:\.\d+)?)\s*(万)?元?/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      let value = parseFloat(match[1])
      // 如果是"万元"，转换为元
      if (match[2] === '万') {
        value = value * 10000
      }
      return {
        name: 'amount',
        value: Math.round(value),
        unit: 'cny',
        source: match[0],
        confidence: 0.85,
      }
    }
  }

  return null
}

/**
 * 提取时长字段（如：账期 90天）
 */
function extractDurationField(
  text: string,
  _hints?: string[]
): ExtractedField | null {
  const patterns = [
    // XX个工作日/天/月
    /(\d+)\s*(?:个)?\s*(工作日?|自然日?|天|月|年)/i,
    // 账期/付款期限 XX天
    /(?:账期|付款期|期限|周期)[:：]?\s*(\d+)\s*(?:个)?\s*(工作日?|天|月|年)?/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      const value = parseInt(match[1], 10)
      const unit = match[2] || '天'
      // 统一转换为天
      let normalizedValue = value
      if (unit.includes('月')) normalizedValue = value * 30
      if (unit.includes('年')) normalizedValue = value * 365

      return {
        name: 'duration',
        value: normalizedValue,
        unit: 'day',
        source: match[0],
        confidence: 0.8,
      }
    }
  }

  return null
}

/**
 * 提取枚举字段
 */
function extractEnumField(
  text: string,
  hints?: string[]
): ExtractedField | null {
  // 枚举类型通常是匹配特定关键词
  if (hints && hints.length > 0) {
    for (const hint of hints) {
      if (text.includes(hint.toLowerCase())) {
        return {
          name: 'enum',
          value: 1,  // 匹配即命中
          unit: 'match',
          source: hint,
          confidence: 0.95,
        }
      }
    }
  }
  return null
}

/**
 * 提取文本字段（模糊匹配）
 */
function extractTextField(
  text: string,
  hints?: string[]
): ExtractedField | null {
  // 文本类型：检查是否包含特定关键词
  if (hints && hints.length > 0) {
    let matchCount = 0
    for (const hint of hints) {
      if (text.includes(hint.toLowerCase())) {
        matchCount++
      }
    }
    const confidence = matchCount / hints.length
    return {
      name: 'text',
      value: confidence > 0.3 ? 1 : 0,  // 匹配率>30%认为命中
      unit: 'confidence',
      source: hints.join(', '),
      confidence,
    }
  }
  return null
}

// ═══════════════════════════════════════════════════════════════
// 3. Level A/B/C 判定逻辑
// ═══════════════════════════════════════════════════════════════

/**
 * 执行运算符比较
 */
function compare(
  operator: LevelOperator,
  actual: number,
  threshold: number
): boolean {
  switch (operator) {
    case '>=':
      return actual >= threshold
    case '<=':
      return actual <= threshold
    case '>':
      return actual > threshold
    case '<':
      return actual < threshold
    case '=':
      return actual === threshold
    case 'contains':
      // 文本包含检查（简化）
      return actual > 0
    case 'in':
      // 在列表中（简化）
      return actual > 0
    default:
      return false
  }
}

/**
 * 执行单条规则的 Level A/B/C 判定
 *
 * 判定顺序：C -> B -> A（从严格到宽松）
 * - 如果满足 Level C 条件 → 红线（🔴）
 * - 否则如果满足 Level B 条件 → 偏离（🟡）
 * - 否则如果满足 Level A 条件 → 通过（🟢）
 * - 否则 → 未匹配（⚪）
 */
export function evaluateFlexibleRule(
  rule: FlexibleRule,
  contractText: string,
  _extractedFields?: Record<string, number>
): LevelMatchResult {
  // 提取字段值
  const extracted = extractField(contractText, rule.category)
  if (!extracted) {
    return {
      level: null,
      matched: false,
      operator: '=',
      threshold: 0,
      actual_value: 0,
      unit: rule.level_a.unit,
      action: 'auto_approve',
      message: `未能提取到${rule.category}类型字段`,
      risk_label: 'white',
    }
  }

  const actualValue = extracted.value

  // 按优先级判定：C -> B -> A
  // Level C (🔴 红线)
  if (compare(rule.level_c.operator, actualValue, rule.level_c.threshold)) {
    return {
      level: 'C',
      matched: true,
      operator: rule.level_c.operator,
      threshold: rule.level_c.threshold,
      actual_value: actualValue,
      unit: rule.level_c.unit,
      action: rule.level_c.action,
      message: rule.level_c.message || `${rule.name}超出红线标准`,
      risk_label: 'red',
    }
  }

  // Level B (🟡 偏离)
  if (compare(rule.level_b.operator, actualValue, rule.level_b.threshold)) {
    return {
      level: 'B',
      matched: true,
      operator: rule.level_b.operator,
      threshold: rule.level_b.threshold,
      actual_value: actualValue,
      unit: rule.level_b.unit,
      action: rule.level_b.action,
      message: `${rule.name}偏离建议区间`,
      counterparty: rule.level_b.counterparty,
      risk_label: 'yellow',
    }
  }

  // Level A (🟢 通过)
  if (compare(rule.level_a.operator, actualValue, rule.level_a.threshold)) {
    return {
      level: 'A',
      matched: true,
      operator: rule.level_a.operator,
      threshold: rule.level_a.threshold,
      actual_value: actualValue,
      unit: rule.level_a.unit,
      action: rule.level_a.action,
      message: `${rule.name}在合规范围内`,
      risk_label: 'green',
    }
  }

  // 未匹配任何级别（可能是数据异常或规则配置问题）
  return {
    level: null,
    matched: false,
    operator: rule.level_a.operator,
    threshold: rule.level_a.threshold,
    actual_value: actualValue,
    unit: rule.level_a.unit,
    action: 'auto_approve',
    message: `${rule.name}未能匹配任何判定级别`,
    risk_label: 'white',
  }
}

// ═══════════════════════════════════════════════════════════════
// 4. 批量执行与结果转换
// ═══════════════════════════════════════════════════════════════

export interface FlexibleExecutionOptions {
  orgId: string
  scenario?: string              // 场景过滤
  category?: RuleCategory        // 类别过滤
}

/**
 * 执行所有适用规则的判定
 */
export async function executeFlexibleRules(
  contractText: string,
  options: FlexibleExecutionOptions
): Promise<RuleExecutionResult[]> {
  const { orgId, scenario, category } = options

  // 1. 加载规则
  const rules = await loadFlexibleRules({ orgId, scenario, category })

  if (rules.length === 0) {
    return []
  }

  // 2. 执行每条规则的判定
  const results: RuleExecutionResult[] = []

  for (const rule of rules) {
    const startTime = Date.now()
    const levelResult = evaluateFlexibleRule(rule, contractText)

    // 转换为标准 RuleExecutionResult 格式
    const result: RuleExecutionResult = {
      ruleId: rule.id,
      ruleVersion: rule.version,
      ruleType: 'structured',
      ruleCode: rule.code,
      riskLevel: levelResult.risk_label === 'red'
        ? 'red'
        : levelResult.risk_label === 'yellow'
          ? 'yellow'
          : levelResult.risk_label === 'green'
            ? 'green'
            : 'green',
      title: rule.name,
      description: levelResult.message,
      suggestion: levelResult.counterparty
        ? `建议换取：${levelResult.counterparty}`
        : levelResult.level === 'C'
          ? '必须修改合同条款'
          : levelResult.level === 'B'
            ? '建议协商调整'
            : '符合标准',
      triggered: levelResult.matched,
      executionTime: Date.now() - startTime,
      levelResult,
    }

    results.push(result)
  }

  // 3. 按风险等级排序：red > yellow > green
  return results.sort((a, b) => {
    const order = { red: 0, yellow: 1, green: 2 }
    return order[a.riskLevel] - order[b.riskLevel]
  })
}

/**
 * 生成审核摘要
 */
export function generateFlexibleSummary(
  results: RuleExecutionResult[]
): string {
  if (results.length === 0) {
    return '未配置审核规则，建议联系管理员配置'
  }

  const redCount = results.filter((r) => r.riskLevel === 'red').length
  const yellowCount = results.filter((r) => r.riskLevel === 'yellow').length
  const greenCount = results.filter((r) => r.riskLevel === 'green').length
  const triggeredCount = results.filter((r) => r.triggered).length

  const parts: string[] = []

  if (redCount > 0) {
    parts.push(`发现 ${redCount} 项红线问题，必须修改`)
  }
  if (yellowCount > 0) {
    parts.push(`${yellowCount} 项偏离建议区间，可协商换取对价`)
  }
  if (greenCount > 0) {
    parts.push(`${greenCount} 项符合标准`)
  }

  if (triggeredCount === 0) {
    return '所有检查项均符合标准，合同条款合规'
  }

  return parts.join('；') + `。共执行 ${results.length} 条规则。`
}

// ═══════════════════════════════════════════════════════════════
// 5. 导出兼容接口（供 lib/ai/failover.ts 调用）
// ═══════════════════════════════════════════════════════════════

export interface FlexibleAnalysisResults {
  risks: Array<{
    level: 'red' | 'yellow' | 'green'
    title: string
    description: string
    suggestion: string
    counterparty?: string
  }>
  summary: string
  appliedRules: number
  matchedRules: number
  levelBreakdown: {
    A: number  // 通过
    B: number  // 偏离
    C: number  // 红线
    null: number  // 未匹配
  }
}

/**
 * 兼容旧接口 executeRules 的新实现
 */
export async function executeFlexibleRulesCompat(
  contractText: string,
  orgId?: string
): Promise<FlexibleAnalysisResults> {
  if (!orgId) {
    return {
      risks: [],
      summary: '未提供组织ID，无法执行规则判定',
      appliedRules: 0,
      matchedRules: 0,
      levelBreakdown: { A: 0, B: 0, C: 0, null: 0 },
    }
  }

  const results = await executeFlexibleRules(contractText, { orgId })

  const levelBreakdown = {
    A: results.filter((r) => r.levelResult?.level === 'A').length,
    B: results.filter((r) => r.levelResult?.level === 'B').length,
    C: results.filter((r) => r.levelResult?.level === 'C').length,
    null: results.filter((r) => r.levelResult?.level === null).length,
  }

  return {
    risks: results
      .filter((r) => r.triggered)
      .map((r) => ({
        level: r.riskLevel,
        title: r.title,
        description: r.description,
        suggestion: r.suggestion || '',
        counterparty: r.levelResult?.counterparty,
      })),
    summary: generateFlexibleSummary(results),
    appliedRules: results.length,
    matchedRules: results.filter((r) => r.triggered).length,
    levelBreakdown,
  }
}

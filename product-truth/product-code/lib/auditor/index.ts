// lib/auditor/index.ts
// Auditor — 确定性审计引擎（纯后端逻辑，不含 AI）
// Tier 1 & 3: 判定幂等性 — 输入相同要素 + 相同规则，结果必须 100% 相同
//
// 设计原则：
// - AI 提取的原始数据 → Normalizer → 特征向量 → Auditor → 确定性结论
// - 规则读取通过缓存层（Redis），禁止硬编码
// - 规则分类使用 Strategy 模式，新增规则无需修改主引擎
// - 所有判定结果携带"逻辑推导链"（用于审计追踪）

import type { Currency, Ratio, Duration, FeatureVector } from '@/lib/normalizer'
import { compareCurrency, compareRatio, compareDuration } from '@/lib/normalizer'

// ═══════════════════════════════════════════════════════════════
// 1. 类型定义
// ═══════════════════════════════════════════════════════════════

/** 审计结果 */
export interface AuditResult {
  ruleId: string
  ruleCode: string
  ruleName: string
  level: 'A' | 'B' | 'C' // Level A/B/C
  matched: boolean          // 是否命中规则
  riskLabel: 'red' | 'yellow' | 'green' | 'white'  // 🔴🟡🟢
  message: string           // 判定结果描述
  suggestion: string        // 建议操作
  // 逻辑推导链（Tier 3 可观测性）
  chain: AuditChain[]
}

/** 审计推导链 — 每个判定步骤的记录 */
export interface AuditChain {
  step: number
  phase: 'normalize' | 'compare' | 'evaluate'
  description: string
  input: unknown
  output: unknown
  timestamp: string
}

/** 规则定义 — 从数据库加载的标准化规则 */
export interface AuditRule {
  id: string
  code: string          // e.g. "RULE-01-01"
  name: string
  category: 'ratio' | 'amount' | 'duration' | 'enum' | 'text'
  description: string

  // 适用条件
  applicableScenarios: string[]
  scope: 'org' | 'dept' | 'user'

  // Level A/B/C 阈值
  levelA: {             // 🟢 通过
    operator: '>=' | '<=' | '=' | '>' | '<'
    threshold: Ratio | Currency | Duration | string
    action: 'auto_approve'
  }
  levelB: {             // 🟡 偏离
    operator: '>=' | '<=' | '=' | '>' | '<'
    threshold: Ratio | Currency | Duration | string
    action: 'suggest_counterparty'
    counterparty?: string  // 建议换取的对价
  }
  levelC: {             // 🔴 红线
    operator: '>=' | '<=' | '=' | '>' | '<'
    threshold: Ratio | Currency | Duration | string
    action: 'block'
    message: string
  }

  // 元数据
  priority: number      // 优先级（用于排序）
  version: number       // 规则版本
  createdAt: string
  updatedAt: string
}

// ═══════════════════════════════════════════════════════════════
// 2. 策略模式 — 不同类别的规则使用不同的判定策略
// ═══════════════════════════════════════════════════════════════

interface AuditStrategy {
  evaluate(feature: FeatureVector, rule: AuditRule): AuditResult
}

/** 金额类策略 */
class AmountStrategy implements AuditStrategy {
  evaluate(feature: FeatureVector, rule: AuditRule): AuditResult {
    const chains: AuditChain[] = []
    const amount = feature.totalAmount

    if (!amount) {
      return this.createResult(rule, 'white', false, '合同金额未提取', chains)
    }

    // 比较金额与 Level C 阈值
    const levelCThreshold = rule.levelC.threshold as Currency
    const compareResult = compareCurrency(amount, levelCThreshold)

    chains.push({
      step: 1,
      phase: 'compare',
      description: `比较合同金额 ${amount.cents} 分 vs Level C 阈值 ${levelCThreshold.cents} 分`,
      input: { amount: amount.cents, threshold: levelCThreshold.cents },
      output: { compareResult },
      timestamp: new Date().toISOString(),
    })

    if (compareResult < 0) {
      return this.createResult(rule, 'red', true, rule.levelC.message, chains)
    }

    // 比较金额与 Level B 阈值
    const levelBThreshold = rule.levelB.threshold as Currency
    const bCompare = compareCurrency(amount, levelBThreshold)

    chains.push({
      step: 2,
      phase: 'compare',
      description: `比较合同金额 ${amount.cents} 分 vs Level B 阈值 ${levelBThreshold.cents} 分`,
      input: { amount: amount.cents, threshold: levelBThreshold.cents },
      output: { compareResult: bCompare },
      timestamp: new Date().toISOString(),
    })

    if (bCompare < 0) {
      return this.createResult(rule, 'yellow', true, `金额偏离建议区间：${rule.levelB.counterparty || '建议协商'}`, chains)
    }

    // Level A — 通过
    return this.createResult(rule, 'green', true, '金额在合规范围内', chains)
  }

  private createResult(rule: AuditRule, riskLabel: 'red' | 'yellow' | 'green' | 'white', matched: boolean, message: string, chain: AuditChain[]): AuditResult {
    const levelMap: Record<string, 'A' | 'B' | 'C'> = {
      green: 'A',
      yellow: 'B',
      red: 'C',
      white: 'A',
    }
    return {
      ruleId: rule.id,
      ruleCode: rule.code,
      ruleName: rule.name,
      level: levelMap[riskLabel] || 'A',
      matched,
      riskLabel,
      message,
      suggestion: matched ? '请根据建议处理' : '无风险',
      chain,
    }
  }
}

/** 比例类策略 */
class RatioStrategy implements AuditStrategy {
  evaluate(feature: FeatureVector, rule: AuditRule): AuditResult {
    const chains: AuditChain[] = []
    const ratio = feature.depositRatio

    if (!ratio) {
      return this.createResult(rule, 'white', false, '比例未提取', chains)
    }

    const levelCThreshold = rule.levelC.threshold as Ratio
    const compareResult = compareRatio(ratio, levelCThreshold)

    chains.push({
      step: 1,
      phase: 'compare',
      description: `比较比例 ${ratio.numerator}/${ratio.denominator} vs Level C`,
      input: { ratio, threshold: levelCThreshold },
      output: { compareResult },
      timestamp: new Date().toISOString(),
    })

    if (compareResult < 0) {
      return this.createResult(rule, 'red', true, rule.levelC.message, chains)
    }

    const levelBThreshold = rule.levelB.threshold as Ratio
    const bCompare = compareRatio(ratio, levelBThreshold)

    if (bCompare < 0) {
      return this.createResult(rule, 'yellow', true, `比例偏离建议区间：${rule.levelB.counterparty || '建议协商'}`, chains)
    }

    return this.createResult(rule, 'green', true, '比例在合规范围内', chains)
  }

  private createResult(rule: AuditRule, riskLabel: 'red' | 'yellow' | 'green' | 'white', matched: boolean, message: string, chain: AuditChain[]): AuditResult {
    return {
      ruleId: rule.id,
      ruleCode: rule.code,
      ruleName: rule.name,
      level: riskLabel === 'red' ? 'C' : riskLabel === 'yellow' ? 'B' : 'A',
      matched,
      riskLabel,
      message,
      suggestion: matched ? '请根据建议处理' : '无风险',
      chain: [...chain],
    }
  }
}

/** 时限类策略 */
class DurationStrategy implements AuditStrategy {
  evaluate(feature: FeatureVector, rule: AuditRule): AuditResult {
    const chains: AuditChain[] = []
    const term = feature.contractTerm

    if (!term) {
      return this.createResult(rule, 'white', false, '时限未提取', chains)
    }

    const levelCThreshold = rule.levelC.threshold as Duration
    const compareResult = compareDuration(term, levelCThreshold)

    chains.push({
      step: 1,
      phase: 'compare',
      description: `比较时限 ${term.value} vs Level C`,
      input: { term, threshold: levelCThreshold },
      output: { compareResult },
      timestamp: new Date().toISOString(),
    })

    if (compareResult > 0) {
      return this.createResult(rule, 'red', true, rule.levelC.message, chains)
    }

    const levelBThreshold = rule.levelB.threshold as Duration
    const bCompare = compareDuration(term, levelBThreshold)

    if (bCompare > 0) {
      return this.createResult(rule, 'yellow', true, `时限偏离建议区间：${rule.levelB.counterparty || '建议协商'}`, chains)
    }

    return this.createResult(rule, 'green', true, '时限在合规范围内', chains)
  }

  private createResult(rule: AuditRule, riskLabel: 'red' | 'yellow' | 'green' | 'white', matched: boolean, message: string, chain: AuditChain[]): AuditResult {
    return {
      ruleId: rule.id,
      ruleCode: rule.code,
      ruleName: rule.name,
      level: riskLabel === 'red' ? 'C' : riskLabel === 'yellow' ? 'B' : 'A',
      matched,
      riskLabel,
      message,
      suggestion: matched ? '请根据建议处理' : '无风险',
      chain: [...chain],
    }
  }
}

/** 枚举/文本类策略（简化版） */
class EnumStrategy implements AuditStrategy {
  evaluate(feature: FeatureVector, rule: AuditRule): AuditResult {
    const chains: AuditChain[] = []
    // 简化：文本匹配
    return {
      ruleId: rule.id,
      ruleCode: rule.code,
      ruleName: rule.name,
      level: 'A',
      matched: false,
      riskLabel: 'green',
      message: '文本类规则暂为占位',
      suggestion: '需人工审核',
      chain: chains,
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 3. 策略工厂 — 根据规则类别选择对应的策略
// ═══════════════════════════════════════════════════════════════

class StrategyFactory {
  private strategies: Map<string, AuditStrategy>

  constructor() {
    this.strategies = new Map()
    this.register('amount', new AmountStrategy())
    this.register('ratio', new RatioStrategy())
    this.register('duration', new DurationStrategy())
    this.register('enum', new EnumStrategy())
    this.register('text', new EnumStrategy())
  }

  register(category: string, strategy: AuditStrategy) {
    this.strategies.set(category, strategy)
  }

  get(category: string): AuditStrategy | undefined {
    return this.strategies.get(category)
  }
}

const strategyFactory = new StrategyFactory()

// ═══════════════════════════════════════════════════════════════
// 4. 审计引擎主入口
// ═══════════════════════════════════════════════════════════════

export interface AuditOptions {
  orgId: string
  onlyStructured?: boolean
  onProgress?: (phase: string, completed: number, total: number) => void
}

/** 审计引擎 — 确定性计算，幂等输出 */
export async function audit(
  featureVector: FeatureVector,
  rules: AuditRule[],
  options?: AuditOptions
): Promise<AuditResult[]> {
  const results: AuditResult[] = []
  const total = rules.length

  for (let i = 0; i < total; i++) {
    const rule = rules[i]
    options?.onProgress?.('auditing', i + 1, total)

    // 获取对应的策略
    const strategy = strategyFactory.get(rule.category)
    if (!strategy) {
      // 未知类别，跳过
      continue
    }

    // 执行判定
    const result = strategy.evaluate(featureVector, rule)
    results.push(result)
  }

  // 按风险等级排序
  const levelOrder = { red: 0, yellow: 1, green: 2, white: 3 }
  return results.sort((a, b) => levelOrder[a.riskLabel] - levelOrder[b.riskLabel])
}

/** 审计摘要生成 */
export function generateAuditSummary(results: AuditResult[]): {
  summary: string
  counts: { red: number; yellow: number; green: number; white: number }
} {
  const counts = {
    red: results.filter((r) => r.riskLabel === 'red').length,
    yellow: results.filter((r) => r.riskLabel === 'yellow').length,
    green: results.filter((r) => r.riskLabel === 'green').length,
    white: results.filter((r) => r.riskLabel === 'white').length,
  }

  const parts: string[] = []
  if (counts.red > 0) parts.push(`发现 ${counts.red} 项高风险，建议立即处理`)
  if (counts.yellow > 0) parts.push(`${counts.yellow} 项中风险建议协商调整`)
  if (counts.green > 0) parts.push(`${counts.green} 项通过`)

  return {
    summary: parts.length > 0 ? parts.join('；') + '。' : '未发现风险。',
    counts,
  }
}

/** 从数据库加载规则（通过缓存层） */
export async function loadRules(orgId: string): Promise<AuditRule[]> {
  // TODO: 从缓存层（Redis）加载规则快照
  // 如果缓存不存在，从数据库加载
  const { supabaseAdmin } = await import('@/lib/supabase')
  const { data: rules, error } = await supabaseAdmin
    .from('contract_rules')
    .select('*')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .order('priority', { ascending: false })

  if (error) {
    throw new Error(`加载规则失败: ${error.message}`)
  }

  return (rules || []).map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    category: r.category,
    description: r.description,
    applicableScenarios: r.applicable_scenarios || [],
    scope: r.scope || 'org',
    levelA: r.level_a,
    levelB: r.level_b,
    levelC: r.level_c,
    priority: r.priority,
    version: r.version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }))
}

// 重新导出
export type { AuditStrategy }

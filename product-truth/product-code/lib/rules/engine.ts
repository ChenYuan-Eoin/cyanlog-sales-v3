// REQ:F006
// PURPOSE: Rule engine - 统一入口，调用柔性化规则引擎 (F005-derive.md §4)
// 注意：旧表 (rules/contract_rules) 已废弃，统一使用 contract_rules_v2

import {
  executeFlexibleRules,
  executeFlexibleRulesCompat,
  generateFlexibleSummary,
  loadFlexibleRules,
  evaluateFlexibleRule,
  extractField,
  type FlexibleAnalysisResults,
  type LoadRulesOptions,
} from './flexible-engine'

export type { FlexibleAnalysisResults, LoadRulesOptions }
export {
  executeFlexibleRules,
  executeFlexibleRulesCompat,
  loadFlexibleRules,
  evaluateFlexibleRule,
  extractField,
  generateFlexibleSummary,
}

// ═══════════════════════════════════════════════════════════════
// 统一出口：executeRules（兼容旧接口）
// ═══════════════════════════════════════════════════════════════

export interface AnalysisResults {
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
}

/**
 * 执行规则审核（统一入口）
 * 读取 contract_rules_v2 表，执行 Level A/B/C 柔性化判定
 *
 * @deprecated 建议使用 executeFlexibleRules 替代，获得更多细节
 */
export async function executeRules(
  contractText: string,
  orgId?: string
): Promise<AnalysisResults> {
  if (!orgId) {
    console.warn('executeRules called without orgId')
    return {
      risks: [],
      summary: '规则引擎未能加载规则配置（缺少组织ID）',
      appliedRules: 0,
      matchedRules: 0,
    }
  }

  try {
    // 调用新的柔性化引擎
    const flexibleResult = await executeFlexibleRulesCompat(contractText, orgId)

    return {
      risks: flexibleResult.risks,
      summary: flexibleResult.summary,
      appliedRules: flexibleResult.appliedRules,
      matchedRules: flexibleResult.matchedRules,
    }
  } catch (error) {
    console.error('Rule engine execution failed:', error)
    return {
      risks: [],
      summary: '规则引擎执行失败，请稍后重试',
      appliedRules: 0,
      matchedRules: 0,
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 旧接口兼容性导出（逐步废弃）
// ═══════════════════════════════════════════════════════════════

export * from './types'
export * from './structured-executor'
export type { StructuredCondition } from './structured-executor'

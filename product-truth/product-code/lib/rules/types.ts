/**
 * 规则引擎类型定义
 * F005-derive.md: 柔性化 3 级阈值（Level A/B/C）
 */

import type {
  ContractProblemCategory,
  ContractRuleContract,
} from '@/types/rules'

export type {
  ContractProblemCategory,
  ContractRuleCondition,
  ContractRuleConditionOperator,
  ContractRuleContract,
  ContractRuleDecision,
  ContractRuleMissingEvidenceOutcome,
  ContractRuleOutcome,
  ContractRuleProperty,
  ContractRulePropertyOption,
  ContractRulePropertyType,
} from '@/types/rules'

export type RiskLevel = 'red' | 'yellow' | 'green'
export type RuleType = 'structured' | 'semantic' | 'hybrid'
export type RuleStatus = 'draft' | 'published' | 'archived'
export type RuleCategory = 'ratio' | 'amount' | 'duration' | 'enum' | 'text'

// ═══════════════════════════════════════════════════════════════
// Level A/B/C 阈值定义（柔性化规则核心）
// ═══════════════════════════════════════════════════════════════

export type LevelOperator = '>=' | '<=' | '=' | '>' | '<' | 'contains' | 'in'
export type LevelAction = 'auto_approve' | 'suggest_counterparty' | 'block' | 'require_approval'

export interface RuleLevel {
  operator: LevelOperator
  threshold: number
  unit: string          // 'percent' | 'amount' | 'day' | 'month' | 'text'
  action: string        // 'auto_approve' | 'suggest_counterparty' | 'block' | 'require_approval'
  message?: string          // 提示文案
  counterparty?: string     // 建议换取的对价（Level B）
}

// 完整的柔性化规则（contract_rules_v2 表结构映射）
export interface FlexibleRule {
  id: string
  org_id: string
  code: string                    // e.g., "RULE-01-01"
  name: string
  description: string | null
  problem_category_id?: string | null
  problem_category?: ContractProblemCategory | null
  /** Canonical v1 execution contract. Legacy rows are adapted once at load time. */
  rule_contract?: ContractRuleContract | null
  category: RuleCategory          // ratio/amount/duration/enum/text
  engine_type: RuleType
  target_field?: string
  clause_category?: string
  field_hints: string[]
  semantic_prompt?: string
  applicable_scenarios: string[]  // 适用场景标签
  scope: 'org' | 'dept' | 'user'

  // Level A/B/C 配置
  level_a: RuleLevel
  level_b: RuleLevel
  level_c: RuleLevel

  // 审批路由
  approval_roles: string[]        // ['finance', 'legal']
  script_id?: string              // 关联话术库

  // 状态与版本
  version: number
  priority: number
  is_active: boolean
  created_by: string
  created_at: string
  updated_at: string
}

// ═══════════════════════════════════════════════════════════════
// 规则执行结果（Level A/B/C 判定结果）
// ═══════════════════════════════════════════════════════════════

export interface LevelMatchResult {
  level: 'A' | 'B' | 'C' | null   // 匹配到的级别，null=未匹配任何级别
  matched: boolean                // 是否命中规则
  operator: LevelOperator
  threshold: number
  actual_value: number
  unit: string
  source?: string
  confidence?: number
  action: string                  // 简化类型
  message: string
  counterparty?: string           // Level B 专用
  risk_label: 'green' | 'yellow' | 'red' | 'white'
}

// 旧类型保持兼容（将在后续重构中逐步替换）
// @deprecated 使用 FlexibleRule 替代
export interface Rule {
  id: string
  org_id: string

  // 基本信息
  name: string
  description: string | null
  rule_type: RuleType
  category: RuleCategory
  level: RiskLevel

  // 编码
  rule_code: string | null

  // 条件配置
  condition_config: Record<string, unknown> | null
  semantic_condition: string | null

  // 消息配置
  message_config: Record<string, unknown> | null

  // 生效范围
  scope: string
  contract_types: string[] | null

  // 优先级与组合
  priority: number
  group_id: string | null
  group_operator: string | null

  // 状态与版本
  status: RuleStatus
  version: number
  published_at: string | null
  published_by: string | null

  // 统计
  trigger_count: number
  total_evaluations: number
  hit_rate: number

  created_by: string
  created_at: string
  updated_at: string
}

// 规则执行结果
export interface RuleExecutionResult {
  ruleId: string
  ruleVersion: number
  ruleType: RuleType
  ruleCode?: string
  riskLevel: RiskLevel
  title: string
  description: string
  suggestion?: string
  evidence?: string[]
  triggered: boolean
  executionTime: number
  details?: string
  // 新增：Level A/B/C 详细结果
  levelResult?: LevelMatchResult
}

// 规则组
export interface RuleGroup {
  id: string
  name: string
  operator: 'AND' | 'OR'
  rules: Rule[]
}

// 合同数据
export interface ContractData {
  id: string
  text: string
  org_id: string
  extractedFields?: Record<string, string | number | boolean | null>
  clauses?: ContractClause[]
}

// 合同条款
export interface ContractClause {
  id: string
  number: string
  title: string
  content: string
  extractedFields?: Record<string, unknown>
}

// 执行上下文
export interface ExecutionContext {
  contract: ContractData
  rules: Rule[]
  orgId: string
  useAI: boolean
  aiConfig?: {
    model?: string
    timeout?: number
  }
}

// 测试结果
export interface RuleTestResult {
  ruleId: string
  testCaseId: string
  passed: boolean
  expected: {
    triggered: boolean
    extractedValue?: string | null
    level?: RiskLevel
  }
  actual: {
    triggered: boolean
    extractedValue?: string | null
    level?: RiskLevel
  }
  executionTime: number
  diff?: string
}

// 统计摘要
export interface RuleStatsSummary {
  ruleId: string
  ruleName: string
  totalEvaluations: number
  triggeredCount: number
  hitRate: number
  avgExecutionTime: number
  maxExecutionTime: number
  redCount: number
  yellowCount: number
  greenCount: number
}

// 统计趋势
export interface RuleStatsTrend {
  date: string
  evaluations: number
  triggered: number
  hitRate: number
}

// 规则版本
export interface RuleVersion {
  id: string
  rule_id: string
  org_id: string
  version: number
  content: Record<string, unknown>
  change_type: 'create' | 'update' | 'rollback' | 'archive'
  change_summary: string | null
  rollback_from_version: number | null
  status: RuleStatus
  published_at: string | null
  published_by: string | null
  created_by: string
  created_at: string
}

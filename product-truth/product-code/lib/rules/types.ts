/**
 * 规则引擎类型定义
 */

export type RiskLevel = 'red' | 'yellow' | 'green'
export type RuleType = 'structured' | 'semantic'
export type RuleStatus = 'draft' | 'published' | 'archived'
export type RuleCategory = 'financial' | 'legal' | 'compliance' | 'technical'

// 规则数据结构
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

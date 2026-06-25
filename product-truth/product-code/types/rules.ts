export interface Rule {
  id: string
  name: string
  description: string
  rule_type: 'structured' | 'semantic'
  risk_level: 'red' | 'yellow' | 'green'
  enabled: boolean
  config: {
    pattern?: string
    field?: string
    operator?: 'gt' | 'lt' | 'eq' | 'contains'
    value?: string | number
    prompt?: string
  }
  created_at: string
  updated_at: string
}

export type ContractRuleCategory = 'ratio' | 'amount' | 'duration' | 'enum' | 'text'
export type ContractRuleEngineType = 'structured' | 'semantic' | 'hybrid'
export type ContractRuleOperator = '>=' | '<=' | '=' | '>' | '<' | 'contains' | 'in'

export interface ContractPolicyRule {
  id: string
  org_id: string
  code: string
  name: string
  description?: string | null
  category: ContractRuleCategory
  engine_type: ContractRuleEngineType
  target_field?: string | null
  clause_category?: string | null
  field_hints?: string[] | null
  semantic_prompt?: string | null
  applicable_scenarios?: string[] | null
  scope?: 'org' | 'dept' | 'user' | null
  level_a_operator: ContractRuleOperator
  level_a_threshold: number
  level_a_unit?: string | null
  level_a_action?: string | null
  level_b_operator: ContractRuleOperator
  level_b_threshold: number
  level_b_unit?: string | null
  level_b_action?: string | null
  level_b_counterparty?: string | null
  level_c_operator: ContractRuleOperator
  level_c_threshold: number
  level_c_unit?: string | null
  level_c_action?: string | null
  level_c_message?: string | null
  approval_roles?: string[] | null
  priority?: number | null
  version: number
  is_active: boolean
  published_at?: string | null
  created_at: string
  updated_at: string
}

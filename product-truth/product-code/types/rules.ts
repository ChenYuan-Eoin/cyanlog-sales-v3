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

export interface Rule {
  id: string
  name: string
  description: string
  rule_type: 'structured' | 'semantic'
  risk_level: 'red' | 'yellow' | 'green'
  enabled: boolean
  config: {
    category?: string
    code?: string
    engine?: string
    evidence?: string
    exception?: string
    pattern?: string
    field?: string
    operator?: 'gt' | 'lt' | 'eq' | 'contains'
    output_template?: string
    rule_set?: string
    test_status?: 'passed' | 'failed' | 'untested'
    trigger_type?: 'keyword' | 'semantic' | 'field' | 'ratio' | 'amount' | 'duration'
    value?: string | number
    prompt?: string
  }
  created_at: string
  updated_at: string
}

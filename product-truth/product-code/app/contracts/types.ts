// types/contracts.ts - 合同中心类型定义

export interface ContractDraft {
  id: string
  title: string
  party_a_name?: string
  party_b_name?: string
  contract_amount?: number
  status: 'draft' | 'generated' | 'submitted_for_review' | 'approved'
  created_at: string
  updated_at: string
}

export interface ContractDashboardStats {
  total: number
  pending: number
  highRisk: number
  aiEfficiencyHours: number
}

export interface ContractTask {
  id: string
  name: string
  type: string
  aiSummary: {
    red: number
    yellow: number
    green: number
  }
  status: string
  updatedAt: string
}

export interface ContractTemplateParam {
  id: string
  param_key: string
  param_type: 'enum' | 'toggle' | 'text' | 'number' | 'date'
  param_label: string
  param_options?: { value: string; label: string }[]
  default_value?: unknown
  required: boolean
}

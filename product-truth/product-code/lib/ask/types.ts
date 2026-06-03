// lib/ask/types.ts
// REQ: F005 ASK v2 类型定义
// 与 feature-packets/F005-contract-ASK-upgrade.md 第 3 节数据模型对齐

export type AskStatus = 'pending' | 'responded' | 'closed'
export type AskInitialLevel = 'red' | 'yellow' | 'green'
export type QuestionType = 'commercial' | 'financial' | 'legal' | 'technical' | 'compliance'
export type EventType = 'created' | 'responded' | 'closed' | 'reopened' | 'report_generated' | 'no_ask_marked'
export type TriggerEvent = 'initial_generate' | 'ask_responded' | 'ask_reopened' | 'ask_closed' | 'standard_marked'

export interface AskItem {
  id: string
  contract_id: string
  ask_code: string
  clause_ref: string | null
  risk_name: string
  initial_level: AskInitialLevel
  question_type: QuestionType
  required_roles: string[]
  question_text: string
  qualified_std: string
  status: AskStatus
  trigger_user_id: string
  response_id: string | null
  closed_by: string | null
  closed_reason: string | null
  created_at: string
  updated_at: string
}

export interface AskResponse {
  id: string
  ask_id: string
  responder_id: string
  responder_role: string
  responder_name: string
  response_text: string
  attachments: Array<{ name: string; url: string; type: string }>
  created_at: string
}

export interface AskItemWithResponse extends AskItem {
  response: AskResponse | null
}

export interface AskAuditLog {
  id: string
  ask_id: string | null
  contract_id: string
  actor_id: string
  actor_role: string
  event_type: EventType
  from_status: string | null
  to_status: string | null
  payload: Record<string, unknown> | null
  created_at: string
}

export interface ReportVersion {
  id: string
  contract_id: string
  version: number
  trigger_event: TriggerEvent
  trigger_ask_id: string | null
  trigger_user_id: string | null
  no_ask_reason: string | null
  report_data: Record<string, unknown>
  report_file_url: string | null
  is_current: boolean
  created_at: string
}

export interface ReportSummary {
  total: number
  responded: number
  pending: number
  closed: number
}

export interface ReportCurrent {
  contract_id: string
  current_version: number
  is_current: boolean
  no_ask_reason: string | null
  no_ask_explanation: string | null
  report_data: {
    ask_items: AskItemWithResponse[]
    summary: ReportSummary
  }
  report_file_url: string | null
}

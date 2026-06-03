// F018 日程管理 + F019 提醒规则 - 类型定义

export type AgendaType = 'TASK' | 'MEETING' | 'FOLLOW_UP' | 'REMINDER'
export type AgendaStatus = 'PENDING' | 'DONE' | 'CANCELLED'
export type AgendaPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
export type ReminderChannel = 'IN_APP' | 'EMAIL'

export interface AgendaItem {
  id: string
  title: string
  description?: string | null
  agenda_type: AgendaType
  start_at: string
  end_at?: string | null
  all_day: boolean
  status: AgendaStatus
  priority: AgendaPriority
  related_type?: string | null
  related_id?: string | null
  assignee_id?: string | null
  created_by?: string | null
  created_at: string
  updated_at: string
}

export interface ReminderRule {
  id: string
  name: string
  agenda_type?: AgendaType | null
  trigger_offset_minutes: number
  channel: ReminderChannel
  is_active: boolean
  created_at: string
}

export interface Reminder {
  id: string
  agenda_id: string
  rule_id?: string | null
  remind_at: string
  sent_at?: string | null
  status: 'PENDING' | 'SENT' | 'FAILED'
  created_at: string
}

export const AGENDA_TYPES: AgendaType[] = ['TASK', 'MEETING', 'FOLLOW_UP', 'REMINDER']
export const AGENDA_STATUSES: AgendaStatus[] = ['PENDING', 'DONE', 'CANCELLED']
export const AGENDA_PRIORITIES: AgendaPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT']

export const AGENDA_TYPE_LABEL: Record<AgendaType, string> = {
  TASK: '任务',
  MEETING: '会议',
  FOLLOW_UP: '跟进',
  REMINDER: '提醒',
}

export const AGENDA_TYPE_COLOR: Record<AgendaType, string> = {
  TASK: 'bg-blue-100 text-blue-700',
  MEETING: 'bg-purple-100 text-purple-700',
  FOLLOW_UP: 'bg-emerald-100 text-emerald-700',
  REMINDER: 'bg-orange-100 text-orange-700',
}

export const PRIORITY_COLOR: Record<AgendaPriority, string> = {
  LOW: 'text-slate-500',
  NORMAL: 'text-blue-600',
  HIGH: 'text-orange-600',
  URGENT: 'text-rose-600',
}

export const STATUS_LABEL: Record<AgendaStatus, string> = {
  PENDING: '待办',
  DONE: '已完成',
  CANCELLED: '已取消',
}

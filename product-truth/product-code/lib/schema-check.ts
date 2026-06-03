// 通过 Supabase 表查询检测 schema 状态
// 列出生产数据库中已存在/缺失的表

import { supabaseAdmin } from './supabase'

const REQUIRED_TABLES = [
  // 认证与组织
  'users',
  'auth_tokens',
  'organizations',
  'departments',
  'user_departments',
  'roles',
  'user_roles',
  'user_organizations',
  // F001-F008 报价/合同/审批/OCR
  'quotes',
  'contracts',
  'approvals',
  'rules',
  'ocr_results',
  // 配置中心
  'configs',
  'config_versions',
  // F015-F019 知识库 + 日程 (新增)
  'login_attempts',
  'error_logs',
  'case_library',
  'tech_documents',
  'business_qualifications',
  'agenda_items',
  'reminder_rules',
  'reminders',
]

export interface SchemaStatus {
  table: string
  exists: boolean
  rowCount?: number
}

/**
 * 检查所有必需表是否存在于生产数据库
 */
export async function checkSchemaStatus(): Promise<SchemaStatus[]> {
  const results: SchemaStatus[] = []

  for (const table of REQUIRED_TABLES) {
    try {
      const { count, error } = await supabaseAdmin
        .from(table)
        .select('*', { count: 'exact', head: true })

      if (error) {
        results.push({ table, exists: false })
      } else {
        results.push({ table, exists: true, rowCount: count || 0 })
      }
    } catch {
      results.push({ table, exists: false })
    }
  }

  return results
}

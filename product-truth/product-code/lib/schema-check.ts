// 通过 Supabase 表查询检测 schema 状态
// 列出生产数据库中已存在/缺失的表
//
// 【技术选型】
// - 运行时Schema检查: 应用层查询而非数据库元数据直接读取
//   备选：information_schema.columns 直接查询（更准确，但Supabase权限受限）
//   权衡：
//   1. 使用 Supabase JS Client 查询，复用现有连接池和权限配置
//   2. 检测方式更贴近实际查询场景（检测"能否SELECT该列"而非"列是否存在"）
//   3. 批量并行查询（限制并发数5），平衡速度与资源占用
//
// - 表存在性检查: SELECT * LIMIT 1 + count:'estimated'
//   备选：PostgreSQL系统表 pg_tables（更快，但权限要求高）
//   权衡：使用标准Supabase API，不依赖特殊权限，兼容所有部署环境
//
// - 列存在性检查: 批量SELECT指定列，捕获错误
//   备选：单独查询information_schema（标准但慢）
//   权衡：
//   1. 优先尝试批量SELECT所有必需列（1次请求）
//   2. 失败则并行逐个检查列（N次并行请求）
//   3. 实际检测"能否查询"而非"列是否存在"，更贴近运行时场景
//
// - REQUIRED_COLUMNS硬编码: 字符串数组而非类型生成
//   技术债务：应与Supabase TypeScript类型同步
//   计划：使用 supabase gen types typescript 自动生成

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
  'organization_sources',
  'external_identities',
  'shipping_orders',
  'shipping_order_revisions',
  'personnel_employment_periods',
  'personnel_lifecycle_events',
  'personnel_invitations',
  // F001-F008 报价/合同/审批/OCR
  'quotes',
  'contracts',
  'approvals',
  'rules',
  'ocr_results',
  // 配置中心
  'configs',
  'config_versions',
  'contract_analysis_jobs',
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
  columnsOk?: boolean
  missingColumns?: string[]
  errorMessage?: string
}

const REQUIRED_COLUMNS: Record<string, string[]> = {
  users: ['id', 'password_hash', 'must_change_password', 'org_id', 'primary_dept_id', 'login_enabled', 'report_to_user_id'],
  auth_tokens: ['id', 'token', 'user_id', 'expires_at'],
  user_roles: ['user_id', 'role_id', 'scope_type', 'scope_id'],
  user_organizations: [
    'user_id',
    'org_id',
    'is_default',
    'membership_id',
    'status',
    'joined_at',
    'left_at',
    'membership_version',
    'primary_department_id',
    'employment_status',
    'employment_started_at',
    'employment_ended_at',
    'offboard_reason',
    'updated_at',
  ],
  shipping_orders: [
    'id',
    'org_id',
    'created_by',
    'status',
    'shipment_payload',
    'payload_hash',
    'revision',
    'original_shipment_payload',
    'amended_at',
    'amended_by',
    'amend_reason',
  ],
  shipping_order_revisions: [
    'order_id',
    'org_id',
    'revision',
    'before_payload',
    'after_payload',
    'actor_id',
    'reason',
  ],
  personnel_employment_periods: [
    'id',
    'org_id',
    'user_id',
    'source_priority',
    'status',
    'department_id',
    'manager_user_id',
    'started_at',
    'ended_at',
  ],
  personnel_lifecycle_events: [
    'id',
    'org_id',
    'target_user_id',
    'actor_id',
    'command',
    'before_state',
    'after_state',
    'occurred_at',
  ],
  personnel_invitations: [
    'id',
    'org_id',
    'user_id',
    'token_hash',
    'role_ids',
    'status',
    'expires_at',
    'created_by',
    'accepted_at',
  ],
  organization_sources: [
    'id',
    'system_org_id',
    'provider',
    'external_tenant_id',
    'priority',
    'status',
    'authority_scope',
    'sync_mode',
  ],
  external_identities: [
    'id',
    'source_id',
    'system_org_id',
    'external_user_id',
    'canonical_user_id',
    'match_status',
    'match_method',
    'match_confidence',
  ],
  contracts: ['id', 'status', 'created_by'],
  quotes: ['id', 'status', 'created_by'],
  contract_analysis_jobs: ['id', 'contract_id', 'review_id', 'status'],
  configs: ['id', 'key', 'type', 'status'],
  reminders: ['id', 'user_id', 'title'],
  agenda_items: ['id', 'user_id', 'agenda_date'],
}

/**
 * 批量检查列是否存在 - 优化版本（单表单次查询）
 */
async function checkRequiredColumnsBulk(table: string, columns: string[]): Promise<{
  columnsOk: boolean
  missingColumns: string[]
  errorMessage?: string
}> {
  try {
    // 尝试 select 所有必需列的一行数据
    const columnList = columns.join(', ')
    const { error } = await supabaseAdmin
      .from(table)
      .select(columnList, { count: 'exact', head: true })
      .limit(1)

    if (!error) {
      return { columnsOk: true, missingColumns: [] }
    }

    // 有错误，并行检查每个列
    const columnChecks = await Promise.all(
      columns.map(async (column) => {
        const { error: colError } = await supabaseAdmin
          .from(table)
          .select(column, { head: true })
          .limit(1)
        return { column, exists: !colError }
      })
    )

    const missingColumns = columnChecks.filter((c) => !c.exists).map((c) => c.column)

    return {
      columnsOk: missingColumns.length === 0,
      missingColumns,
      errorMessage: missingColumns.length > 0
        ? `Missing columns: ${missingColumns.join(', ')}`
        : undefined,
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { columnsOk: false, missingColumns: columns, errorMessage: message }
  }
}

/**
 * 检查所有必需表是否存在于生产数据库
 * 并行化：表间并行（限制并发数为5）
 */
export async function checkSchemaStatus(): Promise<SchemaStatus[]> {
  const results: SchemaStatus[] = []
  const CONCURRENCY = 5

  for (let i = 0; i < REQUIRED_TABLES.length; i += CONCURRENCY) {
    const batch = REQUIRED_TABLES.slice(i, i + CONCURRENCY)

    const batchResults = await Promise.all(
      batch.map(async (table) => {
        try {
          const { count, error } = await supabaseAdmin
            .from(table)
            .select('*', { count: 'estimated', head: true })
            .limit(1)

          if (error) {
            return {
              table,
              exists: false,
              columnsOk: false,
              errorMessage: error.message,
            } as SchemaStatus
          }

          const requiredColumns = REQUIRED_COLUMNS[table] || []
          const columnStatus = requiredColumns.length > 0
            ? await checkRequiredColumnsBulk(table, requiredColumns)
            : { columnsOk: true, missingColumns: [] as string[] }

          return {
            table,
            exists: true,
            rowCount: count ?? 0,
            ...columnStatus,
          } as SchemaStatus
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          return {
            table,
            exists: false,
            columnsOk: false,
            errorMessage: message,
          } as SchemaStatus
        }
      })
    )

    results.push(...batchResults)
  }

  return results
}

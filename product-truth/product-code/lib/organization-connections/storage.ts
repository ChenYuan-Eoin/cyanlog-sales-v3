import { supabaseAdmin } from '@/lib/supabase'
import { OrganizationConnectionError } from './errors'

export type ConnectionStorageMode = 'unified' | 'legacy_fxiaoke_read_only'

type SupabaseFailure = {
  code?: unknown
  message?: unknown
  details?: unknown
}

function failureText(error: SupabaseFailure) {
  return [error.message, error.details]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase()
}

export function isMissingSchemaObject(error: SupabaseFailure | null | undefined) {
  if (!error) return false
  const code = typeof error.code === 'string' ? error.code : ''
  if (['42703', '42P01', 'PGRST204', 'PGRST205'].includes(code)) return true
  const text = failureText(error)
  return text.includes('schema cache')
    && (text.includes('could not find')
      || text.includes('does not exist')
      || text.includes('column'))
}

export async function detectConnectionStorageMode(): Promise<ConnectionStorageMode> {
  const { error } = await supabaseAdmin
    .from('organization_sources')
    // PostgREST can return an empty error body for HEAD failures. Use a body-bearing
    // GET so a missing legacy column remains distinguishable from transport failures.
    .select('configuration_revision')
    .limit(1)

  if (!error) return 'unified'
  if (isMissingSchemaObject(error)) return 'legacy_fxiaoke_read_only'
  throw new OrganizationConnectionError(
    'CONNECTION_STORAGE_UNAVAILABLE',
    '组织连接存储暂时不可用，请稍后重试。',
    503,
  )
}

export function connectionMigrationRequired() {
  return new OrganizationConnectionError(
    'CONNECTION_MIGRATION_REQUIRED',
    '当前数据库尚未完成统一组织连接升级；现有纷享连接可只读验证，配置修改暂不可用。',
    409,
  )
}

export async function assertUnifiedConnectionStorage() {
  if (await detectConnectionStorageMode() !== 'unified') throw connectionMigrationRequired()
}

export async function detectDirectoryCutoverStorage() {
  if (await detectConnectionStorageMode() !== 'unified') return false
  const { error } = await supabaseAdmin
    .from('organization_directory_cutover_plans')
    .select('id')
    .limit(1)
  if (!error) return true
  if (isMissingSchemaObject(error)) return false
  throw new OrganizationConnectionError(
    'DIRECTORY_STORAGE_UNAVAILABLE',
    '组织目录存储暂时不可用，请稍后重试。',
    503,
  )
}

export async function assertDirectoryCutoverStorage() {
  if (!await detectDirectoryCutoverStorage()) {
    throw new OrganizationConnectionError(
      'DIRECTORY_MIGRATION_REQUIRED',
      '当前数据库尚未完成目录切源升级；目录读取可继续验收，差异应用与回滚暂不可用。',
      409,
    )
  }
}

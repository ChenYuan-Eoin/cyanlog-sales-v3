// REQ: F037-F046
// PURPOSE: 配置中心通用域 CRUD（server 侧；与 lib/api/common 解耦，直接抛错由路由捕获）
import { supabaseAdmin } from '@/lib/supabase'
import { DOMAIN_REGISTRY, type ConfigDomain } from './types'
import { DOMAIN_SCHEMAS } from './validation'
import { validatePriceRows, type PriceImportRow } from './price-import'

export class ConfigCenterError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

const ID_COLUMNS = new Set(['id', 'org_id', 'created_by', 'created_at', 'updated_at', 'version'])

/** 版本表父键映射（不同域版本表主键列名不同；键=版本表名） */
const VERSION_PARENT_KEYS: Record<string, string> = {
  business_param_versions: 'param_id',
  field_dictionary_versions: 'dict_id',
  output_template_versions: 'template_id',
  price_matrix_versions: 'matrix_id',
}

function payloadOf(body: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    if (!ID_COLUMNS.has(key)) {
      payload[key] = value
    }
  }
  return payload
}

export function assertDomain(domain: string): ConfigDomain {
  if (!(domain in DOMAIN_REGISTRY)) {
    throw new ConfigCenterError('UNKNOWN_DOMAIN', `未知配置域: ${domain}`)
  }
  return domain as ConfigDomain
}

export function validateDomainPayload(domain: ConfigDomain, body: Record<string, unknown>): Record<string, unknown> {
  const schema = DOMAIN_SCHEMAS[domain]
  const result = schema.safeParse(body)
  if (!result.success) {
    const messages = result.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')
    throw new ConfigCenterError('VALIDATION_ERROR', `配置数据无效: ${messages}`)
  }
  return result.data as Record<string, unknown>
}

export async function listDomain(domain: ConfigDomain, orgId: string, status?: string, limit = 50, offset = 0) {
  const def = DOMAIN_REGISTRY[domain]
  let query = supabaseAdmin
    .from(def.table)
    .select('*', { count: 'exact' })
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)
  if (status) {
    query = query.eq('status', status)
  }
  const { data, error, count } = await query
  if (error) {
    throw new ConfigCenterError('DB_ERROR', error.message)
  }
  return { data: data || [], count: count || 0 }
}

export async function getDomainItem(domain: ConfigDomain, orgId: string, id: string) {
  const def = DOMAIN_REGISTRY[domain]
  const { data, error } = await supabaseAdmin.from(def.table).select('*').eq('id', id).eq('org_id', orgId).maybeSingle()
  if (error) {
    throw new ConfigCenterError('DB_ERROR', error.message)
  }
  if (!data) {
    throw new ConfigCenterError('NOT_FOUND', '配置不存在')
  }
  return data
}

/** approval-rules 支持 chain_code → chain_id 解析 */
async function resolveChainCode(orgId: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (payload.chain_code) {
    const { data, error } = await supabaseAdmin
      .from('approval_chains')
      .select('id')
      .eq('org_id', orgId)
      .eq('code', payload.chain_code)
      .maybeSingle()
    if (error || !data) {
      throw new ConfigCenterError('VALIDATION_ERROR', `审批链 ${payload.chain_code} 不存在`)
    }
    const { chain_code: _code, ...rest } = payload
    return { ...rest, chain_id: data.id }
  }
  return payload
}

/** 创建（DRAFT, version=1）；approval-chains 额外写入 nodes */
export async function createDomainItem(domain: ConfigDomain, orgId: string, userId: string, body: Record<string, unknown>) {
  const def = DOMAIN_REGISTRY[domain]
  let payload = payloadOf(body)
  if (domain === 'approval-rules') {
    payload = await resolveChainCode(orgId, payload)
  }
  const { nodes, ...rest } = payload as Record<string, unknown> & { nodes?: unknown[] }
  const { data, error } = await supabaseAdmin
    .from(def.table)
    .insert({ ...rest, org_id: orgId, created_by: userId, status: 'DRAFT', version: 1 })
    .select()
    .single()
  if (error) {
    throw new ConfigCenterError('DB_ERROR', error.message)
  }
  if (domain === 'approval-chains' && Array.isArray(nodes) && data?.id) {
    await replaceChainNodes(orgId, data.id, nodes)
  }
  return data
}

/** 更新（仅 DRAFT）；approval-chains 额外替换 nodes */
export async function updateDomainItem(domain: ConfigDomain, orgId: string, id: string, body: Record<string, unknown>) {
  const def = DOMAIN_REGISTRY[domain]
  const existing = await getDomainItem(domain, orgId, id)
  if (existing.status === 'ARCHIVED') {
    throw new ConfigCenterError('NOT_DRAFT', '已归档配置不可编辑')
  }
  let payload = payloadOf(body)
  if (domain === 'approval-rules') {
    payload = await resolveChainCode(orgId, payload)
  }
  const { nodes, ...rest } = payload as Record<string, unknown> & { nodes?: unknown[] }
  const { data, error } = await supabaseAdmin.from(def.table).update(rest).eq('id', id).eq('org_id', orgId).select().single()
  if (error) {
    throw new ConfigCenterError('DB_ERROR', error.message)
  }
  if (domain === 'approval-chains' && Array.isArray(nodes)) {
    await replaceChainNodes(orgId, id, nodes)
  }
  return data
}

export async function deleteDomainItem(domain: ConfigDomain, orgId: string, id: string) {
  const def = DOMAIN_REGISTRY[domain]
  const existing = await getDomainItem(domain, orgId, id)
  if (existing.status !== 'DRAFT') {
    throw new ConfigCenterError('NOT_DRAFT', '仅草稿可删除')
  }
  const { error } = await supabaseAdmin.from(def.table).delete().eq('id', id).eq('org_id', orgId)
  if (error) {
    throw new ConfigCenterError('DB_ERROR', error.message)
  }
}

export async function publishDomainItem(domain: ConfigDomain, orgId: string, id: string) {
  const def = DOMAIN_REGISTRY[domain]
  const existing = await getDomainItem(domain, orgId, id)
  if (existing.status === 'ARCHIVED') {
    throw new ConfigCenterError('NOT_DRAFT', '已归档配置不可发布')
  }
  const nextVersion = Number(existing.version || 1)
  if (def.versionTable) {
    await recordVersion(def.versionTable, id, nextVersion, existing, 'PUBLISHED', existing.created_by)
  }
  const { error } = await supabaseAdmin
    .from(def.table)
    .update({ status: 'PUBLISHED', version: nextVersion + 1 })
    .eq('id', id)
    .eq('org_id', orgId)
  if (error) {
    throw new ConfigCenterError('DB_ERROR', error.message)
  }
}

export async function rollbackDomainItem(domain: ConfigDomain, orgId: string, id: string, version: number) {
  const def = DOMAIN_REGISTRY[domain]
  if (!def.versionTable) {
    throw new ConfigCenterError('NO_VERSION', '该配置域不支持版本回滚')
  }
  const parentKey = def.versionTable ? VERSION_PARENT_KEYS[def.versionTable] : undefined
  if (!parentKey) {
    throw new ConfigCenterError('NO_VERSION', `该配置域版本表未配置父键: ${def.versionTable ?? def.table}`)
  }
  const { data, error } = await supabaseAdmin
    .from(def.versionTable)
    .select('value')
    .eq(parentKey, id)
    .eq('version', version)
    .maybeSingle()
  if (error) {
    throw new ConfigCenterError('DB_ERROR', error.message)
  }
  if (!data) {
    throw new ConfigCenterError('NOT_FOUND', `版本 ${version} 不存在`)
  }
  const { error: updateError } = await supabaseAdmin
    .from(def.table)
    .update({ ...(data.value as Record<string, unknown>), status: 'DRAFT' })
    .eq('id', id)
    .eq('org_id', orgId)
  if (updateError) {
    throw new ConfigCenterError('DB_ERROR', updateError.message)
  }
}

export async function listVersions(domain: ConfigDomain, orgId: string, id: string) {
  const def = DOMAIN_REGISTRY[domain]
  if (!def.versionTable) {
    return []
  }
  const parentKey = def.versionTable ? VERSION_PARENT_KEYS[def.versionTable] : undefined
  if (!parentKey) {
    return []
  }
  const { data, error } = await supabaseAdmin
    .from(def.versionTable)
    .select('*')
    .eq(parentKey, id)
    .order('version', { ascending: false })
  if (error) {
    throw new ConfigCenterError('DB_ERROR', error.message)
  }
  return data || []
}

async function recordVersion(
  versionTable: string,
  parentId: string,
  version: number,
  row: Record<string, unknown>,
  status: string,
  createdBy: string | null
) {
  const parentKey = VERSION_PARENT_KEYS[versionTable] ?? versionTable.replace(/_versions$/, '') + '_id'
  const { error } = await supabaseAdmin.from(versionTable).insert({
    [parentKey]: parentId,
    version,
    value: row,
    status,
    created_by: createdBy,
  })
  if (error) {
    throw new ConfigCenterError('DB_ERROR', error.message)
  }
}

async function replaceChainNodes(orgId: string, chainId: string, nodes: unknown[]) {
  const { error: deleteError } = await supabaseAdmin
    .from('approval_chain_nodes')
    .delete()
    .eq('chain_id', chainId)
    .eq('org_id', orgId)
  if (deleteError) {
    throw new ConfigCenterError('DB_ERROR', deleteError.message)
  }
  if (nodes.length === 0) {
    return
  }
  const rows = nodes.map((node, index) => ({
    org_id: orgId,
    chain_id: chainId,
    ord: (node as { ord?: number })?.ord ?? index + 1,
    assignee_type: (node as { assignee_type: string }).assignee_type,
    assignee_value: (node as { assignee_value: string }).assignee_value,
    condition: (node as { condition?: object })?.condition ?? {},
    skip_on_unchanged: (node as { skip_on_unchanged?: boolean })?.skip_on_unchanged ?? true,
    timeout_hours: (node as { timeout_hours?: number })?.timeout_hours ?? null,
    escalation: (node as { escalation?: object })?.escalation ?? {},
  }))
  const { error } = await supabaseAdmin.from('approval_chain_nodes').insert(rows)
  if (error) {
    throw new ConfigCenterError('DB_ERROR', error.message)
  }
}

/** 价盘导入预览：校验不落库，返回逐行问题（阶段 0 硬门） */
export function validateImportRows(rows: PriceImportRow[]) {
  return validatePriceRows(rows)
}

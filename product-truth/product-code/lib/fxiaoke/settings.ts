// REQ: F003 / WP91. Tenant-scoped credentials with optimistic concurrency.
import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { connectionInput, FxiaokeError, type ConnectionSummary, type Credentials } from './contracts'
import { decryptCredentials, encryptCredentials } from './crypto'
import { previewDirectory } from './client'

const PUBLIC_COLUMNS = 'app_id,expected_ea,api_user_id,revision,last_checked_at,last_check_status,last_error'
function failure() { return new FxiaokeError('CONFIG_STORAGE_UNAVAILABLE', '纷享配置存储暂不可用，请确认数据库迁移已部署。', 503) }
export async function loadConnection(orgId: string): Promise<ConnectionSummary | null> {
  const { data, error } = await supabaseAdmin.from('organization_fxiaoke_connections').select(PUBLIC_COLUMNS).eq('system_org_id', orgId).maybeSingle()
  if (error) throw failure()
  if (!data) return null
  return { appId: data.app_id, expectedEa: data.expected_ea, apiUserId: data.api_user_id, revision: data.revision, configured: true, lastCheckedAt: data.last_checked_at, lastCheckStatus: data.last_check_status, lastError: data.last_error }
}
async function secretRow(orgId: string) {
  const { data, error } = await supabaseAdmin.from('organization_fxiaoke_connections').select('app_id,expected_ea,api_user_id,revision,credentials_ciphertext').eq('system_org_id', orgId).maybeSingle()
  if (error) throw failure()
  return data
}
export async function saveConnection(orgId: string, actorId: string, raw: unknown) {
  const parsed = connectionInput.safeParse(raw)
  if (!parsed.success) throw new FxiaokeError('INVALID_CONFIGURATION', '请完整填写 AppID、企业账号和员工 ID；密钥不可填写空白。')
  const input = parsed.data; const existing = await secretRow(orgId)
  if ((existing?.revision || null) !== input.revision) throw new FxiaokeError('CONFIG_CHANGED', '配置已被其他管理员更新，请重新读取后再保存。', 409)
  let previous: Partial<Credentials> = {}
  if (existing && input.appId === existing.app_id && input.expectedEa === existing.expected_ea) {
    try { previous = JSON.parse(decryptCredentials(orgId, existing.credentials_ciphertext)) as Credentials } catch (err) {
      if (!input.appSecret || !input.permanentCode) throw err
    }
  }
  const credentials: Credentials = {
    appId: input.appId, expectedEa: input.expectedEa, apiUserId: input.apiUserId,
    appSecret: input.appSecret || previous.appSecret || '', permanentCode: input.permanentCode || previous.permanentCode || '',
  }
  if (!credentials.appSecret || !credentials.permanentCode) throw new FxiaokeError('CREDENTIALS_REQUIRED', '首次配置或更换企业、应用时，请填写 AppSecret 和永久授权码。')
  const row = { system_org_id: orgId, app_id: input.appId, expected_ea: input.expectedEa, api_user_id: input.apiUserId,
    revision: randomUUID(), credentials_ciphertext: encryptCredentials(orgId, JSON.stringify(credentials)), updated_by: actorId,
    updated_at: new Date().toISOString(), last_checked_at: null, last_check_status: 'not_checked', last_error: null }
  const query = existing
    ? supabaseAdmin.from('organization_fxiaoke_connections').update(row).eq('system_org_id', orgId).eq('revision', existing.revision)
    : supabaseAdmin.from('organization_fxiaoke_connections').insert(row)
  const result = await query.select('revision').maybeSingle()
  if (result.error?.code === '23505' || (!result.error && !result.data)) throw new FxiaokeError('CONFIG_CHANGED', '配置已发生变化，请重新读取后再保存。', 409)
  if (result.error) throw failure()
  const saved = await loadConnection(orgId)
  if (!saved || saved.revision !== row.revision) throw new FxiaokeError('READBACK_CHANGED', '保存后配置发生变化，请重新读取核对。', 409)
  return saved
}
export async function previewSavedConnection(orgId: string, revision: string) {
  const row = await secretRow(orgId)
  if (!row || row.revision !== revision) throw new FxiaokeError('CONFIG_CHANGED', '配置不存在或已修改，请重新读取后再预览。', 409)
  // Atomic cross-instance lease: do not overlap provider token requests.
  const now = new Date()
  const cutoff = new Date(now.getTime() - 60_000).toISOString()
  const lease = await supabaseAdmin.from('organization_fxiaoke_connections')
    .update({ preview_started_at: now.toISOString() }).eq('system_org_id', orgId).eq('revision', revision)
    .or(`preview_started_at.is.null,preview_started_at.lt.${cutoff}`).select('revision').maybeSingle()
  if (lease.error) throw failure()
  if (!lease.data) throw new FxiaokeError('PREVIEW_BUSY', '正在预览或刚刚读取过通讯录，请一分钟后再试。', 429)
  let preview
  try {
    const decoded = JSON.parse(decryptCredentials(orgId, row.credentials_ciphertext)) as Credentials
    const parsed = connectionInput.safeParse({ ...decoded, revision })
    if (!parsed.success || !decoded.appSecret || !decoded.permanentCode || decoded.appId !== row.app_id || decoded.expectedEa !== row.expected_ea || decoded.apiUserId !== row.api_user_id) throw new FxiaokeError('CREDENTIALS_UNREADABLE', '已保存凭据与配置不一致，请重新配置。', 503)
    preview = await previewDirectory(decoded)
  } catch (err) {
    const safe = err instanceof FxiaokeError ? err : new FxiaokeError('PREVIEW_FAILED', '通讯录预览失败，请重新检查配置。', 502)
    await supabaseAdmin.from('organization_fxiaoke_connections').update({ last_checked_at: new Date().toISOString(), last_check_status: 'failed', last_error: safe.message }).eq('system_org_id', orgId).eq('revision', revision)
    throw safe
  }
  const result = await supabaseAdmin.from('organization_fxiaoke_connections').update({ last_checked_at: preview.checkedAt, last_check_status: 'preview_ready', last_error: null }).eq('system_org_id', orgId).eq('revision', revision).select('revision').maybeSingle()
  if (result.error) throw failure()
  if (!result.data) throw new FxiaokeError('CONFIG_CHANGED', '预览期间配置已改变，请重新预览。', 409)
  return preview
}

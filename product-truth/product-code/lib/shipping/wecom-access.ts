import { ShippingError } from './config'
import { readWecomSettings, syncWecomDirectory, type WecomSettingsRow } from './wecom-settings'

// This is an external identity cache, never a second editable employee directory.
export const WECOM_DIRECTORY_MAX_AGE_MS = 15 * 60 * 1000
const refreshing = new Map<string, Promise<WecomSettingsRow>>()

export function hasFreshWecomDirectory(config: WecomSettingsRow, now = Date.now()) {
  const checkedAt = Date.parse(config.directory_synced_at || '')
  return Number.isFinite(checkedAt) && checkedAt <= now && now - checkedAt < WECOM_DIRECTORY_MAX_AGE_MS
}

export async function currentWecomAccess(config: WecomSettingsRow): Promise<WecomSettingsRow> {
  if (hasFreshWecomDirectory(config)) return config
  const key = JSON.stringify([config.org_id, config.corp_id, config.agent_id, config.updated_at])
  const pending = refreshing.get(key)
  if (pending) return pending
  const refresh = (async () => {
    try {
      // The existing atomic RPC retains local restrictions, personal addresses and IDs.
      await syncWecomDirectory(config.org_id)
      const current = await readWecomSettings(config.org_id, { fresh: true })
      if (!current || current.corp_id !== config.corp_id || current.agent_id !== config.agent_id) {
        throw new ShippingError(403, '企业应用已变更，请重新从寄件入口进入。')
      }
      if (!hasFreshWecomDirectory(current)) throw new ShippingError(503, '企业身份资料尚未刷新，请稍后重试。')
      return current
    } catch (error) {
      if (error instanceof ShippingError && error.status === 403) throw error
      throw new ShippingError(503, '暂时无法核实企业成员状态，原有资料已保留，请稍后重试。')
    }
  })()
  refreshing.set(key, refresh)
  try { return await refresh } finally { if (refreshing.get(key) === refresh) refreshing.delete(key) }
}

export function isAllowedWecomMember(row: Record<string, unknown>, config: WecomSettingsRow) {
  return row.org_id === config.org_id && row.wecom_corp_id === config.corp_id
    && row.is_active === true && row.wecom_allowed === true
    && typeof row.wechat_userid === 'string' && row.wechat_userid.length > 0
    && hasFreshWecomDirectory(config)
}

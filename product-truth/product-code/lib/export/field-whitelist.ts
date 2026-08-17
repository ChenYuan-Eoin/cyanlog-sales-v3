// REQ: F039/F040
// PURPOSE: 输出字段白名单（隐藏字段物理剔除）
// 原则：内部字段（成本/底价/毛利/审批人/审批意见等）永不进入输出流；
// 白名单唯一真相 = 字段字典中 is_external=true 的已发布字段（由配置中心派生）
import { INTERNAL_FIELD_KEYS } from '@/lib/config-center/types'

/** 默认内部字段：即使调用方漏配，也强制剔除 */
const FORBIDDEN_KEYS = new Set<string>([...INTERNAL_FIELD_KEYS, 'api_key', 'service_role_key'])

/**
 * 按白名单深拷贝裁剪对象：
 *  - 白名单为空时按默认内部字段黑名单剔除（安全兜底）
 *  - 嵌套数组/对象递归处理
 *  - 只保留白名单内的 key（显式白名单模式）或剔除内部 key（黑名单模式）
 */
export function pickWhitelisted(
  data: unknown,
  whitelist: string[] = [],
  mode: 'allowlist' | 'denylist' = 'allowlist'
): unknown {
  if (Array.isArray(data)) {
    return data.map((item) => pickWhitelisted(item, whitelist, mode))
  }
  if (data && typeof data === 'object') {
    const source = data as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(source)) {
      if (mode === 'allowlist' && whitelist.length > 0) {
        if (!whitelist.includes(key)) {
          continue
        }
      }
      if (FORBIDDEN_KEYS.has(key)) {
        continue
      }
      result[key] = pickWhitelisted(value, whitelist, mode)
    }
    return result
  }
  return data
}

/** 从字段字典（is_external=true）派生输出白名单 key 集合 */
export function deriveWhitelistFromDictionary(
  fields: Array<{ field_key: string; is_external: boolean }>
): string[] {
  return fields.filter((f) => f.is_external).map((f) => f.field_key)
}

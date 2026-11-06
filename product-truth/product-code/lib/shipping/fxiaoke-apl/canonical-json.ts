import { FxiaokeAplContractError } from './contracts'

export type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue }

function encode(value: unknown, path: string): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new FxiaokeAplContractError('APL_MAPPING_VALUE_INVALID', `字段 ${path} 不是有限数字`)
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item, index) => encode(item, `${path}[${index}]`)).join(',')}]`
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new FxiaokeAplContractError('APL_MAPPING_VALUE_INVALID', `字段 ${path} 必须是普通对象`)
    }
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${encode(record[key], `${path}.${key}`)}`).join(',')}}`
  }
  throw new FxiaokeAplContractError('APL_MAPPING_VALUE_INVALID', `字段 ${path} 不是可序列化的 JSON 值`)
}

/**
 * Produces the exact JSON string used for signing and transport. The caller must
 * send this returned string without parsing and re-serializing it.
 */
export function canonicalJson(value: CanonicalJsonValue): string {
  return encode(value, '$')
}

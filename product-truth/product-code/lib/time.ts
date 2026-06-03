// 时间工具 - 统一使用 UTC ISO 8601
// 防止时区不一致（F010）

/** 当前 UTC 时间，ISO 8601 格式 */
export function nowUtc(): string {
  return new Date().toISOString()
}

/** 当前 UTC 时间，毫秒数 */
export function nowUtcMs(): number {
  return Date.now()
}

/** 给定 Date 转 UTC ISO 字符串 */
export function toUtcIso(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toISOString()
}

/** UTC ISO 字符串转 Date 对象（前端展示用） */
export function fromUtcIso(iso: string): Date {
  return new Date(iso)
}

/** 安全的 Date 构造（处理无效输入） */
export function safeDate(input: string | Date | null | undefined): Date | null {
  if (!input) return null
  const d = input instanceof Date ? input : new Date(input)
  return isNaN(d.getTime()) ? null : d
}

/** 格式化为本地化显示（前端展示用） */
export function formatLocal(
  iso: string | Date | null | undefined,
  locale = 'zh-CN'
): string {
  const d = safeDate(iso instanceof Date ? iso : iso ? new Date(iso) : null)
  if (!d) return '—'
  return d.toLocaleString(locale)
}

/** 仅日期（YYYY-MM-DD） */
export function formatDate(iso: string | Date | null | undefined): string {
  const d = safeDate(iso instanceof Date ? iso : iso ? new Date(iso) : null)
  if (!d) return '—'
  return d.toISOString().slice(0, 10)
}

/** 距离现在的相对时间（前端用） */
export function timeAgo(iso: string | Date | null | undefined): string {
  const d = safeDate(iso instanceof Date ? iso : iso ? new Date(iso) : null)
  if (!d) return '—'
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000)
  if (seconds < 60) return '刚刚'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`
  if (seconds < 2592000) return `${Math.floor(seconds / 86400)} 天前`
  return d.toLocaleDateString('zh-CN')
}

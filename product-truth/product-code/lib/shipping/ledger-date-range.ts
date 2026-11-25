export const ledgerDatePresets = [
  { value: 'all', label: '全部日期' },
  { value: 'year', label: '本年度' },
  { value: 'quarter', label: '本季度' },
  { value: 'month', label: '本月' },
  { value: 'week', label: '本周' },
  { value: 'last-week', label: '上周' },
  { value: 'next-week', label: '下周' },
  { value: 'today', label: '今天' },
  { value: 'yesterday', label: '昨天' },
  { value: 'three-days', label: '近3天' },
] as const

export type LedgerDatePreset = typeof ledgerDatePresets[number]['value']
export type LedgerDateRange = { submittedFrom?: string; submittedBefore?: string }

const shanghaiOffset = 8 * 60 * 60 * 1000
const day = 24 * 60 * 60 * 1000
const minute = 60 * 1000

export function ledgerPresetRange(preset: LedgerDatePreset, now = new Date()): LedgerDateRange {
  if (preset === 'all') return {}
  const shanghai = new Date(now.getTime() + shanghaiOffset)
  const year = shanghai.getUTCFullYear()
  const month = shanghai.getUTCMonth()
  const today = Date.UTC(year, month, shanghai.getUTCDate())
  const monday = today - ((shanghai.getUTCDay() + 6) % 7) * day
  const quarter = Math.floor(month / 3) * 3
  const bounds = {
    year: [Date.UTC(year, 0, 1), Date.UTC(year + 1, 0, 1)],
    quarter: [Date.UTC(year, quarter, 1), Date.UTC(year, quarter + 3, 1)],
    month: [Date.UTC(year, month, 1), Date.UTC(year, month + 1, 1)],
    week: [monday, monday + 7 * day],
    'last-week': [monday - 7 * day, monday],
    'next-week': [monday + 7 * day, monday + 14 * day],
    today: [today, today + day],
    yesterday: [today - day, today],
    'three-days': [today - 2 * day, today + day],
  }[preset]
  return {
    submittedFrom: new Date(bounds[0] - shanghaiOffset).toISOString(),
    submittedBefore: new Date(bounds[1] - shanghaiOffset).toISOString(),
  }
}

function calendarTime(date: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return Number.NaN
  const value = new Date(`${date}T${time}:00Z`)
  if (!Number.isFinite(value.getTime()) || value.toISOString().slice(0, 10) !== date) return Number.NaN
  return value.getTime() - shanghaiOffset
}

export function ledgerCustomRange(startDate: string, endDate: string, startTime: string, endTime: string): LedgerDateRange | null {
  const start = calendarTime(startDate, startTime || '00:00')
  const before = calendarTime(endDate, endTime || '00:00') + (endTime ? minute : day)
  if (!Number.isFinite(start) || !Number.isFinite(before) || start >= before) return null
  return { submittedFrom: new Date(start).toISOString(), submittedBefore: new Date(before).toISOString() }
}

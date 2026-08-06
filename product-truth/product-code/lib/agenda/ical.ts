// F018 日程中心（WP11）：iCal 订阅源生成（苹果/谷歌日历同步）
import type { AgendaItem } from './types'

export function escapeIcsText(value: string): string {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

export function icsUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

export function icsDateOnly(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

export function buildIcs(
  items: AgendaItem[],
  options: { now?: Date; calendarName?: string } = {}
): string {
  const now = options.now || new Date()
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Price V3//ONES Sales//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(options.calendarName || 'ONES 日程')}`,
  ]

  for (const item of items) {
    const start = new Date(item.start_at)
    if (Number.isNaN(start.getTime())) continue
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${item.id}@price-v3`)
    lines.push(`DTSTAMP:${icsUtc(now)}`)
    if (item.all_day) {
      lines.push(`DTSTART;VALUE=DATE:${icsDateOnly(start)}`)
      if (item.end_at) {
        const end = new Date(item.end_at)
        const endExclusive = new Date(end)
        endExclusive.setUTCDate(endExclusive.getUTCDate() + 1)
        lines.push(`DTEND;VALUE=DATE:${icsDateOnly(endExclusive)}`)
      }
    } else {
      lines.push(`DTSTART:${icsUtc(start)}`)
      if (item.end_at) lines.push(`DTEND:${icsUtc(new Date(item.end_at))}`)
    }
    lines.push(`SUMMARY:${escapeIcsText(item.title)}`)
    if (item.description) lines.push(`DESCRIPTION:${escapeIcsText(item.description)}`)
    lines.push(`STATUS:${item.status === 'CANCELLED' ? 'CANCELLED' : 'CONFIRMED'}`)
    lines.push('TRANSP:OPAQUE')
    lines.push(`CATEGORIES:${escapeIcsText(item.agenda_type)}`)
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}

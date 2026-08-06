import { describe, expect, it } from 'vitest'
import { buildIcs, escapeIcsText } from './ical'
import type { AgendaItem } from './types'

const base: AgendaItem = {
  id: '11111111-1111-4111-8111-111111111111',
  title: '客户会议, 重要',
  agenda_type: 'MEETING',
  start_at: '2026-08-06T02:00:00.000Z',
  end_at: '2026-08-06T03:00:00.000Z',
  all_day: false,
  status: 'PENDING',
  priority: 'NORMAL',
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
}

describe('buildIcs', () => {
  it('生成标准 VCALENDAR 与 VEVENT', () => {
    const ics = buildIcs([base], { now: new Date('2026-08-06T10:00:00.000Z') })
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('VERSION:2.0')
    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics).toContain('UID:11111111-1111-4111-8111-111111111111@price-v3')
    expect(ics).toContain('DTSTART:20260806T020000Z')
    expect(ics).toContain('DTEND:20260806T030000Z')
    expect(ics).toContain('SUMMARY:客户会议\\, 重要')
    expect(ics).toContain('END:VEVENT')
    expect(ics).toContain('END:VCALENDAR')
  })

  it('全天事件使用 VALUE=DATE 且截止日 +1', () => {
    const ics = buildIcs(
      [{ ...base, all_day: true, start_at: '2026-08-06T00:00:00.000Z', end_at: '2026-08-06T00:00:00.000Z' }],
      { now: new Date('2026-08-06T10:00:00.000Z') }
    )
    expect(ics).toContain('DTSTART;VALUE=DATE:20260806')
    expect(ics).toContain('DTEND;VALUE=DATE:20260807')
  })

  it('取消的日程导出为 CANCELLED 状态', () => {
    const ics = buildIcs([{ ...base, status: 'CANCELLED' }])
    expect(ics).toContain('STATUS:CANCELLED')
  })

  it('特殊字符转义', () => {
    expect(escapeIcsText('a;b,c\\d\ne')).toBe('a\\;b\\,c\\\\d\\ne')
  })
})

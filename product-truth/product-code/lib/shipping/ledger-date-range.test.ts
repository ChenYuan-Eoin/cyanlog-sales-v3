import { describe, expect, it } from 'vitest'
import { ledgerCustomRange, ledgerPresetRange, type LedgerDatePreset } from './ledger-date-range'

describe('shipping ledger dates in Asia/Shanghai', () => {
  const newYear = new Date('2026-12-31T16:05:00Z')

  it.each<[LedgerDatePreset, string, string]>([
    ['year', '2026-12-31', '2027-12-31'],
    ['quarter', '2026-12-31', '2027-03-31'],
    ['month', '2026-12-31', '2027-01-31'],
    ['week', '2026-12-27', '2027-01-03'],
    ['last-week', '2026-12-20', '2026-12-27'],
    ['next-week', '2027-01-03', '2027-01-10'],
    ['today', '2026-12-31', '2027-01-01'],
    ['yesterday', '2026-12-30', '2026-12-31'],
    ['three-days', '2026-12-29', '2027-01-01'],
  ])('uses the correct inclusive and exclusive bounds for %s', (preset, from, before) => {
    expect(ledgerPresetRange(preset, newYear)).toEqual({
      submittedFrom: `${from}T16:00:00.000Z`,
      submittedBefore: `${before}T16:00:00.000Z`,
    })
  })

  it('includes the full end day when times are omitted', () => {
    expect(ledgerCustomRange('2026-11-18', '2026-11-19', '', '')).toEqual({
      submittedFrom: '2026-11-17T16:00:00.000Z',
      submittedBefore: '2026-11-19T16:00:00.000Z',
    })
  })

  it('includes the whole last minute and rejects invalid or reversed intervals', () => {
    expect(ledgerCustomRange('2026-11-18', '2026-11-18', '16:15', '16:16')).toEqual({
      submittedFrom: '2026-11-18T08:15:00.000Z',
      submittedBefore: '2026-11-18T08:17:00.000Z',
    })
    expect(ledgerCustomRange('2026-11-18', '2026-11-18', '16:15', '15:16')).toBeNull()
    expect(ledgerCustomRange('2026-02-30', '2026-03-05', '', '')).toBeNull()
  })
})

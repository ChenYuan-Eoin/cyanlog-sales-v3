'use client'

import { useState, type FormEvent } from 'react'
import { ledgerCustomRange, ledgerDatePresets, ledgerPresetRange, type LedgerDatePreset, type LedgerDateRange } from '@/lib/shipping/ledger-date-range'
import styles from './workbench.module.css'

export function LedgerDateFilter({ disabled, onChange }: { disabled: boolean; onChange: (range: LedgerDateRange) => void }) {
  const [preset, setPreset] = useState<LedgerDatePreset | 'custom'>('all')
  const [customOpen, setCustomOpen] = useState(false)
  const [error, setError] = useState('')

  function choosePreset(value: LedgerDatePreset) {
    setPreset(value)
    setCustomOpen(false)
    setError('')
    onChange(ledgerPresetRange(value))
  }

  function applyCustom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const range = ledgerCustomRange(
      String(fields.get('startDate') ?? ''), String(fields.get('endDate') ?? ''),
      String(fields.get('startTime') ?? ''), String(fields.get('endTime') ?? ''),
    )
    if (!range) {
      setError('请填写有效的起止日期，结束时间应晚于开始时间。')
      return
    }
    setError('')
    setPreset('custom')
    onChange(range)
  }

  return <>
    <div className={styles.quickDates} aria-label="提报日期筛选" role="group">
      {ledgerDatePresets.map(item => (
        <button key={item.value} type="button" disabled={disabled} aria-pressed={preset === item.value} onClick={() => choosePreset(item.value)}>{item.label}</button>
      ))}
      <button type="button" disabled={disabled} aria-expanded={customOpen} aria-pressed={preset === 'custom'} onClick={() => setCustomOpen(value => !value)}>自定义时间</button>
    </div>
    <form hidden={!customOpen} className={styles.customLedgerDates} onSubmit={applyCustom}>
      <div>
        <label>开始日期<input name="startDate" type="date" required/></label>
        <label>开始时间（可选）<input name="startTime" type="time"/></label>
        <label>结束日期<input name="endDate" type="date" required/></label>
        <label>结束时间（可选）<input name="endTime" type="time"/></label>
      </div>
      <div><small>按北京时间筛选。时间留空时按整天计算。</small><button type="submit" disabled={disabled}>应用</button></div>
      {error && <p role="alert">{error}</p>}
    </form>
  </>
}

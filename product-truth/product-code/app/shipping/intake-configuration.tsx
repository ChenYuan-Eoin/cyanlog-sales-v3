'use client'
import { useEffect, useState } from 'react'
import { intakeRulesSchema, type IntakeRules } from '@/lib/shipping/intake-rules'
import styles from './config-drawer.module.css'
export default function IntakeConfiguration() {
  const [rules, setRules] = useState<IntakeRules | null>(null)
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { let active = true; fetch('/api/shipping/intake-settings', { cache: 'no-store' }).then(async r => { const body = await r.json(); if (!r.ok) throw new Error(body.error || '字段规则读取失败'); const parsed = intakeRulesSchema.parse(body.rules); if (active) { setRules(parsed) } }).catch(() => { if (active) setMessage('字段规则暂不可用，请刷新后重试。') }); return () => { active = false } }, [])
  async function save() {
    if (!rules || busy) return
    setBusy(true); setMessage('')
    try {
      const next = intakeRulesSchema.parse(rules)
      const response = await fetch('/api/shipping/intake-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) })
      const body = await response.json(); if (!response.ok) throw new Error(body.error || '保存失败')
      setRules(intakeRulesSchema.parse(body.rules)); setMessage('补充信息规则已保存，新打开的员工提报页立即使用。')
    } catch (e) { setMessage(e instanceof Error ? e.message : '保存失败') } finally { setBusy(false) }
  }
  return <section className={styles.section} aria-label="补充信息配置"><h3>员工提报补充信息</h3><p className={styles.hint}>设置收件客户公司的填写要求。</p>
    {rules && <fieldset className={styles.formGroup} disabled={busy}>{(['companyName'] as const).map(key => <div key={key}><strong>{'公司名称'}</strong><label className={styles.checkbox}><input type="checkbox" checked={rules[key].enabled} onChange={e => setRules({ ...rules, [key]: { ...rules[key], enabled: e.target.checked, required: e.target.checked && rules[key].required } })}/>{'显示公司名称'}</label><label className={styles.checkbox}><input type="checkbox" disabled={!rules[key].enabled} checked={rules[key].required} onChange={e => setRules({ ...rules, [key]: { ...rules[key], required: e.target.checked } })}/>{'公司名称必填'}</label><label>{'公司名称最少字数'}<input type="number" min="0" max={120} value={rules[key].minLength} onChange={e => setRules({ ...rules, [key]: { ...rules[key], minLength: Number(e.target.value) } })}/></label></div>)}<button type="button" onClick={() => void save()}>{busy ? '保存中…' : '保存补充信息规则'}</button></fieldset>}
    {message && <p role="status" className={styles.message}>{message}</p>}
  </section>
}

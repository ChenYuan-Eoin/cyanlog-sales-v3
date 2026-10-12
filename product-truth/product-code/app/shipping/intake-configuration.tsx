'use client'
import { useEffect, useState } from 'react'
import { intakeRulesSchema, type IntakeRules } from '@/lib/shipping/intake-rules'
import styles from './config-drawer.module.css'
export default function IntakeConfiguration() {
  const [rules, setRules] = useState<IntakeRules | null>(null)
  const [teams, setTeams] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { let active = true; fetch('/api/shipping/intake-settings', { cache: 'no-store' }).then(async r => { const body = await r.json(); if (!r.ok) throw new Error(body.error || '字段规则读取失败'); const parsed = intakeRulesSchema.parse(body.rules); if (active) { setRules(parsed); setTeams(parsed.teamOptions.join('\n')) } }).catch(() => { if (active) setMessage('字段规则暂不可用，请刷新后重试。') }); return () => { active = false } }, [])
  async function save() {
    if (!rules || busy) return
    setBusy(true); setMessage('')
    try {
      const next = intakeRulesSchema.parse({ ...rules, teamOptions: [...new Set(teams.split(/[\n,，]/).map(s => s.trim()).filter(Boolean))] })
      const response = await fetch('/api/shipping/intake-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) })
      const body = await response.json(); if (!response.ok) throw new Error(body.error || '保存失败')
      setRules(intakeRulesSchema.parse(body.rules)); setMessage('补充信息规则已保存，新打开的员工提报页立即使用。')
    } catch (e) { setMessage(e instanceof Error ? e.message : '保存失败') } finally { setBusy(false) }
  }
  return <section className={styles.section} aria-label="补充信息配置"><h3>员工提报补充信息</h3><p className={styles.hint}>公司名称指收件客户公司，所有提报入口均遵循此规则，与员工的寄件单位无关。企微员工的所属部门由企业档案带入；开放提报的团队按下列规则填写。不做工商信息校验。</p>
    {rules && <fieldset disabled={busy}>{(['companyName', 'team'] as const).map(key => <div key={key}><strong>{key === 'companyName' ? '公司名称' : '所属团队'}</strong><label className={styles.checkbox}><input type="checkbox" checked={rules[key].enabled} onChange={e => setRules({ ...rules, [key]: { ...rules[key], enabled: e.target.checked, required: e.target.checked && rules[key].required } })}/>{key === 'companyName' ? '显示公司名称' : '显示所属团队'}</label><label className={styles.checkbox}><input type="checkbox" disabled={!rules[key].enabled} checked={rules[key].required} onChange={e => setRules({ ...rules, [key]: { ...rules[key], required: e.target.checked } })}/>{key === 'companyName' ? '公司名称必填' : '所属团队必填'}</label><label>{key === 'companyName' ? '公司名称最少字数' : '所属团队最少字数'}<input type="number" min="0" max={key === 'companyName' ? 120 : 80} value={rules[key].minLength} onChange={e => setRules({ ...rules, [key]: { ...rules[key], minLength: Number(e.target.value) } })}/></label></div>)}<label>所属团队可选名单（每行一个，留空则自由填写）<textarea rows={3} value={teams} onChange={e => setTeams(e.target.value)}/></label><button type="button" onClick={() => void save()}>{busy ? '保存中…' : '保存补充信息规则'}</button></fieldset>}
    {message && <p role="status" className={styles.message}>{message}</p>}
  </section>
}

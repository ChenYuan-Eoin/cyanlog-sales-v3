'use client'
import { useEffect, useState } from 'react'
import { effectiveShippingDepartmentIds, intakeRulesSchema, type IntakeRules } from '@/lib/shipping/intake-rules'
import type { ShippingDepartment } from '@/lib/shipping/department-access'
import styles from './config-drawer.module.css'
export default function IntakeConfiguration() {
  const [rules, setRules] = useState<IntakeRules | null>(null)
  const [departments, setDepartments] = useState<ShippingDepartment[]>([])
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { let active = true; fetch('/api/shipping/intake-settings', { cache: 'no-store' }).then(async r => { const body = await r.json(); if (!r.ok) throw new Error(body.error || '字段规则读取失败'); const parsed = intakeRulesSchema.parse(body.rules); if (active) { setRules(parsed); setDepartments(Array.isArray(body.departments) ? body.departments : []) } }).catch(() => { if (active) setMessage('字段规则暂不可用，请刷新后重试。') }); return () => { active = false } }, [])
  async function save() {
    if (!rules || busy) return
    setBusy(true); setMessage('')
    try {
      const next = intakeRulesSchema.parse(rules)
      const response = await fetch('/api/shipping/intake-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) })
      const body = await response.json(); if (!response.ok) throw new Error(body.error || '保存失败')
      setRules(intakeRulesSchema.parse(body.rules)); setDepartments(Array.isArray(body.departments) ? body.departments : []); setMessage('寄件提报规则已保存，新提报立即按部门范围生效。')
    } catch (e) { setMessage(e instanceof Error ? e.message : '保存失败') } finally { setBusy(false) }
  }
  return <section className={styles.section} aria-label="补充信息配置"><h3>员工寄件提报范围</h3><p className={styles.hint}>选择可提报待确认工单的部门；顺丰发单仍由操作员确认。</p>
    {rules && <fieldset className={styles.formGroup} disabled={busy}>{(['companyName'] as const).map(key => <div key={key}><strong>{'公司名称'}</strong><label className={styles.checkbox}><input type="checkbox" checked={rules[key].enabled} onChange={e => setRules({ ...rules, [key]: { ...rules[key], enabled: e.target.checked, required: e.target.checked && rules[key].required } })}/>{'显示公司名称'}</label><label className={styles.checkbox}><input type="checkbox" disabled={!rules[key].enabled} checked={rules[key].required} onChange={e => setRules({ ...rules, [key]: { ...rules[key], required: e.target.checked } })}/>{'公司名称必填'}</label><label>{'公司名称最少字数'}<input type="number" min="0" max={120} value={rules[key].minLength} onChange={e => setRules({ ...rules, [key]: { ...rules[key], minLength: Number(e.target.value) } })}/></label></div>)}
      <div><strong>允许提报的 ICU 部门</strong><label className={styles.checkbox}><input type="checkbox" checked={rules.allowedDepartmentIds == null} onChange={event => setRules({ ...rules, allowedDepartmentIds: event.target.checked ? null : [] })}/>当前全部有效部门</label>
        {rules.allowedDepartmentIds != null && <div role="group" aria-label="允许提报的部门" style={{ maxHeight: 260, overflowY: 'auto', padding: 8, border: '1px solid #d9e1ed', borderRadius: 8 }}>{departments.map(department => <label className={styles.checkbox} key={department.id}><input type="checkbox" checked={rules.allowedDepartmentIds?.includes(department.id) || false} onChange={event => setRules(current => current && ({ ...current, allowedDepartmentIds: event.target.checked ? [...(current.allowedDepartmentIds || []), department.id] : (current.allowedDepartmentIds || []).filter(id => id !== department.id) }))}/>{department.path}</label>)}</div>}
        <p className={styles.hint}>{rules.allowedDepartmentIds == null ? '尚未限制部门；首次上线保持现有提报范围。' : `已选 ${rules.allowedDepartmentIds.length} 个部门，含下级共 ${effectiveShippingDepartmentIds(departments, rules.allowedDepartmentIds).size} 个有效部门。${rules.allowedDepartmentIds.length ? '' : '保存空名单后，员工将不能新提报。'}`}</p>
      </div><button type="button" onClick={() => void save()}>{busy ? '保存中…' : '保存寄件提报规则'}</button></fieldset>}
    {message && <p role="status" className={styles.message}>{message}</p>}
  </section>
}

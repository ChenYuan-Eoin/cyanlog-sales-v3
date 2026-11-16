'use client'
import { useEffect, useState } from 'react'
import { effectiveShippingDepartmentIds, intakeRulesSchema, type IntakeRules } from '@/lib/shipping/intake-rules'
import type { ShippingDepartment } from '@/lib/shipping/department-access'
import styles from './config-drawer.module.css'

export default function IntakeConfiguration({ mode = 'fields' }: { mode?: 'fields' | 'departments' }) {
  const [rules, setRules] = useState<IntakeRules | null>(null)
  const [departments, setDepartments] = useState<ShippingDepartment[]>([])
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    fetch('/api/shipping/intake-settings', { cache: 'no-store' }).then(async response => {
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || '寄件配置读取失败')
      const parsed = intakeRulesSchema.parse(body.rules)
      if (active) { setRules(parsed); setDepartments(Array.isArray(body.departments) ? body.departments : []) }
    }).catch(() => { if (active) setMessage('寄件配置暂不可用，请刷新后重试。') })
    return () => { active = false }
  }, [])
  async function save() {
    if (!rules || busy) return
    setBusy(true); setMessage('')
    try {
      const next = mode === 'fields' ? { companyName: rules.companyName } : { allowedDepartmentIds: rules.allowedDepartmentIds ?? null }
      const response = await fetch('/api/shipping/intake-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || '保存失败')
      setRules(intakeRulesSchema.parse(body.rules)); setDepartments(Array.isArray(body.departments) ? body.departments : [])
      setMessage(mode === 'fields' ? '寄件提报规则已保存。' : '寄件部门授权已保存，新提报立即生效。')
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败') } finally { setBusy(false) }
  }
  const visible = departments.filter(department => department.path.includes(search.trim()))
  return <section className={styles.section} aria-label={mode === 'fields' ? '补充信息配置' : '寄件部门授权'}>
    <h3>{mode === 'fields' ? '客户信息填写规则' : '授权寄件部门'}</h3>
    {mode === 'departments' && <p className={styles.hint}>从组织架构选择可提报的标准部门，选择上级包含其下级。员工只能使用本人最细一级的所属部门。</p>}
    {!rules && !message && <p role="status">正在读取寄件配置…</p>}
    {rules && <fieldset className={styles.formGroup} disabled={busy}>
      {mode === 'fields' ? <div><strong>公司名称</strong>
        <label className={styles.checkbox}><input type="checkbox" checked={rules.companyName.enabled} onChange={event => setRules({ ...rules, companyName: { ...rules.companyName, enabled: event.target.checked, required: event.target.checked && rules.companyName.required } })}/>显示公司名称</label>
        <label className={styles.checkbox}><input type="checkbox" disabled={!rules.companyName.enabled} checked={rules.companyName.required} onChange={event => setRules({ ...rules, companyName: { ...rules.companyName, required: event.target.checked } })}/>公司名称必填</label>
        <label>公司名称最少字数<input type="number" min="0" max={120} value={rules.companyName.minLength} onChange={event => setRules({ ...rules, companyName: { ...rules.companyName, minLength: Number(event.target.value) } })}/></label>
      </div> : <>
        <label className={styles.checkbox}><input type="radio" name="shipping-department-policy" checked={rules.allowedDepartmentIds == null} onChange={() => setRules({ ...rules, allowedDepartmentIds: null })}/>全部有效部门</label>
        <label className={styles.checkbox}><input type="radio" name="shipping-department-policy" checked={rules.allowedDepartmentIds != null} onChange={() => setRules({ ...rules, allowedDepartmentIds: [] })}/>指定部门</label>
        <label>搜索组织部门<input value={search} onChange={event => setSearch(event.target.value)} placeholder="部门名称或路径"/></label>
        <div role="group" aria-label="允许提报的部门" style={{ maxHeight: 260, overflowY: 'auto', padding: 8, border: '1px solid #d9e1ed', borderRadius: 8 }}>
          {visible.map(department => <label className={styles.checkbox} key={department.id}><input type="checkbox" disabled={rules.allowedDepartmentIds == null} checked={rules.allowedDepartmentIds == null || rules.allowedDepartmentIds.includes(department.id)} onChange={event => setRules(current => current && ({ ...current, allowedDepartmentIds: event.target.checked ? [...(current.allowedDepartmentIds || []), department.id] : (current.allowedDepartmentIds || []).filter(id => id !== department.id) }))}/>{department.path}</label>)}
          {!visible.length && <p>{departments.length ? '没有匹配的部门。' : '组织架构暂无有效部门，请先核对组织目录。'}</p>}
        </div>
        <p className={styles.hint}>{rules.allowedDepartmentIds == null ? '当前全部有效部门可提报；选择“指定部门”可逐项配置。' : '已选 ' + rules.allowedDepartmentIds.length + ' 个部门，含下级共 ' + effectiveShippingDepartmentIds(departments, rules.allowedDepartmentIds).size + ' 个有效部门。' + (rules.allowedDepartmentIds.length ? '' : '保存空名单后，员工将不能新提报。')}</p>
      </>}
      <button type="button" onClick={() => void save()}>{busy ? '保存中…' : mode === 'fields' ? '保存寄件提报规则' : '保存寄件部门授权'}</button>
    </fieldset>}
    {message && <p role="status" className={styles.message}>{message}</p>}
  </section>
}

'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { effectiveShippingDepartmentIds, intakeRulesSchema, toggleShippingDepartmentSubtree, type IntakeRules } from '@/lib/shipping/intake-rules'
import type { ShippingDepartment } from '@/lib/shipping/department-access'
import styles from './config-drawer.module.css'

export default function IntakeConfiguration({ mode = 'fields', readOnly = false }: { mode?: 'fields' | 'departments'; readOnly?: boolean }) {
  const [rules, setRules] = useState<IntakeRules | null>(null)
  const [departments, setDepartments] = useState<ShippingDepartment[]>([])
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const specificDraft = useRef<string[]>([])
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    fetch('/api/shipping/intake-settings', { cache: 'no-store' }).then(async response => {
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || '寄件配置读取失败')
      const parsed = intakeRulesSchema.parse(body.rules)
      if (active) { setRules(parsed); specificDraft.current = parsed.allowedDepartmentIds || []; setDepartments(Array.isArray(body.departments) ? body.departments : []) }
    }).catch(() => { if (active) setMessage('寄件配置暂不可用，请刷新后重试。') })
    return () => { active = false }
  }, [])
  async function save() {
    if (!rules || busy || readOnly) return
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
  const hierarchy = useMemo(() => {
    const byId = new Map(departments.map(department => [department.id, department]))
    const children = new Map<string | null, ShippingDepartment[]>()
    for (const department of departments) {
      const parent = department.parentId && byId.has(department.parentId) ? department.parentId : null
      children.set(parent, [...(children.get(parent) || []), department])
    }
    return { byId, children, subtrees: new Map(departments.map(department => [department.id, effectiveShippingDepartmentIds(departments, [department.id])])) }
  }, [departments])
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    if (!query) return new Set(departments.map(department => department.id))
    const matches = new Set<string>()
    for (const department of departments) {
      if (!department.path.toLocaleLowerCase().includes(query)) continue
      let current: ShippingDepartment | undefined = department
      while (current && !matches.has(current.id)) { matches.add(current.id); current = current.parentId ? hierarchy.byId.get(current.parentId) : undefined }
    }
    return matches
  }, [departments, hierarchy, search])
  const coverage = effectiveShippingDepartmentIds(departments, rules?.allowedDepartmentIds)
  function switchMode(all: boolean) {
    if (!rules) return
    if (all && rules.allowedDepartmentIds != null) specificDraft.current = rules.allowedDepartmentIds
    setRules({ ...rules, allowedDepartmentIds: all ? null : specificDraft.current })
    setMessage('')
  }
  function renderDepartments(parentId: string | null) {
    return <ul className={styles.departmentBranches}>{(hierarchy.children.get(parentId) || []).filter(department => visible.has(department.id)).map(department => {
      const subtree = hierarchy.subtrees.get(department.id)!
      const selectedCount = [...subtree].filter(id => coverage.has(id)).length
      const checked = selectedCount === subtree.size
      const mixed = selectedCount > 0 && !checked
      const hasChildren = Boolean(hierarchy.children.get(department.id)?.length)
      const open = Boolean(search.trim()) || expanded.has(department.id)
      return <li key={department.id}>
        <div className={styles.departmentRow}>
          {hasChildren ? <button className={styles.departmentToggle} type="button" aria-label={`${open ? '收起' : '展开'}${department.name}`} aria-expanded={open} onClick={() => setExpanded(current => { const next = new Set(current); if (next.has(department.id)) next.delete(department.id); else next.add(department.id); return next })}>{open ? '▾' : '▸'}</button> : <span className={styles.departmentSpacer} />}
          <label title={department.path}><input type="checkbox" aria-label={department.name} aria-checked={mixed ? 'mixed' : checked} ref={element => { if (element) element.indeterminate = mixed }} checked={checked} onChange={event => setRules(current => current && ({ ...current, allowedDepartmentIds: toggleShippingDepartmentSubtree(departments, current.allowedDepartmentIds || [], department.id, event.target.checked) }))}/><span>{department.name}</span></label>
        </div>
        {hasChildren && open && renderDepartments(department.id)}
      </li>
    })}</ul>
  }
  return <section className={mode === 'fields' ? styles.section : styles.permissionCard} aria-label={mode === 'fields' ? '补充信息配置' : '寄件部门授权'}>
    <h3>{mode === 'fields' ? '客户信息填写规则' : '授权寄件部门'}</h3>
    {mode === 'departments' && <p className={styles.hint}>员工只能使用本人最细一级的所属部门提报。</p>}
    {!rules && !message && <p role="status">正在读取寄件配置…</p>}
    {rules && <fieldset className={styles.formGroup} disabled={busy || readOnly}>
      {mode === 'fields' ? <div><strong>公司名称</strong>
        <label className={styles.checkbox}><input type="checkbox" checked={rules.companyName.enabled} onChange={event => setRules({ ...rules, companyName: { ...rules.companyName, enabled: event.target.checked, required: event.target.checked && rules.companyName.required } })}/>显示公司名称</label>
        <label className={styles.checkbox}><input type="checkbox" disabled={!rules.companyName.enabled} checked={rules.companyName.required} onChange={event => setRules({ ...rules, companyName: { ...rules.companyName, required: event.target.checked } })}/>公司名称必填</label>
        <label>公司名称最少字数<input type="number" min="0" max={120} value={rules.companyName.minLength} onChange={event => setRules({ ...rules, companyName: { ...rules.companyName, minLength: Number(event.target.value) } })}/></label>
      </div> : <>
        <div className={styles.departmentModes} role="radiogroup" aria-label="寄件部门授权方式">
          <label><input type="radio" name="shipping-department-policy" checked={rules.allowedDepartmentIds == null} onChange={() => switchMode(true)}/>全部有效部门</label>
          <label><input type="radio" name="shipping-department-policy" checked={rules.allowedDepartmentIds != null} onChange={() => switchMode(false)}/>指定部门</label>
        </div>
        {rules.allowedDepartmentIds == null ? <p className={styles.modeHint}>当前和以后新增的有效部门均可提报。</p> : <div className={styles.departmentSelection}>
          <label className={styles.departmentSearch}>搜索组织部门<input value={search} onChange={event => setSearch(event.target.value)} placeholder="部门名称或路径"/></label>
          <div role="group" aria-label="允许提报的部门" className={styles.departmentTree}>
            {visible.size ? renderDepartments(null) : <p className={styles.hint}>{departments.length ? '没有匹配的部门。' : '组织架构暂无有效部门，请先核对组织目录。'}</p>}
          </div>
          <div className={styles.departmentStatistics}><span>{'已选 ' + rules.allowedDepartmentIds.length + ' 个部门，含下级共 ' + coverage.size + ' 个有效部门。'}</span><button type="button" className={styles.textAction} onClick={() => setRules({ ...rules, allowedDepartmentIds: [] })}>清空选择</button></div>
          {!rules.allowedDepartmentIds.length && <p className={styles.hint}>保存空名单后，员工将不能新提报。</p>}
        </div>}
      </>}
      <div className={styles.permissionActions}><button type="button" onClick={() => void save()}>{busy ? '保存中…' : mode === 'fields' ? '保存寄件提报规则' : '保存寄件部门授权'}</button></div>
    </fieldset>}
    {message && <p role="status" className={styles.message}>{message}</p>}
  </section>
}

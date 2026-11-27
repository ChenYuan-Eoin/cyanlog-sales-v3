'use client'

import { useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import {
  effectiveShippingDepartmentIds, intakeRulesSchema, toggleShippingDepartmentSubtree, type IntakeRules,
} from '@/lib/shipping/intake-rules'
import type { ShippingDepartment } from '@/lib/shipping/department-access'
import { shippingWorkbenchRequest, ShippingWorkbenchRequestError } from '@/lib/shipping/workbench-client'
import styles from './config-drawer.module.css'

const intakeSettingsUrl = '/api/shipping/intake-settings'
const departmentAuthorizationUrl = '/api/admin/departments/shipping-intake'
const departmentIdsSchema = intakeRulesSchema.shape.allowedDepartmentIds.unwrap()
const departmentScopeSchema = z.object({
  allowedDepartmentIds: departmentIdsSchema,
  departments: z.array(z.object({ id: z.string().uuid(), name: z.string(), parentId: z.string().uuid().nullable() })),
})

export default function IntakeConfiguration({ readOnly = false }: { readOnly?: boolean }) {
  const [companyName, setCompanyName] = useState<IntakeRules['companyName'] | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    void fetch(intakeSettingsUrl, { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('寄件配置读取失败')
      const body = await response.json()
      const fields = intakeRulesSchema.shape.companyName.parse(body.rules?.companyName)
      if (!controller.signal.aborted) setCompanyName(fields)
    }).catch(() => {
      if (!controller.signal.aborted) setMessage('寄件配置暂不可用，请刷新后重试。')
    })
    return () => controller.abort()
  }, [])

  async function save() {
    if (!companyName || busy || readOnly) return
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch(intakeSettingsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || '保存失败')
      setCompanyName(intakeRulesSchema.shape.companyName.parse(body.rules?.companyName))
      setMessage('寄件提报规则已保存。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  return <section className={styles.section} aria-label="补充信息配置">
    <h3>客户信息填写规则</h3>
    {!companyName && !message && <p role="status">正在读取寄件配置…</p>}
    {companyName && <fieldset className={styles.formGroup} disabled={busy || readOnly}>
      <div><strong>公司名称</strong>
        <label className={styles.checkbox}><input type="checkbox" checked={companyName.enabled} onChange={event => setCompanyName({ ...companyName, enabled: event.target.checked, required: event.target.checked && companyName.required })}/>显示公司名称</label>
        <label className={styles.checkbox}><input type="checkbox" disabled={!companyName.enabled} checked={companyName.required} onChange={event => setCompanyName({ ...companyName, required: event.target.checked })}/>公司名称必填</label>
        <label>公司名称最少字数<input type="number" min="0" max={120} value={companyName.minLength} onChange={event => setCompanyName({ ...companyName, minLength: Number(event.target.value) })}/></label>
      </div>
      {!readOnly && <div className={styles.permissionActions}><button type="button" onClick={() => void save()}>{busy ? '保存中…' : '保存寄件提报规则'}</button></div>}
    </fieldset>}
    {message && <p role="status" className={styles.message}>{message}</p>}
  </section>
}

type DepartmentSelection = { saved: string[] | null; draft: string[] | null }
type OrganizationDepartment = Pick<ShippingDepartment, 'id' | 'name' | 'parentId'>

export function ShippingDepartmentAuthorization({ orgId }: { orgId: string }) {
  const authorizationUrl = `${departmentAuthorizationUrl}?orgId=${encodeURIComponent(orgId)}`
  const [selection, setSelection] = useState<DepartmentSelection | null>(null)
  const [departments, setDepartments] = useState<OrganizationDepartment[]>([])
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    void shippingWorkbenchRequest<unknown>(authorizationUrl, { signal: controller.signal }).then(body => {
      const { allowedDepartmentIds: saved, departments } = departmentScopeSchema.parse(body)
      if (controller.signal.aborted) return
      setDepartments(departments)
      setSelection({ saved, draft: saved })
    }).catch(error => {
      if (controller.signal.aborted) return
      if (error instanceof ShippingWorkbenchRequestError && (error.status === 401 || error.status === 403)) return
      setMessage('提报部门范围暂不可用，请刷新后重试。')
    })
    return () => controller.abort()
  }, [authorizationUrl])

  async function save() {
    if (!selection?.draft || busy) return
    setBusy(true)
    setMessage('')
    try {
      const body = await shippingWorkbenchRequest<{ allowedDepartmentIds: unknown }>(authorizationUrl, {
        method: 'PATCH',
        body: JSON.stringify({ allowedDepartmentIds: selection.draft }),
      })
      const saved = departmentIdsSchema.parse(body.allowedDepartmentIds)
      if (saved === null) throw new Error('无法确认最新提报部门范围，请刷新核对。')
      setSelection({ saved, draft: saved })
      setMessage('提报部门范围已保存，对新提报立即生效。')
    } catch (error) {
      if (error instanceof ShippingWorkbenchRequestError && (error.status === 401 || error.status === 403)) {
        setSelection(null)
        setDepartments([])
        setMessage('当前账号无法更新提报部门范围。')
      } else {
        setMessage(error instanceof ShippingWorkbenchRequestError ? error.message : '保存失败，请刷新核对。')
      }
    } finally {
      setBusy(false)
    }
  }

  const hierarchy = useMemo(() => {
    const byId = new Map(departments.map(department => [department.id, department]))
    const children = new Map<string | null, OrganizationDepartment[]>()
    const paths = new Map<string, string>()
    for (const department of departments) {
      const parent = department.parentId && byId.has(department.parentId) ? department.parentId : null
      const siblings = children.get(parent) ?? []
      siblings.push(department)
      children.set(parent, siblings)
      const branch: string[] = []
      const visited = new Set<string>()
      let current: OrganizationDepartment | undefined = department
      while (current && !visited.has(current.id)) {
        visited.add(current.id)
        branch.push(current.name)
        current = current.parentId ? byId.get(current.parentId) : undefined
      }
      paths.set(department.id, branch.reverse().join(' / '))
    }
    return { byId, children, paths, subtrees: new Map(departments.map(department => [department.id, effectiveShippingDepartmentIds(departments, [department.id])])) }
  }, [departments])

  const query = search.trim().toLocaleLowerCase()
  const visible = useMemo(() => {
    if (!query) return new Set(departments.map(department => department.id))
    const matches = new Set<string>()
    for (const department of departments) {
      if (!hierarchy.paths.get(department.id)?.toLocaleLowerCase().includes(query)) continue
      let current: OrganizationDepartment | undefined = department
      while (current && !matches.has(current.id)) {
        matches.add(current.id)
        current = current.parentId ? hierarchy.byId.get(current.parentId) : undefined
      }
    }
    return matches
  }, [departments, hierarchy, query])

  if (!selection && !message) return null

  const draft = selection?.draft
  const saved = selection?.saved
  const coverage = effectiveShippingDepartmentIds(departments, draft ?? [])
  const changed = draft != null && (saved == null || draft.length !== saved.length || draft.some(id => !saved.includes(id)))

  function renderDepartments(parentId: string | null) {
    return <ul className={styles.departmentBranches}>{(hierarchy.children.get(parentId) ?? []).filter(department => visible.has(department.id)).map(department => {
      const subtree = hierarchy.subtrees.get(department.id) ?? new Set<string>()
      const selectedCount = [...subtree].filter(id => coverage.has(id)).length
      const checked = selectedCount === subtree.size
      const mixed = selectedCount > 0 && !checked
      const hasChildren = Boolean(hierarchy.children.get(department.id)?.length)
      const open = Boolean(query) || expanded.has(department.id)
      return <li key={department.id}>
        <div className={styles.departmentRow}>
          {hasChildren ? <button className={styles.departmentToggle} type="button" aria-label={`${open ? '收起' : '展开'}${department.name}`} aria-expanded={open} onClick={() => setExpanded(current => {
            const next = new Set(current)
            if (open) next.delete(department.id)
            else next.add(department.id)
            return next
          })}>{open ? '▾' : '▸'}</button> : <span className={styles.departmentSpacer} />}
          <label title={hierarchy.paths.get(department.id)}><input type="checkbox" aria-label={department.name} aria-checked={mixed ? 'mixed' : checked}
            ref={element => { if (element) element.indeterminate = mixed }} checked={checked} onChange={event => setSelection(current => current && ({
              ...current, draft: toggleShippingDepartmentSubtree(departments, current.draft ?? [], department.id, event.target.checked),
            }))}/><span>{department.name}</span></label>
        </div>
        {hasChildren && open && renderDepartments(department.id)}
      </li>
    })}</ul>
  }

  return <details className="rounded-lg border bg-white p-4">
    <summary className="cursor-pointer font-medium text-slate-900">提报部门范围</summary>
    <div className="mt-3 space-y-3 text-sm">
      {selection && <p className="text-xs leading-5 text-slate-600">选中的部门及其下级允许提报。员工还需具有本人寄件权限。</p>}
      {selection && draft === null && <>
        <p className="text-xs leading-5 text-slate-600">尚未指定提报部门。当前部门限制未启用。</p>
        <Button type="button" variant="outline" size="sm" onClick={() => setSelection({ saved: selection.saved, draft: [] })}>改为指定部门</Button>
      </>}
      {draft != null && <fieldset className="space-y-3" disabled={busy}>
        <label className="block text-xs text-slate-600">搜索组织部门
          <input className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={search} onChange={event => setSearch(event.target.value)} placeholder="部门名称或路径"/>
        </label>
        <div role="group" aria-label="允许提报的部门" className={styles.departmentTree}>
          {visible.size ? renderDepartments(null) : <p className="p-2 text-xs text-slate-600">{departments.length ? '没有匹配的部门。' : '组织架构暂无有效部门。'}</p>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
          <span>已选 {draft.length} 个部门，含下级共 {coverage.size} 个有效部门。</span>
          <Button type="button" size="sm" variant="ghost" disabled={!draft.length} onClick={() => setSelection(current => current && ({ ...current, draft: [] }))}>清空选择</Button>
        </div>
        {!draft.length && <p className="text-xs text-slate-600">保存空名单后，员工将不能新提报。</p>}
        <Button type="button" size="sm" disabled={!changed} onClick={() => void save()}>{busy ? '保存中…' : '保存提报部门范围'}</Button>
      </fieldset>}
      {message && <p role="status" className="text-xs text-slate-600">{message}</p>}
    </div>
  </details>
}

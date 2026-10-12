'use client'
import { useMemo, useState } from 'react'
import { authorizedDepartmentIds, type WecomDepartment } from '@/lib/shipping/wecom-directory'
import styles from './config-drawer.module.css'
export default function WecomDepartmentPicker({ departments, selected, onChange, disabled = false }: { departments: WecomDepartment[]; selected: number[]; onChange: (ids: number[]) => void; disabled?: boolean }) {
  const [search, setSearch] = useState('')
  const ids = useMemo(() => new Set(departments.map(d => d.id)), [departments])
  const allowed = useMemo(() => new Set(authorizedDepartmentIds(departments, selected.filter(id => ids.has(id)))), [departments, selected, ids])
  const children = (parent: number) => departments.filter(d => d.parentId === parent).sort((a, b) => b.order - a.order || a.id - b.id)
  function matches(node: WecomDepartment): boolean { return node.name.includes(search.trim()) || children(node.id).some(matches) }
  function renderNode(node: WecomDepartment) {
    if (!matches(node)) return null
    const nested = children(node.id)
    let ancestor=departments.find(d=>d.id===node.parentId), inherited=false
    while(ancestor){if(selected.includes(ancestor.id)){inherited=true;break}ancestor=departments.find(d=>d.id===ancestor!.parentId)}
    const checkbox = <label className={styles.checkbox}><input type="checkbox" checked={allowed.has(node.id)} disabled={disabled || inherited} onChange={e => onChange(e.target.checked ? [...selected.filter(id=>!authorizedDepartmentIds(departments,[node.id]).includes(id)), node.id] : selected.filter(id => id !== node.id))}/>{node.name}{inherited && <small>（随上级授权）</small>}{node.parentId !== 0 && !ids.has(node.parentId) && <small>（上级不可见）</small>}</label>
    return <li key={node.id}>{checkbox}{nested.length > 0 && <details open={search.trim() ? true : undefined}><summary>下级部门（{nested.length}）</summary><ul>{nested.map(renderNode)}</ul></details>}</li>
  }
  return <div><label>查找部门<input value={search} onChange={e => setSearch(e.target.value)} placeholder="输入部门名称"/></label><p className={styles.hint}>勾选部门包含全部下级及之后同步的新成员；如需只选部分下级，请先取消上级。未勾选任何部门表示不授权员工提报。</p><ul aria-label="可提报组织范围" style={{ listStyle: 'none', paddingLeft: 0 }}>{departments.filter(d => d.parentId === 0 || !ids.has(d.parentId)).map(renderNode)}</ul></div>
}

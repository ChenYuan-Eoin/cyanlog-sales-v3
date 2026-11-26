'use client'

import { useMemo } from 'react'
import type { LedgerDepartment } from '@/lib/shipping/department-ledger-access'

export type LedgerDepartmentSelection = { departmentId: string; includeSubdepartments: boolean }
export const allLedgerDepartments: LedgerDepartmentSelection = { departmentId: '', includeSubdepartments: false }

export function ledgerDepartmentQuery(selection: LedgerDepartmentSelection) {
  const query = new URLSearchParams()
  if (selection.departmentId) {
    query.set('departmentId', selection.departmentId)
    query.set('includeSubdepartments', String(selection.includeSubdepartments))
  }
  return query
}

function authorizedDepartmentOptions(departments: readonly LedgerDepartment[]) {
  const departmentsById = new Map(departments.map(department => [department.id, department]))
  return departments.map(department => {
    const labels = [department.name]
    const visited = new Set([department.id])
    let parent = department.parentId ? departmentsById.get(department.parentId) : undefined
    while (parent && !visited.has(parent.id)) {
      labels.unshift(parent.name)
      visited.add(parent.id)
      parent = parent.parentId ? departmentsById.get(parent.parentId) : undefined
    }
    return { id: department.id, label: labels.join(' / ') }
  }).sort((first, second) => first.label.localeCompare(second.label, 'zh-CN'))
}

export function DepartmentLedgerFilter({ departments, selection, onChange, disabled, allLabel = '全部已授权部门' }: {
  departments: readonly LedgerDepartment[]
  selection: LedgerDepartmentSelection
  onChange: (selection: LedgerDepartmentSelection) => void
  disabled?: boolean
  allLabel?: string
}) {
  const options = useMemo(() => authorizedDepartmentOptions(departments), [departments])
  const { departmentId, includeSubdepartments } = selection
  const hasSubdepartments = departmentId && departments.some(department => department.parentId === departmentId)

  return <div className="flex flex-wrap items-end gap-3">
    <label className="grid min-w-40 max-w-full gap-1 text-xs">查看部门
      <select value={departmentId} disabled={disabled} onChange={event =>
        onChange({ departmentId: event.target.value, includeSubdepartments: false })}>
        <option value="">{allLabel}</option>
        {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </label>
    {hasSubdepartments && <label className="mb-2 flex items-center gap-2 text-xs">
      <input type="checkbox" className="!w-auto" checked={includeSubdepartments} disabled={disabled}
        onChange={event => onChange({ departmentId, includeSubdepartments: event.target.checked })} />
      含下级部门
    </label>}
  </div>
}

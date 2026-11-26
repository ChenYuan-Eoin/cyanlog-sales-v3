'use client'

import { useId, useState } from 'react'
import { CheckCheckIcon, ChevronDownIcon, ChevronUpIcon, EraserIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ORG_MEMBER_LIFECYCLE_ACTIONS } from '@/lib/admin/member-action-keys'
import { getEffectiveOwnerShippingPermissions, getEffectiveShippingPermissions, legacyShippingPermission, SHIPPING_RECORD_RETURN } from '@/lib/module-access'
import { isOrganizationSourcePermissionKey, ORG_BUSINESS_ROLE_ASSIGN, ORG_DEPARTMENT_STRUCTURE_PERMISSION_KEYS, ORG_MEMBER_EDIT } from '@/lib/permissions'
import { canRevokeShippingAction, getPermissionGrantSource, isRolePermissionEnabled, isRolePermissionExplicitlyGranted } from '@/lib/role-permission-policy'
import { isShippingOwnerPermission } from '@/lib/shipping/owner-permission-keys'
import {
  getDirectoryActions,
  legacyPermissionLabels,
  registeredShippingPermissionKeys,
  removableShippingCompatibilityKeys,
  type PermissionDirectoryGroup,
  type ShippingDirectoryEntry,
} from '../permission-directory'

const retainedLegacyGrantKeys = new Set<string>([
  ORG_BUSINESS_ROLE_ASSIGN, ORG_MEMBER_EDIT, ...ORG_DEPARTMENT_STRUCTURE_PERMISSION_KEYS, ...ORG_MEMBER_LIFECYCLE_ACTIONS,
])

export type EmployeeDepartmentRange = { department_id: string; include_subdepartments: boolean }
export type EmployeePermissionScope = { type: 'self' } | { type: 'org' }
  | { type: 'department'; departments: EmployeeDepartmentRange[] }
export type EmployeePermissionOverride = { effect: 'DENY'; scope: null }
  | { effect: 'ALLOW'; scope: EmployeePermissionScope } | null

export type EmployeePermissionDepartment = { id: string; name: string; parent_id: string | null }

export interface EmployeePermissionState {
  key: string
  base: boolean
  effective: boolean
  base_scope: EmployeePermissionScope | null
  effective_scope: EmployeePermissionScope | null
  override: EmployeePermissionOverride
  sources: Array<{ kind: 'role' | 'department'; name: string }>
  can_edit: boolean
}

interface DirectoryTableProps {
  description: string
  groups: PermissionDirectoryGroup[]
}

interface GrantTableProps extends DirectoryTableProps {
  perms: string[]
  ownerPerms: string[]
  availableModuleKeys: ReadonlySet<string>
  shippingPublication?: { registered: ReadonlySet<string>; published: ReadonlySet<string> }
  entryStates?: Partial<Record<ShippingDirectoryEntry, { checked: boolean; canClear: boolean }> & { config: boolean }>
  isSuperAdmin: boolean
  readOnly: boolean
  ownerReadOnly: boolean
  blockReason?: string | null
  onToggle: (key: string) => void
  onSetGroup: (keys: string[], enabled: boolean) => void
  onClearEntry?: (entry: ShippingDirectoryEntry) => void
}

interface EmployeeTableProps extends DirectoryTableProps {
  employee: {
    permissions: ReadonlyMap<string, EmployeePermissionState>
    departments: EmployeePermissionDepartment[]
    published: ReadonlySet<string>
    disabled: boolean
    onChange: (state: EmployeePermissionState, override: EmployeePermissionOverride) => void
  }
}

function departmentName(departments: EmployeePermissionDepartment[], id: string) {
  const department = departments.find(item => item.id === id)
  if (!department) return '已停用或不可见的部门'
  const parent = departments.find(item => item.id === department.parent_id)
  return parent ? parent.name + ' / ' + department.name : department.name
}

function scopeText(scope: EmployeePermissionScope | null, departments: EmployeePermissionDepartment[]) {
  if (!scope) return '无'
  if (scope.type === 'self') return '本人'
  if (scope.type === 'org') return '全组织'
  return scope.departments.map(department => departmentName(departments, department.department_id)
    + (department.include_subdepartments ? '（含下级）' : '')).join('、')
}

export function sameEmployeeOverride(first: EmployeePermissionOverride, second: EmployeePermissionOverride) {
  if (first?.effect !== second?.effect || first?.scope?.type !== second?.scope?.type) return false
  if (first?.scope?.type !== 'department' || second?.scope?.type !== 'department') return true
  const ranges = new Map(second.scope.departments.map(row => [row.department_id, row.include_subdepartments]))
  return first.scope.departments.length === ranges.size
    && first.scope.departments.every(row => ranges.get(row.department_id) === row.include_subdepartments)
}

function EmployeePermissionControls({ state, label, employee }: {
  state: EmployeePermissionState
  label: string
  employee: EmployeeTableProps['employee']
}) {
  const [effect, setEffect] = useState(state.override?.effect ?? '')
  const initialScope = state.override?.scope ?? state.base_scope
  const [scopeType, setScopeType] = useState<EmployeePermissionScope['type'] | ''>(initialScope?.type ?? '')
  const [ranges, setRanges] = useState<EmployeeDepartmentRange[]>(initialScope?.type === 'department' ? initialScope.departments : [])
  const selfOnly = isShippingOwnerPermission(state.key)
  const scope: EmployeePermissionScope | null = selfOnly ? { type: 'self' }
    : scopeType === 'department' && ranges.length > 0 ? { type: 'department', departments: ranges }
      : scopeType === 'org' ? { type: 'org' } : null
  const next: EmployeePermissionOverride = effect === 'DENY' ? { effect, scope: null }
    : effect === 'ALLOW' && scope ? { effect, scope } : null
  const canSetOverride = state.can_edit && employee.published.has(state.key)
  const valid = effect === '' ? state.can_edit
    : canSetOverride && (effect === 'DENY' || scope !== null)
  const selectClass = 'rounded-md border border-slate-200 bg-white px-2 py-1 text-sm disabled:opacity-60'

  return (
    <div className="space-y-1.5 text-sm">
      <p>基础范围 {scopeText(state.base_scope, employee.departments)}</p>
      <p>最终范围 {scopeText(state.effective_scope, employee.departments)}</p>
      <p className="text-xs text-slate-600">基础来源 {state.sources.length > 0
        ? state.sources.map(source => (source.kind === 'department' ? '部门 ' : '角色 ') + source.name).join('、')
        : '无'}</p>
      {!state.can_edit ? (
        <p className="text-xs text-slate-600">
          个人设置 {state.override?.effect === 'ALLOW' ? '开启' : state.override?.effect === 'DENY' ? '关闭' : '沿用'}（只读）
        </p>
      ) : (
        <fieldset disabled={employee.disabled} className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex flex-wrap items-center gap-2">
              个人设置
              <select
                aria-label={label + ' 个人设置'}
                className={selectClass}
                value={effect}
                onChange={event => setEffect(event.currentTarget.value as 'ALLOW' | 'DENY' | '')}
              >
                <option value="">沿用</option>
                <option value="ALLOW" disabled={!canSetOverride}>开启</option>
                <option value="DENY" disabled={!canSetOverride}>关闭</option>
              </select>
            </label>
            {effect === 'ALLOW' && (
              selfOnly ? <span>数据范围 本人</span> : (
                <label className="inline-flex flex-wrap items-center gap-2">
                  数据范围
                  <select aria-label={label + ' 数据范围'} className={selectClass} value={scopeType}
                    onChange={event => setScopeType(event.currentTarget.value as 'org' | 'department' | '')}>
                    <option value="">请选择</option>
                    <option value="org">全组织</option>
                    <option value="department">指定部门</option>
                  </select>
                </label>
              )
            )}
            <Button type="button" size="sm" variant="outline" disabled={!valid || sameEmployeeOverride(next, state.override)}
              onClick={() => employee.onChange(state, next)}>
              保存{label}
            </Button>
          </div>
          {effect === 'ALLOW' && !selfOnly && scopeType === 'department' && (
            <div className="space-y-1.5">
              {ranges.map(range => {
                const name = departmentName(employee.departments, range.department_id)
                return (
                  <div key={range.department_id} className="flex flex-wrap items-center gap-2">
                    <span>{name}</span>
                    <label className="inline-flex items-center gap-1">
                      <input type="checkbox" aria-label={label + ' ' + name + ' 含下级'} checked={range.include_subdepartments}
                        onChange={event => {
                          const include_subdepartments = event.currentTarget.checked
                          setRanges(previous => previous.map(row => row.department_id === range.department_id
                            ? { ...row, include_subdepartments } : row))
                        }} />
                      含下级
                    </label>
                    <Button type="button" size="sm" variant="ghost" aria-label={'移除数据部门 ' + name}
                      onClick={() => setRanges(previous => previous.filter(row => row.department_id !== range.department_id))}>
                      移除
                    </Button>
                  </div>
                )
              })}
              <label className="inline-flex flex-wrap items-center gap-2">
                加入数据部门
                <select aria-label={label + ' 加入数据部门'} className={selectClass} value=""
                  onChange={event => {
                    const department_id = event.currentTarget.value
                    if (department_id) setRanges(previous => [...previous, { department_id, include_subdepartments: false }])
                  }}>
                  <option value="">请选择</option>
                  {employee.departments.filter(department => !ranges.some(range => range.department_id === department.id))
                    .map(department => <option key={department.id} value={department.id}>{departmentName(employee.departments, department.id)}</option>)}
                </select>
              </label>
            </div>
          )}
        </fieldset>
      )}
    </div>
  )
}

export function PermissionSettingTable(props: GrantTableProps | EmployeeTableProps) {
  const { description, groups } = props
  const employee = 'employee' in props ? props.employee : undefined
  const grant = 'perms' in props ? props : undefined
  const {
    perms = [], ownerPerms = [], availableModuleKeys = new Set<string>(), shippingPublication,
    entryStates, isSuperAdmin = false, readOnly = true, ownerReadOnly = true, blockReason,
    onToggle, onSetGroup, onClearEntry,
  } = grant ?? {}
  const tableId = useId()
  const actions = groups.flatMap(getDirectoryActions)
  const availableKeys = new Set(actions.filter(item => item.available).map(item => item.key))
  const publication = shippingPublication ?? {
    registered: registeredShippingPermissionKeys,
    published: availableModuleKeys,
  }
  const effectiveShippingKeys = new Set<string>(getEffectiveShippingPermissions(perms, publication))
  const effectiveOwnerKeys = new Set<string>(getEffectiveOwnerShippingPermissions(ownerPerms, publication))
  const permissionLabels = new Map(actions.map(item => [item.key, item.label]))
  const labelFor = (key: string) => permissionLabels.get(key) ?? legacyPermissionLabels[key] ?? key
  const existingGrants = [...new Set([...perms, ...ownerPerms])].filter(key => !availableKeys.has(key))
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  function isEffective(key: string): boolean {
    if (employee) return employee.permissions.get(key)?.effective === true
    if (isShippingOwnerPermission(key)) return effectiveOwnerKeys.has(key)
    if (isSuperAdmin && isOrganizationSourcePermissionKey(key)) return true
    if (key === SHIPPING_RECORD_RETURN) return isSuperAdmin ? effectiveShippingKeys.has(key) : perms.includes(key) && effectiveShippingKeys.has(key)
    return legacyShippingPermission(key)
      ? effectiveShippingKeys.has(key)
      : isRolePermissionEnabled(perms, key)
  }

  function isExplicit(key: string) {
    return isRolePermissionExplicitlyGranted(isShippingOwnerPermission(key) ? ownerPerms : perms, key)
  }

  function hasRetainedLegacyGrant(key: string): boolean {
    if (!retainedLegacyGrantKeys.has(key)) return false
    return isRolePermissionEnabled(perms.filter(permission => permission !== key), key)
  }

  function toggleGroup(groupId: string) {
    setCollapsedGroups(current => {
      const next = new Set(current)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  function renderEntry(group: PermissionDirectoryGroup) {
    if (!group.entry || !entryStates) return null
    if (group.entry === 'config') {
      if (entryStates.config === undefined) return null
      return <Badge variant={entryStates.config ? 'secondary' : 'outline'}>{entryStates.config ? '入口已开放' : '入口未开放'}</Badge>
    }
    const entry = group.entry
    const state = entryStates[entry]
    if (!state) return null
    const { checked, canClear } = state
    return (
      <div className="flex shrink-0 items-center gap-2 text-xs text-slate-600">
        <span>入口</span>
        <button
          type="button"
          role="switch"
          aria-label={`${group.label}入口`}
          aria-checked={checked}
          disabled={!canClear}
          title={canClear ? '关闭入口并清除本模块授权' : checked ? '入口由保留授权控制' : '选择下方的权限后开放入口'}
          onClick={() => onClearEntry?.(entry)}
          className={`relative h-5 w-9 rounded-full focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-default ${checked ? 'bg-blue-600' : 'bg-slate-300'}`}
        >
          <span aria-hidden="true" className={`absolute top-0.5 h-4 w-4 rounded-full bg-white ${checked ? 'right-0.5' : 'left-0.5'}`} />
        </button>
      </div>
    )
  }

  function renderGroup(group: PermissionDirectoryGroup, nested = false) {
    const isExpanded = !collapsedGroups.has(group.id)
    const items = group.actions ?? []
    const groupReadOnly = items.length > 0 && items.every(item => isShippingOwnerPermission(item.key)) ? ownerReadOnly : readOnly
    const directKeys = items.filter(item => item.available).map(item => item.key)
    const expandedKeys = getDirectoryActions(group).filter(item => employee
      ? employee.permissions.has(item.key)
      : item.available || effectiveShippingKeys.has(item.key)).map(item => item.key)
    const effectiveCount = expandedKeys.filter(isEffective).length
    const allEffective = expandedKeys.length > 0 && effectiveCount === expandedKeys.length
    const grantableKeys = directKeys.filter(key => !hasRetainedLegacyGrant(key) && (legacyShippingPermission(key)
      ? !isEffective(key)
      : !isExplicit(key)))
    const candidatesToRevoke = directKeys.filter(key => isEffective(key)
      && !hasRetainedLegacyGrant(key)
      && canRevokeShippingAction(perms, key, availableModuleKeys))
    const revocableKeys = candidatesToRevoke.filter(key => !actions.some(action =>
      action.dependencies?.includes(key) && isEffective(action.key)
      && !candidatesToRevoke.includes(action.key)))

    return (
      <section key={group.id} aria-label={group.label} className={nested ? 'rounded-lg border border-slate-200 bg-white' : 'rounded-xl border border-slate-200'}>
        <div className="flex items-center gap-2 px-4 py-3">
          <button
            type="button"
            onClick={() => toggleGroup(group.id)}
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
            aria-expanded={isExpanded}
            aria-controls={`${tableId}-permission-directory-${group.id}`}
          >
            {isExpanded
              ? <ChevronDownIcon aria-hidden="true" size={16} className="text-slate-500" />
              : <ChevronUpIcon aria-hidden="true" size={16} className="text-slate-500" />}
            <span className="font-medium text-slate-900">{group.label}</span>
          </button>
          {renderEntry(group)}
          {expandedKeys.length > 0 && (
            <Badge variant={allEffective ? 'default' : effectiveCount > 0 ? 'secondary' : 'outline'}>
              {employee ? effectiveCount + ' 项已开启' : allEffective ? '全部生效' : effectiveCount > 0 ? '部分生效' : '未生效'}
            </Badge>
          )}
          {!groupReadOnly && directKeys.length > 0 && (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onSetGroup?.(grantableKeys, true)}
                disabled={grantableKeys.length === 0}
                aria-label={`选择${group.label}直接权限`}
                title="选择本组直接权限"
              >
                <CheckCheckIcon className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onSetGroup?.(revocableKeys, false)}
                disabled={revocableKeys.length === 0}
                aria-label={`清除${group.label}直接权限`}
                title="清除本组直接权限"
              >
                <EraserIcon className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
        <div id={`${tableId}-permission-directory-${group.id}`} hidden={!isExpanded}>
          {(items.length > 0 || (group.notes?.length ?? 0) > 0) && (
            <ul className="divide-y border-t px-4">
              {items.map(item => {
                if (employee) {
                  const state = employee.permissions.get(item.key)
                  return (
                    <li key={item.key} className="space-y-1 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-slate-900">{item.label}</span>
                        {item.capabilityLevel && <Badge variant="outline">{item.capabilityLevel}</Badge>}
                        {state ? <>
                          <Badge variant="outline">基础{state.base ? '开启' : '关闭'}</Badge>
                          <Badge variant={state.effective ? 'secondary' : 'outline'}>最终{state.effective ? '开启' : '关闭'}</Badge>
                        </> : <Badge variant="outline">个人设置待接入</Badge>}
                      </div>
                      <div className="text-xs text-slate-500">{item.description}</div>
                      {state && <EmployeePermissionControls key={JSON.stringify([state.override, state.base_scope])}
                        state={state} label={item.label} employee={employee} />}
                    </li>
                  )
                }
                const ownerAction = isShippingOwnerPermission(item.key)
                const explicit = isExplicit(item.key)
                const effective = isEffective(item.key)
                const shippingAction = legacyShippingPermission(item.key) !== null
                const inheritedLegacy = hasRetainedLegacyGrant(item.key)
                const checked = isSuperAdmin || ownerAction || shippingAction || inheritedLegacy ? effective : explicit
                const source = effective && !ownerAction ? getPermissionGrantSource(perms, item.key, undefined, isSuperAdmin) : null
                const dependent = explicit && actions.find(action =>
                  action.available && action.dependencies?.includes(item.key) && isEffective(action.key))
                const missingDependency = item.dependencies?.find(key => !isEffective(key))
                const unavailableForRevoke = item.available && shippingAction && checked
                  && !canRevokeShippingAction(perms, item.key, availableModuleKeys)
                return (
                  <li key={item.key} className="flex items-start gap-3 py-2.5">
                    {item.available && (
                      <input
                        type="checkbox"
                        aria-label={item.label}
                        checked={checked}
                        disabled={groupReadOnly || !!dependent || unavailableForRevoke || inheritedLegacy}
                        onChange={() => onToggle?.(item.key)}
                        className="mt-1"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-slate-900">{item.label}</span>
                        {item.capabilityLevel && <Badge variant="outline">{item.capabilityLevel}</Badge>}
                        {item.scopeTypes?.includes('department') && item.grantSubjectTypes?.length === 1 && item.grantSubjectTypes[0] === 'role'
                          && <Badge variant="outline">角色可按部门授权</Badge>}
                        {!item.available && <Badge variant="outline">{effective ? '旧授权生效' : '待接入'}</Badge>}
                        {explicit && item.available && <Badge variant="outline">{ownerAction ? '角色授权' : '显式授权'}</Badge>}
                        {item.available && effective && !explicit && <Badge variant="secondary">当前有效</Badge>}
                        {source?.via === 'bundle' && <Badge variant="secondary">由 {labelFor(source.grant)} 汇总</Badge>}
                        {source?.via === 'dependency' && <Badge variant="secondary">由 {labelFor(source.grant)} 依赖生效</Badge>}
                        {missingDependency && <Badge variant="outline">勾选时补齐 {labelFor(missingDependency)}</Badge>}
                        {dependent && <Badge variant="outline">供 {dependent.label} 使用</Badge>}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">{item.description}</div>
                      {unavailableForRevoke && (
                        <div className="mt-0.5 text-xs text-slate-500">同组权限发布完整后才能单独撤销这项旧授权。</div>
                      )}
                      {inheritedLegacy && (
                        <div className="mt-0.5 text-xs text-slate-500">已有授权包含此动作，当前只能随原授权一起维护。</div>
                      )}
                    </div>
                  </li>
                )
              })}
              {group.notes?.map(note => (
                <li key={note.label} className="py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-slate-700">{note.label}</span>
                    <Badge variant="outline">{note.status}</Badge>
                  </div>
                  {note.description && <div className="mt-0.5 text-xs text-slate-500">{note.description}</div>}
                </li>
              ))}
            </ul>
          )}
          {group.children && (
            <div className="space-y-2 border-t bg-slate-50/50 p-3">
              {group.children.map(child => renderGroup(child, true))}
            </div>
          )}
        </div>
      </section>
    )
  }

  return (
    <div className="space-y-3 p-6">
      <p className="text-sm text-slate-600">{description}</p>
      {readOnly && blockReason && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-900">
          {blockReason}
        </div>
      )}
      {groups.map(group => renderGroup(group))}
      {existingGrants.length > 0 && (
        <details className="rounded-xl border border-slate-200">
          <summary className="cursor-pointer px-4 py-3 font-medium text-slate-900">已有兼容授权</summary>
          <ul className="divide-y border-t px-4">
            {existingGrants.map(key => (
              <li key={key} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="flex flex-wrap items-center gap-2">
                  {labelFor(key)}
                  <Badge variant="outline">已保存</Badge>
                </span>
                {!readOnly && removableShippingCompatibilityKeys.includes(key) && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => onToggle?.(key)} aria-label={`移除${labelFor(key)}`}>
                    移除
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

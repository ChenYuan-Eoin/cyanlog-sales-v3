'use client'

import { useState } from 'react'
import { CheckCheckIcon, ChevronDownIcon, ChevronUpIcon, EraserIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ORG_MEMBER_LIFECYCLE_ACTIONS } from '@/lib/admin/member-action-keys'
import { getEffectiveOwnerShippingPermissions, getEffectiveShippingPermissions, legacyShippingPermission } from '@/lib/module-access'
import { ORG_BUSINESS_ROLE_ASSIGN, ORG_DEPARTMENT_STRUCTURE_PERMISSION_KEYS, ORG_MEMBER_EDIT } from '@/lib/permissions'
import { canRevokeShippingAction, getPermissionGrantSource, isRolePermissionEnabled, isRolePermissionExplicitlyGranted } from '@/lib/role-permission-policy'
import { isShippingOwnerPermission } from '@/lib/shipping/owner-permission-keys'
import {
  getDirectoryActions,
  legacyPermissionLabels,
  registeredShippingPermissionKeys,
  removableShippingCompatibilityKeys,
  type PermissionDirectoryGroup,
} from '../permission-directory'

const retainedLegacyGrantKeys = new Set<string>([
  ORG_BUSINESS_ROLE_ASSIGN, ORG_MEMBER_EDIT, ...ORG_DEPARTMENT_STRUCTURE_PERMISSION_KEYS, ...ORG_MEMBER_LIFECYCLE_ACTIONS,
])

interface PermissionSettingTableProps {
  description: string
  editableOwnerNote?: string
  perms: string[]
  ownerPerms: string[]
  groups: PermissionDirectoryGroup[]
  availableModuleKeys: ReadonlySet<string>
  isSuperAdmin: boolean
  readOnly: boolean
  ownerReadOnly: boolean
  blockReason?: string | null
  onToggle: (key: string) => void
  onSetGroup: (keys: string[], enabled: boolean) => void
}

export function PermissionSettingTable({
  description, editableOwnerNote, perms, ownerPerms, groups, availableModuleKeys, isSuperAdmin, readOnly, ownerReadOnly, blockReason, onToggle, onSetGroup,
}: PermissionSettingTableProps) {
  const actions = groups.flatMap(getDirectoryActions)
  const availableKeys = new Set(actions.filter(item => item.available).map(item => item.key))
  const effectiveShippingKeys = new Set<string>(getEffectiveShippingPermissions(perms, {
    registered: registeredShippingPermissionKeys,
    published: availableModuleKeys,
  }))
  const effectiveOwnerKeys = new Set<string>(getEffectiveOwnerShippingPermissions(ownerPerms, { published: availableModuleKeys }))
  const permissionLabels = new Map(actions.map(item => [item.key, item.label]))
  const labelFor = (key: string) => permissionLabels.get(key) ?? legacyPermissionLabels[key] ?? key
  const existingGrants = [...new Set([...perms, ...ownerPerms])].filter(key => !availableKeys.has(key))
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  function isEffective(key: string): boolean {
    if (isShippingOwnerPermission(key)) return effectiveOwnerKeys.has(key)
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

  function renderGroup(group: PermissionDirectoryGroup, nested = false) {
    const isExpanded = !collapsedGroups.has(group.id)
    const items = group.actions ?? []
    const groupReadOnly = items.length > 0 && items.every(item => isShippingOwnerPermission(item.key)) ? ownerReadOnly : readOnly
    const directKeys = items.filter(item => item.available).map(item => item.key)
    const expandedKeys = getDirectoryActions(group)
      .filter(item => item.available || effectiveShippingKeys.has(item.key)).map(item => item.key)
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
            aria-controls={`permission-directory-${group.id}`}
          >
            {isExpanded
              ? <ChevronDownIcon aria-hidden="true" size={16} className="text-slate-500" />
              : <ChevronUpIcon aria-hidden="true" size={16} className="text-slate-500" />}
            <span className="font-medium text-slate-900">{group.label}</span>
          </button>
          {expandedKeys.length > 0 && (
            <Badge variant={allEffective ? 'default' : effectiveCount > 0 ? 'secondary' : 'outline'}>
              {allEffective ? '全部生效' : effectiveCount > 0 ? '部分生效' : '未生效'}
            </Badge>
          )}
          {!groupReadOnly && directKeys.length > 0 && (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onSetGroup(grantableKeys, true)}
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
                onClick={() => onSetGroup(revocableKeys, false)}
                disabled={revocableKeys.length === 0}
                aria-label={`清除${group.label}直接权限`}
                title="清除本组直接权限"
              >
                <EraserIcon className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
        <div id={`permission-directory-${group.id}`} hidden={!isExpanded}>
          {(items.length > 0 || (group.notes?.length ?? 0) > 0) && (
            <ul className="divide-y border-t px-4">
              {items.map(item => {
                const ownerAction = isShippingOwnerPermission(item.key)
                const explicit = isExplicit(item.key)
                const effective = isEffective(item.key)
                const shippingAction = legacyShippingPermission(item.key) !== null
                const inheritedLegacy = hasRetainedLegacyGrant(item.key)
                const checked = isSuperAdmin || ownerAction || shippingAction || inheritedLegacy ? effective : explicit
                const source = effective && !ownerAction ? getPermissionGrantSource(perms, item.key) : null
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
                        onChange={() => onToggle(item.key)}
                        className="mt-1"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-slate-900">{item.label}</span>
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
          {!ownerReadOnly && editableOwnerNote && <p>{editableOwnerNote}</p>}
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
                  <Button type="button" variant="ghost" size="sm" onClick={() => onToggle(key)} aria-label={`移除${labelFor(key)}`}>
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

'use client'

import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  SearchIcon,
  UsersIcon,
  ShieldIcon,
  TrashIcon,
  UserPlusIcon,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import Fuse from 'fuse.js'
import {
  grantExplicitRolePermissions,
  isRolePermissionExplicitlyGranted,
  revokeRolePermissions,
  toggleExplicitRolePermission,
} from '@/lib/role-permission-policy'
import {
  getEffectiveOwnerShippingPermissions, getEffectiveShippingPermissions, legacyShippingPermission,
} from '@/lib/module-access'
import { getConfigsTabAccess, hasConfigsTabAccess } from '@/lib/configs/tab-access'
import { isShippingOwnerPermission } from '@/lib/shipping/owner-permission-keys'
import { success, error, confirmAction } from '@/lib/toast'
import { FXIAOKE_BASELINE_ROLE_CODE, isRetiredRoleCode, ORG_SUPER_ADMIN_ROLE_CODE } from '@/lib/role-permission-resolution'
import type { RoleModulePermissionCatalog, ShippingPermissionPublication } from '@/lib/org-role-permission-readback'
import type { OrgSummaryUser, OrgSummaryDepartment } from '../types'
import {
  buildRolePermissionDirectory,
  clearShippingEntryGrants,
  getDirectoryActions,
  registeredShippingPermissionKeys,
  type ShippingDirectoryEntry,
} from '../permission-directory'
import {
  getRoleMutationRestriction,
  editableOrgRoleIds,
  partitionRoleMutationTargets,
} from './role-assignment-policy'
import { PermissionSettingTable } from './PermissionSettingTable'
import { getRoleMembershipStats, type RoleMember, type RoleMembershipStats } from './role-membership-stats'

// ============ Props 类型 ============

interface SystemSuperAdminAuthority {
  orgId: string
  memberIds?: readonly string[]
}

interface RoleDetailPanelProps {
  role: {
    id: string
    code: string
    name: string
    description: string | null
    permissions: string[] | null
    owner_shipping_permissions?: string[]
    permissions_overridden?: boolean
    permissions_edit_block_reason?: string | null
  }
  currentUserId: string | null
  saving: boolean
  onSave: (perms: string[], ownerShippingPermissions?: string[]) => void
  permissionsEditable?: boolean
  modulePermissionCatalog?: RoleModulePermissionCatalog
  shippingPermissionPublication?: ShippingPermissionPublication
  permissionsEditBlockReason?: string | null
  canAssignBusinessRoles?: boolean
  systemSuperAdminAuthority?: SystemSuperAdminAuthority
  users: OrgSummaryUser[]
  membershipStats?: RoleMembershipStats
  departments: OrgSummaryDepartment[]
  onRefresh?: () => void | Promise<void>
  onPermissionDraftChange?: (roleId: string, changed: boolean) => void
  metadataActions?: { disabled: boolean; rename: () => void; archive: () => void }
}

// ============ 主组件 ============

export function RoleDetailPanel({
  role,
  currentUserId,
  saving,
  onSave,
  permissionsEditable = false,
  modulePermissionCatalog,
  shippingPermissionPublication,
  permissionsEditBlockReason,
  canAssignBusinessRoles = false,
  systemSuperAdminAuthority,
  users,
  membershipStats,
  departments,
  onRefresh,
  onPermissionDraftChange,
  metadataActions,
}: RoleDetailPanelProps) {
  const [activeTab, setActiveTab] = useState('members')
  const [perms, setPerms] = useState<string[]>(role.permissions ?? [])
  const [ownerPerms, setOwnerPerms] = useState<string[]>(role.owner_shipping_permissions ?? [])
  const isSuperAdmin = role.code === 'SUPER_ADMIN'
  const isOrgSuperAdmin = role.code === ORG_SUPER_ADMIN_ROLE_CODE
  const protectedRole = isSuperAdmin || isOrgSuperAdmin
  const canEditPermissions = permissionsEditable && !protectedRole && role.code !== FXIAOKE_BASELINE_ROLE_CODE && !role.permissions_edit_block_reason
  const canEditOwnerPermissions = canEditPermissions && role.owner_shipping_permissions !== undefined
  let assignmentBlockReason: string | null = null
  if (!currentUserId) {
    assignmentBlockReason = '当前登录身份尚未确认，角色分配暂不可用。'
  } else if (protectedRole && !systemSuperAdminAuthority) {
    assignmentBlockReason = '仅本组织的系统超级管理员可管理此角色成员。'
  } else if (!protectedRole && !canAssignBusinessRoles) {
    assignmentBlockReason = '当前账号可查看成员分配记录。'
  }

  const stats = useMemo(
    () => membershipStats ?? getRoleMembershipStats(users, role.id),
    [membershipStats, users, role.id],
  )

  // 权限变更时同步
  useEffect(() => {
    setPerms(role.permissions ?? [])
  }, [role.id, role.permissions])
  useEffect(() => {
    setOwnerPerms(role.owner_shipping_permissions ?? [])
  }, [role.id, role.owner_shipping_permissions])

  const hasChanges = JSON.stringify([...perms].sort()) !== JSON.stringify([...(role.permissions ?? [])].sort())
  const hasOwnerChanges = JSON.stringify([...ownerPerms].sort()) !== JSON.stringify([...(role.owner_shipping_permissions ?? [])].sort())
  const hasEditableDraft = canEditPermissions && hasChanges || canEditOwnerPermissions && hasOwnerChanges
  useEffect(() => {
    onPermissionDraftChange?.(role.id, hasEditableDraft)
  }, [hasEditableDraft, onPermissionDraftChange, role.id])
  const catalogKeys = useMemo(() => new Set(
    modulePermissionCatalog?.flatMap(group => group.items
      .filter(item => !('selectable' in item) || item.selectable !== false)
      .map(item => item.key)),
  ), [modulePermissionCatalog])
  const shippingPublication = useMemo(() => shippingPermissionPublication
    ? { registered: new Set(shippingPermissionPublication.registered), published: new Set(shippingPermissionPublication.published) }
    : { registered: registeredShippingPermissionKeys, published: catalogKeys }, [shippingPermissionPublication, catalogKeys])
  const availableModuleKeys = useMemo(() => new Set([...catalogKeys].filter(key => shippingPublication.published.has(key))), [catalogKeys, shippingPublication])
  const permissionGroups = useMemo(() => buildRolePermissionDirectory(modulePermissionCatalog?.map(group => ({
    ...group, items: group.items.filter(item => availableModuleKeys.has(item.key)),
  }))), [modulePermissionCatalog, availableModuleKeys])

  const effectiveShipping = getEffectiveShippingPermissions(perms, shippingPublication)
  const ledgerEntry = effectiveShipping.includes('shipping:ledger_view')
  const settingsEntry = effectiveShipping.includes('shipping:settings_view')
  const ownerEntry = getEffectiveOwnerShippingPermissions(ownerPerms, shippingPublication).includes('shipping:owner_view')
  const canClearOrdinaryEntry = canEditPermissions && !perms.includes('*')
  const entryStates = {
    shipping: {
      checked: ledgerEntry || ownerEntry,
      canClear: !saving && (ledgerEntry || ownerEntry) && (!ledgerEntry || canClearOrdinaryEntry) && (!ownerEntry || canEditOwnerPermissions),
    },
    'shipping-settings': { checked: settingsEntry, canClear: !saving && settingsEntry && canClearOrdinaryEntry },
    config: hasConfigsTabAccess(getConfigsTabAccess({
      permissions: perms,
      systemAdministrator: isSuperAdmin,
      shippingSettingsView: settingsEntry,
    })),
  }

  function includePermissionDependencies(keys: string[]): string[] {
    const actions = new Map(permissionGroups.flatMap(getDirectoryActions).map(item => [item.key, item]))
    const expanded = new Set(keys)
    for (const key of expanded) {
      const dependencies = actions.get(key)?.dependencies ?? []
      for (const dependency of dependencies) expanded.add(dependency)
    }
    return [...expanded]
  }

  function togglePermission(key: string) {
    if (isShippingOwnerPermission(key)) {
      if (!canEditOwnerPermissions || saving || !availableModuleKeys.has(key)) return
      setOwnerPerms(current => current.includes(key)
        ? toggleExplicitRolePermission(current, key)
        : grantExplicitRolePermissions(current, includePermissionDependencies([key])))
      return
    }
    if (!canEditPermissions || saving) return
    setPerms(current => {
      if (legacyShippingPermission(key) && getEffectiveShippingPermissions(current, shippingPublication).some(permission => permission === key)) {
        return revokeRolePermissions(current, [key], [], availableModuleKeys)
      }
      return isRolePermissionExplicitlyGranted(current, key)
        ? toggleExplicitRolePermission(current, key)
        : grantExplicitRolePermissions(current, includePermissionDependencies([key]))
    })
  }

  function setPermissionGroup(keys: string[], enabled: boolean) {
    if (keys.length > 0 && keys.every(isShippingOwnerPermission)) {
      if (!canEditOwnerPermissions || saving) return
      setOwnerPerms(current => enabled
        ? grantExplicitRolePermissions(current, includePermissionDependencies(keys))
        : current.filter(key => !keys.some(removed => removed === key)))
      return
    }
    if (!canEditPermissions || saving) return
    setPerms(current => enabled
      ? grantExplicitRolePermissions(current, includePermissionDependencies(keys))
      : revokeRolePermissions(current, keys, [], availableModuleKeys))
  }

  function clearPermissionEntry(entry: ShippingDirectoryEntry) {
    if (!entryStates[entry].canClear) return
    if (canClearOrdinaryEntry) setPerms(current => clearShippingEntryGrants(current, entry, shippingPublication))
    if (entry === 'shipping' && canEditOwnerPermissions) setOwnerPerms(current => current.filter(key => !isShippingOwnerPermission(key)))
  }

  return (
    <div className="rounded-lg border bg-white overflow-hidden">
      {/* 头部信息 */}
      <div className="border-b px-6 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-4">
            <div
              className={`flex h-12 w-12 items-center justify-center rounded-xl ${
                protectedRole ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
              }`}
            >
              {protectedRole ? <ShieldIcon size={24} /> : <UsersIcon size={24} />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold text-slate-900">{role.name}</h2>
                {isSuperAdmin && (
                  <Badge className="bg-amber-100 text-amber-800 border-amber-200">
                    系统固定
                  </Badge>
                )}
              </div>
              <div className="text-sm text-slate-500 mt-1">
                {isRetiredRoleCode(role.code) ? `${role.code} · 历史角色已停用`
                  : `${role.code} · 已生效 ${stats.effectiveMemberCount ?? '待核对'} · 待生效 ${stats.pendingMemberCount ?? '待核对'} · 生效作用域绑定 ${stats.effectiveBindingCount ?? '待核对'}`}
              </div>
              {role.description && (
                <p className="text-sm text-slate-600 mt-2">{role.description}</p>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {metadataActions && <>
              <Button type="button" variant="outline" size="sm" onClick={metadataActions.rename} disabled={metadataActions.disabled || hasEditableDraft}>改名</Button>
              <Button type="button" variant="ghost" size="sm" onClick={metadataActions.archive} disabled={metadataActions.disabled || hasEditableDraft}>归档</Button>
            </>}
            {(canEditPermissions || canEditOwnerPermissions) && activeTab === 'permissions' && (
              <Button
                onClick={() => {
                  if (hasOwnerChanges && canEditOwnerPermissions) onSave(canEditPermissions ? perms : role.permissions ?? [], ownerPerms)
                  else if (hasChanges && canEditPermissions) onSave(perms)
                }}
                disabled={saving || !hasEditableDraft}
              >
                {saving ? '正在保存授权…' : hasEditableDraft ? '保存授权' : '授权已保存'}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Tab 切换 */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="border-b px-6">
          <TabsList className="h-12 bg-transparent p-0 gap-6">
            <TabsTrigger
              value="members"
              className="data-[state=active]:border-b-2 data-[state=active]:border-blue-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none rounded-none h-12 px-0"
            >
              员工分配 ({stats.members.length})
            </TabsTrigger>
            <TabsTrigger
              value="permissions"
              className="data-[state=active]:border-b-2 data-[state=active]:border-blue-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none rounded-none h-12 px-0"
            >
              权限设置
            </TabsTrigger>
          </TabsList>
        </div>

        {/* 员工分配 Tab */}
        <TabsContent value="members" className="m-0">
          <MemberAssignmentTab
            key={role.id}
            systemSuperAdminAuthority={protectedRole ? systemSuperAdminAuthority : undefined}
            roleCode={role.code}
            roleId={role.id}
            roleName={role.name}
            assignmentEditable={!assignmentBlockReason}
            assignmentBlockReason={assignmentBlockReason}
            currentUserId={currentUserId}
            users={users}
            _departments={departments}
            members={stats.members}
            onRefresh={onRefresh}
          />
        </TabsContent>

        {/* 权限设置 Tab */}
        <TabsContent value="permissions" className="m-0">
          <PermissionSettingTable
            description="此处设置角色可以执行的操作。业务参数由各功能的设置页维护。"
            perms={perms}
            ownerPerms={ownerPerms}
            groups={permissionGroups}
            availableModuleKeys={availableModuleKeys}
            shippingPublication={shippingPublication}
            entryStates={entryStates}
            isSuperAdmin={isSuperAdmin}
            readOnly={!canEditPermissions || saving}
            ownerReadOnly={!canEditOwnerPermissions || saving}
            blockReason={isSuperAdmin
              ? '超级管理员的权限由系统固定。'
              : isOrgSuperAdmin ? '此历史角色已停用，成员绑定仅可核对和撤销。' : role.permissions_edit_block_reason ?? permissionsEditBlockReason}
            onToggle={togglePermission}
            onSetGroup={setPermissionGroup}
            onClearEntry={clearPermissionEntry}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ============ 员工分配 Tab ============

interface MemberAssignmentTabProps {
  systemSuperAdminAuthority?: SystemSuperAdminAuthority
  roleCode: string
  roleId: string
  roleName: string
  assignmentEditable: boolean
  assignmentBlockReason: string | null
  currentUserId: string | null
  users: OrgSummaryUser[]
  _departments: OrgSummaryDepartment[]
  members: RoleMember[]
  onRefresh?: () => void | Promise<void>
}

function MemberRoleStatus({ member, roleId }: { member: RoleMember; roleId: string }) {
  const { user, hasOrgAssignment, pending, effective } = member
  const hasLegacyBinding = user.scoped_roles?.some(role => role.roleId === roleId && role.scopeType === 'space')
  if (hasOrgAssignment && !pending && effective !== false && !hasLegacyBinding) return null
  return (
    <div className="flex flex-wrap gap-1">
      {pending && <Badge variant="outline">待首次登录生效</Badge>}
      {!hasOrgAssignment && !pending && user.scoped_roles?.some(role => role.roleId === roleId && role.scopeType === 'department') && (
        <Badge variant="outline" title="通过组织架构中的成员角色分配管理">部门绑定</Badge>
      )}
      {hasLegacyBinding && (
        <Badge variant="outline" title="通过组织架构中的成员角色分配撤销">历史范围绑定</Badge>
      )}
      {effective === false && !pending && <Badge variant="outline">未生效</Badge>}
    </div>
  )
}

async function readSystemSuperAdminResult(response: Response, orgId: string): Promise<boolean> {
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : '超级管理员状态读取或保存失败。')
  }
  if (data?.success !== true || data.org_id !== orgId || typeof data.enabled !== 'boolean') {
    throw new Error('接口返回的组织或角色状态无法核对，请刷新后重试。')
  }
  return data.enabled
}

function MemberAssignmentTab({
  systemSuperAdminAuthority,
  roleCode,
  roleId,
  roleName,
  assignmentEditable,
  assignmentBlockReason,
  currentUserId,
  users,
  members,
  onRefresh,
}: MemberAssignmentTabProps) {
  const [assigning, setAssigning] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogSearch, setDialogSearch] = useState('')
  const [selection, setSelection] = useState<OrgSummaryUser | null>(null)
  const [orgAssignmentFeedback, setOrgAssignmentFeedback] = useState<{ status: 'error' | 'success'; message: string } | null>(null)
  const orgAssignmentInFlight = useRef(false)
  const isLegacySuperAdmin = roleCode === ORG_SUPER_ADMIN_ROLE_CODE
  const isRetiredBaseline = roleCode === FXIAOKE_BASELINE_ROLE_CODE
  const isSystemSuperAdmin = roleCode === 'SUPER_ADMIN'
  const protectedRole = isSystemSuperAdmin || isLegacySuperAdmin
  const candidateIds = systemSuperAdminAuthority?.memberIds
  const canAddMembers = assignmentEditable && !isLegacySuperAdmin && !isRetiredBaseline
    && (!isSystemSuperAdmin || candidateIds !== undefined)
  const addBlockedReason = isSystemSuperAdmin && assignmentEditable && !canAddMembers
    ? '当前组织的在职成员暂无法核对，请刷新后重试。'
    : assignmentBlockReason
  const removeMemberLabel = isLegacySuperAdmin ? '撤销旧授权'
    : isSystemSuperAdmin ? '撤销超级管理员权限' : '从角色中移除'
  const systemSuperAdminMemberIds = useMemo(
    () => candidateIds ? new Set(candidateIds) : null,
    [candidateIds],
  )

  // 此界面的添加和撤销只作用于组织级角色。
  const orgAssignedUserIds = useMemo(
    () => new Set(members.filter(member => member.hasOrgAssignment || member.pending).map(member => member.user.id)),
    [members],
  )

  const { eligible: availableUsers, restricted: restrictedAvailableUsers } = useMemo(() => {
    const unassignedUsers = users.filter(user => !orgAssignedUserIds.has(user.id))
    if (systemSuperAdminMemberIds) {
      return {
        eligible: unassignedUsers.filter(user => user.id !== currentUserId && systemSuperAdminMemberIds.has(user.id)),
        restricted: [],
      }
    }
    return partitionRoleMutationTargets(unassignedUsers, currentUserId)
  }, [orgAssignedUserIds, systemSuperAdminMemberIds, currentUserId, users])

  function canRemoveMember(member: RoleMember) {
    if (!assignmentEditable) return false
    if (systemSuperAdminAuthority) {
      return member.user.id !== currentUserId && Boolean(member.user.scoped_roles?.some(binding => (
        binding.roleId === roleId && binding.roleCode === roleCode
        && binding.scopeType === 'org' && binding.scopeId === systemSuperAdminAuthority.orgId
      )))
    }
    return editableOrgRoleIds(member.user).includes(roleId)
  }

  // 弹窗内搜索
  const fuse = useMemo(
    () =>
      new Fuse(availableUsers, {
        keys: ['display_name', 'email', 'title', 'primary_dept_name'],
        threshold: 0.3,
      }),
    [availableUsers]
  )

  const dialogFilteredUsers = useMemo(() => {
    if (!dialogSearch.trim()) return availableUsers
    return fuse.search(dialogSearch).map(r => r.item)
  }, [fuse, dialogSearch, availableUsers])

  // 打开弹窗时重置选择
  useEffect(() => {
    if (dialogOpen) {
      setDialogSearch('')
      setSelection(null)
    }
  }, [dialogOpen])

  const toggleSelectUser = useCallback((user: OrgSummaryUser) => {
    setSelection(current => current?.id === user.id ? null : user)
  }, [])

  async function setSystemSuperAdmin(user: OrgSummaryUser, enabled: boolean) {
    if (!systemSuperAdminAuthority || user.id === currentUserId || orgAssignmentInFlight.current) return
    if (enabled && (isLegacySuperAdmin || !systemSuperAdminMemberIds?.has(user.id))) return
    const token = localStorage.getItem('token')
    orgAssignmentInFlight.current = true
    setAssigning(true)
    setOrgAssignmentFeedback(null)
    let writeMayHaveSucceeded = false
    let refreshNeeded = false

    try {
      if (!enabled && !await confirmAction(
        `确定要撤销「${user.display_name}」的${isLegacySuperAdmin ? '旧组织超管授权' : '超级管理员角色'}？`,
        { confirmText: '撤销权限', danger: true },
      )) return

      const orgId = systemSuperAdminAuthority.orgId
      const endpoint = `/api/admin/users/${encodeURIComponent(user.id)}/${isLegacySuperAdmin ? 'org-super-admin' : 'system-super-admin'}`
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined
      const readCurrent = async () => readSystemSuperAdminResult(
        await fetch(endpoint, { cache: 'no-store', headers }), orgId,
      )
      const previous = await readCurrent()
      if (token !== localStorage.getItem('token')) throw new Error('登录身份已变更，请刷新后重试。')
      if (previous === enabled) {
        refreshNeeded = true
        setDialogOpen(false)
        throw new Error('该成员的角色状态已变更，请核对最新成员列表。')
      }

      writeMayHaveSucceeded = true
      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, expected_enabled: previous, expected_org_id: orgId }),
      })
      writeMayHaveSucceeded = response.ok || response.status >= 500
      refreshNeeded = writeMayHaveSucceeded || response.status === 409
      if (response.status === 409) setDialogOpen(false)

      const savedState = await readSystemSuperAdminResult(response, orgId)
      const readBackState = await readCurrent()
      if (savedState !== enabled || readBackState !== enabled) {
        throw new Error('接口回读的角色状态与本次变更不一致。')
      }

      setDialogOpen(false)
      setOrgAssignmentFeedback({
        status: 'success',
        message: enabled ? `已确认「${user.display_name}」获得超级管理员权限。`
          : `已确认撤销「${user.display_name}」的${isLegacySuperAdmin ? '旧组织超管授权' : '超级管理员权限'}。`,
      })
    } catch (err) {
      const detail = err instanceof Error ? err.message : '请刷新后重试。'
      setOrgAssignmentFeedback({
        status: 'error',
        message: writeMayHaveSucceeded ? `未能确认变更结果。请核对后再操作。${detail}` : detail,
      })
    } finally {
      if (refreshNeeded || writeMayHaveSucceeded) {
        try {
          await onRefresh?.()
        } catch {
          error('成员列表刷新失败，请重新加载。')
        }
      }
      orgAssignmentInFlight.current = false
      setAssigning(false)
    }
  }

  // 当前后端只提供单用户替换接口。为避免 N 个独立请求形成部分成功，
  // 在有原子批量端点前，每次只允许添加一名成员。
  const handleAddMember = async () => {
    if (!canAddMembers || !selection || assigning) return

    const selectedUser = users.find((user) => user.id === selection.id)
    if (!selectedUser) {
      error('成员数据已变更，请刷新后重试。')
      return
    }

    if (systemSuperAdminAuthority) {
      if (!availableUsers.some(user => user.id === selectedUser.id)) {
        setOrgAssignmentFeedback({ status: 'error', message: '该成员当前不符合分配条件，请核对在职状态。' })
        return
      }
      await setSystemSuperAdmin(selectedUser, true)
      return
    }
    const restriction = getRoleMutationRestriction(selectedUser, currentUserId)
    if (restriction) {
      error(restriction.reason)
      return
    }

    const currentRoleIds = editableOrgRoleIds(selection)
    if (currentRoleIds.includes(roleId)) {
      setDialogOpen(false)
      success('成员已是当前角色')
      return
    }

    setAssigning(true)
    try {
      const token = localStorage.getItem('token')
      const headers: HeadersInit = {
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        'Content-Type': 'application/json',
      }

      const response = await fetch(`/api/admin/users/${selectedUser.id}/roles`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ role_ids: [...currentRoleIds, roleId], expected_role_ids: currentRoleIds }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (data.code === 'ROLE_ASSIGNMENT_CHANGED') {
          setDialogOpen(false)
          await onRefresh?.()
        }
        throw new Error(typeof data.error === 'string' ? data.error : '添加成员失败')
      }

      setDialogOpen(false)
      await onRefresh?.()
      success(data.pending_role_ids?.includes(roleId) ? `已为「${selectedUser.display_name}」预分配角色，首次登录后生效` : `已添加「${selectedUser.display_name}」`)
    } catch (err) {
      error(err instanceof Error ? err.message : '添加失败，请重试')
    } finally {
      setAssigning(false)
    }
  }

  // 从角色移除成员
  const handleRemoveMember = async (userId: string) => {
    if (!assignmentEditable || assigning) return
    const member = members.find(entry => entry.user.id === userId)
    if (!member || (!member.hasOrgAssignment && !member.pending)) return
    const { user } = member

    if (systemSuperAdminAuthority) {
      if (canRemoveMember(member)) await setSystemSuperAdmin(user, false)
      return
    }

    const restriction = getRoleMutationRestriction(user, currentUserId)
    if (restriction) {
      error(restriction.reason)
      return
    }

    const currentRoleIds = editableOrgRoleIds(user)
    if (!currentRoleIds.includes(roleId)) return
    if (!await confirmAction(`确定要撤销「${user.display_name}」的组织级角色分配？`, { confirmText: '移除', danger: true })) return

    const newRoleIds = currentRoleIds.filter(id => id !== roleId)

    setAssigning(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/admin/users/${userId}/roles`, {
        method: 'POST',
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role_ids: newRoleIds, expected_role_ids: currentRoleIds }),
      })

      if (res.ok) {
        success('组织级角色分配已撤销')
        await onRefresh?.()
      } else {
        const data = await res.json().catch(() => ({}))
        error(data.error || '移除失败')
        if (data.code === 'ROLE_ASSIGNMENT_CHANGED') await onRefresh?.()
      }
    } catch {
      error('网络错误')
    } finally {
      setAssigning(false)
    }
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* 已分配成员列表 */}
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h4 className="min-w-0 font-medium text-slate-900">
            角色关联成员 ({members.length})
          </h4>
          {canAddMembers ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setOrgAssignmentFeedback(null)
                setDialogOpen(true)
              }}
              disabled={assigning}
              className="shrink-0"
            >
              <UserPlusIcon size={16} className="mr-1.5" />
              添加成员
            </Button>
          ) : (
            <div className="max-w-sm text-right">
              <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
                {(isLegacySuperAdmin || isRetiredBaseline) && assignmentEditable ? '旧授权仅可撤销' : '无法添加成员'}
              </Badge>
              {addBlockedReason && (
                <p className="mt-1 text-xs leading-5 text-amber-800">
                  {addBlockedReason}
                </p>
              )}
            </div>
          )}
        </div>
        {orgAssignmentFeedback && (!assignmentEditable || !dialogOpen) && (
          <p role={orgAssignmentFeedback.status === 'error' ? 'alert' : 'status'} className={`mb-3 text-sm ${orgAssignmentFeedback.status === 'error' ? 'text-red-700' : 'text-green-700'}`}>
            {orgAssignmentFeedback.message}
          </p>
        )}

        {members.length > 0 ? (
          <div className="space-y-2 md:hidden">
            {members.map((member) => {
              const { user } = member
              const canRemove = canRemoveMember(member)
              const restriction = protectedRole ? null : getRoleMutationRestriction(user, currentUserId)
              return (
                <div key={user.id} className="rounded-md border bg-white p-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
                      {user.display_name?.charAt(0) || '?'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium leading-5 text-slate-900">{user.display_name}</div>
                      <MemberRoleStatus member={member} roleId={roleId} />
                      <div className="break-all text-xs leading-5 text-slate-500">{user.email}</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Badge variant="outline" className="max-w-full break-all">
                          {user.primary_dept_name || '未分配'}
                        </Badge>
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                          {user.title || '未设置职位'}
                        </span>
                      </div>
                    </div>
                    {restriction ? (
                      <Badge
                        variant="outline"
                        title={restriction.reason}
                        className="shrink-0 border-amber-200 bg-amber-50 text-amber-800"
                      >
                        {restriction.label}
                      </Badge>
                    ) : canRemove ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleRemoveMember(user.id)}
                        disabled={assigning}
                        aria-label={`${removeMemberLabel} ${user.display_name}`}
                        className="h-8 w-8 shrink-0"
                      >
                        <TrashIcon size={16} className="text-red-500" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="rounded-md border py-10 text-center text-sm text-slate-500 md:hidden">
            暂无成员分配到此角色
          </div>
        )}

        <div className="hidden overflow-x-auto rounded-md border md:block">
          <Table className="min-w-[620px]">
            <TableHeader>
              <TableRow>
                <TableHead>成员</TableHead>
                <TableHead>部门</TableHead>
                <TableHead>职位</TableHead>
                <TableHead className="w-20">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.length > 0 ? (
                members.map((member) => {
                  const { user } = member
                  const canRemove = canRemoveMember(member)
                  const restriction = protectedRole ? null : getRoleMutationRestriction(user, currentUserId)
                  return (
                    <TableRow key={user.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
                            {user.display_name?.charAt(0) || '?'}
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium text-slate-900">{user.display_name}</div>
                            <MemberRoleStatus member={member} roleId={roleId} />
                            <div className="max-w-[260px] break-all text-xs text-slate-500">{user.email}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="max-w-[160px] break-all">
                          {user.primary_dept_name || '未分配'}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[160px] break-all text-slate-600">{user.title || '-'}</TableCell>
                      <TableCell>
                        {restriction ? (
                          <Badge
                            variant="outline"
                            title={restriction.reason}
                            className="whitespace-nowrap border-amber-200 bg-amber-50 text-amber-800"
                          >
                            {restriction.label}
                          </Badge>
                        ) : canRemove ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleRemoveMember(user.id)}
                            disabled={assigning}
                            aria-label={`${removeMemberLabel} ${user.display_name}`}
                          >
                            <TrashIcon size={16} className="text-red-500" />
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  )
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center text-slate-500">
                    暂无成员分配到此角色
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* 添加成员 Dialog */}
      <Dialog open={canAddMembers && dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[520px] max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlusIcon size={20} className="text-slate-500" />
              为「{roleName}」添加成员
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-hidden flex flex-col gap-3 py-2">
            {orgAssignmentFeedback?.status === 'error' && (
              <p role="alert" className="shrink-0 text-sm text-red-700">{orgAssignmentFeedback.message}</p>
            )}
            {/* 搜索栏 */}
            <div className="relative shrink-0">
              <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="搜索姓名、邮箱、职位..."
                value={dialogSearch}
                onChange={(e) => setDialogSearch(e.target.value)}
                className="pl-9"
                autoFocus
              />
            </div>

            {/* 统计提示 */}
            <div className="text-xs text-slate-500 shrink-0">
              {selection && (
                <span className="text-blue-600 font-medium">
                  已选择 1 人
                </span>
              )}
              {dialogSearch.trim() ? (
                <span className={selection ? 'ml-2' : ''}>
                  搜索到 {dialogFilteredUsers.length} 人
                  {availableUsers.length !== dialogFilteredUsers.length && `（共 ${availableUsers.length} 人可添加）`}
                </span>
              ) : (
                <span className={selection ? 'ml-2' : ''}>
                  共 {availableUsers.length} 人可添加
                </span>
              )}
            </div>

            {restrictedAvailableUsers.length > 0 && (
              <div className="shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                已排除 {restrictedAvailableUsers.length} 名不可在线变更角色的成员：
                当前登录账号与平台根管理员不会进入提交。
              </div>
            )}

            <div className="shrink-0 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-900">
              {systemSuperAdminAuthority ? '每次可为一名在职且已启用登录的本组织成员授予权限。' : '当前接口不支持原子批量写入。为避免多请求部分成功，每次只可添加一名成员。'}
            </div>

            {/* 用户列表 */}
            <div className="flex-1 overflow-y-auto border rounded-lg">
              {dialogFilteredUsers.length > 0 ? (
                <div className="divide-y">
                  {dialogFilteredUsers.map(user => {
                    const isSelected = selection?.id === user.id
                    return (
                      <label
                        key={user.id}
                        className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition hover:bg-slate-50 ${
                          isSelected ? 'bg-blue-50/50' : ''
                        }`}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleSelectUser(user)}
                        />
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
                          {user.display_name?.charAt(0) || '?'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-slate-900">{user.display_name}</div>
                          <div className="text-xs text-slate-500 truncate">
                            {user.email} · {user.primary_dept_name || '未分配部门'}
                            {user.title && ` · ${user.title}`}
                          </div>
                        </div>
                      </label>
                    )
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-slate-500 py-12">
                  {dialogSearch.trim() ? (
                    <>
                      <SearchIcon size={32} className="mb-2 text-slate-300" />
                      <p className="text-sm">未找到匹配的成员</p>
                    </>
                  ) : (
                    <>
                      <UsersIcon size={32} className="mb-2 text-slate-300" />
                      <p className="text-sm">暂无可添加的成员</p>
                      {!systemSuperAdminAuthority && <p className="text-xs text-slate-400 mt-1">所有成员已分配到此角色</p>}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDialogOpen(false)}
              disabled={assigning}
            >
              取消
            </Button>
            <Button
              onClick={handleAddMember}
              disabled={!selection || assigning}
            >
              {assigning ? '添加中...' : systemSuperAdminAuthority ? '授予权限' : '添加成员到角色'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

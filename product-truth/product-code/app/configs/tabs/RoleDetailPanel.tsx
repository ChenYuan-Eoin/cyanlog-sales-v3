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
  ChevronDownIcon,
  ChevronUpIcon,
  UserPlusIcon,
  CheckCheckIcon,
  EraserIcon,
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
  PERMISSION_KEYS,
  SUPER_ADMIN_CORE_PERMISSIONS,
  getPermissionGrantSource,
  grantExplicitRolePermissions,
  isRolePermissionEnabled,
  isRolePermissionExplicitlyGranted,
  revokeRolePermissions,
  toggleExplicitRolePermission,
} from '@/lib/role-permission-policy'
import { success, error, confirmAction } from '@/lib/toast'
import { ORG_SUPER_ADMIN_ROLE_CODE } from '@/lib/role-permission-resolution'
import { REGISTERED_MODULE_PERMISSION_KEYS, SHIPPING_MANAGE_CONNECTIONS, SHIPPING_OPERATE } from '@/lib/module-access'
import type { RoleModulePermissionCatalog } from '@/lib/org-role-permission-readback'
import type {
  OrgSummaryUser,
  OrgSummaryDepartment,
  OrgSummarySpace,
  PermissionCatalogGroup,
} from '../types'
import {
  getRoleMutationRestriction,
  editableOrgRoleIds,
  partitionRoleMutationTargets,
} from './role-assignment-policy'
import { getRoleMembershipStats, type RoleMember, type RoleMembershipStats } from './role-membership-stats'

// ============ 权限目录 ============

const PERMISSION_CATALOG: PermissionSettingGroup[] = [
  {
    id: 'console-access',
    label: '后台访问',
    description: '管理后台和角色权限维护。',
    items: [
      { key: 'admin:access', label: '管理后台访问', description: '允许进入组织管理与后台入口。' },
      { key: 'role:manage', label: '角色权限管理', description: '允许超级管理员维护当前组织角色权限。' },
      { key: 'report:*', label: '经营报表访问', description: '允许查看组织级经营报表与统计。' },
      { key: 'report:dept', label: '部门报表访问', description: '允许查看所在部门经营数据。' },
      { key: 'report:finance', label: '财务报表访问', description: '允许查看财务口径报表。' },
    ],
  },
  {
    id: 'config-center',
    label: '配置中心',
    description: '当前组织配置的查看、修改和发布。',
    items: [
      { key: 'config:*', label: '配置中心全部权限', description: '包含读取、修改与发布配置。' },
      { key: 'config:read', label: '配置中心查看', description: '允许读取当前组织的配置。' },
      { key: 'config:write', label: '配置中心修改', description: '允许修改当前组织的配置。' },
      { key: 'config:publish', label: '配置发布', description: '允许发布当前组织的配置。' },
    ],
  },
  {
    id: 'org-admin',
    label: '组织架构管理',
    description: '维护部门、成员、角色指派和外部通讯录同步。',
    items: [
      { key: 'org:*', label: '组织管理', description: '允许维护组织与组织级设置。' },
      { key: 'org:write', label: '组织设置修改', description: '允许修改组织级管理项。' },
      { key: 'dept:*', label: '部门维护', description: '允许新建、调整和停用部门。' },
      { key: 'dept:view', label: '部门查看', description: '允许查看部门树和成员归属。' },
      { key: 'dept:write', label: '部门编辑', description: '允许调整部门结构。' },
      { key: 'user:*', label: '成员维护', description: '允许创建成员、分配角色、停用登录。' },
      { key: 'user:view', label: '成员查看', description: '允许查看成员档案和角色绑定。' },
      { key: 'user:write', label: '成员编辑', description: '允许调整成员状态与角色。' },
      { key: 'feishu:sync', label: '外部通讯录同步', description: '允许从飞书等源刷新部门结构。' },
    ],
  },
  {
    id: 'quote-domain',
    label: '报价与客户',
    description: '决定销售侧是否可以创建报价、管理客户、推进机会。',
    items: [
      { key: 'opportunity:*', label: '机会全量管理', description: '允许维护所辖机会与阶段。' },
      { key: 'opportunity:own', label: '本人机会管理', description: '仅允许维护本人负责机会。' },
      { key: 'quote:*', label: '报价全量管理', description: '允许查看、编辑与审批报价。' },
      { key: 'quote:create', label: '创建报价', description: '允许新建报价单。' },
      { key: 'quote:update_own', label: '编辑本人报价', description: '仅允许编辑本人创建的报价。' },
      { key: 'quote:approve', label: '报价审批', description: '允许执行报价审批动作。' },
      { key: 'quote:view', label: '报价查看', description: '允许查看报价结果。' },
      { key: 'customer:view', label: '客户查看', description: '允许查看客户资料。' },
      { key: 'customer:create', label: '客户创建', description: '允许录入客户。' },
      { key: 'customer:*', label: '客户全量管理', description: '允许维护客户档案与关联对象。' },
    ],
  },
  {
    id: 'contract-domain',
    label: '合同与模板',
    description: '决定合同上传、审核、审批和模板查看范围。',
    items: [
      { key: 'contract:*', label: '合同全量管理', description: '允许维护与处理全部合同动作。' },
      { key: 'contract:view', label: '合同查看', description: '允许查看合同记录与审核结果。' },
      { key: 'contract:upload', label: '合同上传', description: '允许上传待审核合同。' },
      { key: 'contract:create', label: '合同创建', description: '允许创建合同记录。' },
      { key: 'contract:write', label: '合同编辑', description: '允许编辑合同相关记录。' },
      { key: 'contract:review', label: '合同审核执行', description: '允许执行规则与模型审核。' },
      { key: 'contract:approve', label: '合同审批', description: '允许对合同结果进行审批。' },
      { key: 'contract:read', label: '合同结果读取', description: '兼容旧接口读取权限。' },
      { key: 'template:view', label: '模板查看', description: '允许查看合同模板与条款模板。' },
    ],
  },
  {
    id: 'payment-domain',
    label: '财务与回款',
    description: '财务角色使用的支付、回款与账务能力。',
    items: [
      { key: 'payment:*', label: '回款与支付管理', description: '允许处理支付、回款与财务动作。' },
    ],
  },
]

const EXTRA_PERMISSION_GROUP: PermissionSettingGroup = {
  id: 'shipping-domain', label: '寄件操作', description: '管理寄件业务与承运商连接。',
  items: [
    { key: 'shipping:*', label: '寄件全部权限', description: '包含寄件操作与连接配置。' },
    { key: 'shipping:operate', label: '寄件操作', description: '寄件操作权限尚未发布。', selectable: false },
    { key: 'shipping:manage_connections', label: '寄件连接管理', description: '寄件连接权限尚未发布。', selectable: false },
  ],
}

const PERMISSION_LABELS = new Map(
  [...PERMISSION_CATALOG, EXTRA_PERMISSION_GROUP]
    .flatMap((group) => group.items.map((item) => [item.key, item.label] as const)),
)

// ============ Props 类型 ============

interface OrgSuperAdminAuthority {
  orgId: string
  memberIds: readonly string[]
}

interface RoleDetailPanelProps {
  role: {
    id: string
    code: string
    name: string
    description: string | null
    permissions: string[] | null
    permissions_edit_block_reason?: string | null
  }
  currentUserId: string | null
  saving: boolean
  onSave: (perms: string[]) => void
  permissionsEditable?: boolean
  modulePermissionCatalog?: RoleModulePermissionCatalog
  permissionsEditBlockReason?: string | null
  orgSuperAdminAuthority?: OrgSuperAdminAuthority
  orgSuperAdminRosterUnavailable?: boolean
  users: OrgSummaryUser[]
  membershipStats?: RoleMembershipStats
  departments: OrgSummaryDepartment[]
  _spaces: OrgSummarySpace[]
  onRefresh?: () => void | Promise<void>
}

// ============ 主组件 ============

export function RoleDetailPanel({
  role,
  currentUserId,
  saving,
  onSave,
  permissionsEditable = false,
  modulePermissionCatalog,
  permissionsEditBlockReason,
  orgSuperAdminAuthority,
  orgSuperAdminRosterUnavailable = false,
  users,
  membershipStats,
  departments,
  _spaces,
  onRefresh,
}: RoleDetailPanelProps) {
  const [activeTab, setActiveTab] = useState('members')
  const [perms, setPerms] = useState<string[]>(role.permissions ?? [])
  const isSuperAdmin = role.code === 'SUPER_ADMIN'
  const isOrgSuperAdmin = role.code === ORG_SUPER_ADMIN_ROLE_CODE
  const protectedRole = isSuperAdmin || isOrgSuperAdmin
  const canEditPermissions = permissionsEditable && !isOrgSuperAdmin && !role.permissions_edit_block_reason
  let assignmentBlockReason: string | null = null
  if (isSuperAdmin) {
    assignmentBlockReason = 'SUPER_ADMIN 是平台根角色，不能通过组织管理界面变更。'
  } else if (!currentUserId) {
    assignmentBlockReason = '当前登录身份尚未确认，角色分配暂不可用。'
  } else if (isOrgSuperAdmin && !orgSuperAdminAuthority) {
    assignmentBlockReason = orgSuperAdminRosterUnavailable
      ? '当前组织的在职成员暂无法核对，请刷新后重试。'
      : '仅本组织有分配权限的超级管理员可管理此角色的成员。'
  }

  const stats = useMemo(
    () => membershipStats ?? getRoleMembershipStats(users, role.id),
    [membershipStats, users, role.id],
  )

  // 权限变更时同步
  useEffect(() => {
    setPerms(role.permissions ?? [])
  }, [role.id, role.permissions])

  const hasChanges = JSON.stringify([...perms].sort()) !== JSON.stringify([...(role.permissions ?? [])].sort())

  function togglePermission(key: string) {
    if (!canEditPermissions || saving) return
    setPerms(cur => toggleExplicitRolePermission(cur, key, isSuperAdmin ? SUPER_ADMIN_CORE_PERMISSIONS : []))
  }

  function setPermissionGroup(keys: string[], enabled: boolean) {
    if (!canEditPermissions || saving) return
    const protectedPermissions = isSuperAdmin ? SUPER_ADMIN_CORE_PERMISSIONS : []
    const availableModuleKeys = new Set(
      modulePermissionCatalog?.flatMap(group => group.items
        .filter(item => !('selectable' in item) || item.selectable !== false)
        .map(item => item.key)),
    )
    setPerms(current => enabled
      ? grantExplicitRolePermissions(current, keys, protectedPermissions)
      : revokeRolePermissions(current, keys, protectedPermissions, availableModuleKeys))
  }

  return (
    <div className="rounded-lg border bg-white overflow-hidden">
      {/* 头部信息 */}
      <div className="border-b px-6 py-4">
        <div className="flex items-start justify-between">
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
                    {role.permissions?.includes('*') ? '全部权限' : '组织内已配置'}
                  </Badge>
                )}
              </div>
              <div className="text-sm text-slate-500 mt-1">
                {role.code} · 已生效 {stats.effectiveMemberCount ?? '待核对'} · 待生效 {stats.pendingMemberCount ?? '待核对'} · 生效作用域绑定 {stats.effectiveBindingCount ?? '待核对'}
              </div>
              {role.description && (
                <p className="text-sm text-slate-600 mt-2">{role.description}</p>
              )}
            </div>
          </div>
          {canEditPermissions && activeTab === 'permissions' && (
            <Button
              onClick={() => onSave(perms)}
              disabled={saving || !hasChanges}
            >
              {saving ? '保存中...' : hasChanges ? '保存更改' : '已保存'}
            </Button>
          )}
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
            orgSuperAdminAuthority={isOrgSuperAdmin ? orgSuperAdminAuthority : undefined}
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
          <PermissionSettingTab
            perms={perms}
            modulePermissionCatalog={modulePermissionCatalog}
            isSuperAdmin={isSuperAdmin}
            readOnly={!canEditPermissions || saving}
            blockReason={isOrgSuperAdmin
              ? '组织超级管理员的治理权限由系统固定。'
              : role.permissions_edit_block_reason ?? permissionsEditBlockReason}
            onToggle={togglePermission}
            onSetGroup={setPermissionGroup}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ============ 员工分配 Tab ============

interface MemberAssignmentTabProps {
  orgSuperAdminAuthority?: OrgSuperAdminAuthority
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

function MemberRoleStatus({ member }: { member: RoleMember }) {
  const { hasOrgAssignment, pending, effective } = member
  if (hasOrgAssignment && !pending && effective !== false) return null
  return (
    <div className="flex flex-wrap gap-1">
      {pending && <Badge variant="outline">待首次登录生效</Badge>}
      {!hasOrgAssignment && !pending && (
        <Badge variant="outline" title="通过组织架构中的成员角色分配管理">部门或空间绑定</Badge>
      )}
      {effective === false && !pending && <Badge variant="outline">未生效</Badge>}
    </div>
  )
}

async function readOrgSuperAdminResult(response: Response, orgId: string): Promise<boolean> {
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : '组织超级管理员状态读取或保存失败。')
  }
  if (data?.success !== true || data.org_id !== orgId || typeof data.enabled !== 'boolean') {
    throw new Error('接口返回的组织或角色状态无法核对，请刷新后重试。')
  }
  return data.enabled
}

function MemberAssignmentTab({
  orgSuperAdminAuthority,
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
  const orgSuperAdminMemberIds = useMemo(
    () => orgSuperAdminAuthority ? new Set(orgSuperAdminAuthority.memberIds) : null,
    [orgSuperAdminAuthority],
  )

  // 此界面的添加和撤销只作用于组织级角色。
  const orgAssignedUserIds = useMemo(
    () => new Set(members.filter(member => member.hasOrgAssignment || member.pending).map(member => member.user.id)),
    [members],
  )

  // 可分配的用户（排除已分配、当前登录账号与平台根管理员）
  const { eligible: availableUsers, restricted: restrictedAvailableUsers } = useMemo(() => {
    const unassignedUsers = users.filter((user) => !orgAssignedUserIds.has(user.id)
      && (!orgSuperAdminMemberIds || orgSuperAdminMemberIds.has(user.id)))
    return partitionRoleMutationTargets(unassignedUsers, currentUserId)
  }, [orgAssignedUserIds, orgSuperAdminMemberIds, currentUserId, users])

  function canRemoveMember(member: RoleMember) {
    if (!assignmentEditable) return false
    if (orgSuperAdminMemberIds) return member.hasOrgAssignment && orgSuperAdminMemberIds.has(member.user.id)
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

  async function setOrgSuperAdmin(user: OrgSummaryUser, enabled: boolean) {
    if (!orgSuperAdminAuthority || !orgSuperAdminMemberIds?.has(user.id) || orgAssignmentInFlight.current) return
    orgAssignmentInFlight.current = true
    setAssigning(true)
    setOrgAssignmentFeedback(null)
    let writeMayHaveSucceeded = false
    let refreshNeeded = false

    try {
      if (!enabled && !await confirmAction(
        `确定要撤销「${user.display_name}」的组织超级管理员角色？`,
        { confirmText: '撤销权限', danger: true },
      )) return

      const orgId = orgSuperAdminAuthority.orgId
      const endpoint = `/api/admin/users/${encodeURIComponent(user.id)}/org-super-admin`
      const token = localStorage.getItem('token')
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined
      const readCurrent = async () => readOrgSuperAdminResult(
        await fetch(endpoint, { cache: 'no-store', headers }), orgId,
      )
      const previous = await readCurrent()
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

      const savedState = await readOrgSuperAdminResult(response, orgId)
      const readBackState = await readCurrent()
      if (savedState !== enabled || readBackState !== enabled) {
        throw new Error('接口回读的角色状态与本次变更不一致。')
      }

      setDialogOpen(false)
      setOrgAssignmentFeedback({
        status: 'success',
        message: enabled ? `已确认「${user.display_name}」获得组织超级管理员权限。` : `已确认撤销「${user.display_name}」的组织超级管理员权限。`,
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
    if (!assignmentEditable || !selection || assigning) return

    const selectedUser = users.find((user) => user.id === selection.id)
    if (!selectedUser) {
      error('成员数据已变更，请刷新后重试。')
      return
    }

    const restriction = getRoleMutationRestriction(selectedUser, currentUserId)
    if (restriction) {
      error(restriction?.reason || '当前成员不可进行角色变更。')
      return
    }

    if (orgSuperAdminAuthority) {
      if (!orgSuperAdminMemberIds?.has(selectedUser.id)) {
        setOrgAssignmentFeedback({ status: 'error', message: '该成员当前不符合分配条件，请核对在职状态。' })
        return
      }
      await setOrgSuperAdmin(selectedUser, true)
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

    const restriction = getRoleMutationRestriction(user, currentUserId)
    if (restriction) {
      error(restriction.reason)
      return
    }

    if (orgSuperAdminAuthority) {
      if (canRemoveMember(member)) await setOrgSuperAdmin(user, false)
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
          {assignmentEditable ? (
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
                角色分配只读
              </Badge>
              {assignmentBlockReason && (
                <p className="mt-1 text-xs leading-5 text-amber-800">
                  {assignmentBlockReason}
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
              const restriction = getRoleMutationRestriction(user, currentUserId)
              return (
                <div key={user.id} className="rounded-md border bg-white p-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
                      {user.display_name?.charAt(0) || '?'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium leading-5 text-slate-900">{user.display_name}</div>
                      <MemberRoleStatus member={member} />
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
                        aria-label={orgSuperAdminAuthority ? `撤销组织超级管理员权限 ${user.display_name}` : `从角色中移除 ${user.display_name}`}
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
                  const restriction = getRoleMutationRestriction(user, currentUserId)
                  return (
                    <TableRow key={user.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
                            {user.display_name?.charAt(0) || '?'}
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium text-slate-900">{user.display_name}</div>
                            <MemberRoleStatus member={member} />
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
                            aria-label={orgSuperAdminAuthority ? `撤销组织超级管理员权限 ${user.display_name}` : `从角色中移除 ${user.display_name}`}
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
      <Dialog open={assignmentEditable && dialogOpen} onOpenChange={setDialogOpen}>
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
              {orgSuperAdminAuthority ? '每次可为一名在职且已启用登录的本组织成员授予权限。' : '当前接口不支持原子批量写入。为避免多请求部分成功，每次只可添加一名成员。'}
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
                      {!orgSuperAdminAuthority && <p className="text-xs text-slate-400 mt-1">所有成员已分配到此角色</p>}
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
              {assigning ? '添加中...' : orgSuperAdminAuthority ? '授予权限' : '添加成员到角色'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ============ 权限设置 Tab ============

interface PermissionSettingTabProps {
  perms: string[]
  modulePermissionCatalog?: RoleModulePermissionCatalog
  isSuperAdmin: boolean
  readOnly: boolean
  blockReason?: string | null
  onToggle: (key: string) => void
  onSetGroup: (keys: string[], enabled: boolean) => void
}

type PermissionSettingGroup = Omit<PermissionCatalogGroup, 'items'> & {
  items: Array<PermissionCatalogGroup['items'][number] & { dependencies?: string[]; selectable?: boolean }>
}

function PermissionSettingTab({
  perms, modulePermissionCatalog = [], isSuperAdmin, readOnly, blockReason, onToggle, onSetGroup,
}: PermissionSettingTabProps) {
  const moduleItems = modulePermissionCatalog.flatMap(group => group.items)
  const moduleKeys = new Set(moduleItems.map(item => item.key))
  const effectivePerms = perms.filter(key => moduleKeys.has(key)
    || !REGISTERED_MODULE_PERMISSION_KEYS.some(registered => registered === key))
  const moduleByKey = new Map(moduleItems.map(item => [item.key, item] as const))
  const shippingBundleAvailable = moduleKeys.has(SHIPPING_OPERATE) && moduleKeys.has(SHIPPING_MANAGE_CONNECTIONS)
  const staticGroups = [...PERMISSION_CATALOG, EXTRA_PERMISSION_GROUP].map(group => ({
    ...group, items: group.items.map(item => {
      if (item.key === 'shipping:*' && !shippingBundleAvailable) {
        return { ...item, description: '寄件操作和寄件连接管理均发布后可设置全部权限。', selectable: false }
      }
      return moduleByKey.get(item.key) ?? item
    }),
  }))
  const staticKeys = new Set(staticGroups.flatMap(group => group.items.map(item => item.key)))
  const unknownPermissions = perms.filter(key => !moduleKeys.has(key) && !staticKeys.has(key)
    && (!PERMISSION_KEYS.includes(key) || REGISTERED_MODULE_PERMISSION_KEYS.some(registered => registered === key)))
  const permissionLabels = new Map([...PERMISSION_LABELS, ...moduleItems.map(item => [item.key, item.label] as const)])
  const moduleGroups = modulePermissionCatalog.map(group => ({
    ...group, items: group.items.filter(item => !staticKeys.has(item.key)),
  })).filter(group => group.items.length > 0)
  const groups: PermissionSettingGroup[] = [...staticGroups, ...moduleGroups]
  if (unknownPermissions.length > 0) {
    groups.push({
      id: 'existing-extra', label: '其他已保存权限', description: '仅展示当前角色已有的权限标识。',
      items: unknownPermissions.map(key => ({ key, label: key, description: '已保存的权限标识。', selectable: false })),
    })
  }
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups(current => {
      const next = new Set(current)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  return (
    <div className="p-6 space-y-4">
      {isSuperAdmin && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          <ShieldIcon className="inline-block h-4 w-4 mr-2" />
          权限更改仅作用于当前组织。为保证可以恢复配置，管理后台访问、配置中心查看与修改、角色权限管理始终保留。
        </div>
      )}

      {readOnly && blockReason && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-900">
          {blockReason}
        </div>
      )}

      {!readOnly && moduleItems.some(item => item.dependencies?.length > 0) && (
        <p className="text-sm text-slate-600">勾选动作时会一并勾选其前置权限。请在保存前核对。</p>
      )}

      {groups.map(group => {
        const isExpanded = !collapsedGroups.has(group.id)
        const groupPermissions = group.items.filter(item => item.selectable !== false).map(item => item.key)
        const hasAllExplicit = groupPermissions.length > 0
          && groupPermissions.every(key => isRolePermissionExplicitlyGranted(perms, key))
        const hasSomeEffective = groupPermissions.some(key => isRolePermissionEnabled(effectivePerms, key))
        const canClear = hasSomeEffective || groupPermissions.some(key => perms.includes(key))

        return (
          <div key={group.id} className="rounded-xl border border-slate-200">
            <div className="flex items-center gap-2 px-4 py-3">
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                aria-expanded={isExpanded}
              >
                {isExpanded ? (
                  <ChevronDownIcon size={18} className="text-slate-400" />
                ) : (
                  <ChevronUpIcon size={18} className="text-slate-400" />
                )}
                <div className="text-left">
                  <div className="font-medium text-slate-900">{group.label}</div>
                  <div className="text-xs text-slate-500">{group.description}</div>
                </div>
              </button>
              {groupPermissions.length > 0 && (
                <Badge variant={hasAllExplicit ? 'default' : hasSomeEffective ? 'secondary' : 'outline'}>
                  {hasAllExplicit ? '全部显式' : hasSomeEffective ? '部分生效' : '未生效'}
                </Badge>
              )}
              {!readOnly && groupPermissions.length > 0 && (
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onSetGroup(groupPermissions, true)}
                    disabled={hasAllExplicit}
                    aria-label={`选择${group.label}全部权限`}
                    title={`选择${group.label}全部权限`}
                  >
                    <CheckCheckIcon className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onSetGroup(groupPermissions, false)}
                    disabled={!canClear}
                    aria-label={`清除${group.label}全部权限`}
                    title={`清除${group.label}全部权限`}
                  >
                    <EraserIcon className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>

            {/* 权限列表 */}
            {isExpanded && (
              <div className="border-t px-4 py-4 bg-slate-50/50">
                <div className="grid gap-3 md:grid-cols-2">
                  {group.items.map(item => {
                    const checked = isRolePermissionExplicitlyGranted(perms, item.key)
                    const effective = item.selectable !== false && isRolePermissionEnabled(effectivePerms, item.key)
                    const grantSource = effective ? getPermissionGrantSource(effectivePerms, item.key) : null
                    const isCore = isSuperAdmin && SUPER_ADMIN_CORE_PERMISSIONS.includes(item.key)
                    const missingDependency = item.dependencies?.find(key => !isRolePermissionEnabled(effectivePerms, key))
                    const disabled = readOnly || isCore || item.selectable === false
                    return (
                      <label
                        key={item.key}
                        className={`flex items-start gap-3 rounded-lg border bg-white p-3 ${
                          disabled
                            ? 'opacity-60 cursor-not-allowed'
                            : 'cursor-pointer hover:border-slate-300'
                        }`}
                      >
                        <input
                          type="checkbox"
                          aria-label={item.label}
                          checked={checked}
                          disabled={disabled}
                          onChange={() => onToggle(item.key)}
                          className="mt-0.5 rounded"
                        />
                        <div className="flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`text-sm font-medium ${disabled ? 'text-slate-500' : 'text-slate-900'}`}>
                              {item.label}
                            </span>
                            {isCore && <Badge className="border-amber-200 bg-amber-100 text-amber-800">核心权限</Badge>}
                            {checked && <Badge variant="outline">{item.selectable === false ? '已保存' : '显式授权'}</Badge>}
                            {missingDependency && (
                              <Badge variant="outline">
                                {checked ? '需' : '勾选时补齐'}{permissionLabels.get(missingDependency) ?? missingDependency}
                              </Badge>
                            )}
                            {effective && !checked && <Badge variant="secondary">当前有效</Badge>}
                            {grantSource?.via === 'bundle' && (
                              <Badge variant="secondary">
                                由 {permissionLabels.get(grantSource.grant) || grantSource.label} 汇总
                              </Badge>
                            )}
                            {grantSource?.via === 'dependency' && (
                              <Badge variant="secondary">
                                由 {permissionLabels.get(grantSource.grant) || grantSource.label} 依赖生效
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">{item.description}</div>
                        </div>
                      </label>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

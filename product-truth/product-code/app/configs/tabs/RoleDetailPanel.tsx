'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
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
import type {
  OrgSummaryUser,
  OrgSummaryDepartment,
  OrgSummarySpace,
  PermissionCatalogGroup,
} from '../types'
import {
  getRoleMutationRestriction,
  partitionRoleMutationTargets,
} from './role-assignment-policy'

// ============ 权限目录 ============

const PERMISSION_CATALOG: PermissionCatalogGroup[] = [
  {
    id: 'console-access',
    label: '后台访问',
    description: '决定用户是否能进入组织管理、配置中心和管理入口。',
    items: [
      { key: 'admin:access', label: '管理后台访问', description: '允许进入组织管理与后台入口。' },
      { key: 'config:*', label: '配置中心全部权限', description: '包含读取、修改与发布配置。' },
      { key: 'config:read', label: '配置中心查看', description: '允许读取当前组织的配置。' },
      { key: 'config:write', label: '配置中心修改', description: '允许修改当前组织的配置。' },
      { key: 'config:publish', label: '配置发布', description: '允许发布当前组织的配置。' },
      { key: 'role:manage', label: '角色权限管理', description: '允许超级管理员维护当前组织角色权限。' },
      { key: 'report:*', label: '经营报表访问', description: '允许查看组织级经营报表与统计。' },
      { key: 'report:dept', label: '部门报表访问', description: '允许查看所在部门经营数据。' },
      { key: 'report:finance', label: '财务报表访问', description: '允许查看财务口径报表。' },
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
      { key: 'user:*', label: '成员维护', description: '允许创建成员、分配角色、重置密码。' },
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

const EXTRA_PERMISSION_GROUP: PermissionCatalogGroup = {
  id: 'shipping-domain', label: '寄件操作', description: '管理寄件业务与承运商连接。',
  items: [
    { key: 'shipping:*', label: '寄件全部权限', description: '包含寄件操作与连接配置。' },
    { key: 'shipping:operate', label: '寄件操作', description: '允许执行寄件业务操作。' },
    { key: 'shipping:manage_connections', label: '寄件连接管理', description: '允许维护寄件接入配置。' },
  ],
}

const PERMISSION_LABELS = new Map(
  [...PERMISSION_CATALOG, EXTRA_PERMISSION_GROUP]
    .flatMap((group) => group.items.map((item) => [item.key, item.label] as const)),
)

// ============ Props 类型 ============

interface RoleDetailPanelProps {
  role: {
    id: string
    code: string
    name: string
    description: string | null
    permissions: string[] | null
  }
  currentUserId: string | null
  saving: boolean
  onSave: (perms: string[]) => void
  permissionsEditable?: boolean
  permissionsEditBlockReason?: string | null
  users: OrgSummaryUser[]
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
  permissionsEditBlockReason,
  users,
  departments,
  _spaces,
  onRefresh,
}: RoleDetailPanelProps) {
  const [activeTab, setActiveTab] = useState('members')
  const [perms, setPerms] = useState<string[]>(role.permissions ?? [])
  const isSuperAdmin = role.code === 'SUPER_ADMIN'
  const assignmentBlockReason = isSuperAdmin
    ? 'SUPER_ADMIN 是平台根角色，不能通过组织管理界面变更。'
    : currentUserId
      ? null
      : '当前登录身份尚未确认，角色分配暂不可用。'

  // 计算统计数据
  const stats = useMemo(() => {
    const assignedUsers = users.filter(u => u.role_codes?.includes(role.code))
    const scopedAssignments = users.flatMap(u =>
      (u.scoped_roles || [])
        .filter(a => a.roleCode === role.code)
        .map(a => ({ userId: u.id, userName: u.display_name, scopeType: a.scopeType, scopeName: a.scopeName }))
    )
    return { assignedUsers, scopedAssignments }
  }, [users, role.code])

  // 权限变更时同步
  useEffect(() => {
    setPerms(role.permissions ?? [])
  }, [role.id, role.permissions])

  const hasChanges = JSON.stringify([...perms].sort()) !== JSON.stringify([...(role.permissions ?? [])].sort())

  function togglePermission(key: string) {
    if (!permissionsEditable || saving) return
    setPerms(cur => toggleExplicitRolePermission(cur, key, isSuperAdmin ? SUPER_ADMIN_CORE_PERMISSIONS : []))
  }

  function setPermissionGroup(keys: string[], enabled: boolean) {
    if (!permissionsEditable || saving) return
    const protectedPermissions = isSuperAdmin ? SUPER_ADMIN_CORE_PERMISSIONS : []
    setPerms(current => enabled
      ? grantExplicitRolePermissions(current, keys, protectedPermissions)
      : revokeRolePermissions(current, keys, protectedPermissions))
  }

  return (
    <div className="rounded-lg border bg-white overflow-hidden">
      {/* 头部信息 */}
      <div className="border-b px-6 py-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div
              className={`flex h-12 w-12 items-center justify-center rounded-xl ${
                isSuperAdmin ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
              }`}
            >
              {isSuperAdmin ? <ShieldIcon size={24} /> : <UsersIcon size={24} />}
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
                {role.code} · {stats.assignedUsers.length} 名成员 · {stats.scopedAssignments.length} 条作用域绑定
              </div>
              {role.description && (
                <p className="text-sm text-slate-600 mt-2">{role.description}</p>
              )}
            </div>
          </div>
          {permissionsEditable && activeTab === 'permissions' && (
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
              员工分配 ({stats.assignedUsers.length})
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
            roleId={role.id}
            roleName={role.name}
            assignmentEditable={!assignmentBlockReason}
            assignmentBlockReason={assignmentBlockReason}
            currentUserId={currentUserId}
            users={users}
            _departments={departments}
            assignedUsers={stats.assignedUsers}
            onRefresh={onRefresh}
          />
        </TabsContent>

        {/* 权限设置 Tab */}
        <TabsContent value="permissions" className="m-0">
          <PermissionSettingTab
            perms={perms}
            isSuperAdmin={isSuperAdmin}
            readOnly={!permissionsEditable || saving}
            blockReason={permissionsEditBlockReason}
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
  _roleCode?: string
  roleId: string
  roleName: string
  assignmentEditable: boolean
  assignmentBlockReason: string | null
  currentUserId: string | null
  users: OrgSummaryUser[]
  _departments: OrgSummaryDepartment[]
  assignedUsers: OrgSummaryUser[]
  onRefresh?: () => void | Promise<void>
}

function MemberAssignmentTab({
  roleId,
  roleName,
  assignmentEditable,
  assignmentBlockReason,
  currentUserId,
  users,
  assignedUsers,
  onRefresh,
}: MemberAssignmentTabProps) {
  const [assigning, setAssigning] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogSearch, setDialogSearch] = useState('')
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set())

  // 已分配用户的 ID 集合
  const assignedUserIds = useMemo(
    () => new Set(assignedUsers.map(u => u.id)),
    [assignedUsers]
  )

  // 可分配的用户（排除已分配、当前登录账号与平台根管理员）
  const { eligible: availableUsers, restricted: restrictedAvailableUsers } = useMemo(() => {
    const unassignedUsers = users.filter((user) => !assignedUserIds.has(user.id))
    return partitionRoleMutationTargets(unassignedUsers, currentUserId)
  }, [assignedUserIds, currentUserId, users])

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
      setSelectedUserIds(new Set())
    }
  }, [dialogOpen])

  const toggleSelectUser = useCallback((userId: string) => {
    setSelectedUserIds((current) => {
      return current.has(userId) ? new Set() : new Set([userId])
    })
  }, [])

  // 当前后端只提供单用户替换接口。为避免 N 个独立请求形成部分成功，
  // 在有原子批量端点前，每次只允许添加一名成员。
  const handleAddMember = async () => {
    if (!assignmentEditable || selectedUserIds.size === 0) return

    const selectedUserId = Array.from(selectedUserIds)[0]
    const selectedUser = users.find((user) => user.id === selectedUserId)
    if (!selectedUser) {
      error('成员数据已变更，请刷新后重试。')
      return
    }

    const restriction = getRoleMutationRestriction(selectedUser, currentUserId)
    if (restriction) {
      error(restriction?.reason || '当前成员不可进行角色变更。')
      return
    }

    const currentRoleIds = selectedUser.role_ids || []
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
        body: JSON.stringify({ role_ids: [...currentRoleIds, roleId] }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(typeof data.error === 'string' ? data.error : '添加成员失败')
      }

      setDialogOpen(false)
      await onRefresh?.()
      success(`已添加「${selectedUser.display_name}」`)
    } catch (err) {
      error(err instanceof Error ? err.message : '添加失败，请重试')
    } finally {
      setAssigning(false)
    }
  }

  // 从角色移除成员
  const handleRemoveMember = async (userId: string) => {
    if (!assignmentEditable) return
    const user = assignedUsers.find(u => u.id === userId)
    if (!user) return

    const restriction = getRoleMutationRestriction(user, currentUserId)
    if (restriction) {
      error(restriction.reason)
      return
    }

    if (!await confirmAction(`确定要从角色中移除「${user.display_name}」？`, { confirmText: '移除', danger: true })) return

    const currentRoleIds = user.role_ids || []
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
        body: JSON.stringify({ role_ids: newRoleIds }),
      })

      if (res.ok) {
        success('成员已移除')
        await onRefresh?.()
      } else {
        const data = await res.json().catch(() => ({}))
        error(data.error || '移除失败')
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
            已分配成员 ({assignedUsers.length})
          </h4>
          {assignmentEditable ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDialogOpen(true)}
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

        {assignedUsers.length > 0 ? (
          <div className="space-y-2 md:hidden">
            {assignedUsers.map((user) => {
              const restriction = getRoleMutationRestriction(user, currentUserId)
              return (
                <div key={user.id} className="rounded-md border bg-white p-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
                      {user.display_name?.charAt(0) || '?'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium leading-5 text-slate-900">{user.display_name}</div>
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
                    ) : assignmentEditable ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleRemoveMember(user.id)}
                        disabled={assigning}
                        aria-label={`从角色中移除 ${user.display_name}`}
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
              {assignedUsers.length > 0 ? (
                assignedUsers.map((user) => {
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
                        ) : assignmentEditable ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleRemoveMember(user.id)}
                            disabled={assigning}
                            aria-label={`从角色中移除 ${user.display_name}`}
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
              {selectedUserIds.size > 0 && (
                <span className="text-blue-600 font-medium">
                  已选择 1 人
                </span>
              )}
              {dialogSearch.trim() ? (
                <span className={selectedUserIds.size > 0 ? 'ml-2' : ''}>
                  搜索到 {dialogFilteredUsers.length} 人
                  {availableUsers.length !== dialogFilteredUsers.length && `（共 ${availableUsers.length} 人可添加）`}
                </span>
              ) : (
                <span className={selectedUserIds.size > 0 ? 'ml-2' : ''}>
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
              当前接口不支持原子批量写入。为避免多请求部分成功，每次只可添加一名成员。
            </div>

            {/* 用户列表 */}
            <div className="flex-1 overflow-y-auto border rounded-lg">
              {dialogFilteredUsers.length > 0 ? (
                <div className="divide-y">
                  {dialogFilteredUsers.map(user => {
                    const isSelected = selectedUserIds.has(user.id)
                    return (
                      <label
                        key={user.id}
                        className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition hover:bg-slate-50 ${
                          isSelected ? 'bg-blue-50/50' : ''
                        }`}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleSelectUser(user.id)}
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
                      <p className="text-xs text-slate-400 mt-1">所有成员已分配到此角色</p>
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
              disabled={selectedUserIds.size === 0 || assigning}
            >
              {assigning ? '添加中...' : '添加成员到角色'}
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
  isSuperAdmin: boolean
  readOnly: boolean
  blockReason?: string | null
  onToggle: (key: string) => void
  onSetGroup: (keys: string[], enabled: boolean) => void
}

function PermissionSettingTab({ perms, isSuperAdmin, readOnly, blockReason, onToggle, onSetGroup }: PermissionSettingTabProps) {
  const unknownPermissions = perms.filter(key => !PERMISSION_KEYS.includes(key))
  const groups: PermissionCatalogGroup[] = [...PERMISSION_CATALOG, EXTRA_PERMISSION_GROUP, ...(unknownPermissions.length ? [{
    id: 'existing-extra', label: '其他已保存权限', description: '保留现有权限项，可按需要调整。',
    items: unknownPermissions.map(key => ({ key, label: key, description: '已保存的权限标识。' })),
  }] : [])]
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set([...PERMISSION_CATALOG.map(g => g.id), 'shipping-domain', 'existing-extra'])
  )

  const toggleGroup = (groupId: string) => {
    setExpandedGroups(cur => {
      const next = new Set(cur)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
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

      {groups.map(group => {
        const isExpanded = expandedGroups.has(group.id)
        const groupPermissions = group.items.map(item => item.key)
        const hasAllExplicit = groupPermissions.every(key => isRolePermissionExplicitlyGranted(perms, key))
        const hasSomeEffective = groupPermissions.some(key => isRolePermissionEnabled(perms, key))

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
              <Badge variant={hasAllExplicit ? 'default' : hasSomeEffective ? 'secondary' : 'outline'}>
                {hasAllExplicit ? '全部显式' : hasSomeEffective ? '部分生效' : '未生效'}
              </Badge>
              {!readOnly && (
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
                    disabled={!hasSomeEffective}
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
                    const effective = isRolePermissionEnabled(perms, item.key)
                    const grantSource = effective ? getPermissionGrantSource(perms, item.key) : null
                    const isCore = isSuperAdmin && SUPER_ADMIN_CORE_PERMISSIONS.includes(item.key)
                    const disabled = readOnly || isCore
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
                            {checked && <Badge variant="outline">显式授权</Badge>}
                            {effective && !checked && <Badge variant="secondary">当前有效</Badge>}
                            {grantSource?.via === 'bundle' && (
                              <Badge variant="secondary">
                                由 {PERMISSION_LABELS.get(grantSource.grant) || grantSource.label} 汇总
                              </Badge>
                            )}
                            {grantSource?.via === 'dependency' && (
                              <Badge variant="secondary">
                                由 {PERMISSION_LABELS.get(grantSource.grant) || grantSource.label} 依赖生效
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

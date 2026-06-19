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
import { toast, success, error } from '@/lib/toast'
import type {
  OrgSummaryUser,
  OrgSummaryDepartment,
  OrgSummarySpace,
  PermissionCatalogGroup,
} from '../types'

// ============ 权限目录 ============

const PERMISSION_CATALOG: PermissionCatalogGroup[] = [
  {
    id: 'console-access',
    label: '后台访问',
    description: '决定用户是否能进入组织管理、配置中心和管理入口。',
    items: [
      { key: 'admin:access', label: '管理后台访问', description: '允许进入组织管理与后台入口。' },
      { key: 'config:*', label: '配置中心访问', description: '允许进入并维护配置中心能力域。' },
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

// ============ Props 类型 ============

interface RoleDetailPanelProps {
  role: {
    id: string
    code: string
    name: string
    description: string | null
    permissions: string[] | null
  }
  saving: boolean
  onSave: (perms: string[]) => void
  users: OrgSummaryUser[]
  departments: OrgSummaryDepartment[]
  _spaces: OrgSummarySpace[]
}

// ============ 主组件 ============

export function RoleDetailPanel({
  role,
  saving,
  onSave,
  users,
  departments,
  _spaces,
}: RoleDetailPanelProps) {
  const [activeTab, setActiveTab] = useState('members')
  const [perms, setPerms] = useState<string[]>(role.permissions ?? [])
  const isSuperAdmin = role.code === 'SUPER_ADMIN'

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
  useMemo(() => {
    setPerms(role.permissions ?? [])
  }, [role.id, role.permissions])

  const hasChanges = JSON.stringify(perms.sort()) !== JSON.stringify((role.permissions ?? []).sort())

  function togglePermission(key: string) {
    if (isSuperAdmin) return
    setPerms(cur =>
      cur.includes(key) ? cur.filter(p => p !== key) : [...cur, key]
    )
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
                    拥有所有权限
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
          {!isSuperAdmin && activeTab === 'permissions' && (
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
            users={users}
            _departments={departments}
            assignedUsers={stats.assignedUsers}
          />
        </TabsContent>

        {/* 权限设置 Tab */}
        <TabsContent value="permissions" className="m-0">
          <PermissionSettingTab
            perms={perms}
            isSuperAdmin={isSuperAdmin}
            onToggle={togglePermission}
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
  users: OrgSummaryUser[]
  _departments: OrgSummaryDepartment[]
  assignedUsers: OrgSummaryUser[]
  onRefresh?: () => void
}

function MemberAssignmentTab({ roleId, roleName, users, assignedUsers, onRefresh }: MemberAssignmentTabProps) {
  const [assigning, setAssigning] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogSearch, setDialogSearch] = useState('')
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set())

  // 已分配用户的 ID 集合
  const assignedUserIds = useMemo(
    () => new Set(assignedUsers.map(u => u.id)),
    [assignedUsers]
  )

  // 可分配的用户（排除已分配）
  const availableUsers = useMemo(
    () => users.filter(u => !assignedUserIds.has(u.id)),
    [users, assignedUserIds]
  )

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
    setSelectedUserIds(prev => {
      const next = new Set(prev)
      if (next.has(userId)) {
        next.delete(userId)
      } else {
        next.add(userId)
      }
      return next
    })
  }, [])

  const handleSelectAll = useCallback(() => {
    const allSelected = dialogFilteredUsers.every(u => selectedUserIds.has(u.id))
    setSelectedUserIds(prev => {
      const next = new Set(prev)
      if (allSelected) {
        // 取消全选当前可见
        dialogFilteredUsers.forEach(u => next.delete(u.id))
      } else {
        // 全选当前可见
        dialogFilteredUsers.forEach(u => next.add(u.id))
      }
      return next
    })
  }, [dialogFilteredUsers, selectedUserIds])

  // 批量添加成员到角色
  const handleBatchAdd = async () => {
    if (selectedUserIds.size === 0) return

    setAssigning(true)
    try {
      const token = localStorage.getItem('token')
      const headers: HeadersInit = {
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        'Content-Type': 'application/json',
      }

      const promises = Array.from(selectedUserIds).map(async userId => {
        const user = users.find(u => u.id === userId)
        if (!user) return
        const currentRoleIds = user.role_ids || []
        if (currentRoleIds.includes(roleId)) return
        const newRoleIds = [...currentRoleIds, roleId]

        return fetch(`/api/admin/users/${userId}/roles`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ role_ids: newRoleIds }),
        })
      })

      await Promise.all(promises)
      setDialogOpen(false)
      success('成员已添加')
      onRefresh?.()
    } catch {
      error('添加失败，请重试')
    } finally {
      setAssigning(false)
    }
  }

  // 从角色移除成员
  const handleRemoveMember = async (userId: string) => {
    const user = assignedUsers.find(u => u.id === userId)
    if (!user) return

    if (!confirm(`确定要从角色中移除「${user.display_name}」？`)) return

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
        onRefresh?.()
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

  // 全选按钮文字
  const selectAllText = useMemo(() => {
    if (dialogFilteredUsers.length === 0) return '全选'
    const allSelected = dialogFilteredUsers.every(u => selectedUserIds.has(u.id))
    return allSelected ? '取消全选' : '全选'
  }, [dialogFilteredUsers, selectedUserIds])

  return (
    <div className="p-6 space-y-6">
      {/* 已分配成员列表 */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-medium text-slate-900">
            已分配成员 ({assignedUsers.length})
          </h4>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDialogOpen(true)}
            disabled={assigning}
          >
            <UserPlusIcon size={16} className="mr-1.5" />
            添加成员
          </Button>
        </div>

        <div className="rounded-md border">
          <Table>
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
                assignedUsers.map(user => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
                          {user.display_name?.charAt(0) || '?'}
                        </div>
                        <div>
                          <div className="font-medium text-slate-900">{user.display_name}</div>
                          <div className="text-xs text-slate-500">{user.email}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{user.primary_dept_name || '未分配'}</Badge>
                    </TableCell>
                    <TableCell className="text-slate-600">{user.title || '-'}</TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemoveMember(user.id)}
                        disabled={assigning}
                      >
                        <TrashIcon size={16} className="text-red-500" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
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
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[520px] max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlusIcon size={20} className="text-slate-500" />
              为「{roleName}」添加成员
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-hidden flex flex-col gap-3 py-2">
            {/* 搜索栏 + 全选 */}
            <div className="flex items-center gap-3 shrink-0">
              <div className="relative flex-1">
                <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="搜索姓名、邮箱、职位..."
                  value={dialogSearch}
                  onChange={(e) => setDialogSearch(e.target.value)}
                  className="pl-9"
                  autoFocus
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSelectAll}
                disabled={dialogFilteredUsers.length === 0}
              >
                {selectAllText}
              </Button>
            </div>

            {/* 统计提示 */}
            <div className="text-xs text-slate-500 shrink-0">
              {selectedUserIds.size > 0 && (
                <span className="text-blue-600 font-medium">
                  已选择 {selectedUserIds.size} 人
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
              onClick={handleBatchAdd}
              disabled={selectedUserIds.size === 0 || assigning}
            >
              {assigning ? '添加中...' : `添加 ${selectedUserIds.size} 人到角色`}
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
  onToggle: (key: string) => void
}

function PermissionSettingTab({ perms, isSuperAdmin, onToggle }: PermissionSettingTabProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(PERMISSION_CATALOG.map(g => g.id))
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
          超级管理员拥有系统中的所有权限，无需单独配置。
        </div>
      )}

      {PERMISSION_CATALOG.map(group => {
        const isExpanded = expandedGroups.has(group.id)
        const groupPermissions = group.items.map(item => item.key)
        const hasAllInGroup = groupPermissions.every(p =>
          perms.includes(p) || perms.includes('*')
        )
        const hasSomeInGroup = groupPermissions.some(p =>
          perms.includes(p) || perms.includes('*')
        )

        return (
          <div key={group.id} className="rounded-xl border border-slate-200">
            {/* 分组标题 - 可点击折叠 */}
            <button
              onClick={() => toggleGroup(group.id)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50"
            >
              <div className="flex items-center gap-3">
                {isExpanded ? (
                  <ChevronDownIcon size={18} className="text-slate-400" />
                ) : (
                  <ChevronUpIcon size={18} className="text-slate-400" />
                )}
                <div className="text-left">
                  <div className="font-medium text-slate-900">{group.label}</div>
                  <div className="text-xs text-slate-500">{group.description}</div>
                </div>
              </div>
              <Badge variant={hasAllInGroup ? 'default' : hasSomeInGroup ? 'secondary' : 'outline'}>
                {hasAllInGroup ? '全部' : hasSomeInGroup ? '部分' : '未启用'}
              </Badge>
            </button>

            {/* 权限列表 */}
            {isExpanded && (
              <div className="border-t px-4 py-4 bg-slate-50/50">
                <div className="grid gap-3 md:grid-cols-2">
                  {group.items.map(item => {
                    const checked = isSuperAdmin || perms.includes(item.key) || perms.includes('*')
                    return (
                      <label
                        key={item.key}
                        className={`flex items-start gap-3 rounded-lg border bg-white p-3 ${
                          isSuperAdmin ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:border-slate-300'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={isSuperAdmin}
                          onChange={() => onToggle(item.key)}
                          className="mt-0.5 rounded"
                        />
                        <div className="flex-1">
                          <div className={`text-sm font-medium ${isSuperAdmin ? 'text-slate-500' : 'text-slate-900'}`}>
                            {item.label}
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

'use client'

import { useState, useMemo, useCallback } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { BuildingIcon, UsersIcon, SearchIcon, ChevronLeftIcon, ChevronRightIcon, ChevronRight as ChevronRightIconCustom, ChevronDown as ChevronDownIconCustom, PlusIcon, MoreHorizontalIcon, EditIcon, TrashIcon, UserPlusIcon, ShieldIcon, PowerOffIcon, PowerIcon, LockIcon, UnlockIcon, MailIcon, BanIcon, FingerprintIcon } from 'lucide-react'
import type { OrgSummaryPayload, OrgSummaryUser, OrgSummaryDepartment } from '../types'
import Fuse from 'fuse.js'
import { success, error, confirmAction } from '@/lib/toast'
import { DepartmentFormDialog } from './components/DepartmentFormDialog'
import { UserFormDialog } from './components/UserFormDialog'
import { RoleAssignmentDialog } from './components/RoleAssignmentDialog'
import { IdentityBindingDialog } from './components/IdentityBindingDialog'
import { getRoleMutationRestriction } from './role-assignment-policy'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

interface OrgStructureTabProps {
  orgSummary: OrgSummaryPayload | null
  currentUserId: string | null
  onRefresh?: () => void | Promise<void>
  onOpenIntegrations?: () => void
}

function buildAuthHeaders(includeJson = false): HeadersInit {
  const token = localStorage.getItem('token')
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(includeJson ? { 'Content-Type': 'application/json' } : {}),
  }
}

// ============ 工具函数 ============

function getAllChildDeptIds(departments: OrgSummaryDepartment[], parentId: string): Set<string> {
  const result = new Set<string>([parentId])
  const children = departments.filter(d => d.parent_id === parentId)
  for (const child of children) {
    const childIds = getAllChildDeptIds(departments, child.id)
    childIds.forEach(id => result.add(id))
  }
  return result
}

// ============ 部门树组件 ============

interface DepartmentTreeProps {
  departments: OrgSummaryDepartment[]
  users: OrgSummaryUser[]
  selectedDeptId: string | null
  onSelectDept: (id: string | null) => void
  onRefresh?: () => void | Promise<void>
  className?: string
}

function DepartmentTree({ departments, users, selectedDeptId, onSelectDept, onRefresh, className }: DepartmentTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [editDept, setEditDept] = useState<OrgSummaryDepartment | null>(null)
  const [deletingDept, setDeletingDept] = useState<OrgSummaryDepartment | null>(null)
  // 添加部门弹窗状态
  const [addDeptOpen, setAddDeptOpen] = useState(false)
  const [addDeptParentId, setAddDeptParentId] = useState<string | null>(null)

  const rootDepts = useMemo(() => departments.filter(d => !d.parent_id), [departments])

  const toggleExpand = useCallback((id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const handleDeptClick = useCallback((deptId: string, hasChildren: boolean) => {
    if (selectedDeptId === deptId) {
      onSelectDept(null)
      return
    }
    onSelectDept(deptId)
    if (hasChildren && !expanded.has(deptId)) {
      toggleExpand(deptId)
    }
  }, [selectedDeptId, onSelectDept, expanded, toggleExpand])

  const handleDelete = useCallback(async (dept: OrgSummaryDepartment) => {
    if (!await confirmAction(`确定要删除部门 "${dept.name}" 吗？`, { confirmText: '删除', danger: true })) return
    setDeletingDept(dept)
    try {
      const res = await fetch(`/api/admin/departments/${dept.id}`, {
        method: 'DELETE',
        headers: buildAuthHeaders(),
      })
      if (!res.ok) {
        const result = await res.json().catch(() => ({}))
        error(result.error || '删除失败')
        return
      }
      success('部门已删除')
      await onRefresh?.()
    } finally {
      setDeletingDept(null)
    }
  }, [onRefresh])

  function DeptNode({ dept, depth }: { dept: OrgSummaryDepartment; depth: number }) {
    const children = useMemo(() => departments.filter(d => d.parent_id === dept.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [departments, dept.id])
    const isExpanded = expanded.has(dept.id)
    const hasChildren = children.length > 0
    const isSelected = selectedDeptId === dept.id

    return (
      <div>
        <div
          role="button"
          tabIndex={0}
          onClick={() => handleDeptClick(dept.id, hasChildren)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              handleDeptClick(dept.id, hasChildren)
            }
          }}
          className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition group ${
            isSelected
              ? 'bg-blue-50 text-blue-900 hover:bg-blue-100'
              : 'hover:bg-slate-50'
          }`}
          style={{ paddingLeft: `${depth * 20 + 12}px` }}
        >
          {/* Expand/collapse button */}
          <div
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-slate-200/50"
            onClick={(e) => {
              e.stopPropagation()
              if (hasChildren) toggleExpand(dept.id)
            }}
          >
            {hasChildren ? (
              isExpanded ? (
                <ChevronDownIconCustom size={14} className={isSelected ? 'text-blue-400' : 'text-slate-400'} />
              ) : (
                <ChevronRightIconCustom size={14} className={isSelected ? 'text-blue-400' : 'text-slate-400'} />
              )
            ) : (
              <span className={`h-1.5 w-1.5 rounded-full ${isSelected ? 'bg-blue-300' : 'bg-slate-300'}`} />
            )}
          </div>

          {/* Department name + leader */}
          <div className="min-w-0 flex-1 truncate">
            <span className={`text-sm font-medium ${isSelected ? 'text-blue-900' : 'text-slate-900'}`}>
              {dept.name}
            </span>
            {dept.status === 'inactive' && <span className="ml-1 text-xs text-slate-400">已停用</span>}
            {dept.leader_name && (
              <span className="ml-1 text-xs text-amber-600">
                👤 {dept.leader_name}
              </span>
            )}
          </div>

          {/* Actions: Edit / Delete */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity rounded p-1 hover:bg-slate-200/50"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontalIcon size={14} className="text-slate-400" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setEditDept(dept)}>
                <EditIcon className="h-4 w-4 mr-2" />
                编辑
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { setAddDeptParentId(dept.parent_id ? dept.parent_id : null); setAddDeptOpen(true); }}>
                <PlusIcon className="h-4 w-4 mr-2" />
                添加同级部门
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { setAddDeptParentId(dept.id); setAddDeptOpen(true); }}>
                <PlusIcon className="h-4 w-4 mr-2" />
                添加下级部门
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-red-600"
                disabled={deletingDept?.id === dept.id}
                onSelect={() => handleDelete(dept)}
              >
                <TrashIcon className="h-4 w-4 mr-2" />
                {deletingDept?.id === dept.id ? '删除中...' : '删除'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Member count */}
          <Badge variant={isSelected ? 'default' : 'outline'} className="shrink-0 text-xs">
            {dept.member_count}
          </Badge>
        </div>

        {isExpanded && hasChildren && (
          <div>
            {children.map(child => (
              <DeptNode key={child.id} dept={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <div className={`space-y-1 ${className}`}>
        {rootDepts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-500">
            暂无部门数据
          </div>
        ) : (
          rootDepts.map(dept => <DeptNode key={dept.id} dept={dept} depth={0} />)
        )}
      </div>

      {/* Edit Dialog - controlled by state, not nested in DropdownMenu */}
      {editDept && (
        <DepartmentFormDialog
          departments={departments}
          users={users}
          editingDept={editDept}
          open={true}
          onOpenChange={(open) => !open && setEditDept(null)}
          onSubmit={async (values) => {
            const res = await fetch(`/api/admin/departments/${editDept.id}`, {
              method: 'PATCH',
              headers: buildAuthHeaders(true),
              body: JSON.stringify({
                name: values.name,
                code: values.code,
                parent_id: values.parent_id,
                leader_id: values.leader_id,
              }),
            })
            const result = await res.json()
            if (!res.ok) {
              error(result.error || '更新失败')
              throw new Error(result.error)
            }
            success('部门更新成功')
            await onRefresh?.()
          }}
        />
      )}

      {/* 添加同级/下级部门 Dialog */}
      {addDeptOpen && (
        <DepartmentFormDialog
          departments={departments}
          users={users}
          open={true}
          onOpenChange={(open) => !open && setAddDeptOpen(false)}
          onSubmit={async (values) => {
            const res = await fetch('/api/admin/departments', {
              method: 'POST',
              headers: buildAuthHeaders(true),
              body: JSON.stringify({
                name: values.name,
                code: values.code,
                parent_id: addDeptParentId,
                leader_id: values.leader_id,
              }),
            })
            const result = await res.json()
            if (!res.ok) {
              error(result.error || '创建失败')
              throw new Error(result.error)
            }
            success('部门创建成功')
            await onRefresh?.()
          }}
          trigger={null}
        />
      )}
    </>
  )
}

// ============ 成员表格组件 ============

interface MemberTableProps {
  users: OrgSummaryUser[]
  departments: OrgSummaryDepartment[]
  currentUserId: string | null
  onEditUser: (user: OrgSummaryUser) => void
  onAssignRole: (user: OrgSummaryUser) => void
  onBindIdentity: (user: OrgSummaryUser) => void
  onRefresh?: () => void | Promise<void>
}

function MemberTable({ users, currentUserId, onEditUser, onAssignRole, onBindIdentity, onRefresh }: MemberTableProps) {
  const [globalFilter, setGlobalFilter] = useState('')

  // 使用 Fuse.js 进行模糊搜索
  const fuse = useMemo(() => {
    return new Fuse(users, {
      keys: ['display_name', 'email', 'title', 'primary_dept_name', 'secondary_dept_names', 'directory_external_id', 'role_names'],
      threshold: 0.4,
    })
  }, [users])

  // 根据搜索关键词过滤
  const filteredUsers = useMemo(() => {
    if (!globalFilter.trim()) return users
    return fuse.search(globalFilter).map(result => result.item)
  }, [users, fuse, globalFilter])

  const columns = useMemo<ColumnDef<OrgSummaryUser>[]>(() => [
    {
      accessorKey: 'display_name',
      header: '姓名',
      size: 220,
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
            {row.original.display_name?.charAt(0) || '?'}
          </div>
          <div className="min-w-0">
            <div className="font-medium text-slate-900 truncate">{row.original.display_name}</div>
            <div className="text-xs text-slate-500 truncate">{row.original.email}</div>
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'title',
      header: '职位',
      size: 120,
      cell: ({ row }) => (
        <span className="text-sm text-slate-600 truncate block">
          {row.original.title || '-'}
        </span>
      ),
    },
    {
      accessorKey: 'primary_dept_name',
      header: '主属／附属部门',
      size: 180,
      cell: ({ row }) => (
        <div className="space-y-1">
          <Badge variant="outline" className="font-normal">{row.original.primary_dept_name || '未分配'}</Badge>
          {!!row.original.secondary_dept_names?.length && <div className="text-xs text-slate-500">附属：{row.original.secondary_dept_names.join('、')}</div>}
        </div>
      ),
    },
    {
      id: 'directory_association',
      header: '账号关联',
      size: 110,
      cell: ({ row }) => row.original.directory_identity_id
        ? <Badge variant={row.original.directory_pending_account ? 'outline' : 'secondary'}>{row.original.directory_pending_account ? '待首次登录' : '已有账号'}</Badge>
        : <span className="text-xs text-slate-500">系统成员</span>,
    },
    {
      accessorKey: 'role_names',
      header: '角色',
      size: 180,
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1 max-w-[170px]">
          {row.original.role_names?.split(',').map((role, i) => (
            <Badge key={i} variant="secondary" className="text-xs">
              {role.trim()}
            </Badge>
          )) || <span className="text-slate-400">-</span>}
        </div>
      ),
    },
    {
      accessorKey: 'status',
      header: '状态',
      size: 90,
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2 w-2 rounded-full ${
            row.original.directory_status
              ? (row.original.directory_status === 'active' ? 'bg-emerald-400' : 'bg-amber-400')
              : row.original.membership_status === 'invited'
              ? 'bg-blue-400'
              : row.original.status === 'active'
                ? 'bg-emerald-400'
                : 'bg-amber-400'
          }`} />
          <span className="text-sm text-slate-600">
            {row.original.directory_status
              ? (row.original.directory_status === 'active' ? '在职' : row.original.directory_status === 'ended' ? '已离职' : '已停用')
              : row.original.membership_status === 'invited'
              ? '待激活'
              : row.original.status === 'active'
                ? '在职'
                : row.original.status === 'suspended'
                  ? '已停用'
                  : '已离职'}
          </span>
        </div>
      ),
    },
    {
      id: 'actions',
      header: '操作',
      size: 70,
      cell: ({ row }) => {
        const user = row.original
        const isDisabled = user.status !== 'active'
        const isLoginDisabled = user.login_enabled === false
        const isInvited = user.membership_status === 'invited'
        const isDirectoryPending = user.directory_pending_account === true
        const roleMutationRestriction = getRoleMutationRestriction(user, currentUserId)

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <MoreHorizontalIcon className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="z-[100]">
              {/* P0: 编辑 */}
              <DropdownMenuItem onSelect={() => onEditUser(user)}>
                <EditIcon className="h-4 w-4 mr-2" />
                编辑
              </DropdownMenuItem>

              {/* P0: 分配角色 */}
              <DropdownMenuItem
                disabled={Boolean(roleMutationRestriction) || isInvited}
                onSelect={() => {
                  if (!roleMutationRestriction && !isInvited) onAssignRole(user)
                }}
                title={roleMutationRestriction?.reason || (isDirectoryPending ? '请员工首次通过纷享登录后再分配业务角色' : undefined)}
              >
                {roleMutationRestriction ? (
                  <LockIcon className="h-4 w-4 mr-2" />
                ) : (
                  <ShieldIcon className="h-4 w-4 mr-2" />
                )}
                <span className="flex min-w-0 flex-col">
                  <span>{roleMutationRestriction?.label || '分配角色'}</span>
                  {roleMutationRestriction && (
                    <span className="max-w-64 whitespace-normal text-[11px] leading-4 text-slate-400">
                      {roleMutationRestriction.reason}
                    </span>
                  )}
                </span>
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              {user.directory_identity_id ? (
                <DropdownMenuItem disabled>
                  <FingerprintIcon className="h-4 w-4 mr-2" />
                  已由纷享目录关联，无需逐人绑定
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  disabled={isInvited || isDisabled}
                  onSelect={() => onBindIdentity(user)}
                >
                  <FingerprintIcon className="h-4 w-4 mr-2" />
                  绑定历史 ICU 账号的纷享身份
                </DropdownMenuItem>
              )}

              {isDirectoryPending ? (
                <DropdownMenuItem disabled>纷享员工无需邀请码；首次登录即可查看，业务操作另按授权</DropdownMenuItem>
              ) : <>
              <DropdownMenuItem
                disabled={!isInvited}
                onSelect={async () => {
                  if (!await confirmAction(`重新生成 "${user.display_name}" 的待激活邀请码吗？旧激活码将立即失效。`, { confirmText: '重发邀请' })) return
                  try {
                    const res = await fetch(`/api/admin/users/${user.id}/invitations`, {
                      method: 'POST',
                      headers: buildAuthHeaders(),
                    })
                    const result = await res.json()
                    if (!res.ok) {
                      error(result.error || '重发邀请失败')
                      return
                    }
                    success(`新激活码：${result.data?.activationCode}（7 天内有效）`)
                    await onRefresh?.()
                  } catch (_err) {
                    error('重发邀请请求失败')
                  }
                }}
              >
                <MailIcon className="h-4 w-4 mr-2" />
                重发待激活邀请
              </DropdownMenuItem>

              <DropdownMenuItem
                disabled={!isInvited}
                onSelect={async () => {
                  if (!await confirmAction(`撤销 "${user.display_name}" 当前待激活邀请吗？`, { confirmText: '撤销邀请', danger: true })) return
                  try {
                    const res = await fetch(`/api/admin/users/${user.id}/invitations`, {
                      method: 'DELETE',
                      headers: buildAuthHeaders(),
                    })
                    const result = await res.json()
                    if (!res.ok) {
                      error(result.error || '撤销邀请失败')
                      return
                    }
                    success('待激活邀请已撤销')
                    await onRefresh?.()
                  } catch (_err) {
                    error('撤销邀请请求失败')
                  }
                }}
              >
                <BanIcon className="h-4 w-4 mr-2" />
                撤销待激活邀请
              </DropdownMenuItem>
              </>}

              {/* P1: 停用/启用 */}
              <DropdownMenuItem
                disabled={isInvited}
                onSelect={async () => {
                  const isRehire = user.status === 'inactive'
                  const action = isRehire ? '恢复在职' : isDisabled ? '启用' : '停用'
                  if (!await confirmAction(
                    isRehire
                      ? `确定将 "${user.display_name}" 恢复为在职吗？部门和角色需要重新配置，登录保持关闭。`
                      : `确定要${action}用户 "${user.display_name}" 吗？`,
                    { confirmText: action, danger: !isDisabled },
                  )) return
                  try {
                    const res = await fetch(
                      isRehire
                        ? `/api/admin/users/${user.id}/restore`
                        : `/api/admin/users/${user.id}`,
                      {
                      method: isRehire ? 'POST' : 'PATCH',
                      headers: buildAuthHeaders(true),
                      body: JSON.stringify(isRehire ? {} : { status: isDisabled ? 'active' : 'suspended' }),
                    })
                    const result = await res.json()
                    if (!res.ok) {
                      error(result.error || `${action}失败`)
                      return
                    }
                    success(`用户已${action}`)
                    await onRefresh?.()
                  } catch (_err) {
                    error(`${action}请求失败`)
                  }
                }}
              >
                {isDisabled ? (
                  <>
                    <PowerIcon className="h-4 w-4 mr-2 text-emerald-600" />
                    <span className="text-emerald-600">启用用户</span>
                  </>
                ) : (
                  <>
                    <PowerOffIcon className="h-4 w-4 mr-2 text-amber-600" />
                    <span className="text-amber-600">停用用户</span>
                  </>
                )}
              </DropdownMenuItem>

              {/* P1: 允许/禁止登录 */}
              <DropdownMenuItem
                disabled={isInvited}
                onSelect={async () => {
                  const action = isLoginDisabled ? '允许' : '禁止'
                  if (!await confirmAction(`确定要${action}用户 "${user.display_name}" 登录吗？`, { confirmText: action, danger: !isLoginDisabled })) return
                  try {
                    const res = await fetch(`/api/admin/users/${user.id}/login-enabled`, {
                      method: 'PATCH',
                      headers: buildAuthHeaders(true),
                      body: JSON.stringify({ login_enabled: isLoginDisabled }),
                    })
                    const result = await res.json()
                    if (!res.ok) {
                      error(result.error || `${action}登录失败`)
                      return
                    }
                    success(`已${action}登录`)
                    await onRefresh?.()
                  } catch (_err) {
                    error(`登录状态更新请求失败`)
                  }
                }}
              >
                {isLoginDisabled ? (
                  <>
                    <UnlockIcon className="h-4 w-4 mr-2 text-emerald-600" />
                    <span className="text-emerald-600">允许登录</span>
                  </>
                ) : (
                  <>
                    <LockIcon className="h-4 w-4 mr-2 text-amber-600" />
                    <span className="text-amber-600">禁止登录</span>
                  </>
                )}
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              {!isInvited && (
                <DropdownMenuItem
                  className="text-red-600"
                  disabled={Boolean(roleMutationRestriction)}
                  onSelect={async () => {
                    if (!await confirmAction(`确定要为 "${user.display_name}" 办理离职吗？\n成员关系、角色和部门授权会结束，历史审计保留，可在之后明确复职。`, { confirmText: '办理离职', danger: true })) return
                    try {
                      const res = await fetch(`/api/admin/users/${user.id}`, {
                        method: 'DELETE',
                        headers: buildAuthHeaders(true),
                        body: JSON.stringify({ reason: 'tenant administrator offboarding' }),
                      })
                      const result = await res.json()
                      if (!res.ok) {
                        error(result.error || '办理离职失败')
                        return
                      }
                      success('成员已离职，历史记录已保留')
                      await onRefresh?.()
                    } catch (_err) {
                      error('离职请求失败')
                    }
                  }}
                >
                  <TrashIcon className="h-4 w-4 mr-2" />
                  办理离职
                </DropdownMenuItem>
              )}

              {!isInvited && (
                <DropdownMenuItem
                  className="text-red-600"
                  disabled={Boolean(roleMutationRestriction)}
                  onSelect={async () => {
                    if (!await confirmAction(
                      `确定要将 "${user.display_name}" 移出当前组织吗？\n只结束当前租户的成员关系、角色、部门和空间授权，人员账户与历史审计保留。`,
                      { confirmText: '移出当前组织', danger: true },
                    )) return
                    try {
                      const res = await fetch(`/api/admin/users/${user.id}/membership`, {
                        method: 'DELETE',
                        headers: buildAuthHeaders(true),
                        body: JSON.stringify({ reason: 'tenant administrator removed membership' }),
                      })
                      const result = await res.json()
                      if (!res.ok) {
                        error(result.error || '移出当前组织失败')
                        return
                      }
                      success('成员已移出当前组织，账户与历史记录已保留')
                      await onRefresh?.()
                    } catch (_err) {
                      error('移出当前组织请求失败')
                    }
                  }}
                >
                  <TrashIcon className="h-4 w-4 mr-2" />
                  移出当前组织
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ], [currentUserId, onEditUser, onAssignRole, onBindIdentity, onRefresh])

  const table = useReactTable({
    data: filteredUsers,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: {
        pageSize: 10,
      },
    },
  })

  return (
    <div className="space-y-4">
      {/* 搜索栏 */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="搜索姓名、邮箱、职位..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="pl-9"
            autoComplete="off"
            type="search"
          />
        </div>
        <div className="text-sm text-slate-500">
          共 {filteredUsers.length} 人
        </div>
      </div>

      {/* 表格 */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map(headerGroup => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                  <TableHead key={header.id}>
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map(row => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map(cell => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-slate-500">
                  未找到匹配的成员
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* 分页 */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-500">
          第 {table.getState().pagination.pageIndex + 1} / {table.getPageCount()} 页
          （每页 {table.getState().pagination.pageSize} 条）
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            <ChevronRightIcon className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

// ============ 主组件 ============

export default function OrgStructureTab({
  orgSummary,
  currentUserId,
  onRefresh,
  onOpenIntegrations,
}: OrgStructureTabProps) {
  const departments = useMemo(() => orgSummary?.departments ?? [], [orgSummary?.departments])
  const users = useMemo(() => orgSummary?.users ?? [], [orgSummary?.users])
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null)

  // 根据选中部门过滤成员
  const filteredUsers = useMemo(() => {
    if (!selectedDeptId) return users
    const allowedDeptIds = getAllChildDeptIds(departments, selectedDeptId)
    return users.filter(u => [...(u.department_ids ?? []), ...(u.primary_dept_id ? [u.primary_dept_id] : [])].some(id => allowedDeptIds.has(id)))
  }, [users, departments, selectedDeptId])

  // 统计信息
  const stats = useMemo(() => ({
    deptCount: (orgSummary?.departments ?? []).length,
    userCount: (orgSummary?.users ?? []).length,
    spaceCount: (orgSummary?.spaces ?? []).length,
    filteredCount: filteredUsers.length,
  }), [orgSummary, filteredUsers.length])

  const selectedDept = useMemo(() => {
    const departments = orgSummary?.departments ?? []
    return departments.find(d => d.id === selectedDeptId) ?? null
  }, [orgSummary, selectedDeptId])

  // 编辑用户状态
  const [editingUser, setEditingUser] = useState<OrgSummaryUser | null>(null)
  const [assigningUser, setAssigningUser] = useState<OrgSummaryUser | null>(null)
  const [bindingUser, setBindingUser] = useState<OrgSummaryUser | null>(null)

  const isEmptyState = stats.deptCount === 0 && stats.userCount === 0

  return (
    <div className="space-y-6">
      {/* 顶部统计和操作 */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-wrap gap-2">
          <StatCard icon={<BuildingIcon size={18} />} label="部门" value={stats.deptCount} />
          <StatCard icon={<UsersIcon size={18} />} label="成员" value={stats.userCount} />
          <StatCard icon={<BuildingIcon size={18} />} label="销售空间" value={stats.spaceCount} />
        </div>
        <div className="text-sm text-slate-500">
          {selectedDept ? `当前筛选：${selectedDept.name}` : '当前筛选：全部成员'}
        </div>
      </div>

      {/* A3: 空数据状态提示 */}
      {isEmptyState && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-medium">暂无组织架构数据</p>
          <p className="mt-1 text-amber-700">
            当前组织没有可显示的部门或成员。可先手工添加，或进入“外部系统接入”核对目录差异。
          </p>
        </div>
      )}

      {/* 三栏布局 */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[280px_minmax(0,1fr)_300px]">
        {/* 左侧部门树 */}
        <div className="min-w-0">
          <div className="rounded-lg border bg-white">
            <div className="border-b px-4 py-3">
              <h3 className="font-medium text-slate-900">部门结构</h3>
              <p className="text-xs text-slate-500 mt-1">点击选择部门</p>
            </div>
            <div className="p-2 max-h-[680px] overflow-y-auto">
              <button
                onClick={() => setSelectedDeptId(null)}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition mb-2 ${
                  selectedDeptId === null
                    ? 'bg-blue-50 text-blue-900'
                    : 'hover:bg-slate-50'
                }`}
              >
                <UsersIcon size={16} className={selectedDeptId === null ? 'text-blue-500' : 'text-slate-400'} />
                <span className="flex-1 text-sm font-medium">全部成员</span>
                <Badge variant={selectedDeptId === null ? 'default' : 'outline'} className="text-xs">
                  {stats.userCount}
                </Badge>
              </button>

              <div className="border-t my-2" />

              <DepartmentTree
                departments={departments}
                users={users}
                selectedDeptId={selectedDeptId}
                onSelectDept={setSelectedDeptId}
                onRefresh={onRefresh}
              />
            </div>
          </div>
        </div>

        {/* 中间成员列表 */}
        <div className="min-w-0">
          <div className="rounded-lg border bg-white">
            <div className="border-b px-6 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-slate-900">
                    {selectedDept ? `${selectedDept.name} 的成员` : '全部成员'}
                  </h3>
                  <p className="text-xs text-slate-500 mt-1">
                    {selectedDept
                      ? `共 ${stats.filteredCount} 人（含子部门）`
                      : `共 ${stats.userCount} 人`
                    }
                  </p>
                </div>
                {selectedDept && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedDeptId(null)}
                  >
                    查看全部
                  </Button>
                )}
              </div>
            </div>
            <div className="p-6">
              <MemberTable
                users={filteredUsers}
                departments={departments}
                currentUserId={currentUserId}
                onEditUser={setEditingUser}
                onAssignRole={(user) => {
                  const restriction = getRoleMutationRestriction(user, currentUserId)
                  if (restriction) {
                    error(restriction.reason)
                    return
                  }
                  setAssigningUser(user)
                }}
                onBindIdentity={setBindingUser}
                onRefresh={onRefresh}
              />
            </div>
          </div>
        </div>

        <div className="min-w-0 space-y-4">
          <div className="rounded-lg border bg-white p-4">
            <h3 className="font-medium text-slate-900">当前组织目录</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              外部目录只在冻结差异并人工确认后更新这里。连接、可读范围和主来源切换在独立页面管理。
            </p>
            {onOpenIntegrations && (
              <Button type="button" variant="outline" size="sm" className="mt-3 w-full justify-center" onClick={onOpenIntegrations}>
                前往外部系统接入
              </Button>
            )}
          </div>
          <div className="rounded-lg border bg-white p-4">
            <h3 className="font-medium text-slate-900">组织操作</h3>
            <div className="mt-4 grid gap-2">
          <DepartmentFormDialog
            departments={departments}
            users={users}
            onSubmit={async (values) => {
              const res = await fetch('/api/admin/departments', {
                method: 'POST',
                headers: buildAuthHeaders(true),
                body: JSON.stringify({
                  name: values.name,
                  code: values.code,
                  parent_id: values.parent_id,
                  leader_id: values.leader_id,
                }),
              })
              const result = await res.json()
              if (!res.ok) {
                error(result.error || '创建部门失败')
                throw new Error(result.error)
              }
              success('部门创建成功')
              await onRefresh?.()
            }}
            trigger={
              <Button variant="outline" size="sm" className="w-full justify-center">
                <PlusIcon className="h-4 w-4 mr-1" />
                添加部门
              </Button>
            }
          />
          <UserFormDialog
            departments={departments}
            roles={orgSummary?.roles ?? []}
            onSubmit={async (values) => {
              const res = await fetch('/api/admin/users', {
                method: 'POST',
                headers: buildAuthHeaders(true),
                body: JSON.stringify(values),
              })
              const result = await res.json()
              if (!res.ok) {
                error(result.error || '创建用户失败')
                throw new Error(result.error)
              }
              const activationCode = result.data?.activationCode
              success(activationCode
                ? `成员邀请已创建，激活码：${activationCode}（7 天内有效）`
                : '成员邀请已创建')
              await onRefresh?.()
            }}
            trigger={
              <Button variant="outline" size="sm" className="w-full justify-center">
                <UserPlusIcon className="h-4 w-4 mr-1" />
                添加成员
              </Button>
            }
          />
            </div>
          </div>

          <div className="rounded-lg border bg-white p-4">
            <h3 className="font-medium text-slate-900">当前上下文</h3>
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-slate-500">部门</span>
                <span className="font-medium text-slate-900">{selectedDept?.name || '全部成员'}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-slate-500">筛选成员</span>
                <span className="font-semibold text-slate-900">{stats.filteredCount}</span>
              </div>
              <div className="rounded-lg border border-slate-200 p-3 text-xs leading-5 text-slate-500">
                外部目录同步先检查读取范围并生成差异；冲突、范围不明或快照不完整时整批阻断。
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 编辑用户 Dialog */}
      {editingUser && (
        <UserFormDialog
          departments={departments}
          editingUser={editingUser}
          open={true}
          onOpenChange={(open) => !open && setEditingUser(null)}
          onSubmit={async (values) => {
            const res = await fetch(`/api/admin/users/${editingUser.id}`, {
              method: 'PATCH',
              headers: buildAuthHeaders(true),
              body: JSON.stringify(values),
            })
            const result = await res.json()
            if (!res.ok) {
              error(result.error || '更新失败')
              throw new Error(result.error)
            }
            success('用户更新成功')
            await onRefresh?.()
          }}
        />
      )}

      <IdentityBindingDialog
        user={bindingUser}
        open={Boolean(bindingUser)}
        onOpenChange={(open) => !open && setBindingUser(null)}
        onBound={onRefresh}
      />

      {/* 分配角色 Dialog */}
      {assigningUser && (
        <RoleAssignmentDialog
          userId={assigningUser.id}
          userName={assigningUser.display_name}
          currentRoles={assigningUser.role_ids || []}
          departments={departments}
          spaces={orgSummary?.spaces ?? []}
          scopedRoles={assigningUser.scoped_roles}
          open={true}
          onOpenChange={(open) => !open && setAssigningUser(null)}
          onSubmit={async (roleIds) => {
            const res = await fetch(`/api/admin/users/${assigningUser.id}/roles`, {
              method: 'POST',
              headers: buildAuthHeaders(true),
              body: JSON.stringify({ role_ids: roleIds, scope_type: 'org' }),
            })
            const result = await res.json()
            if (!res.ok) {
              error(result.error || '分配角色失败')
              throw new Error(result.error)
            }
            success('角色分配成功')
            await onRefresh?.()
          }}
          onSubmitScoped={async (roleId, scopeType, scopeId) => {
            const res = await fetch(`/api/admin/users/${assigningUser.id}/role-scopes`, {
              method: 'POST',
              headers: buildAuthHeaders(true),
              body: JSON.stringify({
                role_id: roleId,
                scope_type: scopeType,
                scope_id: scopeId,
                reason: `${scopeType} role assignment`,
              }),
            })
            const result = await res.json()
            if (!res.ok) {
              error(result.error || '分配作用域角色失败')
              throw new Error(result.error)
            }
            success('作用域角色分配成功')
            await onRefresh?.()
          }}
          onRevokeScoped={async (roleId, scopeType, scopeId) => {
            const res = await fetch(`/api/admin/users/${assigningUser.id}/role-scopes`, {
              method: 'DELETE',
              headers: buildAuthHeaders(true),
              body: JSON.stringify({
                role_id: roleId,
                scope_type: scopeType,
                scope_id: scopeId,
                reason: `${scopeType} role assignment revoked`,
              }),
            })
            const result = await res.json()
            if (!res.ok) {
              error(result.error || '撤销作用域角色失败')
              throw new Error(result.error)
            }
            success('作用域角色已撤销')
            await onRefresh?.()
          }}
        />
      )}
    </div>
  )
}

// ============ 辅助组件 ============

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-white px-4 py-2">
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-slate-600">
        {icon}
      </div>
      <div>
        <div className="text-lg font-semibold leading-none text-slate-900">{value}</div>
        <div className="text-xs text-slate-500 mt-1">{label}</div>
      </div>
    </div>
  )
}

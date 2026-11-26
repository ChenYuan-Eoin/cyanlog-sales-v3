'use client'

import { useState, useMemo, useCallback, useEffect } from 'react'
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
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { BuildingIcon, UsersIcon, SearchIcon, ChevronLeftIcon, ChevronRightIcon, ChevronRight as ChevronRightIconCustom, ChevronDown as ChevronDownIconCustom, PlusIcon, MoreHorizontalIcon, EditIcon, TrashIcon, UserPlusIcon, ShieldIcon, PowerOffIcon, PowerIcon, UnlockIcon, MailIcon, BanIcon, FingerprintIcon } from 'lucide-react'
import type { OrgSummaryPayload, OrgSummaryUser, OrgSummaryDepartment, OrgSummaryRole } from '../types'
import type { MemberActionAvailability } from '@/lib/admin/member-actions'
import { isRetiredRoleCode } from '@/lib/role-permission-resolution'
import Fuse from 'fuse.js'
import { success, error, confirmAction } from '@/lib/toast'
import { buildDepartmentOptions, resolveDepartmentSpaceIds } from '@/lib/department-spaces'
import { ShippingDepartmentAuthorization } from '@/app/shipping/intake-configuration'
import { DepartmentPermissions } from './DepartmentPermissions'
import { EmployeePermissionOverrides, isEmployeePermissionTarget } from './EmployeePermissionOverrides'
import { DepartmentFormDialog } from './components/DepartmentFormDialog'
import { UserFormDialog } from './components/UserFormDialog'
import { RoleAssignmentDialog } from './components/RoleAssignmentDialog'
import { IdentityBindingDialog } from './components/IdentityBindingDialog'
import { MemberBatchActions } from './components/MemberBatchActions'
import {
  editableCurrentOrgBusinessRoleIds, editableOrgRoleIds, getMemberRoleMutationRestriction, getRoleMutationRestriction, isGenericallyAssignableRole,
  userHasSystemAdminAssignment,
} from './role-assignment-policy'
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

const unavailableMemberActions: MemberActionAvailability = {
  edit: false,
  assignRoles: false,
  invite: false,
  manageLogin: false,
  manageEmployment: false,
  removeMembership: false,
  manageDepartments: false,
  bindExternalIdentity: false,
}

type LeaderAccess = { userId: string | null; leaderId: string | null }

function DepartmentLeaderAccess({ department }: { department: OrgSummaryDepartment }) {
  const [approval, setApproval] = useState<LeaderAccess | null>(null)
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)
  const { id: departmentId, leader_id: leaderId } = department
  const url = '/api/admin/departments/leader-access'
  const leaderMatchesDepartment = approval?.leaderId === (leaderId ?? null)
  const leaderLabel = department.leader_name || '当前负责人'

  const readApproval = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`${url}?departmentId=${encodeURIComponent(departmentId)}`, {
        headers: buildAuthHeaders(),
        cache: 'no-store',
        signal,
      })
      if (signal?.aborted) return
      if (!response.ok) {
        setApproval(null)
        setFeedback(response.status === 401 || response.status === 403 ? '' : '暂时无法读取负责人数据权限。')
        return
      }
      const data: LeaderAccess = await response.json()
      if (signal?.aborted) return
      setApproval(data)
      setFeedback('')
    } catch {
      if (signal?.aborted) return
      setApproval(null)
      setFeedback('暂时无法读取负责人数据权限。')
    }
  }, [departmentId])

  useEffect(() => {
    const controller = new AbortController()
    void readApproval(controller.signal)
    return () => controller.abort()
  }, [readApproval, leaderId])

  async function updateApproval() {
    if (!approval || !leaderMatchesDepartment || busy) return
    const granting = !approval.userId
    const nextUserId = granting ? approval.leaderId : null
    if (granting && !nextUserId) return
    setBusy(true)
    try {
      const confirmed = await confirmAction(granting
        ? `允许${leaderLabel}查看${department.name}及下级部门。商机等业务仍按角色权限校验。`
        : `撤销${leaderLabel}在${department.name}的这项部门授权。`, {
        title: granting ? '确认负责人数据权限' : '撤销负责人数据权限',
        confirmText: granting ? '确认授权' : '确认撤销',
      })
      if (!confirmed) return

      const response = await fetch(url, {
        method: 'PUT',
        headers: buildAuthHeaders(true),
        body: JSON.stringify({ departmentId, userId: nextUserId, expectedUserId: approval.userId }),
      })
      if (!response.ok) {
        if (response.status === 409) {
          await readApproval()
          setFeedback('负责人或权限已变更，请核对最新状态后重试。')
        } else if (response.status === 401 || response.status === 403) {
          setApproval(null)
          setFeedback('当前账号无权确认负责人数据权限。')
        } else {
          setFeedback('无法更新负责人数据权限，请重试。')
        }
        return
      }
      await readApproval()
    } catch {
      setFeedback('暂时无法确认保存结果，请重新读取。')
    } finally {
      setBusy(false)
    }
  }

  if (!approval && !feedback) return null

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <h4 className="text-sm font-medium text-slate-800">负责人数据权限</h4>
      {approval && (
        <>
          <p className="mt-1 text-xs text-slate-500">
            {approval.userId ? '已授权' : approval.leaderId ? '负责人待授权' : '尚未设置负责人'}
          </p>
          {!leaderMatchesDepartment && (
            <p className="mt-1 text-xs text-amber-800">部门负责人已更新，请刷新组织架构后再确认。</p>
          )}
          {leaderMatchesDepartment && (approval.leaderId || approval.userId) && (
            <Button type="button" variant="outline" size="sm" className="mt-2" disabled={busy}
              onClick={() => void updateApproval()}>
              {approval.userId ? '撤销负责人权限' : '确认负责人权限'}
            </Button>
          )}
        </>
      )}
      {feedback && <p role="status" className="mt-1 text-xs text-amber-800">{feedback}</p>}
    </div>
  )
}

function buildAuthHeaders(includeJson = false): HeadersInit {
  const token = localStorage.getItem('token')
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(includeJson ? { 'Content-Type': 'application/json' } : {}),
  }
}

// ============ 工具函数 ============

type MemberEmployment = 'active' | 'departed' | 'suspended' | 'unknown'
type MemberFilter = MemberEmployment | 'synced' | 'all'

function memberEmployment(user: OrgSummaryUser): MemberEmployment {
  if (user.directory_identity_id) {
    if (user.directory_status === 'active') return 'active'
    if (user.directory_status === 'ended'
      || (user.directory_source === 'fxiaoke' && user.directory_status === 'suspended')) return 'departed'
    if (user.directory_status === 'suspended') return 'suspended'
    return 'unknown'
  }
  if (user.employment_status === 'ended' || user.membership_status === 'ended') return 'departed'
  if (user.employment_status === 'suspended' || user.membership_status === 'suspended') return 'suspended'
  if (user.membership_status === 'invited' || user.status === 'active') return 'active'
  if (user.status === 'suspended') return 'suspended'
  if (user.status === 'inactive') return 'departed'
  return 'unknown'
}

const EMPLOYMENT_LABELS: Record<MemberEmployment, string> = {
  active: '在职', departed: '已离职', suspended: '已停用', unknown: '待核对',
}
const MEMBER_FILTER_LABELS: Record<MemberFilter, string> = {
  synced: '同步在职', ...EMPLOYMENT_LABELS, active: '在职（含本地）', all: '全部',
}

function memberDepartmentIds(user: OrgSummaryUser): Set<string> {
  return new Set([...(user.department_ids ?? []), ...(user.primary_dept_id ? [user.primary_dept_id] : [])])
}

// ============ 部门树组件 ============

interface DepartmentTreeProps {
  departments: OrgSummaryDepartment[]
  users: OrgSummaryUser[]
  memberCounts: Map<string, number> | null
  memberAccess: boolean
  canEdit: boolean
  canDelete: boolean
  showRootAdd?: boolean
  selectedDeptId: string | null
  onSelectDept: (id: string | null) => void
  onMemberBindingsBlocked?: (departmentId: string) => void
  onRefresh?: () => void | Promise<void>
  className?: string
}

function DepartmentTree({
  departments, users, memberCounts, memberAccess, canEdit, canDelete, showRootAdd,
  selectedDeptId, onSelectDept, onMemberBindingsBlocked, onRefresh, className,
}: DepartmentTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [editDept, setEditDept] = useState<OrgSummaryDepartment | null>(null)
  const [deletingDept, setDeletingDept] = useState<OrgSummaryDepartment | null>(null)
  // 添加部门弹窗状态
  const [addDeptOpen, setAddDeptOpen] = useState(false)
  const [addDeptParentId, setAddDeptParentId] = useState<string | null>(null)

  const departmentsByParent = useMemo(() => {
    const grouped = new Map<string | null, OrgSummaryDepartment[]>()
    for (const department of departments) {
      const parent = department.parent_id || null
      const siblings = grouped.get(parent) ?? []
      siblings.push(department)
      grouped.set(parent, siblings)
    }
    return grouped
  }, [departments])
  const rootDepts = departmentsByParent.get(null) ?? []

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
        if (memberAccess && result.code === 'DEPARTMENT_HAS_MEMBER_BINDINGS') onMemberBindingsBlocked?.(dept.id)
        return
      }
      success('部门已删除')
      await onRefresh?.()
    } catch {
      error('未能确认删除结果，请核对部门状态')
    } finally {
      setDeletingDept(null)
    }
  }, [memberAccess, onMemberBindingsBlocked, onRefresh])

  function renderDepartment(dept: OrgSummaryDepartment, depth: number) {
    const children = departmentsByParent.get(dept.id) ?? []
    const isExpanded = expanded.has(dept.id)
    const hasChildren = children.length > 0
    const isSelected = selectedDeptId === dept.id

    return (
      <div key={dept.id}>
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
          {(canEdit || canDelete) && <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`管理部门 ${dept.name}`}
                className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity rounded p-1 hover:bg-slate-200/50"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontalIcon size={14} className="text-slate-400" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canEdit && <DropdownMenuItem onSelect={() => setEditDept(dept)}>
                <EditIcon className="h-4 w-4 mr-2" />
                编辑
              </DropdownMenuItem>}
              {canEdit && <DropdownMenuItem onSelect={() => { setAddDeptParentId(dept.parent_id ? dept.parent_id : null); setAddDeptOpen(true); }}>
                <PlusIcon className="h-4 w-4 mr-2" />
                添加同级部门
              </DropdownMenuItem>}
              {canEdit && <DropdownMenuItem onSelect={() => { setAddDeptParentId(dept.id); setAddDeptOpen(true); }}>
                <PlusIcon className="h-4 w-4 mr-2" />
                添加下级部门
              </DropdownMenuItem>}
              {canDelete && <DropdownMenuItem
                className="text-red-600"
                disabled={deletingDept?.id === dept.id}
                onSelect={() => handleDelete(dept)}
              >
                <TrashIcon className="h-4 w-4 mr-2" />
                {deletingDept?.id === dept.id ? '删除中...' : '删除'}
              </DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>}

          {/* Member count */}
          {memberAccess && <Badge variant={isSelected ? 'default' : 'outline'} className="shrink-0 text-xs">
            {memberCounts ? memberCounts.get(dept.id) ?? 0 : '—'}
          </Badge>}
        </div>

        {isExpanded && hasChildren && (
          <div>
            {children.map(child => renderDepartment(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <div className={`space-y-1 ${className}`}>
        {showRootAdd && canEdit && (
          <Button type="button" size="sm" variant="outline" onClick={() => {
            setAddDeptParentId(null)
            setAddDeptOpen(true)
          }}>
            <PlusIcon className="mr-1 h-4 w-4" />
            添加部门
          </Button>
        )}
        {rootDepts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-500">
            暂无部门数据
          </div>
        ) : (
          rootDepts.map(dept => renderDepartment(dept, 0))
        )}
      </div>

      {/* Edit Dialog - controlled by state, not nested in DropdownMenu */}
      {editDept && canEdit && (
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
                ...(memberAccess ? { leader_id: values.leader_id } : {}),
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
      {addDeptOpen && canEdit && (
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
  canReadDepartments: boolean
  currentUserId: string | null
  actions: MemberActionAvailability
  batchOrgId?: string
  batchScope: string
  batchRoles: OrgSummaryRole[]
  onEditUser: (user: OrgSummaryUser) => void
  onAssignRole: (user: OrgSummaryUser) => void
  systemAdminOrgIdForUser: (user: OrgSummaryUser) => string | undefined
  onOpenEmployeePermissions?: (user: OrgSummaryUser) => void
  onBindIdentity: (user: OrgSummaryUser) => void
  onRefresh?: () => void | Promise<void>
}

const memberPageSize = 10

function MemberTable({
  users, canReadDepartments, currentUserId, actions, batchOrgId, batchScope, batchRoles,
  onEditUser, onAssignRole, systemAdminOrgIdForUser, onOpenEmployeePermissions, onBindIdentity, onRefresh,
}: MemberTableProps) {
  const [globalFilter, setGlobalFilter] = useState('')
  const query = globalFilter.trim()
  const selectionScope = JSON.stringify([batchScope, query])
  const [selection, setSelection] = useState(() => ({ scope: selectionScope, ids: new Set<string>() }))
  const [pageIndex, setPageIndex] = useState(0)
  const allowSelection = Boolean(batchOrgId && currentUserId && (actions.manageLogin || actions.manageEmployment || actions.assignRoles))

  // 使用 Fuse.js 进行模糊搜索
  const fuse = useMemo(() => {
    return new Fuse(users, {
      keys: ['display_name', 'email', 'title', 'directory_external_id', 'role_names',
        ...(canReadDepartments ? ['primary_dept_name', 'secondary_dept_names'] : [])],
      threshold: 0.4,
    })
  }, [canReadDepartments, users])

  // 根据搜索关键词过滤
  const filteredUsers = useMemo(() => {
    if (!query) return users
    return fuse.search(query).map(result => result.item)
  }, [users, fuse, query])

  const lastPageIndex = Math.max(0, Math.ceil(filteredUsers.length / memberPageSize) - 1)
  if (selection.scope !== selectionScope) {
    setSelection({ scope: selectionScope, ids: new Set() })
    setPageIndex(0)
  } else if (pageIndex > lastPageIndex) {
    setPageIndex(lastPageIndex)
  }
  const membersInScope = useMemo(() => new Map(filteredUsers.map(user => [user.id, user])), [filteredUsers])
  const selectedMembers = useMemo(() => selection.scope === selectionScope
    ? [...membersInScope.values()].filter(user => selection.ids.has(user.id))
    : [], [membersInScope, selection, selectionScope])
  const toggleMember = useCallback((memberId: string, checked: boolean) => {
    setSelection(previous => {
      const ids = new Set(previous.scope === selectionScope ? previous.ids : [])
      if (checked) ids.add(memberId)
      else ids.delete(memberId)
      return { scope: selectionScope, ids }
    })
  }, [selectionScope])
  const clearSelection = useCallback(() => setSelection({ scope: selectionScope, ids: new Set() }), [selectionScope])
  const removeCompletedSelection = useCallback((userIds: string[]) => {
    const completed = new Set(userIds)
    setSelection(previous => previous.scope === selectionScope
      ? { scope: previous.scope, ids: new Set([...previous.ids].filter(id => !completed.has(id))) }
      : previous)
  }, [selectionScope])

  const dataColumns = useMemo<ColumnDef<OrgSummaryUser>[]>(() => [
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
      cell: ({ row }) => {
        const user = row.original
        if (!user.directory_identity_id) return <span className="text-xs text-slate-500">
          {user.status === 'active' && user.login_enabled === false ? '账号已停用' : '系统成员'}
        </span>
        const employed = memberEmployment(user) === 'active'
        const firstLoginPending = user.directory_pending_account === true && user.membership_status === 'invited' && user.status === 'inactive'
        return <Badge variant={employed && firstLoginPending ? 'outline' : 'secondary'}>
          {!employed ? '不可登录' : firstLoginPending ? '待首次登录' : user.login_enabled === false ? '账号已停用' : '已有账号'}
        </Badge>
      },
    },
    {
      accessorKey: 'role_names',
      header: '角色',
      size: 180,
      cell: ({ row }) => {
        const user = row.original
        const roleNames = user.scoped_roles?.filter(role => !isRetiredRoleCode(role.roleCode))
          .map(role => role.scopeType === 'org' ? role.roleName : `${role.roleName}（${role.scopeName}）`)
          ?? (user.role_names ?? '').split(',').map(role => role.trim()).filter(Boolean)
        const pendingRoles = user.pending_org_roles?.filter(role => !isRetiredRoleCode(role.code)) ?? []
        return <div className="flex flex-wrap gap-1 max-w-[170px]">
          {[...new Set(roleNames)].map(role => <Badge key={role} variant="secondary" className="text-xs">{role}</Badge>)}
          {pendingRoles.map(role => <Badge key={role.id} variant="outline" className="text-xs">{role.name} · 待首次登录生效</Badge>)}
          {roleNames.length === 0 && pendingRoles.length === 0 && <span className="text-slate-400">-</span>}
        </div>
      },
    },
    {
      accessorKey: 'status',
      header: '状态',
      size: 90,
      cell: ({ row }) => {
        const employment = memberEmployment(row.original)
        return <div className="flex items-center gap-2">
          <span className={'inline-block h-2 w-2 rounded-full ' + (employment === 'active' ? 'bg-emerald-400' : employment === 'unknown' ? 'bg-slate-400' : 'bg-amber-400')} />
          <span className="text-sm text-slate-600">{EMPLOYMENT_LABELS[employment]}</span>
        </div>
      },
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
        const isDirectoryManaged = Boolean(user.directory_identity_id)
        const directoryUnavailable = isDirectoryManaged && memberEmployment(user) !== 'active'
        const lifecycleRestriction = getRoleMutationRestriction(user, currentUserId)
        const roleMutationRestriction = getMemberRoleMutationRestriction(user, currentUserId, systemAdminOrgIdForUser(user))
        const canChangeRoles = actions.assignRoles && !roleMutationRestriction && !directoryUnavailable
        const showAccountActions = !isInvited && !directoryUnavailable && user.status !== 'inactive'
        const lifecycleHint = lifecycleRestriction?.code === 'PROTECTED_ROLE_MUTATION_FORBIDDEN'
          ? '请先撤销系统超管角色' : lifecycleRestriction?.label

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" aria-label={'管理' + user.display_name}>
                <MoreHorizontalIcon className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="z-[100]">
              {/* P0: 编辑 */}
              <DropdownMenuItem disabled={!actions.edit || isDirectoryManaged} onSelect={() => onEditUser(user)}>
                <EditIcon className="h-4 w-4 mr-2" />
                编辑
              </DropdownMenuItem>

              {/* P0: 分配角色 */}
              <DropdownMenuItem
                disabled={!canChangeRoles}
                onSelect={() => onAssignRole(user)}
                title={roleMutationRestriction?.label}
              >
                <ShieldIcon className="h-4 w-4 mr-2" />
                分配角色
              </DropdownMenuItem>

              {onOpenEmployeePermissions && (
                <DropdownMenuItem
                  disabled={directoryUnavailable || !isEmployeePermissionTarget(user)}
                  onSelect={() => onOpenEmployeePermissions(user)}
                >
                  <ShieldIcon className="mr-2 h-4 w-4" />
                  员工权限设置
                </DropdownMenuItem>
              )}

              <DropdownMenuSeparator />

              {!isDirectoryManaged && (
                <DropdownMenuItem
                  disabled={!actions.bindExternalIdentity || isInvited || isDisabled}
                  onSelect={() => onBindIdentity(user)}
                >
                  <FingerprintIcon className="h-4 w-4 mr-2" />
                  绑定历史 ICU 账号的纷享身份
                </DropdownMenuItem>
              )}

              {!isDirectoryManaged && !isDirectoryPending && <>
              <DropdownMenuItem
                disabled={!actions.invite || !isInvited}
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
                disabled={!actions.invite || !isInvited}
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

              {!isDirectoryManaged && isDisabled && (
              <DropdownMenuItem
                disabled={!actions.manageEmployment || isInvited || Boolean(lifecycleRestriction)}
                onSelect={async () => {
                  const isRehire = user.status === 'inactive'
                  const action = isRehire ? '恢复在职' : '启用用户'
                  if (!await confirmAction(
                    isRehire
                      ? `确定将 "${user.display_name}" 恢复为在职吗？部门和角色需要重新配置，登录保持关闭。`
                      : `确定要启用用户 "${user.display_name}" 吗？`,
                    { confirmText: action },
                  )) return
                  try {
                    const res = await fetch(
                      isRehire
                        ? `/api/admin/users/${user.id}/restore`
                        : `/api/admin/users/${user.id}`,
                      {
                      method: isRehire ? 'POST' : 'PATCH',
                      headers: buildAuthHeaders(true),
                      body: JSON.stringify(isRehire ? {} : { status: 'active' }),
                    })
                    const result = await res.json()
                    if (!res.ok) {
                      error(result.error || `${action}失败`)
                      return
                    }
                    success(isRehire ? '用户已恢复在职' : '用户已启用')
                    await onRefresh?.()
                  } catch (_err) {
                    error(`${action}请求失败`)
                  }
                }}
              >
                <PowerIcon className="h-4 w-4 mr-2 text-emerald-600" />
                <span className="text-emerald-600">{user.status === 'inactive' ? '恢复在职' : '启用用户'}</span>
              </DropdownMenuItem>
              )}

              {showAccountActions && (
              <DropdownMenuItem
                disabled={!actions.manageLogin || Boolean(lifecycleRestriction)}
                title={lifecycleHint}
                onSelect={async () => {
                  const action = isLoginDisabled ? '启用账号' : '停用账号'
                  if (!await confirmAction(`确定要为「${user.display_name}」${action}吗？`, { confirmText: action, danger: !isLoginDisabled })) return
                  try {
                    const res = await fetch(`/api/admin/users/${user.id}/login-enabled`, {
                      method: 'PATCH',
                      headers: buildAuthHeaders(true),
                      body: JSON.stringify({ login_enabled: isLoginDisabled }),
                    })
                    const result = await res.json()
                    if (!res.ok) {
                      error(result.error || `${action}失败`)
                      return
                    }
                    success(isLoginDisabled ? '账号已启用' : '账号已停用')
                    await onRefresh?.()
                  } catch (_err) {
                    error(`${action}请求失败`)
                  }
                }}
              >
                {isLoginDisabled ? (
                  <>
                    <UnlockIcon className="h-4 w-4 mr-2 text-emerald-600" />
                    <span className="text-emerald-600">启用账号</span>
                  </>
                ) : (
                  <>
                    <PowerOffIcon className="h-4 w-4 mr-2 text-amber-600" />
                    <span className="text-amber-600">停用账号</span>
                  </>
                )}
              </DropdownMenuItem>
              )}

              <DropdownMenuSeparator />

              {showAccountActions && (
                <DropdownMenuItem
                  className="text-red-600"
                  disabled={!actions.manageEmployment || Boolean(lifecycleRestriction)}
                  title={lifecycleHint}
                  onSelect={async () => {
                    if (!await confirmAction(`为「${user.display_name}」办理离职后，员工将失去 ICU 的成员身份及访问权限。`, { confirmText: '办理离职', danger: true })) return
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

              {!isDirectoryManaged && !isInvited && (
                <DropdownMenuItem
                  className="text-red-600"
                  disabled={!actions.removeMembership || Boolean(lifecycleRestriction)}
                  onSelect={async () => {
                    if (!await confirmAction(
                      `确定要将 "${user.display_name}" 移出当前组织吗？\n只结束当前租户的成员关系、角色和数据授权，人员账户与历史审计保留。`,
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
  ], [currentUserId, actions, onEditUser, onAssignRole, systemAdminOrgIdForUser, onOpenEmployeePermissions, onBindIdentity, onRefresh])

  const columns = useMemo<ColumnDef<OrgSummaryUser>[]>(() => {
    const visibleColumns = canReadDepartments
      ? dataColumns
      : dataColumns.filter(column => !('accessorKey' in column && column.accessorKey === 'primary_dept_name'))
    if (!allowSelection) return visibleColumns
    const fullSelection = selectedMembers.length > 0 && selectedMembers.length === membersInScope.size
    return [{
      id: 'member_selection',
      size: 76,
      header: () => (
        <label className="inline-flex items-center gap-2 whitespace-nowrap" title="选择当前名单的所有分页">
          <Checkbox
            aria-label={`全选当前名单（${membersInScope.size} 人，含所有分页）`}
            disabled={membersInScope.size === 0}
            checked={fullSelection ? true : selectedMembers.length > 0 ? 'indeterminate' : false}
            onCheckedChange={checked => {
              if (checked === true) setSelection({ scope: selectionScope, ids: new Set(membersInScope.keys()) })
              else clearSelection()
            }}
          />
          <span className="text-xs">全选</span>
        </label>
      ),
      cell: ({ row }) => (
        <Checkbox
          aria-label={`选择${row.original.display_name}`}
          checked={selection.scope === selectionScope && selection.ids.has(row.original.id)}
          onCheckedChange={checked => toggleMember(row.original.id, checked === true)}
        />
      ),
    }, ...visibleColumns]
  }, [allowSelection, canReadDepartments, clearSelection, dataColumns, membersInScope, selectedMembers.length, selection, selectionScope, toggleMember])

  const table = useReactTable({
    data: filteredUsers,
    columns,
    getRowId: user => user.id,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: false,
    state: { pagination: { pageIndex, pageSize: memberPageSize } },
    onPaginationChange: update => {
      const next = typeof update === 'function' ? update({ pageIndex, pageSize: memberPageSize }) : update
      setPageIndex(next.pageIndex)
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

      {allowSelection && batchOrgId && (
        <MemberBatchActions
          key={selectionScope}
          orgId={batchOrgId}
          members={selectedMembers}
          roles={batchRoles}
          canSuspend={actions.manageLogin}
          canOffboard={actions.manageEmployment}
          canAssignRoles={actions.assignRoles}
          authHeaders={() => buildAuthHeaders(true)}
          onClearSelection={clearSelection}
          onSucceeded={removeCompletedSelection}
          onRefresh={onRefresh}
        />
      )}

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
            aria-label="上一页"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label="下一页"
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
  const departmentAccess = orgSummary?.department_access
  const canReadDepartments = departmentAccess?.canRead !== false
  const departments = useMemo(() => canReadDepartments ? orgSummary?.departments ?? [] : [],
    [canReadDepartments, orgSummary?.departments])
  const users = useMemo(() => orgSummary?.users ?? [], [orgSummary?.users])
  const departmentTree = useMemo(() => buildDepartmentOptions(departments), [departments])
  const shippingDepartments = useMemo(() => departmentTree.map(department => ({
    id: department.department_id, name: department.name, parentId: department.parent_department_id,
  })), [departmentTree])
  const orgDepartmentIds = useMemo(() => departmentTree.map(department => department.department_id), [departmentTree])
  const [storedSelectedDeptId, setSelectedDeptId] = useState<string | null>(null)
  const selectedDeptId = canReadDepartments ? storedSelectedDeptId : null
  const [includeSubdepartments, setIncludeSubdepartments] = useState(true)
  const [employmentFilter, setEmploymentFilter] = useState<MemberFilter>('synced')
  const [memberTableVersion, setMemberTableVersion] = useState(0)
  const showDirectDepartmentMembers = useCallback((departmentId: string) => {
    setSelectedDeptId(departmentId)
    setEmploymentFilter('all')
    setIncludeSubdepartments(false)
    setMemberTableVersion(version => version + 1)
  }, [])
  const directoryRoster = orgSummary?.directory_roster
  const synchronizedView = employmentFilter === 'synced'
  const allMembersLabel = synchronizedView ? '全部同步在职成员' : '全部成员'
  const countsUnavailable = synchronizedView && directoryRoster?.status !== 'ready'
  const statusUsers = useMemo(() => {
    if (!synchronizedView) {
      return users.filter(user => employmentFilter === 'all' || memberEmployment(user) === employmentFilter)
    }
    if (directoryRoster?.status !== 'ready') return []
    const usersById = new Map(users.map(user => [user.id, user]))
    return directoryRoster.members.flatMap(member => {
      const user = usersById.get(member.id)
      return user ? [{ ...user, department_ids: member.departmentIds }] : []
    })
  }, [directoryRoster, users, employmentFilter, synchronizedView])

  const departmentMemberCounts = useMemo(() => {
    if (countsUnavailable) return null
    const parents = new Map(departmentTree.map(department => [department.department_id, department.parent_department_id]))
    const counts = new Map<string, number>()
    for (const user of statusUsers) {
      const seen = new Set<string>()
      for (const departmentId of memberDepartmentIds(user)) {
        let id: string | null = departmentId
        while (id && parents.has(id) && !seen.has(id)) {
          seen.add(id)
          counts.set(id, (counts.get(id) ?? 0) + 1)
          id = parents.get(id) ?? null
        }
      }
    }
    return counts
  }, [countsUnavailable, departmentTree, statusUsers])

  // 根据选中部门过滤成员
  const filteredUsers = useMemo(() => {
    if (!selectedDeptId) return statusUsers
    const allowedDeptIds = resolveDepartmentSpaceIds(departmentTree, orgDepartmentIds, {
      departmentId: selectedDeptId, includeSubdepartments,
    })
    return statusUsers.filter(user => [...memberDepartmentIds(user)].some(id => allowedDeptIds.has(id)))
  }, [statusUsers, departmentTree, orgDepartmentIds, selectedDeptId, includeSubdepartments])

  const directMembersOutsideFilter = useMemo(() => {
    if (!selectedDeptId || !orgDepartmentIds.includes(selectedDeptId)) return 0
    const visibleIds = new Set(filteredUsers.map(user => user.id))
    return new Set(users
      .filter(user => !visibleIds.has(user.id) && memberDepartmentIds(user).has(selectedDeptId))
      .map(user => user.id)).size
  }, [filteredUsers, orgDepartmentIds, selectedDeptId, users])

  // 统计信息
  const stats = useMemo(() => ({
    deptCount: (orgSummary?.departments ?? []).length,
    userCount: statusUsers.length,
    filteredCount: filteredUsers.length,
  }), [orgSummary, statusUsers.length, filteredUsers.length])

  const selectedDept = useMemo(() => {
    const departments = orgSummary?.departments ?? []
    return departments.find(d => d.id === selectedDeptId) ?? null
  }, [orgSummary, selectedDeptId])

  // 编辑用户状态
  const [editingUser, setEditingUser] = useState<OrgSummaryUser | null>(null)
  const [assignmentDraft, setAssignmentDraft] = useState<{
    user: OrgSummaryUser; actorId: string; orgId?: string; roleIds: string[]; systemAdmin?: boolean
  } | null>(null)
  const [employeePermissions, setEmployeePermissions] = useState<{ orgId: string; user: OrgSummaryUser } | null>(null)
  const [bindingUser, setBindingUser] = useState<OrgSummaryUser | null>(null)

  const actions = orgSummary?.member_actions ?? unavailableMemberActions
  const canEditDepartments = departmentAccess?.canEdit ?? actions.manageDepartments
  const canDeleteDepartments = departmentAccess?.canDelete ?? actions.manageDepartments
  const isEmptyState = departments.length === 0 && users.length === 0
  const orgId = orgSummary?.organization?.id
  const eligibleSystemAdminIds = orgSummary?.role_membership_stats?.systemSuperAdminAssignableMemberIds
  const systemAdminOrgIdForUser = useCallback((user: OrgSummaryUser) => {
    if (!orgId || !currentUserId || !actions.assignRoles || user.id === currentUserId) return undefined
    if (userHasSystemAdminAssignment(user, orgId)) return orgId
    if (user.membership_status !== 'active' || user.employment_status !== 'active') return undefined
    return user.login_enabled === true && isEmployeePermissionTarget(user) && eligibleSystemAdminIds?.includes(user.id) ? orgId : undefined
  }, [orgId, currentUserId, actions.assignRoles, eligibleSystemAdminIds])
  const assignment = actions.assignRoles && assignmentDraft?.orgId === orgId && assignmentDraft?.actorId === currentUserId
    ? assignmentDraft : null
  const latestAssignmentUser = assignment ? users.find(user => user.id === assignment.user.id) : undefined
  const departmentAssignmentRestricted = assignment?.systemAdmin === true
    || Boolean(orgId && latestAssignmentUser && userHasSystemAdminAssignment(latestAssignmentUser, orgId))

  useEffect(() => {
    if (!canReadDepartments) setSelectedDeptId(null)
  }, [canReadDepartments])

  useEffect(() => {
    setAssignmentDraft(draft => draft && (draft.orgId !== orgId || draft.actorId !== currentUserId || !actions.assignRoles)
      ? null : draft)
  }, [orgId, currentUserId, actions.assignRoles])

  if (orgSummary?.member_access === false) {
    return (
      <div className="space-y-4">
        <StatCard icon={<BuildingIcon size={18} />} label="部门" value={stats.deptCount} />
        <div className="rounded-lg border bg-white p-4">
          <h3 className="mb-3 font-medium text-slate-900">部门结构</h3>
          <DepartmentTree
            departments={departments}
            users={[]}
            memberCounts={null}
            memberAccess={false}
            canEdit={canEditDepartments}
            canDelete={canDeleteDepartments}
            showRootAdd
            selectedDeptId={selectedDeptId}
            onSelectDept={setSelectedDeptId}
            onRefresh={onRefresh}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 顶部统计和操作 */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {canReadDepartments && <StatCard icon={<BuildingIcon size={18} />} label="部门" value={stats.deptCount} />}
          <StatCard icon={<UsersIcon size={18} />} label={`${MEMBER_FILTER_LABELS[employmentFilter]}成员`} value={countsUnavailable ? '—' : stats.userCount} />
        </div>
        <div className="text-sm text-slate-500">
          当前筛选：{selectedDept?.name || allMembersLabel}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-white px-4 py-3">
        <label htmlFor="member-employment-filter" className="text-sm font-medium text-slate-700">成员状态</label>
        <select id="member-employment-filter" value={employmentFilter} onChange={event => setEmploymentFilter(event.target.value as MemberFilter)}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
          {Object.entries(MEMBER_FILTER_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        {synchronizedView && directoryRoster?.status === 'ready' && (
          <span className="text-xs text-slate-500">
            最近生效同步 {new Intl.DateTimeFormat('zh-CN', {
              timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
            }).format(new Date(directoryRoster.asOf))}
          </span>
        )}
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
      <div className={`grid grid-cols-1 gap-4 ${canReadDepartments
        ? 'xl:grid-cols-[280px_minmax(0,1fr)_300px]' : 'xl:grid-cols-[minmax(0,1fr)_300px]'}`}>
        {/* 左侧部门树 */}
        {canReadDepartments && <div className="min-w-0">
          <div className="rounded-lg border bg-white">
            <div className="border-b px-4 py-3">
              <h3 className="font-medium text-slate-900">部门结构</h3>
              <p className="text-xs text-slate-500 mt-1">部门人数含下级，同一成员只计一次</p>
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
                <span className="flex-1 text-sm font-medium">{allMembersLabel}</span>
                <Badge variant={selectedDeptId === null ? 'default' : 'outline'} className="text-xs">
                  {countsUnavailable ? '—' : stats.userCount}
                </Badge>
              </button>

              <div className="border-t my-2" />

              <DepartmentTree
                departments={departments}
                users={users}
                memberCounts={departmentMemberCounts}
                memberAccess
                canEdit={canEditDepartments}
                canDelete={canDeleteDepartments}
                selectedDeptId={selectedDeptId}
                onSelectDept={setSelectedDeptId}
                onMemberBindingsBlocked={showDirectDepartmentMembers}
                onRefresh={onRefresh}
              />
            </div>
          </div>
        </div>}

        {/* 中间成员列表 */}
        <div className="min-w-0 space-y-4">
          <div className="rounded-lg border bg-white">
            <div className="border-b px-6 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-slate-900">
                    {selectedDept ? `${selectedDept.name} 的成员` : allMembersLabel}
                  </h3>
                  <p className="text-xs text-slate-500 mt-1">
                    {countsUnavailable ? '同步在职人数待核对' : selectedDept
                      ? `共 ${stats.filteredCount} 人（${includeSubdepartments ? '含子部门' : '仅本部门'}）`
                      : `共 ${stats.userCount} 人`
                    }
                  </p>
                </div>
                {selectedDept && (
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <label className="text-xs text-slate-600">
                      <span className="sr-only">部门成员范围</span>
                      <select
                        value={includeSubdepartments ? 'subtree' : 'direct'}
                        onChange={event => setIncludeSubdepartments(event.target.value === 'subtree')}
                        className="rounded-md border border-slate-300 bg-white px-2 py-1.5"
                      >
                        <option value="direct">仅本部门</option>
                        <option value="subtree">含下级部门</option>
                      </select>
                    </label>
                    <Button variant="ghost" size="sm" onClick={() => setSelectedDeptId(null)}>
                      取消部门筛选
                    </Button>
                  </div>
                )}
              </div>
              {selectedDept && directMembersOutsideFilter > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => showDirectDepartmentMembers(selectedDept.id)}>
                    查看本部门关联成员
                  </Button>
                  <p className="text-xs text-slate-600">
                    {countsUnavailable ? `已读取本部门 ${directMembersOutsideFilter} 名直接关联成员`
                      : `当前筛选未显示本部门 ${directMembersOutsideFilter} 名直接关联成员`}
                  </p>
                </div>
              )}
            </div>
            <div className="p-6">
              {countsUnavailable ? (
                <p role="status" className="text-sm text-slate-600">暂时无法核对同步名单。可以切换到「全部」查看成员记录。</p>
              ) : <MemberTable
                key={memberTableVersion}
                users={filteredUsers}
                canReadDepartments={canReadDepartments}
                currentUserId={currentUserId}
                actions={actions}
                batchOrgId={orgId}
                batchScope={JSON.stringify([orgId, currentUserId, selectedDeptId, includeSubdepartments, employmentFilter,
                  actions.manageLogin, actions.manageEmployment, actions.assignRoles])}
                batchRoles={(orgSummary?.roles ?? []).filter(role => isGenericallyAssignableRole(role.code) && !isRetiredRoleCode(role.code))}
                onEditUser={setEditingUser}
                systemAdminOrgIdForUser={systemAdminOrgIdForUser}
                onAssignRole={(user) => {
                  if (!actions.assignRoles || !currentUserId) return
                  const systemAdminOrgId = systemAdminOrgIdForUser(user)
                  const restriction = getMemberRoleMutationRestriction(user, currentUserId, systemAdminOrgId)
                  if (restriction) {
                    error(restriction.reason)
                    return
                  }
                  setAssignmentDraft({
                    user, actorId: currentUserId, orgId,
                    roleIds: systemAdminOrgId ? editableCurrentOrgBusinessRoleIds(user, systemAdminOrgId) : editableOrgRoleIds(user),
                    systemAdmin: systemAdminOrgId ? userHasSystemAdminAssignment(user, systemAdminOrgId) : undefined,
                  })
                }}
                onBindIdentity={setBindingUser}
                onOpenEmployeePermissions={currentUserId && orgId && actions.assignRoles
                  ? user => setEmployeePermissions({ orgId, user }) : undefined}
                onRefresh={onRefresh}
              />}
            </div>
          </div>
          {currentUserId && orgId && selectedDept && orgDepartmentIds.includes(selectedDept.id) && (
            <DepartmentPermissions
              key={JSON.stringify([orgId, currentUserId, selectedDept.id])}
              orgId={orgId}
              departmentId={selectedDept.id}
              authHeaders={buildAuthHeaders}
            />
          )}
        </div>

        <div className="min-w-0 space-y-4">
          {currentUserId && selectedDept && (
            <div className="rounded-lg border bg-white p-4">
              <h3 className="font-medium text-slate-900">部门管理</h3>
              <p className="mt-2 text-sm text-slate-700">{selectedDept.name}</p>
              <DepartmentLeaderAccess
                key={JSON.stringify([orgSummary?.organization?.id, currentUserId, selectedDept.id, selectedDept.leader_id])}
                department={selectedDept}
              />
            </div>
          )}
          {canReadDepartments && currentUserId && orgSummary?.organization?.id && (
            <ShippingDepartmentAuthorization
              key={JSON.stringify([orgSummary.organization.id, currentUserId])}
              orgId={orgSummary.organization.id}
              departments={shippingDepartments}
              authHeaders={buildAuthHeaders}
            />
          )}
          <div className="rounded-lg border bg-white p-4">
            <h3 className="font-medium text-slate-900">员工登录</h3>
            <p className="mt-2 text-xs leading-5 text-slate-600">在职员工使用自己的纷享销客账号登录 ICU；尚未登录纷享时，登录流程会引导完成认证。无需逐人发邀请码。已离职人员不可登录。</p>
            <a href="/login" target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex text-sm font-medium text-blue-700 underline">打开员工登录页</a>
            <p className="mt-2 text-xs leading-5 text-slate-500">可把本网站登录页链接发给员工；此入口使用打开它的人的身份，不会代替表格中的员工登录。</p>
          </div>
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
          {(canEditDepartments || actions.invite) && <div className="rounded-lg border bg-white p-4">
            <h3 className="font-medium text-slate-900">组织操作</h3>
            <div className="mt-4 grid gap-2">
          {canEditDepartments && <DepartmentFormDialog
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
          />}
          {actions.invite && <UserFormDialog
            departments={departments}
            canSelectDepartment={canEditDepartments}
            roles={actions.assignRoles ? orgSummary?.roles ?? [] : []}
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
              if (result.success !== true || typeof result.data?.id !== 'string') {
                const message = '未能确认成员邀请，请刷新成员名单核对。'
                error(message)
                throw new Error(message)
              }
              const activationCode = result.data?.activationCode
              // A manual invitation is outside the synced roster until the directory matches it.
              setEmploymentFilter('all')
              setSelectedDeptId(null)
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
          />}
            </div>
          </div>}

          <div className="rounded-lg border bg-white p-4">
            <h3 className="font-medium text-slate-900">当前上下文</h3>
            <div className="mt-4 space-y-3 text-sm">
              {canReadDepartments && <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-slate-500">部门</span>
                <span className="font-medium text-slate-900">{selectedDept?.name || allMembersLabel}</span>
              </div>}
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-slate-500">筛选成员</span>
                <span className="font-semibold text-slate-900">{countsUnavailable ? '—' : stats.filteredCount}</span>
              </div>
              <div className="rounded-lg border border-slate-200 p-3 text-xs leading-5 text-slate-500">
                外部目录同步先检查读取范围并生成差异；冲突、范围不明或快照不完整时整批阻断。
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 编辑用户 Dialog */}
      {editingUser && actions.edit && (
        <UserFormDialog
          departments={departments}
          canSelectDepartment={canReadDepartments}
          editingUser={editingUser}
          employeePermissionOrgId={currentUserId && actions.assignRoles && isEmployeePermissionTarget(editingUser) ? orgId : undefined}
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
        open={actions.bindExternalIdentity && Boolean(bindingUser)}
        onOpenChange={(open) => !open && setBindingUser(null)}
        onBound={onRefresh}
      />

      {currentUserId && orgId && actions.assignRoles && employeePermissions?.orgId === orgId && (
        <EmployeePermissionOverrides
          key={JSON.stringify([orgId, currentUserId, employeePermissions.user.id])}
          orgId={orgId}
          userId={employeePermissions.user.id}
          userName={employeePermissions.user.display_name}
          onClose={() => setEmployeePermissions(null)}
        />
      )}

      {/* 分配角色 Dialog */}
      {assignment && (
        <RoleAssignmentDialog
          key={JSON.stringify([assignment.actorId, assignment.orgId, assignment.user.id])}
          userId={assignment.user.id}
          userName={assignment.user.display_name}
          currentRoles={assignment.roleIds}
          pendingRoles={assignment.user.pending_org_roles}
          currentSystemAdmin={assignment.systemAdmin}
          organizationOnly={assignment.user.membership_status === 'invited'}
          departmentAssignmentRestricted={departmentAssignmentRestricted}
          employeePermissionOrgId={isEmployeePermissionTarget(assignment.user) ? orgId : undefined}
          departments={departments}
          scopedRoles={latestAssignmentUser?.scoped_roles}
          open={true}
          onOpenChange={(open) => !open && setAssignmentDraft(null)}
          onSubmit={async (roleIds, systemAdmin) => {
            const systemAdminFields = assignment.systemAdmin === undefined ? {} : {
              expected_org_id: assignment.orgId,
              system_admin: systemAdmin ?? assignment.systemAdmin,
              expected_system_admin: assignment.systemAdmin,
            }
            const res = await fetch(`/api/admin/users/${assignment.user.id}/roles`, {
              method: 'POST',
              headers: buildAuthHeaders(true),
              body: JSON.stringify({
                role_ids: roleIds, expected_role_ids: assignment.roleIds, scope_type: 'org', ...systemAdminFields,
              }),
            })
            const result = await res.json().catch(() => null)
            if (!res.ok || !result) {
              const message = result?.error || '无法确认角色保存结果，请刷新后重试。'
              if (result?.code === 'ROLE_ASSIGNMENT_CHANGED') {
                error(message)
                setAssignmentDraft(null)
                await onRefresh?.()
                return
              }
              throw new Error(message)
            }
            success(result.pending_role_ids?.length ? '组织角色已预分配，首次登录后生效' : '角色已保存')
            await onRefresh?.()
          }}
          onSubmitScoped={departmentAssignmentRestricted ? undefined : async (roleId, departmentId) => {
            const res = await fetch(`/api/admin/users/${assignment.user.id}/role-scopes`, {
              method: 'POST',
              headers: buildAuthHeaders(true),
              body: JSON.stringify({
                role_id: roleId,
                scope_type: 'department',
                scope_id: departmentId,
                reason: 'department role assignment',
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
          onRevokeScoped={departmentAssignmentRestricted ? undefined : async (roleId, scopeType, scopeId) => {
            const res = await fetch(`/api/admin/users/${assignment.user.id}/role-scopes`, {
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

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
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

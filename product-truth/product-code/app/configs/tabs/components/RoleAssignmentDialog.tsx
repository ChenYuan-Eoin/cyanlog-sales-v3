'use client'

import { useState, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { BuildingIcon, ShieldIcon, XIcon } from 'lucide-react'
import type { OrgSummaryDepartment, OrgSummaryRole, ScopedRoleAssignment } from '../../types'
import { isRoleAssignableInScope } from '@/lib/role-permission-resolution'
import { isGenericallyAssignableRole } from '../role-assignment-policy'

interface RoleAssignmentDialogProps {
  userId: string
  userName: string
  pendingRoles?: { id: string }[]
  organizationOnly?: boolean
  currentRoles: string[]
  departments: OrgSummaryDepartment[]
  scopedRoles?: ScopedRoleAssignment[]
  onSubmit: (roleIds: string[]) => Promise<void>
  onSubmitScoped?: (roleId: string, departmentId: string) => Promise<void>
  onRevokeScoped?: (roleId: string, scopeType: 'department' | 'space', scopeId: string) => Promise<void>
  trigger?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function RoleAssignmentDialog({
  userId: _userId,
  userName,
  currentRoles,
  pendingRoles,
  organizationOnly = false,
  departments,
  scopedRoles = [],
  onSubmit,
  onSubmitScoped,
  onRevokeScoped,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: RoleAssignmentDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen
  const onOpenChange = controlledOnOpenChange ?? setInternalOpen
  const [loading, setLoading] = useState(false)
  const [roles, setRoles] = useState<OrgSummaryRole[]>([])
  const [selectedOrgRoles, setSelectedOrgRoles] = useState<string[]>(currentRoles)
  const [selectedScopedRoleId, setSelectedScopedRoleId] = useState('')
  const [fetchingRoles, setFetchingRoles] = useState(false)
  const [rolesError, setRolesError] = useState(false)
  const [scopeType, setScopeType] = useState<'org' | 'department'>('org')
  const [scopeId, setScopeId] = useState('')
  const [revokingKey, setRevokingKey] = useState<string | null>(null)
  const assignableRoles = roles.filter(role => isRoleAssignableInScope(role.code, scopeType))
  const selectedScopedRole = assignableRoles.find(role => role.id === selectedScopedRoleId)
  const assignableDepartments = departments.filter(department => department.status === 'active')
  const selectedDepartment = assignableDepartments.find(department => department.id === scopeId)

  // 获取角色列表
  useEffect(() => {
    if (!open) return

    const controller = new AbortController()
    const fetchRoles = async () => {
      setFetchingRoles(true)
      setRoles([])
      setRolesError(false)
      try {
        const token = localStorage.getItem('token')
        const res = await fetch('/api/roles?view=assignable', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!res.ok) throw new Error('无法读取可分配角色')
        const result = await res.json()
        if (!result.success || !Array.isArray(result.data?.roles)) throw new Error('无效的角色列表')
        if (!controller.signal.aborted) {
          setRoles(result.data.roles.filter((role: OrgSummaryRole) => isGenericallyAssignableRole(role.code)))
        }
      } catch {
        if (!controller.signal.aborted) setRolesError(true)
      } finally {
        if (!controller.signal.aborted) setFetchingRoles(false)
      }
    }

    void fetchRoles()
    return () => controller.abort()
  }, [open])

  // 同步 currentRoles 变化
  useEffect(() => {
    setSelectedOrgRoles(currentRoles)
  }, [currentRoles])

  const handleToggleRole = useCallback((roleId: string) => {
    if (scopeType !== 'org') {
      setSelectedScopedRoleId(previous => previous === roleId ? '' : roleId)
      return
    }
    setSelectedOrgRoles(previous => (
      previous.includes(roleId) ? previous.filter(id => id !== roleId) : [...previous, roleId]
    ))
  }, [scopeType])

  const handleSubmit = useCallback(async () => {
    setLoading(true)
    try {
      if (scopeType === 'org') {
        await onSubmit(selectedOrgRoles)
      } else {
        if (!onSubmitScoped || !selectedDepartment || !selectedScopedRole) return
        await onSubmitScoped(selectedScopedRole.id, selectedDepartment.id)
      }
      onOpenChange(false)
    } finally {
      setLoading(false)
    }
  }, [scopeType, onSubmit, selectedOrgRoles, onSubmitScoped, selectedScopedRole, selectedDepartment, onOpenChange])

  const nonOrgScopedRoles = scopedRoles.filter(
    assignment => (assignment.scopeType === 'department' || assignment.scopeType === 'space')
      && isGenericallyAssignableRole(assignment.roleCode),
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="sm">
            <ShieldIcon className="h-4 w-4 mr-1" />
            分配角色
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldIcon className="h-5 w-5" />
            为 &quot;{userName}&quot; 分配角色
          </DialogTitle>
        </DialogHeader>

        {fetchingRoles ? (
          <div className="py-8 text-center text-slate-500">加载角色列表...</div>
        ) : rolesError ? (
          <p className="py-8 text-center text-slate-600" role="alert">无法读取可分配角色，请关闭后重试。</p>
        ) : assignableRoles.length === 0 ? (
          <div className="py-8 text-center text-slate-500">当前作用域没有可分配的角色</div>
        ) : (
          <div className="space-y-4 max-h-[400px] overflow-y-auto">
            {assignableRoles.map((role) => (
              <div
                key={role.id}
                className="flex items-start gap-3 p-3 rounded-lg border hover:bg-slate-50 transition"
              >
                <Checkbox
                  id={`role-${role.id}`}
                  checked={scopeType === 'org' ? selectedOrgRoles.includes(role.id) : selectedScopedRoleId === role.id}
                  onCheckedChange={() => handleToggleRole(role.id)}
                />
                <div className="flex-1">
                  <label
                    htmlFor={`role-${role.id}`}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <span className="font-medium">{role.name}</span>
                    {pendingRoles?.some(pending => pending.id === role.id) && <Badge variant="outline">待首次登录生效</Badge>}
                    {!isRoleAssignableInScope(role.code, 'department') && <Badge variant="outline">仅整个组织</Badge>}
                    <Badge variant="outline" className="text-xs">
                      {role.code}
                    </Badge>
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}

        {nonOrgScopedRoles.length > 0 && (
          <div className="border-t pt-4">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <BuildingIcon className="h-4 w-4" />
              <span>现有范围授权</span>
            </div>
            <div className="mt-2 space-y-2">
              {nonOrgScopedRoles.map((assignment) => {
                const scopeType = assignment.scopeType === 'space' ? 'space' : 'department'
                const key = `${assignment.roleId}:${scopeType}:${assignment.scopeId}`
                return (
                  <div
                    key={key}
                    className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm"
                  >
                    <Badge variant="secondary" className="shrink-0 text-xs">
                      {assignment.roleName}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate text-slate-600">
                      {scopeType === 'department' ? '部门' : '历史范围'} · {assignment.scopeName}
                    </span>
                    {(scopeType === 'space' || !isRoleAssignableInScope(assignment.roleCode, scopeType)) && <Badge variant="outline">历史绑定 · 仅可撤销</Badge>}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 shrink-0 p-0"
                      aria-label={`撤销 ${assignment.roleName}（${assignment.scopeName}）`}
                      title="撤销范围授权"
                      disabled={!onRevokeScoped || !assignment.scopeId || revokingKey === key}
                      onClick={async () => {
                        if (!onRevokeScoped || !assignment.scopeId) return
                        setRevokingKey(key)
                        try {
                          await onRevokeScoped(assignment.roleId, scopeType, assignment.scopeId)
                        } finally {
                          setRevokingKey(null)
                        }
                      }}
                    >
                      <XIcon className="h-4 w-4" />
                    </Button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {roles.length > 0 && (
          <>
            <div className="border-t pt-4">
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <BuildingIcon className="h-4 w-4" />
                <span>授权作用域</span>
              </div>
              <select
                aria-label="角色作用域类型"
                disabled={organizationOnly}
                className="mt-2 h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                value={scopeType}
                onChange={(event) => {
                  setScopeType(event.target.value === 'department' ? 'department' : 'org')
                  setScopeId('')
                  setSelectedScopedRoleId('')
                }}
              >
                <option value="org">整个组织</option>
                <option value="department">指定部门</option>
              </select>
              {organizationOnly && <p className="mt-2 text-xs text-slate-500">预分配的组织角色将在首次登录后生效。</p>}
              {scopeType === 'department' && (
                <select
                  aria-label="选择部门角色作用域"
                  className="mt-2 h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                  value={selectedDepartment?.id ?? ''}
                  onChange={(event) => setScopeId(event.target.value)}
                >
                  <option value="">请选择部门</option>
                  {assignableDepartments.map((department) => (
                    <option key={department.id} value={department.id}>{department.name}</option>
                  ))}
                </select>
              )}
              {scopeType !== 'org' && <p className="mt-2 text-xs text-slate-500">每次为一个部门分配一个角色。</p>}
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={loading}
              >
                取消
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={loading || fetchingRoles || (scopeType !== 'org' && (!onSubmitScoped || !selectedDepartment || !selectedScopedRole))}
              >
                {loading ? '保存中...' : '保存'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

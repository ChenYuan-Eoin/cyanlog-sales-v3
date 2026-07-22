'use client'

import { useState, useCallback, useEffect, isValidElement } from 'react'
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
import { BuildingIcon, ShieldIcon } from 'lucide-react'
import type { OrgSummaryDepartment } from '../../types'

interface Role {
  id: string
  code: string
  name: string
  description?: string
}

interface RoleAssignmentDialogProps {
  userId: string
  userName: string
  currentRoles: string[]
  departments: OrgSummaryDepartment[]
  onSubmit: (roleIds: string[]) => Promise<void>
  trigger?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function RoleAssignmentDialog({
  userId: _userId,
  userName,
  currentRoles,
  departments: _departments,
  onSubmit,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: RoleAssignmentDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen
  const onOpenChange = controlledOnOpenChange ?? setInternalOpen
  const [loading, setLoading] = useState(false)
  const [roles, setRoles] = useState<Role[]>([])
  const [selectedRoles, setSelectedRoles] = useState<string[]>(currentRoles)
  const [fetchingRoles, setFetchingRoles] = useState(false)

  // 获取角色列表
  useEffect(() => {
    if (!open) return

    const fetchRoles = async () => {
      setFetchingRoles(true)
      try {
        const res = await fetch('/api/roles')
        if (res.ok) {
          const result = await res.json()
          if (result.success && result.data?.roles) {
            setRoles(result.data.roles)
          }
        }
      } catch (err) {
        console.error('Fetch roles error:', err)
      } finally {
        setFetchingRoles(false)
      }
    }

    fetchRoles()
  }, [open])

  // 同步 currentRoles 变化
  useEffect(() => {
    setSelectedRoles(currentRoles)
  }, [currentRoles])

  const handleToggleRole = useCallback((roleId: string) => {
    setSelectedRoles((prev) =>
      prev.includes(roleId)
        ? prev.filter((id) => id !== roleId)
        : [...prev, roleId]
    )
  }, [])

  const handleSubmit = useCallback(async () => {
    setLoading(true)
    try {
      await onSubmit(selectedRoles)
      onOpenChange(false)
    } finally {
      setLoading(false)
    }
  }, [onSubmit, selectedRoles, onOpenChange])

  const defaultTrigger = (
    <Button variant="ghost" size="sm">
      <ShieldIcon className="h-4 w-4 mr-1" />
      分配角色
    </Button>
  )
  const resolvedTrigger = trigger === undefined ? defaultTrigger : trigger

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {isValidElement(resolvedTrigger) ? (
        <DialogTrigger render={resolvedTrigger} />
      ) : null}
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldIcon className="h-5 w-5" />
            为 &quot;{userName}&quot; 分配角色
          </DialogTitle>
        </DialogHeader>

        {fetchingRoles ? (
          <div className="py-8 text-center text-slate-500">加载角色列表...</div>
        ) : roles.length === 0 ? (
          <div className="py-8 text-center text-slate-500">暂无可用角色</div>
        ) : (
          <div className="space-y-4 max-h-[400px] overflow-y-auto">
            {roles.map((role) => (
              <div
                key={role.id}
                className="flex items-start gap-3 p-3 rounded-lg border hover:bg-slate-50 transition"
              >
                <Checkbox
                  id={`role-${role.id}`}
                  checked={selectedRoles.includes(role.id)}
                  onCheckedChange={() => handleToggleRole(role.id)}
                />
                <div className="flex-1">
                  <label
                    htmlFor={`role-${role.id}`}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <span className="font-medium">{role.name}</span>
                    <Badge variant="outline" className="text-xs">
                      {role.code}
                    </Badge>
                  </label>
                  {role.description && (
                    <p className="text-sm text-slate-500 mt-1">
                      {role.description}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {roles.length > 0 && (
          <>
            <div className="border-t pt-4">
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <BuildingIcon className="h-4 w-4" />
                <span>作用域：组织级别</span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                角色将在整个组织范围内生效。如需按部门分配，请使用部门管理功能。
              </p>
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
                disabled={loading || fetchingRoles}
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

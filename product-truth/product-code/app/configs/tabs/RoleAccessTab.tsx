'use client'

import { useState, useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { SearchIcon, UsersIcon, ShieldIcon, ChevronRightIcon } from 'lucide-react'
import { RoleDetailPanel } from './RoleDetailPanel'
import type { OrgSummaryPayload } from '../types'

interface RoleAccessTabProps {
  roles: Array<{
    id: string
    code: string
    name: string
    description: string | null
    permissions: string[] | null
    sort_order: number | null
  }>
  savingRoleId: string | null
  orgSummary: OrgSummaryPayload | null
  onSaveRole: (roleId: string, newPerms: string[]) => void
}

interface RoleWithStats {
  id: string
  code: string
  name: string
  description: string | null
  permissions: string[] | null
  sort_order: number | null
  memberCount: number
  isSuperAdmin: boolean
}

export default function RoleAccessTab({
  roles,
  savingRoleId,
  orgSummary,
  onSaveRole,
}: RoleAccessTabProps) {
  const users = orgSummary?.users ?? []
  const departments = orgSummary?.departments ?? []
  const spaces = orgSummary?.spaces ?? []

  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null)
  const [roleSearchQuery, setRoleSearchQuery] = useState('')

  const rolesWithStats: RoleWithStats[] = useMemo(() => {
    return roles.map(role => {
      const memberCount = users.filter(u => {
        // Try role_ids first (UUID matching)
        if (u.role_ids?.includes(role.id)) return true
        // Then try role_codes (code matching)
        if (u.role_codes?.includes(role.code)) return true
        // Fallback to role_names (name matching for comma-separated string)
        if (u.role_names?.includes(role.name)) return true
        return false
      }).length
      return {
        ...role,
        memberCount,
        isSuperAdmin: role.code === 'SUPER_ADMIN',
      }
    }).sort((a, b) => {
      // SUPER_ADMIN 始终排第一，其他按 sort_order
      if (a.isSuperAdmin) return -1
      if (b.isSuperAdmin) return 1
      return (a.sort_order ?? 999) - (b.sort_order ?? 999)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roles, users])

  // 过滤角色列表
  const filteredRoles = useMemo(() => {
    if (!roleSearchQuery.trim()) return rolesWithStats
    const query = roleSearchQuery.toLowerCase()
    return rolesWithStats.filter(
      r =>
        r.name.toLowerCase().includes(query) ||
        r.code.toLowerCase().includes(query) ||
        r.description?.toLowerCase().includes(query)
    )
  }, [rolesWithStats, roleSearchQuery])

  // 选中的角色
  const selectedRole = useMemo(
    () => roles.find(r => r.id === selectedRoleId) || roles[0] || null,
    [roles, selectedRoleId]
  )

  // 如果没有选中角色，默认选中第一个
  if (selectedRole && !selectedRoleId) {
    setSelectedRoleId(selectedRole.id)
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      {/* 左侧角色列表 */}
      <div className="w-full lg:w-[280px] shrink-0">
        <div className="rounded-lg border bg-white">
          <div className="border-b px-4 py-3">
            <h3 className="font-medium text-slate-900">角色列表</h3>
            <p className="text-xs text-slate-500 mt-1">选择角色查看详情</p>
          </div>

          {/* 搜索框 */}
          <div className="p-3 border-b">
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="搜索角色..."
                value={roleSearchQuery}
                onChange={(e) => setRoleSearchQuery(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
          </div>

          {/* 角色列表 */}
          <div className="p-2 max-h-[600px] overflow-y-auto space-y-1">
            {filteredRoles.map(role => (
              <button
                key={role.id}
                onClick={() => setSelectedRoleId(role.id)}
                className={`w-full flex items-center gap-3 rounded-lg px-3 py-3 text-left transition ${
                  selectedRoleId === role.id
                    ? 'bg-blue-50 border border-blue-200'
                    : 'hover:bg-slate-50 border border-transparent'
                }`}
              >
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                    role.isSuperAdmin ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {role.isSuperAdmin ? <ShieldIcon size={20} /> : <UsersIcon size={20} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900 truncate">{role.name}</span>
                    {role.isSuperAdmin && (
                      <Badge variant="outline" className="text-xs shrink-0 text-amber-600 border-amber-200">
                        超级管理员
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">{role.code}</div>
                </div>
                <div className="flex items-center gap-1 text-slate-400">
                  <span className="text-sm">{role.memberCount}</span>
                  <ChevronRightIcon size={16} />
                </div>
              </button>
            ))}
            {filteredRoles.length === 0 && (
              <div className="text-center py-8 text-sm text-slate-500">
                未找到匹配的角色
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 右侧角色详情 */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {selectedRole ? (
          <RoleDetailPanel
            role={selectedRole}
            saving={savingRoleId === selectedRole.id}
            onSave={(perms) => onSaveRole(selectedRole.id, perms)}
            users={users}
            departments={departments}
            _spaces={spaces}
          />
        ) : (
          <div className="rounded-lg border bg-white p-12 text-center">
            <UsersIcon className="mx-auto h-12 w-12 text-slate-300" />
            <h3 className="mt-4 text-lg font-medium text-slate-900">选择角色</h3>
            <p className="mt-2 text-slate-500">从左侧列表选择一个角色查看详情</p>
          </div>
        )}
      </div>
    </div>
  )
}

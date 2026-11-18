'use client'

import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { SearchIcon, UsersIcon, ShieldIcon, ChevronRightIcon } from 'lucide-react'
import { userHasPendingOrgRole } from './role-assignment-policy'
import { RoleDetailPanel } from './RoleDetailPanel'
import { PermissionRegistryPanel } from './PermissionRegistryPanel'
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
  currentUserId: string | null
  savingRoleId: string | null
  permissionsEditable?: boolean
  permissionsEditBlockReason?: string | null
  orgSummary: OrgSummaryPayload | null
  onSaveRole: (roleId: string, newPerms: string[]) => void
  onRefresh: () => void | Promise<void>
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
  currentUserId,
  savingRoleId,
  permissionsEditable = false,
  permissionsEditBlockReason,
  orgSummary,
  onSaveRole,
  onRefresh,
}: RoleAccessTabProps) {
  const users = orgSummary?.users ?? []
  const departments = orgSummary?.departments ?? []
  const spaces = orgSummary?.spaces ?? []

  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null)
  const [roleSearchQuery, setRoleSearchQuery] = useState('')

  const rolesWithStats: RoleWithStats[] = useMemo(() => {
    const users = orgSummary?.users ?? []
    return roles.map(role => {
      const memberCount = users.filter(u => {
        if (userHasPendingOrgRole(u, role.id)) return true
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
    () => rolesWithStats.find(r => r.id === selectedRoleId) || rolesWithStats[0] || null,
    [rolesWithStats, selectedRoleId]
  )

  useEffect(() => {
    if (!selectedRoleId && selectedRole) {
      setSelectedRoleId(selectedRole.id)
      return
    }

    if (selectedRoleId && !rolesWithStats.some((role) => role.id === selectedRoleId)) {
      setSelectedRoleId(rolesWithStats[0]?.id ?? null)
    }
  }, [rolesWithStats, selectedRole, selectedRoleId])

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)_300px]">
      <div className="col-span-full">
        <PermissionRegistryPanel />
      </div>

      {/* 左侧角色列表 */}
      <div className="min-w-0">
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

      {/* 中间角色详情 */}
      <div className="min-w-0 overflow-hidden">
        {selectedRole ? (
          <RoleDetailPanel
            role={selectedRole}
            permissionsEditable={permissionsEditable}
            permissionsEditBlockReason={permissionsEditBlockReason}
            currentUserId={currentUserId}
            saving={savingRoleId === selectedRole.id}
            onSave={(perms) => onSaveRole(selectedRole.id, perms)}
            users={users}
            departments={departments}
            _spaces={spaces}
            onRefresh={onRefresh}
          />
        ) : (
          <div className="rounded-lg border bg-white p-12 text-center">
            <UsersIcon className="mx-auto h-12 w-12 text-slate-300" />
            <h3 className="mt-4 text-lg font-medium text-slate-900">选择角色</h3>
            <p className="mt-2 text-slate-500">从左侧列表选择一个角色查看详情</p>
          </div>
        )}
      </div>

      <div className="min-w-0 space-y-4">
        <div className="rounded-lg border bg-white p-4">
          <h3 className="font-medium text-slate-900">权限摘要</h3>
          {selectedRole ? (
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-slate-500">角色编码</span>
                <span className="font-mono text-xs text-slate-700">{selectedRole.code}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-slate-500">直接成员</span>
                <span className="font-semibold text-slate-900">{selectedRole.memberCount}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <span className="text-slate-500">权限点</span>
                <span className="font-semibold text-slate-900">
                  {selectedRole.permissions?.includes('*') ? '全部' : (selectedRole.permissions?.length ?? 0)}
                </span>
              </div>
              <div className="rounded-lg border border-slate-200 px-3 py-2 text-xs leading-5 text-slate-500">
                {selectedRole.description || '当前角色暂无描述。成员分配和权限设置会影响合同审核、配置中心和组织管理入口。'}
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-500">
              请选择角色
            </div>
          )}
        </div>

        <div className="rounded-lg border bg-white p-4">
          <h3 className="font-medium text-slate-900">组织作用域</h3>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-slate-50 px-2 py-3">
              <div className="text-lg font-semibold text-slate-900">{departments.length}</div>
              <div className="mt-1 text-[11px] text-slate-500">部门</div>
            </div>
            <div className="rounded-lg bg-slate-50 px-2 py-3">
              <div className="text-lg font-semibold text-slate-900">{users.length}</div>
              <div className="mt-1 text-[11px] text-slate-500">成员</div>
            </div>
            <div className="rounded-lg bg-slate-50 px-2 py-3">
              <div className="text-lg font-semibold text-slate-900">{spaces.length}</div>
              <div className="mt-1 text-[11px] text-slate-500">空间</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void onRefresh()}
            className="mt-4 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            刷新组织与角色
          </button>
        </div>
      </div>
    </div>
  )
}

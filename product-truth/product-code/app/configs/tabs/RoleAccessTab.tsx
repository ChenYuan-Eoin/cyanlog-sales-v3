'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import RoleAccessCard from './RoleAccessCard'
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

const DATA_SCOPE_LEVELS = [
  { key: 'OWN', label: '仅本人', description: '只能查看和处理自己负责的业务对象。' },
  { key: 'DEPT', label: '本部门', description: '可查看所在部门及其下级部门的业务数据。' },
  { key: 'SPACE', label: '销售空间', description: '可查看被分配的销售空间数据。' },
  { key: 'ORG', label: '全组织', description: '可查看组织范围内全部业务数据。' },
]

export default function RoleAccessTab({ roles, savingRoleId, orgSummary, onSaveRole }: RoleAccessTabProps) {
  const users = orgSummary?.users ?? []
  const departments = orgSummary?.departments ?? []
  const spaces = orgSummary?.spaces ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle>角色权限管理</CardTitle>
        <p className="text-sm text-slate-500 mt-1">
          按业务能力维护角色，通过组织/部门/销售空间分配数据范围。
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-semibold text-slate-900">能力体系</div>
            <div className="mt-3 space-y-1 text-xs text-slate-600">
              <p>权限以 <code className="bg-white px-1 rounded border">资源:操作</code> 命名。</p>
              <p>角色拥有权限 = 能访问的资源 × 数据范围。</p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-semibold text-slate-900">数据范围层级</div>
            <div className="mt-3 grid gap-2">
              {DATA_SCOPE_LEVELS.map((level) => (
                <div key={level.key} className="flex items-center justify-between rounded-lg bg-white px-3 py-2">
                  <span className="text-sm font-medium text-slate-900">{level.label}</span>
                  <span className="text-xs text-slate-500">{level.description}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {roles.map((role) => (
            <RoleAccessCard
              key={role.id}
              role={role}
              saving={savingRoleId === role.id}
              onSave={(perms) => onSaveRole(role.id, perms)}
              users={users}
              departments={departments}
              spaces={spaces}
            />
          ))}
          {roles.length === 0 && (
            <div className="text-center py-12">
              <p className="text-slate-500">暂无角色数据</p>
              <p className="text-sm text-slate-400 mt-2">角色由系统初始化自动创建</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

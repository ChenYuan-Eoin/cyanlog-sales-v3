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
          为每个角色分配业务能力和数据范围，控制成员的访问权限。
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
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

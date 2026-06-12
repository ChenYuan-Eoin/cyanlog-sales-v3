'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { BuildingIcon } from '@/components/icons'
import { OrgAdminWorkbench } from '@/components/admin/OrgAdminWorkbench'
import type { OrgSummaryPayload } from '../types'

interface OrgStructureTabProps {
  orgSummary: OrgSummaryPayload | null
  feishuSyncing: boolean
  feishuResult: string
  onFeishuSync: () => void
}

export default function OrgStructureTab({ orgSummary, feishuSyncing, feishuResult, onFeishuSync }: OrgStructureTabProps) {
  const departments = orgSummary?.departments ?? []
  const users = orgSummary?.users ?? []
  const spaces = orgSummary?.spaces ?? []

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>组织架构管理</CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              组织架构是角色权限、审批路由和数据范围的基础层，不属于合同审核规则配置。
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={onFeishuSync} disabled={feishuSyncing} variant="outline">
              {feishuSyncing ? '同步中...' : '从飞书同步'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {feishuResult && (
            <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
              {feishuResult}
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">部门树</div>
              <div className="mt-3 space-y-2">
                {departments.slice(0, 8).map((department) => (
                  <div key={department.id} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-900">
                        {`${'\u3000'.repeat(department.depth || 0)}${department.name}`}
                      </div>
                      <div className="text-xs text-slate-500">
                        {department.code || '未设编码'}
                      </div>
                    </div>
                    <Badge variant="outline">{department.member_count} 人</Badge>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 lg:col-span-2">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">成员概览</div>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th className="pb-2 font-medium">成员</th>
                      <th className="pb-2 font-medium">主部门</th>
                      <th className="pb-2 font-medium">组织角色</th>
                      <th className="pb-2 font-medium">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.slice(0, 8).map((user) => (
                      <tr key={user.id} className="border-b border-slate-100 last:border-0">
                        <td className="py-3">
                          <div className="font-medium text-slate-900">{user.display_name}</div>
                          <div className="text-xs text-slate-500">{user.email}</div>
                        </td>
                        <td className="py-3 text-slate-600">{user.primary_dept_name || '-'}</td>
                        <td className="py-3 text-slate-600">{user.role_names || '-'}</td>
                        <td className="py-3">
                          <Badge className={user.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}>
                            {user.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <BuildingIcon size={16} />
                销售空间与部门绑定
              </div>
              <div className="mt-3 space-y-2">
                {spaces.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-sm text-slate-500">
                    暂无销售空间。
                  </div>
                ) : (
                  spaces.slice(0, 6).map((space) => (
                    <div key={space.id} className="rounded-lg bg-slate-50 px-3 py-3">
                      <div className="text-sm font-medium text-slate-900">{space.name}</div>
                      <div className="mt-1 text-xs text-slate-500">{space.department_name}</div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-4">
              <div className="text-sm font-semibold text-slate-900">设计判断</div>
              <div className="mt-3 space-y-3 text-sm text-slate-600">
                <p>组织架构管理负责「部门、成员、空间、同步」，它提供审批链和数据范围的组织基础。</p>
                <p>合同审核规则只负责「规则内容和生效版本」，不应承载部门树、角色分配或成员导入。</p>
                <p>因此这里必须作为独立控制面存在，而不是挂在合同规则之下；本页直接提供组织工作台，不再要求跳转到单独后台完成日常配置。</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <OrgAdminWorkbench embedded />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

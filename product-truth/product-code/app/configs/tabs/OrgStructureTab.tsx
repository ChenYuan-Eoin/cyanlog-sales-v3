'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { BuildingIcon, ChevronRightIcon, ChevronDownIcon, UsersIcon, Building2Icon, MapPinIcon } from '@/components/icons'
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
      {/* Header Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          icon={<Building2Icon size={20} />}
          label="部门"
          value={departments.length}
          description="组织架构节点"
        />
        <StatCard
          icon={<UsersIcon size={20} />}
          label="成员"
          value={users.length}
          description="在职员工"
        />
        <StatCard
          icon={<MapPinIcon size={20} />}
          label="销售空间"
          value={spaces.length}
          description="业务空间"
        />
      </div>

      {/* Actions */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 pb-4">
          <div>
            <CardTitle>组织架构同步</CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              从外部系统同步部门结构和成员信息
            </p>
          </div>
          <Button onClick={onFeishuSync} disabled={feishuSyncing} variant="outline">
            {feishuSyncing ? '同步中...' : '从飞书同步'}
          </Button>
        </CardHeader>
        {feishuResult && (
          <CardContent>
            <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
              {feishuResult}
            </div>
          </CardContent>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Department Tree */}
        <Card>
          <CardHeader>
            <CardTitle>部门结构</CardTitle>
            <p className="text-sm text-slate-500">按层级展示组织架构</p>
          </CardHeader>
          <CardContent>
            <DepartmentTree departments={departments} />
          </CardContent>
        </Card>

        {/* Members */}
        <Card>
          <CardHeader>
            <CardTitle>成员概览</CardTitle>
            <p className="text-sm text-slate-500">最近活跃的团队成员</p>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {users.slice(0, 10).map((user) => (
                <div
                  key={user.id}
                  className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:shadow-sm"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
                    {user.display_name?.charAt(0) || '?'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-900">{user.display_name}</span>
                      {user.status === 'active' ? (
                        <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
                      ) : (
                        <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                      <span>{user.primary_dept_name || '未分配部门'}</span>
                      <span className="text-slate-300">·</span>
                      <span>{user.email}</span>
                    </div>
                  </div>
                  <Badge variant="outline" className="shrink-0 text-xs">
                    {user.role_names || '成员'}
                  </Badge>
                </div>
              ))}
              {users.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-500">
                  暂无成员数据
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sales Spaces */}
      <Card>
        <CardHeader>
          <CardTitle>销售空间</CardTitle>
          <p className="text-sm text-slate-500">业务空间与部门绑定关系</p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {spaces.map((space) => (
              <div
                key={space.id}
                className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 transition hover:shadow-sm"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <BuildingIcon size={20} />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900">{space.name}</div>
                  <div className="mt-0.5 text-xs text-slate-500">{space.department_name}</div>
                </div>
              </div>
            ))}
            {spaces.length === 0 && (
              <div className="col-span-full rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-500">
                暂无销售空间
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function StatCard({ icon, label, value, description }: { icon: React.ReactNode; label: string; value: number; description: string }) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
        {icon}
      </div>
      <div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold text-slate-900">{value}</span>
          <span className="text-sm text-slate-500">{label}</span>
        </div>
        <p className="text-xs text-slate-400">{description}</p>
      </div>
    </div>
  )
}

function DepartmentTree({ departments }: { departments: OrgSummaryPayload['departments'] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Build tree structure
  const deptMap = new Map(departments.map(d => [d.id, d]))
  const rootDepts = departments.filter(d => !d.parent_id)

  function getChildren(parentId: string) {
    return departments.filter(d => d.parent_id === parentId)
  }

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function DeptNode({ dept, depth }: { dept: typeof departments[0]; depth: number }) {
    const children = getChildren(dept.id)
    const isExpanded = expanded.has(dept.id)
    const hasChildren = children.length > 0

    return (
      <div>
        <button
          onClick={() => hasChildren && toggleExpand(dept.id)}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition hover:bg-slate-50"
          style={{ paddingLeft: `${depth * 24 + 12}px` }}
        >
          <div className="flex h-5 w-5 shrink-0 items-center justify-center">
            {hasChildren ? (
              isExpanded ? (
                <ChevronDownIcon size={14} className="text-slate-400" />
              ) : (
                <ChevronRightIcon size={14} className="text-slate-400" />
              )
            ) : (
              <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-900">{dept.name}</span>
              {dept.code && (
                <span className="font-mono text-xs text-slate-400">{dept.code}</span>
              )}
            </div>
          </div>
          <Badge variant="outline" className="shrink-0 text-xs">
            {dept.member_count} 人
          </Badge>
        </button>
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
    <div className="space-y-1">
      {rootDepts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-500">
          暂无部门数据
        </div>
      ) : (
        rootDepts.map(dept => (
          <DeptNode key={dept.id} dept={dept} depth={0} />
        ))
      )}
    </div>
  )
}

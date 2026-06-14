'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ShieldIcon, ChevronDownIcon, ChevronUpIcon } from '@/components/icons'
import type {
  OrgSummaryUser,
  OrgSummaryDepartment,
  OrgSummarySpace,
  PermissionCatalogGroup,
} from '../types'

const PERMISSION_CATALOG: PermissionCatalogGroup[] = [
  {
    id: 'console-access',
    label: '后台访问',
    description: '决定用户是否能进入组织管理、配置中心和管理入口。',
    items: [
      { key: 'admin:access', label: '管理后台访问', description: '允许进入组织管理与后台入口。' },
      { key: 'config:*', label: '配置中心访问', description: '允许进入并维护配置中心能力域。' },
      { key: 'report:*', label: '经营报表访问', description: '允许查看组织级经营报表与统计。' },
      { key: 'report:dept', label: '部门报表访问', description: '允许查看所在部门经营数据。' },
      { key: 'report:finance', label: '财务报表访问', description: '允许查看财务口径报表。' },
    ],
  },
  {
    id: 'org-admin',
    label: '组织架构管理',
    description: '维护部门、成员、角色指派和外部通讯录同步。',
    items: [
      { key: 'org:*', label: '组织管理', description: '允许维护组织与组织级设置。' },
      { key: 'org:write', label: '组织设置修改', description: '允许修改组织级管理项。' },
      { key: 'dept:*', label: '部门维护', description: '允许新建、调整和停用部门。' },
      { key: 'dept:view', label: '部门查看', description: '允许查看部门树和成员归属。' },
      { key: 'user:*', label: '成员维护', description: '允许创建成员、分配角色、重置密码。' },
      { key: 'user:view', label: '成员查看', description: '允许查看成员档案和角色绑定。' },
      { key: 'user:write', label: '成员编辑', description: '允许调整成员状态与角色。' },
      { key: 'feishu:sync', label: '外部通讯录同步', description: '允许从飞书等源刷新部门结构。' },
    ],
  },
  {
    id: 'quote-domain',
    label: '报价与客户',
    description: '决定销售侧是否可以创建报价、管理客户、推进机会。',
    items: [
      { key: 'opportunity:*', label: '机会全量管理', description: '允许维护所辖机会与阶段。' },
      { key: 'opportunity:own', label: '本人机会管理', description: '仅允许维护本人负责机会。' },
      { key: 'quote:*', label: '报价全量管理', description: '允许查看、编辑与审批报价。' },
      { key: 'quote:create', label: '创建报价', description: '允许新建报价单。' },
      { key: 'quote:update_own', label: '编辑本人报价', description: '仅允许编辑本人创建的报价。' },
      { key: 'quote:approve', label: '报价审批', description: '允许执行报价审批动作。' },
      { key: 'quote:view', label: '报价查看', description: '允许查看报价结果。' },
      { key: 'customer:view', label: '客户查看', description: '允许查看客户资料。' },
      { key: 'customer:create', label: '客户创建', description: '允许录入客户。' },
      { key: 'customer:*', label: '客户全量管理', description: '允许维护客户档案与关联对象。' },
    ],
  },
  {
    id: 'contract-domain',
    label: '合同与模板',
    description: '决定合同上传、审核、审批和模板查看范围。',
    items: [
      { key: 'contract:*', label: '合同全量管理', description: '允许维护与处理全部合同动作。' },
      { key: 'contract:view', label: '合同查看', description: '允许查看合同记录与审核结果。' },
      { key: 'contract:upload', label: '合同上传', description: '允许上传待审核合同。' },
      { key: 'contract:write', label: '合同编辑', description: '允许编辑合同相关记录。' },
      { key: 'contract:review', label: '合同审核执行', description: '允许执行规则与模型审核。' },
      { key: 'contract:approve', label: '合同审批', description: '允许对合同结果进行审批。' },
      { key: 'contract:read', label: '合同结果读取', description: '兼容旧接口读取权限。' },
      { key: 'template:view', label: '模板查看', description: '允许查看合同模板与条款模板。' },
    ],
  },
  {
    id: 'payment-domain',
    label: '财务与回款',
    description: '财务角色使用的支付、回款与账务能力。',
    items: [
      { key: 'payment:*', label: '回款与支付管理', description: '允许处理支付、回款与财务动作。' },
    ],
  },
]

interface RoleAccessCardProps {
  role: {
    id: string
    code: string
    name: string
    description: string | null
    permissions: string[] | null
  }
  saving: boolean
  onSave: (perms: string[]) => void
  users: OrgSummaryUser[]
  departments: OrgSummaryDepartment[]
  spaces: OrgSummarySpace[]
}

export default function RoleAccessCard({
  role,
  saving,
  onSave,
  users,
  departments,
  spaces,
}: RoleAccessCardProps) {
  const [perms, setPerms] = useState<string[]>(role.permissions ?? [])
  const isSuperAdmin = role.code === 'SUPER_ADMIN'

  const assignedUsers = useMemo(() => (
    users.filter((user) => user.role_codes?.includes(role.code))
  ), [role.code, users])

  const scopedAssignments = useMemo(() => (
    users.flatMap((user) => (
      (user.scoped_roles || [])
        .filter((assignment) => assignment.roleCode === role.code)
        .map((assignment) => ({
          userId: user.id,
          userName: user.display_name,
          scopeType: assignment.scopeType,
          scopeName: assignment.scopeName,
        }))
    ))
  ), [role.code, users])

  const impliedScopeLabels = useMemo(() => {
    const labels = new Set<string>()

    if (isSuperAdmin || perms.includes('*') || perms.includes('org:*') || perms.includes('admin:access')) {
      labels.add('全组织')
    }
    if (perms.some((permission) => permission.startsWith('dept:'))) {
      labels.add('部门')
    }
    if (scopedAssignments.some((assignment) => assignment.scopeType === 'department')) {
      labels.add('部门')
    }
    if (scopedAssignments.some((assignment) => assignment.scopeType === 'space')) {
      labels.add('销售空间')
    }
    if (assignedUsers.length > 0 && labels.size === 0) {
      labels.add('组织')
    }

    return Array.from(labels)
  }, [assignedUsers.length, isSuperAdmin, perms, scopedAssignments])

  function toggle(p: string) {
    setPerms((cur) => cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p])
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold text-slate-900">{role.name}</span>
            <Badge variant="outline" className="text-xs">{role.code}</Badge>
            {isSuperAdmin && <Badge className="text-xs bg-amber-100 text-amber-800">所有权限</Badge>}
          </div>
          {role.description && <p className="mt-2 text-sm text-slate-500">{role.description}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge className="bg-slate-100 text-slate-700">{assignedUsers.length} 名成员</Badge>
            <Badge className="bg-slate-100 text-slate-700">{scopedAssignments.length} 条作用域绑定</Badge>
            {impliedScopeLabels.map((scope) => (
              <Badge key={scope} variant="outline">{scope}</Badge>
            ))}
          </div>
        </div>
        {!isSuperAdmin && (
          <Button
            size="sm"
            onClick={() => onSave(perms)}
            disabled={saving || JSON.stringify(perms.sort()) === JSON.stringify((role.permissions ?? []).sort())}
          >
            {saving ? '保存中...' : '保存'}
          </Button>
        )}
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.9fr)]">
        <div className="space-y-4">
          {PERMISSION_CATALOG.map((group) => (
            <div key={group.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3">
                <div className="text-sm font-semibold text-slate-900">{group.label}</div>
                <p className="mt-1 text-xs leading-5 text-slate-500">{group.description}</p>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {group.items.map((item) => (
                  <label key={item.key} className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={isSuperAdmin || perms.includes(item.key) || perms.includes('*')}
                        disabled={isSuperAdmin}
                        onChange={() => toggle(item.key)}
                        className="mt-1 rounded"
                      />
                      <div>
                        <div className={`text-sm font-medium ${isSuperAdmin ? 'text-slate-500' : 'text-slate-900'}`}>
                          {item.label}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">{item.description}</div>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="text-sm font-semibold text-slate-900">分配成员</div>
            <div className="mt-3 space-y-2">
              {assignedUsers.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">
                  暂无成员直接绑定该组织角色。
                </div>
              ) : (
                assignedUsers.slice(0, 6).map((user) => (
                  <div key={user.id} className="rounded-lg bg-slate-50 px-3 py-3">
                    <div className="text-sm font-medium text-slate-900">{user.display_name}</div>
                    <div className="mt-1 text-xs text-slate-500">{user.primary_dept_name || '-'}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 p-4">
            <div className="text-sm font-semibold text-slate-900">作用域绑定</div>
            <div className="mt-3 space-y-2">
              {scopedAssignments.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">
                  当前角色未设置部门/销售空间级作用域绑定。
                </div>
              ) : (
                scopedAssignments.slice(0, 8).map((assignment, index) => (
                  <div key={`${assignment.userId}-${assignment.scopeType}-${assignment.scopeName}-${index}`} className="rounded-lg bg-slate-50 px-3 py-3">
                    <div className="text-sm font-medium text-slate-900">{assignment.userName}</div>
                    <div className="mt-1 text-xs text-slate-500">{assignment.scopeType} · {assignment.scopeName}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 p-4">
            <div className="text-sm font-semibold text-slate-900">作用范围参照</div>
            <div className="mt-3 grid gap-2">
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                部门树：{departments.length} 个节点
              </div>
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                销售空间：{spaces.length} 个对象
              </div>
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                成员池：{users.length} 名
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

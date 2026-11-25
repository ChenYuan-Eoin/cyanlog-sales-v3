import {
  ORG_BUSINESS_ROLE_ASSIGN, ORG_DEPARTMENT_DIRECTORY_VIEW, ORG_DEPARTMENT_STRUCTURE_DELETE,
  ORG_DEPARTMENT_STRUCTURE_EDIT, ORG_MEMBER_EDIT,
} from './permissions'
import { SHIPPING_ACTION_DEFINITIONS, shippingActionViewDependency } from './module-access'
import {
  ORG_MEMBER_INVITE, ORG_MEMBER_MANAGE_EMPLOYMENT, ORG_MEMBER_MANAGE_LOGIN, ORG_MEMBER_REMOVE_MEMBERSHIP,
} from './admin/member-action-keys'

export type PermissionKind = 'atomic' | 'bundle'
export type PermissionLifecycleStatus = 'draft' | 'reviewed' | 'published' | 'deprecated' | 'disabled' | 'deleted'
export type PermissionScopeType = 'org' | 'department' | 'space' | 'self'

export interface PermissionDefinition {
  id: string
  key: string
  version: number
  semanticVersion: string
  resource: string
  action: string
  kind: PermissionKind
  status: PermissionLifecycleStatus
  category: string
  label: string
  description: string
  scopeTypes: PermissionScopeType[]
  dependencies: string[]
  conflicts: string[]
  enforcementConsumer: string | null
  impliedBy: string[]
  publishedAt: string | null
  deprecatedAt: string | null
  disabledAt: string | null
  deletedAt: string | null
}

export interface PermissionCatalogItem {
  key: string
  label: string
  description: string
  kind: PermissionKind
  status: PermissionLifecycleStatus
  version: number
  scopeTypes: PermissionScopeType[]
  dependencies: string[]
  conflicts: string[]
  impliedBy: string[]
  selectable: boolean
  unavailableReason: string | null
}

export interface PermissionCatalogGroup {
  id: string
  label: string
  description: string
  items: PermissionCatalogItem[]
}

export const PERMISSION_GROUPS: Record<string, { label: string; description: string }> = {
  console: {
    label: '后台访问',
    description: '进入管理后台、配置中心和角色权限控制面。',
  },
  org: {
    label: '组织与人员',
    description: '维护组织、部门、成员和外部通讯录同步。',
  },
  quote: {
    label: '报价、客户与机会',
    description: '销售侧报价、客户资料和业务机会能力。',
  },
  contract: {
    label: '合同与模板',
    description: '合同上传、审查、审批和模板读取能力。',
  },
  payment: {
    label: '财务与回款',
    description: '支付、回款和账务处理能力。',
  },
  shipping: {
    label: '顺丰业务域',
    description: '寄件操作和承运商连接管理，不包含登录身份或组织成员资格。',
  },
}

const ALL_SCOPES: PermissionScopeType[] = ['org', 'department', 'space', 'self']

function definition(input: {
  key: string
  category: keyof typeof PERMISSION_GROUPS
  label: string
  description: string
  kind?: PermissionKind
  status?: PermissionLifecycleStatus
  scopes?: PermissionScopeType[]
  dependencies?: string[]
  conflicts?: string[]
  impliedBy?: string[]
  enforcementConsumer?: string | null
}): PermissionDefinition {
  const [resource, action = '*'] = input.key.split(':')
  return {
    id: input.key,
    key: input.key,
    version: 1,
    semanticVersion: '1.0.0',
    resource,
    action,
    kind: input.kind ?? (input.key.endsWith(':*') ? 'bundle' : 'atomic'),
    status: input.status ?? 'published',
    category: input.category,
    label: input.label,
    description: input.description,
    scopeTypes: input.scopes ?? ALL_SCOPES,
    dependencies: input.dependencies ?? [],
    conflicts: input.conflicts ?? [],
    enforcementConsumer: input.enforcementConsumer === undefined ? 'lib/permissions.ts' : input.enforcementConsumer,
    impliedBy: input.impliedBy ?? [],
    publishedAt: (input.status ?? 'published') === 'published' ? '2026-10-21T00:00:00.000Z' : null,
    deprecatedAt: null,
    disabledAt: null,
    deletedAt: null,
  }
}

/**
 * Runtime fallback and migration seed for the platform permission registry.
 * Tenant clients consume the server response and must not import this catalog.
 */
export const BUILTIN_PERMISSION_DEFINITIONS: PermissionDefinition[] = [
  definition({ key: '*', category: 'console', label: '平台全部权限', description: '仅供平台根角色恢复和兼容使用。', kind: 'bundle', enforcementConsumer: 'lib/permissions.ts#hasPermission' }),

  definition({ key: 'admin:access', category: 'console', label: '管理后台访问', description: '允许进入组织管理与后台入口。', enforcementConsumer: 'lib/permissions.ts#canAccessOrgAdmin', impliedBy: ['org:write', 'user:view', 'user:write'] }),
  definition({ key: 'config:*', category: 'console', label: '配置中心组合权限', description: '包含配置读取、修改与发布。', kind: 'bundle', enforcementConsumer: 'lib/configs/access.ts' }),
  definition({ key: 'config:read', category: 'console', label: '配置中心查看', description: '允许读取当前组织配置。', enforcementConsumer: 'lib/configs/access.ts', impliedBy: ['config:write', 'config:publish'] }),
  definition({ key: 'config:write', category: 'console', label: '配置中心修改', description: '允许修改当前组织配置。', enforcementConsumer: 'lib/configs/access.ts' }),
  definition({ key: 'config:publish', category: 'console', label: '配置发布', description: '允许发布当前组织配置。', enforcementConsumer: 'lib/configs/access.ts' }),
  definition({ key: 'role:manage', category: 'console', label: '角色权限管理', description: '允许维护当前组织角色和权限。', enforcementConsumer: 'lib/org-role-permissions.ts#canEditRolePermissions' }),
  definition({ key: 'report:*', category: 'console', label: '经营报表组合权限', description: '经营报表资源通配能力。', kind: 'bundle', status: 'draft', enforcementConsumer: null }),
  definition({ key: 'report:dept', category: 'console', label: '部门报表访问', description: '请求查看部门经营数据的保留权限。', status: 'draft', enforcementConsumer: null }),
  definition({ key: 'report:finance', category: 'console', label: '财务报表访问', description: '请求查看财务口径数据的保留权限。', status: 'draft', enforcementConsumer: null }),

  definition({ key: 'org:*', category: 'org', label: '组织管理组合权限', description: '包含组织设置维护能力。', kind: 'bundle', enforcementConsumer: 'lib/scoped-access.ts#canManageOrg' }),
  definition({ key: 'org:write', category: 'org', label: '组织设置修改', description: '允许修改组织级管理项。', enforcementConsumer: 'lib/scoped-access.ts#canMutateOrgUsers', impliedBy: ['user:write', 'dept:write'] }),
  definition({ key: 'dept:*', category: 'org', label: '部门组合权限', description: '部门查看与编辑资源通配能力。', kind: 'bundle', status: 'draft', enforcementConsumer: null }),
  definition({ key: 'dept:view', category: 'org', label: '部门查看', description: '请求查看部门树和成员归属的保留权限。', status: 'draft', enforcementConsumer: null }),
  definition({ key: 'dept:write', category: 'org', label: '部门编辑', description: '允许调整当前组织部门结构。', enforcementConsumer: 'lib/scoped-access.ts#canMutateOrgDepartments', impliedBy: ['org:write'] }),
  definition({ key: ORG_DEPARTMENT_DIRECTORY_VIEW, category: 'org', label: '查看部门树', description: '查看当前组织的部门层级。', scopes: ['org'], enforcementConsumer: 'lib/admin/department-actions.ts' }),
  definition({ key: ORG_DEPARTMENT_STRUCTURE_EDIT, category: 'org', label: '维护部门', description: '新增部门以及修改部门的名称、上级和负责人。', scopes: ['org'], dependencies: [ORG_DEPARTMENT_DIRECTORY_VIEW], enforcementConsumer: 'lib/admin/department-actions.ts' }),
  definition({ key: ORG_DEPARTMENT_STRUCTURE_DELETE, category: 'org', label: '删除部门', description: '删除符合条件的部门。', scopes: ['org'], dependencies: [ORG_DEPARTMENT_DIRECTORY_VIEW], enforcementConsumer: 'lib/admin/department-actions.ts' }),
  definition({ key: 'user:*', category: 'org', label: '成员组合权限', description: '包含成员查看与编辑。', kind: 'bundle', enforcementConsumer: 'lib/permissions.ts#canAccessOrgAdmin' }),
  definition({ key: 'user:view', category: 'org', label: '成员查看', description: '允许查看当前组织成员档案和角色绑定。', enforcementConsumer: 'lib/permissions.ts#canAccessOrgAdmin' }),
  definition({ key: ORG_MEMBER_EDIT, category: 'org', label: '编辑成员', description: '修改当前组织内成员的资料和部门归属。', scopes: ['org'], dependencies: ['user:view'], enforcementConsumer: 'lib/admin/member-actions.ts' }),
  definition({ key: ORG_BUSINESS_ROLE_ASSIGN, category: 'org', label: '分配或撤销业务角色', description: '变更本组织成员的业务角色绑定，仍受可委派角色范围校验。', scopes: ['org'], dependencies: ['user:view'], enforcementConsumer: 'lib/admin/member-actions.ts' }),
  definition({ key: ORG_MEMBER_INVITE, category: 'org', label: '添加或邀请成员', description: '创建邀请、重发或撤销待激活邀请。', scopes: ['org'], dependencies: ['user:view'], enforcementConsumer: 'lib/admin/member-actions.ts' }),
  definition({ key: ORG_MEMBER_MANAGE_LOGIN, category: 'org', label: '管理成员登录', description: '启用或停用本组织成员登录。', scopes: ['org'], dependencies: ['user:view'], enforcementConsumer: 'lib/admin/member-actions.ts' }),
  definition({ key: ORG_MEMBER_MANAGE_EMPLOYMENT, category: 'org', label: '办理离职或复职', description: '更新本组织成员的在职状态。', scopes: ['org'], dependencies: ['user:view'], enforcementConsumer: 'lib/admin/member-actions.ts' }),
  definition({ key: ORG_MEMBER_REMOVE_MEMBERSHIP, category: 'org', label: '移出组织', description: '结束成员在当前组织的成员关系。', scopes: ['org'], dependencies: ['user:view'], enforcementConsumer: 'lib/admin/member-actions.ts' }),
  definition({ key: 'user:write', category: 'org', label: '成员编辑', description: '允许调整当前组织成员状态、部门和角色。', enforcementConsumer: 'lib/scoped-access.ts#canMutateOrgUsers', impliedBy: ['org:write'] }),
  definition({ key: 'feishu:sync', category: 'org', label: '外部通讯录同步', description: '请求刷新已验证外部来源部门与成员的保留权限。', status: 'draft', enforcementConsumer: null }),
  definition({ key: 'org:source_view', category: 'org', label: '查看连接与同步状态', description: '查看本组织的外部连接和目录同步状态。', scopes: ['org'], enforcementConsumer: 'lib/admin/organization-source-access.ts' }),
  definition({ key: 'org:source_connect', category: 'org', label: '维护与验证连接', description: '保存或验证本组织的外部连接。', scopes: ['org'], enforcementConsumer: 'lib/admin/organization-source-access.ts' }),
  definition({ key: 'org:source_preview', category: 'org', label: '预览目录同步', description: '预览部门与成员的目录变更。', scopes: ['org'], enforcementConsumer: 'lib/admin/organization-source-access.ts' }),
  definition({ key: 'org:source_apply', category: 'org', label: '应用或回滚目录同步', description: '应用已核对的同步、切换目录来源或回滚切换。', scopes: ['org'], enforcementConsumer: 'lib/admin/organization-source-access.ts' }),

  definition({ key: 'opportunity:*', category: 'quote', label: '机会组合权限', description: '机会资源通配能力。', kind: 'bundle', status: 'draft', enforcementConsumer: null }),
  definition({ key: 'opportunity:own', category: 'quote', label: '本人机会管理', description: '请求维护本人负责机会的保留权限。', scopes: ['self'], status: 'draft', enforcementConsumer: null }),
  definition({ key: 'quote:*', category: 'quote', label: '报价组合权限', description: '报价资源通配能力。', kind: 'bundle', enforcementConsumer: 'lib/permissions.ts#hasPermission' }),
  definition({ key: 'quote:create', category: 'quote', label: '创建报价', description: '允许新建报价单。', enforcementConsumer: 'lib/permissions.ts#hasPermission' }),
  definition({ key: 'quote:update_own', category: 'quote', label: '编辑本人报价', description: '允许编辑本人创建的报价。', scopes: ['self'], enforcementConsumer: 'lib/permissions.ts#hasPermission' }),
  definition({ key: 'quote:approve', category: 'quote', label: '报价审批', description: '请求执行报价审批的保留权限。', status: 'draft', enforcementConsumer: null }),
  definition({ key: 'quote:view', category: 'quote', label: '报价查看', description: '允许查看报价结果。', enforcementConsumer: 'lib/permissions.ts#hasPermission' }),
  definition({ key: 'customer:*', category: 'quote', label: '客户组合权限', description: '客户资源通配能力。', kind: 'bundle', enforcementConsumer: 'lib/permissions.ts#hasPermission' }),
  definition({ key: 'customer:view', category: 'quote', label: '客户查看', description: '允许查看客户资料。', enforcementConsumer: 'lib/permissions.ts#hasPermission' }),
  definition({ key: 'customer:create', category: 'quote', label: '客户创建', description: '允许录入客户。', enforcementConsumer: 'lib/permissions.ts#hasPermission' }),

  definition({ key: 'contract:*', category: 'contract', label: '合同组合权限', description: '合同资源通配能力。', kind: 'bundle', enforcementConsumer: 'lib/permissions.ts#canReviewContracts' }),
  definition({ key: 'contract:view', category: 'contract', label: '合同查看', description: '允许查看合同记录与审核结果。', enforcementConsumer: 'lib/scoped-access.ts#canAccessContractAction', impliedBy: ['contract:read', 'contract:upload', 'contract:review', 'contract:write'] }),
  definition({ key: 'contract:upload', category: 'contract', label: '合同上传', description: '允许上传待审核合同。', enforcementConsumer: 'lib/scoped-access.ts#canAccessContractAction', impliedBy: ['contract:create', 'contract:write'] }),
  definition({ key: 'contract:create', category: 'contract', label: '合同创建', description: '允许创建合同记录。', enforcementConsumer: 'lib/scoped-access.ts#canAccessContractAction', impliedBy: ['contract:upload', 'contract:write'] }),
  definition({ key: 'contract:write', category: 'contract', label: '合同编辑', description: '允许编辑合同相关记录。', enforcementConsumer: 'lib/scoped-access.ts#canAccessContractAction' }),
  definition({ key: 'contract:review', category: 'contract', label: '合同审核执行', description: '允许执行规则与模型审核。', enforcementConsumer: 'lib/permissions.ts#canReviewContracts', impliedBy: ['contract:write'] }),
  definition({ key: 'contract:approve', category: 'contract', label: '合同审批', description: '请求执行合同审批的保留权限。', status: 'draft', enforcementConsumer: null }),
  definition({ key: 'contract:read', category: 'contract', label: '合同结果读取', description: '兼容旧接口的合同读取权限。', enforcementConsumer: 'lib/scoped-access.ts#canAccessContractAction' }),
  definition({ key: 'template:view', category: 'contract', label: '模板查看', description: '请求查看合同模板的保留权限。', status: 'draft', enforcementConsumer: null }),

  definition({ key: 'payment:*', category: 'payment', label: '财务与回款组合权限', description: '支付与回款资源通配能力。', kind: 'bundle', enforcementConsumer: 'lib/permissions.ts#hasPermission' }),

  definition({ key: 'shipping:*', category: 'shipping', label: '寄件组合权限', description: '包含当前组织的寄件操作与连接管理。', scopes: ['org'], kind: 'bundle', enforcementConsumer: 'lib/permissions.ts#hasPermission' }),
  ...Object.entries(SHIPPING_ACTION_DEFINITIONS).map(([key, [label, description]]) => {
    const dependency = shippingActionViewDependency(key)
    return definition({
      key, label, description, category: 'shipping', scopes: ['org'],
      dependencies: dependency ? [dependency] : [],
      enforcementConsumer: 'lib/shipping/http.ts',
    })
  }),
  definition({ key: 'shipping:operate', category: 'shipping', label: '寄件操作', description: '允许在当前组织查看收寄台账、核对工单和执行已授权的承运商操作。', scopes: ['org'], enforcementConsumer: 'lib/shipping/operator-access.ts#requireShippingOperator' }),
  definition({ key: 'shipping:manage_connections', category: 'shipping', label: '寄件连接管理', description: '允许维护当前组织的承运商与企业接入配置。', scopes: ['org'], enforcementConsumer: 'lib/shipping/connection-authorization.ts' }),
]

export const BUILTIN_PERMISSION_BY_KEY = new Map(
  BUILTIN_PERMISSION_DEFINITIONS.map((item) => [item.key, item]),
)

export function isPermissionSelectable(
  item: Pick<PermissionDefinition, 'kind' | 'status' | 'enforcementConsumer'>,
): boolean {
  return item.kind === 'atomic'
    && item.status === 'published'
    && Boolean(item.enforcementConsumer)
}

export function permissionUnavailableReason(
  item: Pick<PermissionDefinition, 'kind' | 'status' | 'enforcementConsumer'>,
): string | null {
  if (isPermissionSelectable(item)) return null
  if (item.kind === 'bundle') return '组合能力由原子权限汇总，不作为独立复选框。'
  if (item.status !== 'published') return '尚未接入真实执行点，不能分配给租户。'
  return '缺少服务端执行消费者，不能分配给租户。'
}

export function buildPermissionCatalog(
  definitions: PermissionDefinition[],
  options: { includeUnavailable?: boolean } = {},
): PermissionCatalogGroup[] {
  const includeUnavailable = options.includeUnavailable === true
  return Object.entries(PERMISSION_GROUPS)
    .map(([id, group]) => ({
      id,
      ...group,
      items: definitions
        .filter((item) => item.category === id && item.status !== 'deleted')
        .filter((item) => item.kind === 'atomic' || includeUnavailable)
        .filter((item) => includeUnavailable || isPermissionSelectable(item))
        .sort((left, right) => left.key.localeCompare(right.key))
        .map((item) => ({
          key: item.key,
          label: item.label,
          description: item.description,
          kind: item.kind,
          status: item.status,
          version: item.version,
          scopeTypes: item.scopeTypes,
          dependencies: item.dependencies,
          conflicts: item.conflicts,
          impliedBy: item.impliedBy,
          selectable: isPermissionSelectable(item),
          unavailableReason: permissionUnavailableReason(item),
        })),
    }))
    .filter((group) => group.items.length > 0)
}

export function permissionDefinitionIsValid(
  definition: PermissionDefinition,
  allDefinitions: PermissionDefinition[],
): string[] {
  const errors: string[] = []
  if (!/^[a-z][a-z0-9_-]*:(?:[a-z][a-z0-9_-]*|\*)$/.test(definition.key) && definition.key !== '*') {
    errors.push('权限 key 必须使用 resource:action 格式。')
  }
  if (!definition.label.trim()) errors.push('权限名称不能为空。')
  if (!definition.description.trim()) errors.push('权限说明不能为空。')
  if (!Object.prototype.hasOwnProperty.call(PERMISSION_GROUPS, definition.category)) {
    errors.push(`权限分类不可用：${definition.category}`)
  }
  if (definition.kind === 'atomic' && definition.action === '*') {
    errors.push('原子权限不能使用通配 action。')
  }
  const byKey = new Map(allDefinitions.filter((item) => item.key !== definition.key).map((item) => [item.key, item]))
  for (const dependency of definition.dependencies) {
    const target = byKey.get(dependency)
    if (!target || target.status === 'disabled' || target.status === 'deleted') {
      errors.push(`依赖权限不可用：${dependency}`)
    }
    if (dependency === definition.key) errors.push('权限不能依赖自身。')
  }
  for (const conflict of definition.conflicts) {
    if (!byKey.has(conflict)) errors.push(`冲突权限不存在：${conflict}`)
    if (definition.dependencies.includes(conflict)) errors.push(`权限不能同时依赖和冲突：${conflict}`)
  }
  if (definition.key.endsWith(':*') && definition.kind !== 'bundle') {
    errors.push('资源通配权限必须标记为组合能力。')
  }
  const graph = new Map(
    [...allDefinitions.filter((item) => item.key !== definition.key), definition]
      .map((item) => [item.key, item.dependencies]),
  )
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const hasCycle = (key: string): boolean => {
    if (visiting.has(key)) return true
    if (visited.has(key)) return false
    visiting.add(key)
    for (const dependency of graph.get(key) ?? []) {
      if (hasCycle(dependency)) return true
    }
    visiting.delete(key)
    visited.add(key)
    return false
  }
  if (hasCycle(definition.key)) errors.push('权限依赖存在循环。')
  return errors
}

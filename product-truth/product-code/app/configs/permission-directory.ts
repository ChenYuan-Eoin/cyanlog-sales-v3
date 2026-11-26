import type { PermissionDirectoryPlacement, RoleModulePermissionCatalog } from '@/lib/org-role-permission-readback'
import {
  ORG_BUSINESS_ROLE_ASSIGN,
  ORG_DEPARTMENT_DIRECTORY_VIEW,
  ORG_DEPARTMENT_STRUCTURE_DELETE,
  ORG_DEPARTMENT_STRUCTURE_EDIT,
  ORG_MEMBER_EDIT,
} from '@/lib/permissions'
import {
  ORG_MEMBER_INVITE,
  ORG_MEMBER_MANAGE_EMPLOYMENT,
  ORG_MEMBER_MANAGE_LOGIN,
  ORG_MEMBER_REMOVE_MEMBERSHIP,
} from '@/lib/admin/member-action-keys'
import {
  getEffectiveShippingPermissions,
  REGISTERED_MODULE_PERMISSION_KEYS,
  SHIPPING_ACTION_DEFINITIONS,
  SHIPPING_BUNDLE,
  SHIPPING_MANAGE_CONNECTIONS,
  SHIPPING_OPERATE,
  SHIPPING_OWNER_ACTION_KEYS,
  SHIPPING_SETTINGS_ACTION_KEYS,
  SHIPPING_WORKBENCH_ACTION_KEYS,
  shippingActionViewDependency,
  type ShippingActionKey,
} from '@/lib/module-access'

export const registeredShippingPermissionKeys: ReadonlySet<string> = new Set(REGISTERED_MODULE_PERMISSION_KEYS)

type PermissionDirectoryAction = PermissionDirectoryPlacement & {
  key: string
  label: string
  description: string
  dependencies?: readonly string[]
  available: boolean
}

type PermissionDirectoryNote = {
  label: string
  description?: string
  status: '系统控制'
}

export interface PermissionDirectoryGroup {
  id: string
  label: string
  entry?: ShippingDirectoryEntry | 'config'
  actions?: readonly PermissionDirectoryAction[]
  notes?: readonly PermissionDirectoryNote[]
  children?: readonly PermissionDirectoryGroup[]
}

export type ShippingDirectoryEntry = 'shipping' | 'shipping-settings'

const shippingEntryGrants = {
  shipping: { alias: SHIPPING_OPERATE, actions: SHIPPING_WORKBENCH_ACTION_KEYS },
  'shipping-settings': { alias: SHIPPING_MANAGE_CONNECTIONS, actions: SHIPPING_SETTINGS_ACTION_KEYS },
}

export function clearShippingEntryGrants(
  grants: string[], entry: ShippingDirectoryEntry, publication: { registered: ReadonlySet<string>; published: ReadonlySet<string> },
): string[] {
  if (grants.includes('*')) return grants
  const removed = shippingEntryGrants[entry]
  const removedKeys = new Set<string>([removed.alias, ...removed.actions, SHIPPING_BUNDLE])
  const next = grants.filter(key => !removedKeys.has(key))
  if (!grants.includes(SHIPPING_BUNDLE)) return next

  const kept = shippingEntryGrants[entry === 'shipping' ? 'shipping-settings' : 'shipping']
  if (publication.published.has(kept.alias)) return [...new Set([...next, kept.alias])]
  const keptKeys = new Set<string>([kept.alias, ...kept.actions])
  // Keep the other entry's actual grants, including its published compatibility path.
  const saved = getEffectiveShippingPermissions(grants, publication).filter(key => keptKeys.has(key) && publication.published.has(key))
  return [...new Set([...next, ...saved])]
}

export const legacyPermissionLabels: Readonly<Record<string, string>> = {
  '*': '系统全部权限',
  'admin:access': '管理后台入口',
  'config:*': '配置中心旧组合授权',
  'org:*': '组织管理旧组合授权',
  'org:write': '组织管理旧授权',
  'role:manage': '角色权限管理',
  'user:*': '成员管理旧组合授权',
  'user:write': '成员管理旧授权',
  [ORG_BUSINESS_ROLE_ASSIGN]: '业务角色分配旧授权',
  'dept:write': '部门维护旧授权',
  'report:dept': '部门经营数据旧授权',
  'report:finance': '财务报表旧授权',
  'quote:view': '报价查看旧授权',
  'contract:write': '合同编辑旧授权',
  [SHIPPING_BUNDLE]: '寄件旧组合授权',
  [SHIPPING_OPERATE]: '寄件操作旧授权',
  [SHIPPING_MANAGE_CONNECTIONS]: '寄件设置旧授权',
}

export const removableShippingCompatibilityKeys: readonly string[] = [
  SHIPPING_BUNDLE, SHIPPING_OPERATE, SHIPPING_MANAGE_CONNECTIONS,
]

function availableAction(key: string, label: string, description: string, dependencies?: readonly string[]): PermissionDirectoryAction {
  return { key, label, description, dependencies, available: true }
}

export function buildRolePermissionDirectory(moduleCatalog: RoleModulePermissionCatalog = []): PermissionDirectoryGroup[] {
  const registered = new Map(moduleCatalog.flatMap(group => group.items)
    .filter(item => !('selectable' in item) || item.selectable !== false)
    .map(item => [item.key, item] as const))
  const shippingActions = (keys: readonly ShippingActionKey[]) => keys.map(key => {
    const published = registered.get(key)
    const required = shippingActionViewDependency(key)
    const [label, description] = SHIPPING_ACTION_DEFINITIONS[key]
    return published
      ? { ...published, available: (!published.moduleKey || published.grantSubjectTypes?.includes('role') === true) && (!required || published.dependencies.includes(required))
        && published.dependencies.every(dependency => registered.has(dependency)) }
      : { key, label, description, available: false }
  })

  const groups: PermissionDirectoryGroup[] = [
    {
      id: 'shipping', label: '自助收寄', entry: 'shipping',
      children: [
        {
          id: 'shipping-personal', label: '本人寄件',
          actions: shippingActions(SHIPPING_OWNER_ACTION_KEYS),
        },
        { id: 'shipping-workbench', label: '收寄工作台', actions: shippingActions(SHIPPING_WORKBENCH_ACTION_KEYS) },
      ],
    },
    {
      id: 'shipping-settings', label: '寄件设置', entry: 'shipping-settings',
      actions: shippingActions(SHIPPING_SETTINGS_ACTION_KEYS),
    },
    {
      id: 'config', label: '配置中心', entry: 'config',
      actions: [
        availableAction('config:read', '配置中心查看', '查看当前组织的通用业务配置。'),
        availableAction('config:write', '配置中心修改', '新建、编辑和删除通用配置草稿。支持版本历史的通用配置可将历史版本恢复到草稿。'),
        availableAction('config:publish', '配置发布', '发布通用配置。编辑或回滚已生效的通用配置时，还须具有修改权限。'),
      ],
      children: [
        {
          id: 'config-org', label: '组织与权限',
          children: [
            {
              id: 'org-structure', label: '组织架构',
              children: [
                {
                  id: 'org-departments', label: '部门',
                  actions: [
                    availableAction(ORG_DEPARTMENT_DIRECTORY_VIEW, '查看部门树', '查看本组织的部门目录和上下级关系。'),
                    availableAction(ORG_DEPARTMENT_STRUCTURE_EDIT, '维护部门', '新建部门或编辑资料。现有部门改隶仍须核验超管资格。', [ORG_DEPARTMENT_DIRECTORY_VIEW]),
                    availableAction(ORG_DEPARTMENT_STRUCTURE_DELETE, '删除部门', '停用符合条件的空部门。', [ORG_DEPARTMENT_DIRECTORY_VIEW]),
                  ],
                  notes: [
                    { label: '维护部门寄件提报资格', description: '由系统超管设置哪些部门符合提报范围。', status: '系统控制' },
                  ],
                },
                {
                  id: 'org-members', label: '成员',
                  actions: [
                    availableAction('user:view', '查看成员', '查看组织架构中的成员档案及分配记录。'),
                    availableAction(ORG_MEMBER_EDIT, '编辑成员', '修改成员档案。', ['user:view']),
                    availableAction(ORG_MEMBER_INVITE, '邀请成员', '添加、重发或撤销待激活邀请。预分配角色和部门另校验权限。', ['user:view']),
                    availableAction(ORG_MEMBER_MANAGE_LOGIN, '管理成员登录', '允许或禁止成员登录。', ['user:view']),
                    availableAction(ORG_MEMBER_MANAGE_EMPLOYMENT, '管理成员在职状态', '停用、恢复在职或办理离职。', ['user:view']),
                    availableAction(ORG_MEMBER_REMOVE_MEMBERSHIP, '将成员移出组织', '解除成员在当前组织的成员关系，保留账户。', ['user:view']),
                  ],
                },
              ],
            },
            {
              id: 'role-access', label: '角色权限',
              actions: [availableAction('role:view', '查看角色及成员', '查看当前组织的角色、有效成员和权限配置。', ['user:view'])],
              notes: [
                { label: '保存角色授权', description: '由系统超管设置这个角色可以执行哪些业务动作。', status: '系统控制' },
                { label: '分配或撤销业务角色', description: '由系统超管为员工设置角色与数据范围。', status: '系统控制' },
                { label: '任免超级管理员', description: '由后端依据操作人和目标成员的资格校验。', status: '系统控制' },
              ],
            },
            {
              id: 'integrations', label: '外部系统接入',
              actions: [
                availableAction('org:source_view', '查看连接与同步状态', '查看本组织的外部连接和目录同步状态。'),
                availableAction('org:source_connect', '维护和校验连接', '保存连接设置、校验连接及发现目录来源。'),
                availableAction('org:source_preview', '预览目录同步', '核对目录读取范围并预览将发生的变更。'),
                availableAction('org:source_apply', '应用或回滚目录同步', '启用目录来源，应用或回滚已核对的目录同步。'),
              ],
              notes: [
                { label: '切换登录来源', description: '由专用管理接口校验操作人资格。', status: '系统控制' },
              ],
            },
          ],
        },
      ],
    },
  ]

  function addRegisteredPlacement(group: PermissionDirectoryGroup): PermissionDirectoryGroup {
    return {
      ...group,
      actions: group.actions?.map(action => {
        const item = registered.get(action.key)
        if (!item?.moduleKey) return action
        return {
          ...action,
          moduleKey: item.moduleKey,
          capabilityLevel: item.capabilityLevel,
          grantSubjectTypes: item.grantSubjectTypes,
          scopeTypes: item.scopeTypes,
          available: action.available && item.grantSubjectTypes?.includes('role') === true,
        }
      }),
      children: group.children?.map(addRegisteredPlacement),
    }
  }

  return groups.map(addRegisteredPlacement)
}

export function getDirectoryActions(group: PermissionDirectoryGroup): PermissionDirectoryAction[] {
  return [...(group.actions ?? []), ...(group.children ?? []).flatMap(getDirectoryActions)]
}

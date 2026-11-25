import type { RoleModulePermissionCatalog } from '@/lib/org-role-permission-readback'
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
  SHIPPING_ACTION_DEFINITIONS,
  SHIPPING_BUNDLE,
  SHIPPING_MANAGE_CONNECTIONS,
  SHIPPING_OPERATE,
  SHIPPING_OWNER_ACTION_KEYS,
  SHIPPING_SETTINGS_ACTION_KEYS,
  SHIPPING_WORKBENCH_ACTION_KEYS,
  type ShippingActionKey,
} from '@/lib/module-access'

type PermissionDirectoryAction = {
  key: string
  label: string
  description: string
  dependencies?: readonly string[]
  available: boolean
}

type PermissionDirectoryNote = {
  label: string
  description?: string
  status: '沿用现有规则' | '待接入' | '系统控制'
}

export interface PermissionDirectoryGroup {
  id: string
  label: string
  actions?: readonly PermissionDirectoryAction[]
  notes?: readonly PermissionDirectoryNote[]
  children?: readonly PermissionDirectoryGroup[]
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

function existing(label: string, description?: string): PermissionDirectoryNote {
  return { label, description, status: '沿用现有规则' }
}

export function buildRolePermissionDirectory(moduleCatalog: RoleModulePermissionCatalog = []): PermissionDirectoryGroup[] {
  const registered = new Map(moduleCatalog.flatMap(group => group.items)
    .filter(item => !('selectable' in item) || item.selectable !== false)
    .map(item => [item.key, item] as const))
  const shippingActions = (keys: readonly ShippingActionKey[]) => keys.map(key => {
    const published = registered.get(key)
    const [label, description] = SHIPPING_ACTION_DEFINITIONS[key]
    return published
      ? { ...published, available: published.dependencies.every(dependency => registered.has(dependency)) }
      : { key, label, description, available: false }
  })

  return [
    {
      id: 'workbench', label: '工作台',
      notes: [existing('查看工作台'), existing('查看部门经营数据', '按当前部门数据规则查询。')],
    },
    {
      id: 'quotes', label: '报价中心',
      notes: [existing('查看报价、创建报价、编辑本人报价', '按现有报价规则执行。')],
    },
    {
      id: 'shipping', label: '自助收寄',
      children: [
        {
          id: 'shipping-personal', label: '本人寄件',
          actions: shippingActions(SHIPPING_OWNER_ACTION_KEYS),
          notes: [existing('本人数据范围', '只处理本人提报，并校验纷享登录资格和单据状态。')],
        },
        { id: 'shipping-workbench', label: '收寄工作台', actions: shippingActions(SHIPPING_WORKBENCH_ACTION_KEYS) },
      ],
    },
    {
      id: 'shipping-settings', label: '寄件设置',
      actions: shippingActions(SHIPPING_SETTINGS_ACTION_KEYS),
      notes: [existing('与配置中心中的「寄件配置」共用权限。')],
    },
    {
      id: 'contracts', label: '合同审核',
      notes: [existing('查看合同、新建或上传合同、执行审核')],
    },
    {
      id: 'tenders', label: '标书中心',
      notes: [existing('查看标书、上传识别、推进流程')],
    },
    {
      id: 'knowledge', label: '知识库',
      notes: [existing('查看、编辑和管理知识页', '由具体知识页的授权控制。')],
    },
    {
      id: 'schedule', label: '日程',
      notes: [existing('查看、新建和更新日程')],
    },
    {
      id: 'config', label: '配置中心',
      actions: [
        availableAction('config:read', '配置中心查看', '查看当前组织的通用业务配置。'),
        availableAction('config:write', '配置中心修改', '新建、编辑和删除通用配置草稿。支持版本历史的通用配置可将历史版本恢复到草稿。'),
        availableAction('config:publish', '配置发布', '发布通用配置。编辑或回滚已生效的通用配置时，还须具有修改权限。'),
      ],
      children: [
        { id: 'trading', label: '定价与审批', notes: [existing('使用本页支持的通用配置权限')] },
        { id: 'quote-output', label: '报价输出', notes: [existing('使用本页支持的通用配置权限')] },
        { id: 'contract-rules', label: '合同规则', notes: [existing('按已有合同规则入口执行')] },
        { id: 'shipping-config', label: '寄件配置', notes: [existing('所用权限见「寄件设置」')] },
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
                },
                {
                  id: 'org-members', label: '成员',
                  actions: [
                    availableAction('user:view', '查看成员', '查看组织架构中的成员档案及分配记录。'),
                    availableAction(ORG_MEMBER_EDIT, '编辑成员', '修改成员档案。', ['user:view']),
                    availableAction(ORG_BUSINESS_ROLE_ASSIGN, '分配或撤销业务角色', '变更成员的业务角色。', ['user:view']),
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
                { label: '保存角色权限', description: '由当前组织具有角色管理资格的超级管理员操作。', status: '系统控制' },
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
        { id: 'experience', label: '品牌与主题', notes: [existing('按已有主题入口执行')] },
        { id: 'ai-platform', label: 'AI 平台', notes: [existing('按已有 AI 平台入口执行')] },
      ],
    },
  ]
}

export function getDirectoryActions(group: PermissionDirectoryGroup): PermissionDirectoryAction[] {
  return [...(group.actions ?? []), ...(group.children ?? []).flatMap(getDirectoryActions)]
}

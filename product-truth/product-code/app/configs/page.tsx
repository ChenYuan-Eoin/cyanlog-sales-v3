'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ImageUpload } from '@/components/ui/ImageUpload'
import type { Rule } from '@/types/rules'
import { DEFAULT_THEME } from '@/lib/ui-theme-shared'
import {
  BotIcon,
  BuildingIcon,
  FileTextIcon,
  KeyRoundIcon,
  PaletteIcon,
  PackageIcon,
  PercentIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UsersIcon,
} from '@/components/icons'

const riskLevelMap: Record<string, { label: string; className: string }> = {
  red: { label: '红灯', className: 'bg-red-100 text-red-800 border-red-200' },
  yellow: { label: '黄灯', className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  green: { label: '绿灯', className: 'bg-green-100 text-green-800 border-green-200' },
}

const ruleTypeMap: Record<string, string> = {
  structured: '结构化规则',
  semantic: '语义规则',
}

interface Config {
  id: string
  key: string
  name: string
  value: Record<string, unknown>
  type: 'CONTRACT_RULE' | 'TAX_RULE' | 'APPROVAL_RULE' | 'AI_CONFIG' | 'UI_THEME'
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
  version: number
  description?: string
  created_at: string
  updated_at: string
}

interface ProductPriceTier {
  id?: string
  qty_from: number
  qty_to: number | null
  unit_price: number
  sort_order?: number
}

interface ProductRecord {
  id: string
  code: string
  name: string
  specification?: string | null
  unit?: string | null
  base_price: number
  cost_price?: number | null
  min_price?: number | null
  tier_pricing_enabled: boolean
  status: 'active' | 'inactive' | 'discontinued'
  product_categories?: { name: string } | null
  product_price_tiers?: ProductPriceTier[]
}

interface ScopedRoleAssignment {
  roleId: string
  roleName: string
  roleCode: string
  scopeType: 'org' | 'department' | 'space'
  scopeId: string | null
  scopeName: string
  grantedAt: string | null
}

interface OrgSummaryUser {
  id: string
  email: string
  display_name: string
  title: string
  primary_dept_name: string
  primary_dept_id?: string | null
  role_names: string
  role_codes?: string[]
  scoped_roles?: ScopedRoleAssignment[]
  status: string
  must_change_password: boolean
}

interface OrgSummaryDepartment {
  id: string
  name: string
  code?: string | null
  depth?: number
  parent_id?: string | null
  parent_name: string | null
  member_count: number
}

interface OrgSummaryRole {
  id: string
  code: string
  name: string
}

interface OrgSummarySpace {
  id: string
  name: string
  description?: string | null
  department_id: string
  department_name: string
  owner_id?: string | null
}

interface OrgSummaryPayload {
  organization?: {
    id: string
    name: string
    slug?: string | null
  }
  users: OrgSummaryUser[]
  departments: OrgSummaryDepartment[]
  roles: OrgSummaryRole[]
  spaces: OrgSummarySpace[]
}

interface PermissionCatalogItem {
  key: string
  label: string
  description: string
}

interface PermissionCatalogGroup {
  id: string
  label: string
  description: string
  items: PermissionCatalogItem[]
}

const CONFIG_TYPE_META: Record<string, { label: string; color: string }> = {
  CONTRACT_RULE: { label: '合同审核规则', color: 'bg-blue-100 text-blue-800' },
  TAX_RULE: { label: '税率规则', color: 'bg-emerald-100 text-emerald-800' },
  APPROVAL_RULE: { label: '审批权限', color: 'bg-purple-100 text-purple-800' },
  AI_CONFIG: { label: 'AI 配置', color: 'bg-amber-100 text-amber-800' },
  UI_THEME: { label: '界面主题', color: 'bg-cyan-100 text-cyan-800' },
}

const CONFIG_STATUS_META: Record<string, { label: string; className: string }> = {
  DRAFT: { label: '草稿', className: 'bg-slate-100 text-slate-600' },
  PUBLISHED: { label: '已发布', className: 'bg-emerald-100 text-emerald-700' },
  ARCHIVED: { label: '已归档', className: 'bg-gray-100 text-gray-500' },
}

type ConfigTabId = 'price-list' | 'rules' | 'tax' | 'approval' | 'ai' | 'theme' | 'org-structure' | 'role-access'
type ConfigSectionId = 'trading' | 'contract-ai' | 'org-access' | 'experience'

const CONFIG_TABS: Record<ConfigTabId, {
  label: string
  description: string
  section: ConfigSectionId
  icon: React.ComponentType<{ className?: string; size?: number }>
}> = {
  'price-list': {
    label: '价盘与阶梯价',
    description: '配置中心拥有 SKU、基础价、最低价和阶梯价，报价工作台只读消费已发布价格。',
    section: 'trading',
    icon: PackageIcon,
  },
  tax: {
    label: '税率规则',
    description: '统一管理税率、适用地区和结算口径，避免报价与合同口径不一致。',
    section: 'trading',
    icon: PercentIcon,
  },
  approval: {
    label: '审批权限',
    description: '按折扣、金额和合同风险设置审批链，形成交易治理闭环。',
    section: 'trading',
    icon: ShieldCheckIcon,
  },
  rules: {
    label: '合同审核规则',
    description: '管理结构化规则与语义规则，供合同审核与本地模型执行。',
    section: 'contract-ai',
    icon: FileTextIcon,
  },
  'org-structure': {
    label: '组织架构',
    description: '维护部门、成员、销售空间与导入同步入口，作为权限与审批的组织基础。',
    section: 'org-access',
    icon: UsersIcon,
  },
  'role-access': {
    label: '角色权限',
    description: '按业务能力维护角色，并通过组织/部门/销售空间分配数据范围。',
    section: 'org-access',
    icon: KeyRoundIcon,
  },
  ai: {
    label: 'AI 模型配置',
    description: '管理本地模型、云端 OpenAI 兼容模型和运行时路由策略。',
    section: 'contract-ai',
    icon: BotIcon,
  },
  theme: {
    label: '界面主题',
    description: '控制运行时主题变量与视觉发布，确保业务界面一致可控。',
    section: 'experience',
    icon: PaletteIcon,
  },
}

const CONFIG_SECTIONS: Array<{
  id: ConfigSectionId
  label: string
  description: string
  tabs: ConfigTabId[]
}> = [
  {
    id: 'trading',
    label: '交易配置',
    description: '围绕报价工作台的价盘、税率和审批配置。',
    tabs: ['price-list', 'tax', 'approval'],
  },
  {
    id: 'contract-ai',
    label: '合同与 AI 规则',
    description: '围绕合同审核规则、模型路由和运行时策略的配置集。',
    tabs: ['rules', 'ai'],
  },
  {
    id: 'org-access',
    label: '组织与权限',
    description: '围绕部门、成员、角色能力和作用域分配的组织控制面。',
    tabs: ['org-structure', 'role-access'],
  },
  {
    id: 'experience',
    label: '界面与体验',
    description: '运行时主题和界面变量集中配置发布。',
    tabs: ['theme'],
  },
]

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

const DATA_SCOPE_LEVELS = [
  {
    key: 'OWN',
    label: '仅本人',
    description: '只能查看和处理自己负责的业务对象。',
  },
  {
    key: 'DEPT',
    label: '本部门',
    description: '可查看所在部门及其下级部门的业务数据。',
  },
  {
    key: 'SPACE',
    label: '销售空间',
    description: '可查看被分配的销售空间数据。',
  },
  {
    key: 'ORG',
    label: '全组织',
    description: '可查看组织范围内全部业务数据。',
  },
]

export default function ConfigsPage() {
  const [rules, setRules] = useState<Rule[]>([])
  const [configs, setConfigs] = useState<Config[]>([])
  const [products, setProducts] = useState<ProductRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<ConfigTabId>('price-list')
  const [tabReady, setTabReady] = useState(false)

  // Rule dialog
  const [isRuleEditOpen, setIsRuleEditOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<Partial<Rule> | null>(null)

  // Config dialog
  const [isConfigEditOpen, setIsConfigEditOpen] = useState(false)
  const [editingConfig, setEditingConfig] = useState<Partial<Config> | null>(null)
  const [configType, setConfigType] = useState<Config['type']>('TAX_RULE')

  // Product / price list dialog
  const [isProductEditOpen, setIsProductEditOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Partial<ProductRecord> | null>(null)

  // Version dialog
  const [isVersionOpen, setIsVersionOpen] = useState(false)
  const [versions, setVersions] = useState<Array<{ version: number; status: string; created_at: string }>>([])
  const [versionConfigId, setVersionConfigId] = useState<string | null>(null)

  // 角色权限（Tab: roles）
  const [roles, setRoles] = useState<Array<{
    id: string; code: string; name: string; description: string | null
    permissions: string[] | null; sort_order: number | null
  }>>([])
  const [savingRoleId, setSavingRoleId] = useState<string | null>(null)
  const [feishuSyncing, setFeishuSyncing] = useState(false)
  const [feishuResult, setFeishuResult] = useState<string>('')
  const [orgSummary, setOrgSummary] = useState<OrgSummaryPayload | null>(null)

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    const tab = searchParams.get('tab')
    if (tab && tab in CONFIG_TABS) {
      setActiveTab(tab as ConfigTabId)
    }
    setTabReady(true)
    fetchData()
  }, [])

  useEffect(() => {
    if (!tabReady) return
    const url = new URL(window.location.href)
    url.searchParams.set('tab', activeTab)
    window.history.replaceState({}, '', url)
  }, [activeTab, tabReady])

  async function fetchData() {
    setLoading(true)
    setError('')
    try {
      const token = localStorage.getItem('token')
      const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {}

      const [rulesRes, configsRes, rolesRes, productsRes, orgRes] = await Promise.all([
        fetch('/api/rules', { headers }),
        fetch('/api/configs', { headers }),
        fetch('/api/roles', { headers }),
        fetch('/api/products', { headers }),
        fetch('/api/admin/org', { headers }),
      ])

      if (rulesRes.ok) {
        const rulesData = await rulesRes.json()
        setRules(rulesData)
      }

      if (configsRes.ok) {
        const configsData = await configsRes.json()
        setConfigs(configsData)
      }

      if (rolesRes.ok) {
        const rolesData = await rolesRes.json()
        setRoles(rolesData.data?.roles ?? [])
      }

      if (productsRes.ok) {
        const productsData = await productsRes.json()
        setProducts(productsData)
      }

      if (orgRes.ok) {
        const orgData = await orgRes.json()
        setOrgSummary(orgData)
      }
    } catch {
      setError('网络错误')
    } finally {
      setLoading(false)
    }
  }

  const getConfigsByType = useCallback((type: Config['type']) => (
    configs.filter((c) => c.type === type)
  ), [configs])
  const activeSection = CONFIG_TABS[activeTab].section
  const sectionMeta = CONFIG_SECTIONS.find((section) => section.id === activeSection) || CONFIG_SECTIONS[0]
  const sectionTabs = sectionMeta.tabs

  const moduleCounts = useMemo(() => ({
    'price-list': products.length,
    rules: rules.length,
    tax: getConfigsByType('TAX_RULE').length,
    approval: getConfigsByType('APPROVAL_RULE').length,
    ai: getConfigsByType('AI_CONFIG').length,
    theme: getConfigsByType('UI_THEME').length,
    'org-structure': orgSummary?.departments.length ?? 0,
    'role-access': roles.length,
  }), [getConfigsByType, orgSummary?.departments.length, products, rules, roles])

  const activeModuleMetrics = useMemo(() => {
    switch (activeTab) {
      case 'price-list':
        return [
          { label: 'SKU 总数', value: String(products.length) },
          { label: '启用阶梯价', value: String(products.filter((product) => product.tier_pricing_enabled).length) },
          { label: '在售 SKU', value: String(products.filter((product) => product.status === 'active').length) },
        ]
      case 'rules':
        return [
          { label: '规则总数', value: String(rules.length) },
          { label: '启用规则', value: String(rules.filter((rule) => rule.enabled).length) },
          { label: '语义规则', value: String(rules.filter((rule) => rule.rule_type === 'semantic').length) },
        ]
      case 'tax': {
        const taxConfigs = getConfigsByType('TAX_RULE')
        return [
          { label: '税率配置', value: String(taxConfigs.length) },
          { label: '已发布', value: String(taxConfigs.filter((config) => config.status === 'PUBLISHED').length) },
          { label: '草稿', value: String(taxConfigs.filter((config) => config.status === 'DRAFT').length) },
        ]
      }
      case 'approval': {
        const approvalConfigs = getConfigsByType('APPROVAL_RULE')
        return [
          { label: '审批配置', value: String(approvalConfigs.length) },
          { label: '已发布', value: String(approvalConfigs.filter((config) => config.status === 'PUBLISHED').length) },
          { label: '草稿', value: String(approvalConfigs.filter((config) => config.status === 'DRAFT').length) },
        ]
      }
      case 'ai': {
        const aiConfigs = getConfigsByType('AI_CONFIG')
        return [
          { label: '模型档位', value: String(aiConfigs.length) },
          { label: '启用模型', value: String(aiConfigs.filter((config) => config.value?.enabled === true).length) },
          { label: '已发布', value: String(aiConfigs.filter((config) => config.status === 'PUBLISHED').length) },
        ]
      }
      case 'theme': {
        const themeConfigs = getConfigsByType('UI_THEME')
        return [
          { label: '主题方案', value: String(themeConfigs.length) },
          { label: '已发布', value: String(themeConfigs.filter((config) => config.status === 'PUBLISHED').length) },
          { label: '草稿', value: String(themeConfigs.filter((config) => config.status === 'DRAFT').length) },
        ]
      }
      case 'org-structure':
        return [
          { label: '部门总数', value: String(orgSummary?.departments.length ?? 0) },
          { label: '成员总数', value: String(orgSummary?.users.length ?? 0) },
          { label: '销售空间', value: String(orgSummary?.spaces.length ?? 0) },
        ]
      case 'role-access':
        return [
          { label: '角色总数', value: String(roles.length) },
          { label: '能力分组', value: String(PERMISSION_CATALOG.length) },
          { label: '作用域层级', value: String(DATA_SCOPE_LEVELS.length) },
        ]
      default:
        return []
    }
  }, [activeTab, getConfigsByType, orgSummary?.departments.length, orgSummary?.spaces.length, orgSummary?.users.length, products, roles.length, rules])

  function switchSection(sectionId: ConfigSectionId) {
    const nextSection = CONFIG_SECTIONS.find((section) => section.id === sectionId)
    if (!nextSection) return
    setActiveTab(nextSection.tabs[0])
  }

  function renderActivePanel() {
    switch (activeTab) {
      case 'price-list':
        return renderPriceList()
      case 'rules':
        return (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>合同审核规则</CardTitle>
              <Button onClick={openNewRule}>+ 新建规则</Button>
            </CardHeader>
            <CardContent>
              {rules.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-slate-500">暂无规则</p>
                  <p className="text-sm text-slate-400 mt-2">点击上方按钮创建第一条规则</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {rules.map((rule) => (
                    <div key={rule.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium">{rule.name}</span>
                          <Badge variant={rule.enabled ? 'default' : 'secondary'}>
                            {rule.enabled ? '启用' : '停用'}
                          </Badge>
                          <Badge className={riskLevelMap[rule.risk_level]?.className || ''}>
                            {riskLevelMap[rule.risk_level]?.label || rule.risk_level}
                          </Badge>
                        </div>
                        <p className="text-sm text-slate-500">{rule.description || '无描述'}</p>
                        <div className="text-xs text-slate-400 mt-1">{ruleTypeMap[rule.rule_type] || rule.rule_type}</div>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => openEditRule(rule)}>编辑</Button>
                        <Button variant="outline" size="sm" onClick={() => handleDeleteRule(rule.id)}>删除</Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )
      case 'tax':
        return renderTaxRules()
      case 'approval':
        return renderApprovalRules()
      case 'ai':
        return renderAIConfigs()
      case 'theme':
        return renderThemeConfigs()
      case 'org-structure':
        return renderOrgStructurePanel()
      case 'role-access':
        return (
          renderRoleAccessPanel()
        )
      default:
        return null
    }
  }

  // 角色权限：保存单个角色的 permissions
  async function handleSaveRole(roleId: string, newPerms: string[]) {
    setSavingRoleId(roleId)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/roles/${roleId}`, {
        method: 'PATCH',
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ permissions: newPerms }),
      })
      if (res.ok) {
        setRoles((rs) => rs.map((r) => r.id === roleId ? { ...r, permissions: newPerms } : r))
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error || '保存失败')
      }
    } catch {
      setError('网络错误')
    } finally {
      setSavingRoleId(null)
    }
  }

  // 飞书同步（占位：需配置飞书 OAuth 才能真实同步）
  async function handleFeishuSync() {
    if (!confirm('从飞书导入部门结构？现有部门树将保留，source=feishu 的记录会被刷新。')) return
    setFeishuSyncing(true)
    setFeishuResult('')
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/access/feishu/sync', {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })
      const data = await res.json()
      if (res.ok) {
        setFeishuResult(`同步完成：导入 ${data.imported ?? 0} 个部门`)
      } else {
        setFeishuResult(`同步失败：${data.error ?? '未知错误'}`)
      }
    } catch {
      setFeishuResult('网络错误')
    } finally {
      setFeishuSyncing(false)
    }
  }

  // Rule handlers
  async function handleSaveRule() {
    if (!editingRule?.name || !editingRule?.rule_type || !editingRule?.risk_level) {
      return
    }

    try {
      const token = localStorage.getItem('token')
      const isUpdate = 'id' in editingRule && editingRule.id
      const url = isUpdate ? `/api/rules/${editingRule.id}` : '/api/rules'
      const method = isUpdate ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token || ''}`,
        },
        body: JSON.stringify(editingRule),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || '保存失败')
        return
      }

      setIsRuleEditOpen(false)
      setEditingRule(null)
      await fetchData()
    } catch {
      setError('网络错误')
    }
  }

  async function handleDeleteRule(id: string) {
    if (!confirm('确定要删除这条规则吗？')) return

    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/rules/${id}`, {
        method: 'DELETE',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })

      if (!res.ok) {
        setError('删除失败')
        return
      }

      await fetchData()
    } catch {
      setError('网络错误')
    }
  }

  function openNewRule() {
    setEditingRule({
      name: '',
      description: '',
      rule_type: 'structured',
      risk_level: 'yellow',
      enabled: true,
      config: {},
    })
    setIsRuleEditOpen(true)
  }

  function openEditRule(rule: Rule) {
    setEditingRule({ ...rule })
    setIsRuleEditOpen(true)
  }

  // Config handlers
  async function handleSaveConfig() {
    if (!editingConfig?.key || !editingConfig?.name) {
      setError('请填写完整信息')
      return
    }

    try {
      const token = localStorage.getItem('token')
      const isUpdate = 'id' in editingConfig && editingConfig.id
      const url = isUpdate ? `/api/configs/${editingConfig.id}` : '/api/configs'
      const method = isUpdate ? 'PUT' : 'POST'

      const payload = isUpdate
        ? {
            name: editingConfig.name,
            value: editingConfig.value || {},
            description: editingConfig.description,
          }
        : {
            key: editingConfig.key,
            name: editingConfig.name,
            type: configType,
            value: editingConfig.value || getDefaultValue(configType),
            description: editingConfig.description,
          }

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token || ''}`,
        },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || '保存失败')
        return
      }

      setIsConfigEditOpen(false)
      setEditingConfig(null)
      await fetchData()
    } catch {
      setError('网络错误')
    }
  }

  async function handleDeleteConfig(id: string) {
    if (!confirm('确定要删除这个配置吗？')) return

    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/configs/${id}`, {
        method: 'DELETE',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })

      if (!res.ok) {
        setError('删除失败')
        return
      }

      await fetchData()
    } catch {
      setError('网络错误')
    }
  }

  async function handlePublishConfig(id: string) {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/configs/${id}/publish`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || '发布失败')
        return
      }

      await fetchData()
    } catch {
      setError('网络错误')
    }
  }

  async function handleFetchVersions(id: string) {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/configs/${id}/versions`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })

      if (!res.ok) {
        setError('获取版本历史失败')
        return
      }

      const data = await res.json()
      setVersions(data)
      setVersionConfigId(id)
      setIsVersionOpen(true)
    } catch {
      setError('网络错误')
    }
  }

  async function handleRollback(configId: string, version: number) {
    if (!confirm(`确定要回滚到版本 ${version} 吗？回滚后配置将变为草稿状态。`)) return

    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/configs/${configId}/rollback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token || ''}`,
        },
        body: JSON.stringify({ version }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || '回滚失败')
        return
      }

      setIsVersionOpen(false)
      setVersionConfigId(null)
      await fetchData()
    } catch {
      setError('网络错误')
    }
  }

  function openNewConfig(type: Config['type']) {
    setConfigType(type)
    setEditingConfig({
      key: '',
      name: '',
      value: getDefaultValue(type),
      description: '',
    })
    setIsConfigEditOpen(true)
  }

  function openEditConfig(config: Config) {
    setConfigType(config.type)
    setEditingConfig({ ...config })
    setIsConfigEditOpen(true)
  }

  function getDefaultValue(type: Config['type']): Record<string, unknown> {
    switch (type) {
      case 'TAX_RULE':
        return { rate: 0.13, category: '货物销售', enabled: true }
      case 'APPROVAL_RULE':
        return { rule_type: 'discount', thresholds: [{ limit: 5, approver_role: 'auto', enabled: true }] }
      case 'AI_CONFIG':
        return {
          level: 1,
          name: '新模型',
          profile: 'local_primary',
          provider_kind: 'openai_compatible',
          base_url: '',
          model: '',
          timeout_ms: 45000,
          enabled: true,
          routing: { max_pages: 15, strategy: 'full' },
        }
      case 'CONTRACT_RULE':
        return { pattern: '', field: '', operator: 'gt', value: 0 }
      case 'UI_THEME':
        return { ...DEFAULT_THEME }
      default:
        return {}
    }
  }

  function openNewProduct() {
    setEditingProduct({
      code: '',
      name: '',
      specification: '',
      unit: '',
      base_price: 0,
      cost_price: 0,
      min_price: 0,
      tier_pricing_enabled: false,
      status: 'active',
      product_price_tiers: [],
    })
    setIsProductEditOpen(true)
  }

  function openEditProduct(product: ProductRecord) {
    setEditingProduct({
      ...product,
      product_price_tiers: [...(product.product_price_tiers || [])].sort((left, right) => (
        (left.sort_order || 0) - (right.sort_order || 0)
      )),
    })
    setIsProductEditOpen(true)
  }

  async function handleSaveProduct() {
    if (!editingProduct?.name || !editingProduct?.code) {
      setError('请填写 SKU 编码和名称')
      return
    }

    try {
      const token = localStorage.getItem('token')
      const isUpdate = Boolean(editingProduct.id)
      const res = await fetch(isUpdate ? `/api/products/${editingProduct.id}` : '/api/products', {
        method: isUpdate ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token || ''}`,
        },
        body: JSON.stringify({
          code: editingProduct.code,
          name: editingProduct.name,
          specification: editingProduct.specification || '',
          unit: editingProduct.unit || '',
          base_price: Number(editingProduct.base_price || 0),
          cost_price: Number(editingProduct.cost_price || 0),
          min_price: Number(editingProduct.min_price || 0),
          tier_pricing_enabled: Boolean(editingProduct.tier_pricing_enabled),
          status: editingProduct.status || 'active',
          tiers: (editingProduct.product_price_tiers || []).map((tier, index) => ({
            ...tier,
            qty_to: tier.qty_to ?? null,
            sort_order: tier.sort_order ?? index,
          })),
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || '保存 SKU 失败')
        return
      }

      setIsProductEditOpen(false)
      setEditingProduct(null)
      await fetchData()
    } catch {
      setError('网络错误')
    }
  }

  async function handleDeleteProduct(id: string) {
    if (!confirm('确定删除这个 SKU 吗？对应阶梯价也会一起删除。')) return

    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/products/${id}`, {
        method: 'DELETE',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || '删除 SKU 失败')
        return
      }

      await fetchData()
    } catch {
      setError('网络错误')
    }
  }

  // Render functions
  function renderTaxRules() {
    const taxConfigs = getConfigsByType('TAX_RULE')

    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>税率规则配置</CardTitle>
          <Button onClick={() => openNewConfig('TAX_RULE')}>+ 新增税率</Button>
        </CardHeader>
        <CardContent>
          {taxConfigs.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-slate-500">暂无税率规则</p>
              <p className="text-sm text-slate-400 mt-2">点击上方按钮创建第一条税率配置</p>
            </div>
          ) : (
            <div className="rounded-md border divide-y">
              {taxConfigs.map((config) => (
                <div key={config.id} className="flex items-center justify-between px-4 py-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900">{config.name}</span>
                      <ConfigStatusBadge status={config.status} />
                      {config.value?.enabled === true && (
                        <Badge variant="outline" className="bg-emerald-50 text-emerald-700">启用</Badge>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {config.key} · {(config.value?.category as string) || '通用'}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-mono font-semibold text-slate-700">
                      {((config.value?.rate as number) * 100).toFixed(0)}%
                    </span>
                    <Button variant="outline" size="sm" onClick={() => openEditConfig(config)}>编辑</Button>
                    {config.status !== 'PUBLISHED' && (
                      <Button variant="outline" size="sm" onClick={() => handlePublishConfig(config.id)}>发布</Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => handleFetchVersions(config.id)}>版本</Button>
                    <Button variant="outline" size="sm" className="text-red-600" onClick={() => handleDeleteConfig(config.id)}>删除</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  function renderApprovalRules() {
    const approvalConfigs = getConfigsByType('APPROVAL_RULE')

    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>审批权限配置</CardTitle>
          <Button onClick={() => openNewConfig('APPROVAL_RULE')}>+ 新增规则</Button>
        </CardHeader>
        <CardContent>
          {approvalConfigs.map((config) => (
            <div key={config.id} className="mb-6 last:mb-0">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-900">{config.name}</span>
                  <ConfigStatusBadge status={config.status} />
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => openEditConfig(config)}>编辑</Button>
                  {config.status !== 'PUBLISHED' && (
                    <Button variant="outline" size="sm" onClick={() => handlePublishConfig(config.id)}>发布</Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => handleFetchVersions(config.id)}>版本</Button>
                  <Button variant="outline" size="sm" className="text-red-600" onClick={() => handleDeleteConfig(config.id)}>删除</Button>
                </div>
              </div>

              <div className="rounded-md border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium text-slate-700">序号</th>
                      <th className="text-left px-4 py-2 font-medium text-slate-700">阈值条件</th>
                      <th className="text-left px-4 py-2 font-medium text-slate-700">审批角色</th>
                      <th className="text-left px-4 py-2 font-medium text-slate-700">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(config.value?.thresholds as Array<{ limit: number; approver_role: string; enabled: boolean }>)?.map((t, idx) => (
                      <tr key={idx} className="border-t border-slate-100">
                        <td className="px-4 py-2 font-mono">{idx + 1}</td>
                        <td className="px-4 py-2">
                          {(config.value?.rule_type as string) === 'discount' ? `≤ ${t.limit}%` : `≤ ¥${t.limit.toLocaleString()}`}
                        </td>
                        <td className="px-4 py-2">{t.approver_role}</td>
                        <td className="px-4 py-2">
                          {t.enabled ? (
                            <Badge className="bg-emerald-100 text-emerald-700">启用</Badge>
                          ) : (
                            <Badge variant="secondary">禁用</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {config.description && <p className="text-xs text-slate-500 mt-2">{config.description}</p>}
            </div>
          ))}

          {approvalConfigs.length === 0 && (
            <div className="text-center py-12">
              <p className="text-slate-500">暂无审批权限配置</p>
              <p className="text-sm text-slate-400 mt-2">点击上方按钮创建第一条审批配置</p>
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  function renderAIConfigs() {
    const aiConfigs = getConfigsByType('AI_CONFIG')

    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>AI 模型配置（3级降级链）</CardTitle>
          <Button onClick={() => openNewConfig('AI_CONFIG')}>+ 新增模型</Button>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            {aiConfigs.map((config) => (
              <div key={config.id} className="rounded-lg border p-4">
                <div className="flex items-baseline justify-between mb-3">
                  <div className="text-sm font-semibold text-slate-900">
                    Level {(config.value?.level as number)} · {config.name}
                  </div>
                  <div className="flex gap-1">
                    <ConfigStatusBadge status={config.status} />
                    {config.value?.enabled === true && <Badge className="bg-emerald-100 text-emerald-700">启用</Badge>}
                  </div>
                </div>

                <div className="text-xs text-slate-600 space-y-1.5 mb-4">
                  <div className="truncate">画像: {(config.value?.profile as string) || '未设置'}</div>
                  <div className="truncate">类型: {(config.value?.provider_kind as string) || 'openai_compatible'}</div>
                  <div className="truncate">模型: {config.value?.model as string}</div>
                  <div className="truncate">地址: {(config.value?.base_url as string) || '（内置）'}</div>
                  <div>超时: {(config.value?.timeout_ms as number) / 1000}s</div>
                  {typeof config.value?.api_key === 'string' && config.value.api_key.length > 0 && <div className="font-mono text-slate-400">{config.value.api_key}</div>}
                </div>

                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => openEditConfig(config)}>编辑</Button>
                  {config.status !== 'PUBLISHED' && (
                    <Button variant="outline" size="sm" onClick={() => handlePublishConfig(config.id)}>发布</Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => handleDeleteConfig(config.id)}>删除</Button>
                </div>
              </div>
            ))}
          </div>

          {aiConfigs.length === 0 && (
            <div className="text-center py-12">
              <p className="text-slate-500">暂无 AI 模型配置</p>
              <p className="text-sm text-slate-400 mt-2">点击上方按钮创建第一条 AI 配置</p>
            </div>
          )}

          <div className="rounded-md border mt-4">
            <div className="px-4 py-2 bg-slate-50 border-b text-xs font-medium text-slate-700">路由策略（按文档页数）</div>
            <div className="divide-y">
              {[
                { pages: '≤ 15 页', level: 1, strategy: '整体送入本地' },
                { pages: '15 - 40 页', level: 1, strategy: '分段送入本地' },
                { pages: '> 40 页', level: 2, strategy: '强制云端' },
              ].map((row, idx) => (
                <div key={idx} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span className="font-mono text-slate-700">{row.pages}</span>
                  <span className="text-xs text-slate-500">{row.strategy}</span>
                  <span className="text-xs font-mono bg-blue-50 text-blue-700 px-2 py-0.5 rounded">Level {row.level}</span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  function renderPriceList() {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>价盘与阶梯价</CardTitle>
            <p className="text-sm text-slate-500 mt-1">配置中心拥有 SKU、基础价、最低价和阶梯价；报价中心只读消费。</p>
          </div>
          <Button onClick={openNewProduct}>+ 新增 SKU</Button>
        </CardHeader>
        <CardContent>
          {products.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-slate-500">暂无 SKU</p>
              <p className="text-sm text-slate-400 mt-2">点击上方按钮创建第一条价盘记录</p>
            </div>
          ) : (
            <div className="space-y-4">
              {products.map((product) => (
                <div key={product.id} className="rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900">{product.name}</span>
                          <Badge variant="outline" className="font-mono">{product.code}</Badge>
                          <Badge className={
                            product.status === 'active'
                              ? 'bg-emerald-100 text-emerald-700'
                              : product.status === 'inactive'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-slate-200 text-slate-700'
                          }>
                            {product.status === 'active' ? '在售' : product.status === 'inactive' ? '停售' : '停产'}
                          </Badge>
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {[product.specification, product.unit, product.product_categories?.name].filter(Boolean).join(' · ') || '未设置规格'}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-3 text-sm text-slate-600">
                        <span>基础价 ¥{Number(product.base_price || 0).toLocaleString()}</span>
                        <span>最低价 ¥{Number(product.min_price || 0).toLocaleString()}</span>
                        <span>{product.tier_pricing_enabled ? '已启用阶梯价' : '仅基础价'}</span>
                      </div>

                      {product.product_price_tiers && product.product_price_tiers.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {product.product_price_tiers.map((tier, index) => (
                            <div key={tier.id || index} className="rounded-md border px-2 py-1 text-xs text-slate-700">
                              {tier.qty_to === null ? `${tier.qty_from}+` : `${tier.qty_from}-${tier.qty_to}`} · ¥{tier.unit_price.toLocaleString()}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => openEditProduct(product)}>编辑</Button>
                      <Button variant="outline" size="sm" className="text-red-600" onClick={() => handleDeleteProduct(product.id)}>删除</Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  function renderThemeConfigs() {
    const themeConfigs = getConfigsByType('UI_THEME')

    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>运行时主题</CardTitle>
          <Button onClick={() => openNewConfig('UI_THEME')}>+ 新增主题</Button>
        </CardHeader>
        <CardContent>
          {themeConfigs.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-slate-500">暂无主题配置</p>
              <p className="text-sm text-slate-400 mt-2">发布后，按钮和输入框会在运行时自动应用。</p>
            </div>
          ) : (
            <div className="space-y-4">
              {themeConfigs.map((config) => (
                <div key={config.id} className="rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{config.name}</span>
                        <ConfigStatusBadge status={config.status} />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { label: 'Primary', value: String(config.value?.primary || '') },
                          { label: 'Secondary', value: String(config.value?.secondary || '') },
                          { label: 'Border', value: String(config.value?.border || '') },
                          { label: 'Background', value: String(config.value?.background || '') },
                        ].map((item) => (
                          <div key={item.label} className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
                            <span
                              className="size-3 rounded-sm border"
                              style={{ backgroundColor: item.value }}
                            />
                            <span className="font-mono">{item.label}</span>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-3 text-xs text-slate-500">
                        <span>radius-md: {String(config.value?.radiusMd ?? '')}px</span>
                        <span>radius-lg: {String(config.value?.radiusLg ?? '')}px</span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => openEditConfig(config)}>编辑</Button>
                      {config.status !== 'PUBLISHED' && (
                        <Button variant="outline" size="sm" onClick={() => handlePublishConfig(config.id)}>发布</Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => handleFetchVersions(config.id)}>版本</Button>
                      <Button variant="outline" size="sm" className="text-red-600" onClick={() => handleDeleteConfig(config.id)}>删除</Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  function renderOrgStructurePanel() {
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
              <Button onClick={handleFeishuSync} disabled={feishuSyncing} variant="outline">
                {feishuSyncing ? '同步中...' : '从飞书同步'}
              </Button>
              <Button variant="outline" onClick={() => window.open('/admin/org', '_blank', 'noopener,noreferrer')}>
                打开组织管理后台
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
                          {`${'　'.repeat(department.depth || 0)}${department.name}`}
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
                  <p>组织架构管理负责“部门、成员、空间、同步”，它提供审批链和数据范围的组织基础。</p>
                  <p>合同审核规则只负责“规则内容和生效版本”，不应承载部门树、角色分配或成员导入。</p>
                  <p>因此这里必须作为独立控制面存在，而不是挂在合同规则之下。</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  function renderRoleAccessPanel() {
    const users = orgSummary?.users ?? []
    const departments = orgSummary?.departments ?? []
    const spaces = orgSummary?.spaces ?? []

    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>角色权限模型</CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              后端仍使用权限键执行鉴权，但前台必须以“业务能力 + 数据范围 + 分配对象”表达，而不是直接暴露接口动作码。
            </p>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <span>成员分配、部门/销售空间作用域分配，在真实组织后台维护。</span>
              <Button variant="outline" size="sm" onClick={() => window.open('/admin/org', '_blank', 'noopener,noreferrer')}>
                打开组织管理后台
              </Button>
            </div>
            <div className="grid gap-4 lg:grid-cols-4">
              {DATA_SCOPE_LEVELS.map((scope) => (
                <div key={scope.key} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{scope.key}</div>
                  <div className="mt-2 text-sm font-semibold text-slate-900">{scope.label}</div>
                  <p className="mt-2 text-xs leading-5 text-slate-500">{scope.description}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {roles.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-slate-500">暂无角色</CardContent>
          </Card>
        ) : (
          roles.map((role) => (
            <RoleAccessCard
              key={role.id}
              role={role}
              saving={savingRoleId === role.id}
              onSave={(perms) => handleSaveRole(role.id, perms)}
              users={users}
              departments={departments}
              spaces={spaces}
            />
          ))
        )}
      </div>
    )
  }

  function renderTaxEditForm() {
    const value = editingConfig?.value as { rate?: number; category?: string; enabled?: boolean; region?: string } || {}

    return (
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium">配置键 (Key)</label>
          <Input
            value={editingConfig?.key || ''}
            onChange={(e) => setEditingConfig({ ...editingConfig!, key: e.target.value })}
            placeholder="如: TAX_STANDARD"
            disabled={!!editingConfig?.id}
          />
          <p className="text-xs text-slate-500 mt-1">大写字母+下划线，如 TAX_SERVICE</p>
        </div>
        <div>
          <label className="text-sm font-medium">显示名称</label>
          <Input
            value={editingConfig?.name || ''}
            onChange={(e) => setEditingConfig({ ...editingConfig!, name: e.target.value })}
            placeholder="如: 标准增值税"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">税率 (%)</label>
            <Input
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={(value.rate || 0) * 100}
              onChange={(e) => setEditingConfig({
                ...editingConfig!,
                value: { ...value, rate: parseFloat(e.target.value) / 100 }
              })}
            />
          </div>
          <div>
            <label className="text-sm font-medium">适用类别</label>
            <Input
              value={value.category || ''}
              onChange={(e) => setEditingConfig({
                ...editingConfig!,
                value: { ...value, category: e.target.value }
              })}
              placeholder="如: 货物销售"
            />
          </div>
        </div>
        <div>
          <label className="text-sm font-medium">地区</label>
          <Input
            value={value.region || ''}
            onChange={(e) => setEditingConfig({
              ...editingConfig!,
              value: { ...value, region: e.target.value }
            })}
            placeholder="如: 中国大陆"
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={value.enabled || false}
            onChange={(e) => setEditingConfig({
              ...editingConfig!,
              value: { ...value, enabled: e.target.checked }
            })}
          />
          <span className="text-sm">启用此税率</span>
        </div>
      </div>
    )
  }

  function renderApprovalEditForm() {
    const value = editingConfig?.value as { rule_type?: 'discount' | 'contract'; thresholds?: Array<{ limit: number; approver_role: string; enabled: boolean }> } || {}
    const thresholds = value.thresholds || []

    const updateThreshold = (idx: number, field: string, val: unknown) => {
      const newThresholds = [...thresholds]
      newThresholds[idx] = { ...newThresholds[idx], [field]: val }
      setEditingConfig({ ...editingConfig!, value: { ...value, thresholds: newThresholds } })
    }

    return (
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium">配置键 (Key)</label>
          <Input
            value={editingConfig?.key || ''}
            onChange={(e) => setEditingConfig({ ...editingConfig!, key: e.target.value })}
            placeholder="如: APPROVAL_DISCOUNT"
            disabled={!!editingConfig?.id}
          />
        </div>
        <div>
          <label className="text-sm font-medium">显示名称</label>
          <Input
            value={editingConfig?.name || ''}
            onChange={(e) => setEditingConfig({ ...editingConfig!, name: e.target.value })}
          />
        </div>
        <div>
          <label className="text-sm font-medium">规则类型</label>
          <select
            className="w-full mt-1 p-2 border rounded-md"
            value={value.rule_type || 'discount'}
            onChange={(e) => setEditingConfig({
              ...editingConfig!,
              value: { ...value, rule_type: e.target.value as 'discount' | 'contract' }
            })}
          >
            <option value="discount">折扣审批</option>
            <option value="contract">合同审批</option>
          </select>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium">审批阈值</label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEditingConfig({
                ...editingConfig!,
                value: { ...value, thresholds: [...thresholds, { limit: 10, approver_role: 'auto', enabled: true }] }
              })}
            >+ 添加阈值</Button>
          </div>
          <div className="space-y-2">
            {thresholds.map((t, idx) => (
              <div key={idx} className="flex items-center gap-2 p-2 bg-slate-50 rounded">
                <Input
                  type="number"
                  className="w-20"
                  value={t.limit}
                  onChange={(e) => updateThreshold(idx, 'limit', parseFloat(e.target.value))}
                  placeholder={value.rule_type === 'discount' ? '折扣%' : '金额'}
                />
                <Input
                  className="flex-1"
                  value={t.approver_role}
                  onChange={(e) => updateThreshold(idx, 'approver_role', e.target.value)}
                  placeholder="审批角色，如 sales_manager"
                />
                <input
                  type="checkbox"
                  checked={t.enabled}
                  onChange={(e) => updateThreshold(idx, 'enabled', e.target.checked)}
                  title="启用"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const newThresholds = thresholds.filter((_, i) => i !== idx)
                    setEditingConfig({ ...editingConfig!, value: { ...value, thresholds: newThresholds } })
                  }}
                >×</Button>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  function renderAIEditForm() {
    const value = editingConfig?.value as {
      level?: number; name?: string; profile?: string; provider_kind?: string; base_url?: string; api_key?: string;
      model?: string; timeout_ms?: number; enabled?: boolean;
      routing?: { max_pages?: number; strategy?: string }
    } || {}

    return (
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium">配置键 (Key)</label>
          <Input
            value={editingConfig?.key || ''}
            onChange={(e) => setEditingConfig({ ...editingConfig!, key: e.target.value })}
            placeholder="如: AI_LEVEL_1"
            disabled={!!editingConfig?.id}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">降级等级</label>
            <Input
              type="number"
              min={1}
              max={3}
              value={value.level || 1}
              onChange={(e) => setEditingConfig({
                ...editingConfig!,
                value: { ...value, level: parseInt(e.target.value) }
              })}
            />
          </div>
          <div>
            <label className="text-sm font-medium">显示名称</label>
            <Input
              value={editingConfig?.name || ''}
              onChange={(e) => setEditingConfig({
                ...editingConfig!,
                name: e.target.value,
                value: { ...value, name: e.target.value },
              })}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">运行画像</label>
            <select
              className="w-full mt-1 p-2 border rounded-md"
              value={value.profile || 'local_primary'}
              onChange={(e) => setEditingConfig({
                ...editingConfig!,
                value: { ...value, profile: e.target.value }
              })}
            >
              <option value="local_primary">local_primary</option>
              <option value="cloud_primary">cloud_primary</option>
              <option value="sales_cloud_backup">sales_cloud_backup</option>
              <option value="rule_engine">rule_engine</option>
              <option value="custom">custom</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">Provider 类型</label>
            <select
              className="w-full mt-1 p-2 border rounded-md"
              value={value.provider_kind || 'openai_compatible'}
              onChange={(e) => setEditingConfig({
                ...editingConfig!,
                value: { ...value, provider_kind: e.target.value }
              })}
            >
              <option value="openai_compatible">openai_compatible</option>
              <option value="builtin">builtin</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-sm font-medium">模型标识</label>
          <Input
            value={value.model || ''}
            onChange={(e) => setEditingConfig({
              ...editingConfig!,
              value: { ...value, model: e.target.value }
            })}
            placeholder="如: claude-sonnet, local-model"
          />
        </div>
        <div>
          <label className="text-sm font-medium">API 地址</label>
          <Input
            value={value.base_url || ''}
            onChange={(e) => setEditingConfig({
              ...editingConfig!,
              value: { ...value, base_url: e.target.value }
            })}
            placeholder={value.provider_kind === 'builtin' ? 'builtin 可留空' : '如: http://localhost:1234/v1'}
          />
        </div>
        <div>
          <label className="text-sm font-medium">API Key (可选)</label>
          <Input
            type="password"
            value={value.api_key || ''}
            onChange={(e) => setEditingConfig({
              ...editingConfig!,
              value: { ...value, api_key: e.target.value }
            })}
            placeholder="留空保持现有值"
          />
          <p className="text-xs text-slate-500 mt-1">安全存储，API 返回时脱敏显示</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">超时 (毫秒)</label>
            <Input
              type="number"
              step={1000}
              value={value.timeout_ms || 45000}
              onChange={(e) => setEditingConfig({
                ...editingConfig!,
                value: { ...value, timeout_ms: parseInt(e.target.value) }
              })}
            />
          </div>
          <div>
            <label className="text-sm font-medium">最大页数</label>
            <Input
              type="number"
              value={value.routing?.max_pages || 15}
              onChange={(e) => setEditingConfig({
                ...editingConfig!,
                value: { ...value, routing: { ...value.routing, max_pages: parseInt(e.target.value) } }
              })}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={value.enabled || false}
            onChange={(e) => setEditingConfig({
              ...editingConfig!,
              value: { ...value, enabled: e.target.checked }
            })}
          />
          <span className="text-sm">启用此模型配置</span>
        </div>
      </div>
    )
  }

  function renderThemeEditForm() {
    const value = editingConfig?.value as Record<string, unknown> || { ...DEFAULT_THEME }

    const setThemeField = (field: string, nextValue: string | number) => {
      setEditingConfig({
        ...editingConfig!,
        value: {
          ...value,
          [field]: nextValue,
        },
      })
    }

    const colorFields = [
      { key: 'primary', label: '主按钮背景' },
      { key: 'primaryForeground', label: '主按钮文字' },
      { key: 'secondary', label: '次按钮背景' },
      { key: 'secondaryForeground', label: '次按钮文字' },
      { key: 'background', label: '页面背景' },
      { key: 'foreground', label: '基础文字' },
      { key: 'border', label: '边框' },
      { key: 'input', label: '输入框背景' },
      { key: 'ring', label: '焦点高亮' },
      { key: 'destructive', label: '危险态' },
    ]

    return (
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium">配置键 (Key)</label>
          <Input
            value={editingConfig?.key || ''}
            onChange={(e) => setEditingConfig({ ...editingConfig!, key: e.target.value })}
            placeholder="如: UI_THEME_DEFAULT"
            disabled={!!editingConfig?.id}
          />
        </div>
        <div>
          <label className="text-sm font-medium">显示名称</label>
          <Input
            value={editingConfig?.name || ''}
            onChange={(e) => setEditingConfig({ ...editingConfig!, name: e.target.value })}
            placeholder="如: 蓝色主题"
          />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="text-sm font-medium">品牌名称</label>
            <Input
              value={String(value.brandName || '')}
              onChange={(e) => setThemeField('brandName', e.target.value)}
              placeholder="如: Cyanlog"
            />
          </div>
          <div>
            <label className="text-sm font-medium">品牌简称</label>
            <Input
              value={String(value.brandShortName || '')}
              onChange={(e) => setThemeField('brandShortName', e.target.value)}
              placeholder="如: CY"
            />
          </div>
          <div>
            <label className="text-sm font-medium">浏览器标题</label>
            <Input
              value={String(value.productTitle || '')}
              onChange={(e) => setThemeField('productTitle', e.target.value)}
              placeholder="如: Cyanlog Sales"
            />
          </div>
          <div>
            <label className="text-sm font-medium">侧栏副标题</label>
            <Input
              value={String(value.productSubtitle || '')}
              onChange={(e) => setThemeField('productSubtitle', e.target.value)}
              placeholder="如: 智能销售支撑平台"
            />
          </div>
          <div>
            <label className="text-sm font-medium">登录页标题</label>
            <Input
              value={String(value.loginTitle || '')}
              onChange={(e) => setThemeField('loginTitle', e.target.value)}
              placeholder="如: 企业销售支撑平台"
            />
          </div>
          <div>
            <label className="text-sm font-medium">登录页副标题</label>
            <Input
              value={String(value.loginSubtitle || '')}
              onChange={(e) => setThemeField('loginSubtitle', e.target.value)}
              placeholder="如: 使用企业账号进入工作台首页"
            />
          </div>
          <div>
            <label className="text-sm font-medium">品牌 Logo</label>
            <ImageUpload
              value={String(value.logoUrl || '')}
              onChange={(url) => setThemeField('logoUrl', url)}
              folder="logos"
            />
          </div>
          <div>
            <label className="text-sm font-medium">浏览器 Favicon</label>
            <ImageUpload
              value={String(value.faviconUrl || '')}
              onChange={(url) => setThemeField('faviconUrl', url)}
              folder="favicons"
              accept="image/png,image/x-icon,image/svg+xml"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {colorFields.map((field) => (
            <div key={field.key}>
              <label className="text-sm font-medium">{field.label}</label>
              <div className="mt-1 flex gap-2">
                <Input
                  type="color"
                  className="w-14 p-1"
                  value={String(value[field.key] || '#000000')}
                  onChange={(e) => setThemeField(field.key, e.target.value)}
                />
                <Input
                  value={String(value[field.key] || '')}
                  onChange={(e) => setThemeField(field.key, e.target.value)}
                  placeholder="#2563eb"
                />
              </div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">按钮圆角</label>
            <Input
              type="number"
              min={0}
              max={32}
              value={Number(value.radiusMd ?? 10)}
              onChange={(e) => setThemeField('radiusMd', Number(e.target.value))}
            />
          </div>
          <div>
            <label className="text-sm font-medium">卡片圆角</label>
            <Input
              type="number"
              min={0}
              max={32}
              value={Number(value.radiusLg ?? 16)}
              onChange={(e) => setThemeField('radiusLg', Number(e.target.value))}
            />
          </div>
        </div>
      </div>
    )
  }

  function renderProductEditForm() {
    const product = editingProduct || {}
    const tiers = product.product_price_tiers || []

    const updateTier = (index: number, patch: Partial<ProductPriceTier>) => {
      const nextTiers = [...tiers]
      nextTiers[index] = { ...nextTiers[index], ...patch }
      setEditingProduct({ ...product, product_price_tiers: nextTiers })
    }

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">SKU 编码</label>
            <Input
              value={product.code || ''}
              onChange={(e) => setEditingProduct({ ...product, code: e.target.value })}
              placeholder="如: PROD-001"
            />
          </div>
          <div>
            <label className="text-sm font-medium">SKU 名称</label>
            <Input
              value={product.name || ''}
              onChange={(e) => setEditingProduct({ ...product, name: e.target.value })}
              placeholder="如: 智能合同审核系统"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">规格</label>
            <Input
              value={product.specification || ''}
              onChange={(e) => setEditingProduct({ ...product, specification: e.target.value })}
            />
          </div>
          <div>
            <label className="text-sm font-medium">单位</label>
            <Input
              value={product.unit || ''}
              onChange={(e) => setEditingProduct({ ...product, unit: e.target.value })}
              placeholder="套 / 个 / 月"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="text-sm font-medium">基础价</label>
            <Input
              type="number"
              min={0}
              value={Number(product.base_price || 0)}
              onChange={(e) => setEditingProduct({ ...product, base_price: Number(e.target.value || 0) })}
            />
          </div>
          <div>
            <label className="text-sm font-medium">成本价</label>
            <Input
              type="number"
              min={0}
              value={Number(product.cost_price || 0)}
              onChange={(e) => setEditingProduct({ ...product, cost_price: Number(e.target.value || 0) })}
            />
          </div>
          <div>
            <label className="text-sm font-medium">最低保护价</label>
            <Input
              type="number"
              min={0}
              value={Number(product.min_price || 0)}
              onChange={(e) => setEditingProduct({ ...product, min_price: Number(e.target.value || 0) })}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">状态</label>
            <select
              className="w-full mt-1 p-2 border rounded-md"
              value={product.status || 'active'}
              onChange={(e) => setEditingProduct({ ...product, status: e.target.value as ProductRecord['status'] })}
            >
              <option value="active">在售</option>
              <option value="inactive">停售</option>
              <option value="discontinued">停产</option>
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(product.tier_pricing_enabled)}
                onChange={(e) => setEditingProduct({ ...product, tier_pricing_enabled: e.target.checked })}
              />
              <span>启用阶梯价</span>
            </label>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-sm font-medium">阶梯价</label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEditingProduct({
                ...product,
                tier_pricing_enabled: true,
                product_price_tiers: [...tiers, { qty_from: 1, qty_to: null, unit_price: Number(product.base_price || 0), sort_order: tiers.length }],
              })}
            >
              + 添加阶梯
            </Button>
          </div>
          <div className="space-y-2">
            {tiers.length === 0 ? (
              <div className="rounded-md border border-dashed px-3 py-4 text-sm text-slate-500">
                未配置阶梯价，将使用基础价。
              </div>
            ) : (
              tiers.map((tier, index) => (
                <div key={tier.id || index} className="grid grid-cols-[1fr_1fr_1fr_72px] gap-2 rounded-md bg-slate-50 p-3">
                  <Input
                    type="number"
                    min={1}
                    value={tier.qty_from}
                    onChange={(e) => updateTier(index, { qty_from: Number(e.target.value || 1) })}
                  />
                  <Input
                    type="number"
                    min={2}
                    value={tier.qty_to ?? ''}
                    onChange={(e) => updateTier(index, { qty_to: e.target.value ? Number(e.target.value) : null })}
                    placeholder="留空=无上限"
                  />
                  <Input
                    type="number"
                    min={0}
                    value={tier.unit_price}
                    onChange={(e) => updateTier(index, { unit_price: Number(e.target.value || 0) })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingProduct({
                      ...product,
                      product_price_tiers: tiers.filter((_, tierIndex) => tierIndex !== index),
                    })}
                  >
                    删除
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    )
  }

  if (loading) {
    return <div className="p-8">加载中...</div>
  }

  return (
    <div className="min-h-full bg-slate-50">
      <div className="mx-auto max-w-[1480px] px-6 py-8 lg:px-8">
        <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
              <SettingsIcon size={14} />
              组织级配置工作台
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">配置中心</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-500">
              参考 Apollo 的分层思路，按“配置域 → 配置集 → 发布版本”管理交易、治理、AI 与界面运行时。
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[420px]">
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="text-xs font-medium text-slate-500">生效范围</div>
              <div className="mt-2 text-sm font-semibold text-slate-900">组织级统一发布</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="text-xs font-medium text-slate-500">消费端</div>
              <div className="mt-2 text-sm font-semibold text-slate-900">报价 / 合同 / AI</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="text-xs font-medium text-slate-500">当前配置集</div>
              <div className="mt-2 text-sm font-semibold text-slate-900">{CONFIG_TABS[activeTab].label}</div>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
            <button className="ml-2 underline" onClick={() => setError('')}>清除</button>
          </div>
        )}

        <div className="grid gap-8 xl:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="self-start xl:sticky xl:top-8">
            <div className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="px-3 pb-3 pt-2">
                <div className="text-sm font-semibold text-slate-900">配置域</div>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  把所有配置先归到稳定的业务域，再进入具体配置集编辑。
                </p>
              </div>

              <div className="space-y-2">
                {CONFIG_SECTIONS.map((section) => {
                  const isActiveSection = section.id === activeSection
                  return (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => switchSection(section.id)}
                      className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                        isActiveSection
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-transparent bg-slate-50 text-slate-700 hover:border-slate-200 hover:bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold">{section.label}</div>
                        <div className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          isActiveSection ? 'bg-white/10 text-slate-100' : 'bg-white text-slate-500'
                        }`}>
                          {section.tabs.reduce((total, tab) => total + (moduleCounts[tab] || 0), 0)}
                        </div>
                      </div>
                      <p className={`mt-2 text-xs leading-5 ${
                        isActiveSection ? 'text-slate-300' : 'text-slate-500'
                      }`}>
                        {section.description}
                      </p>
                    </button>
                  )
                })}
              </div>

              <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">结构约束</div>
                <ul className="mt-3 space-y-2 text-xs leading-5 text-slate-600">
                  <li>配置中心只拥有配置，不承载业务执行。</li>
                  <li>报价工作台、合同审核页只读消费已发布配置。</li>
                  <li>配置项需要有版本、状态和作用范围。</li>
                </ul>
              </div>
            </div>
          </aside>

          <main className="min-w-0">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                    <span>配置中心</span>
                    <span>/</span>
                    <span>{sectionMeta.label}</span>
                  </div>
                  <div className="mt-4 flex items-center gap-3">
                    {(() => {
                      const ActiveIcon = CONFIG_TABS[activeTab].icon
                      return (
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-white">
                          <ActiveIcon className="h-5 w-5" />
                        </div>
                      )
                    })()}
                    <div className="min-w-0">
                      <h2 className="text-2xl font-semibold text-slate-950">{CONFIG_TABS[activeTab].label}</h2>
                      <p className="mt-1 max-w-3xl text-sm text-slate-500">{CONFIG_TABS[activeTab].description}</p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[360px]">
                  {activeModuleMetrics.map((metric) => (
                    <div key={metric.label} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="text-xs font-medium text-slate-500">{metric.label}</div>
                      <div className="mt-2 text-lg font-semibold text-slate-900">{metric.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-6 flex flex-wrap gap-2 border-t border-slate-200 pt-6">
                {sectionTabs.map((tabId) => {
                  const meta = CONFIG_TABS[tabId]
                  const TabIcon = meta.icon
                  const isActive = tabId === activeTab

                  return (
                    <button
                      key={tabId}
                      type="button"
                      onClick={() => setActiveTab(tabId)}
                      className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition ${
                        isActive
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
                      }`}
                    >
                      <TabIcon className="h-4 w-4" />
                      <span>{meta.label}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${
                        isActive ? 'bg-white/10 text-slate-100' : 'bg-slate-100 text-slate-500'
                      }`}>
                        {moduleCounts[tabId] || 0}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="mt-6 space-y-6">
              {renderActivePanel()}
            </div>
          </main>
        </div>
      </div>

      {/* Rule Edit Dialog */}
      {editingRule && (
        <Dialog open={isRuleEditOpen} onOpenChange={setIsRuleEditOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingRule.id ? '编辑规则' : '新建规则'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <label className="text-sm font-medium">规则名称</label>
                <Input
                  value={editingRule.name || ''}
                  onChange={(e) => setEditingRule({ ...editingRule, name: e.target.value })}
                  placeholder="如：付款账期检查"
                />
              </div>
              <div>
                <label className="text-sm font-medium">规则描述</label>
                <Textarea
                  value={editingRule.description || ''}
                  onChange={(e) => setEditingRule({ ...editingRule, description: e.target.value })}
                  placeholder="描述这条规则的作用"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">规则类型</label>
                  <select
                    className="w-full mt-1 p-2 border rounded-md"
                    value={editingRule.rule_type}
                    onChange={(e) => setEditingRule({ ...editingRule, rule_type: e.target.value as 'structured' | 'semantic' })}
                  >
                    <option value="structured">结构化规则</option>
                    <option value="semantic">语义规则</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium">风险等级</label>
                  <select
                    className="w-full mt-1 p-2 border rounded-md"
                    value={editingRule.risk_level}
                    onChange={(e) => setEditingRule({ ...editingRule, risk_level: e.target.value as 'red' | 'yellow' | 'green' })}
                  >
                    <option value="red">红灯</option>
                    <option value="yellow">黄灯</option>
                    <option value="green">绿灯</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={editingRule.enabled || false}
                    onChange={(e) => setEditingRule({ ...editingRule, enabled: e.target.checked })}
                  />
                  <span className="text-sm">启用规则</span>
                </label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsRuleEditOpen(false)}>取消</Button>
              <Button onClick={handleSaveRule}>保存</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Config Edit Dialog */}
      {editingConfig && (
        <Dialog open={isConfigEditOpen} onOpenChange={setIsConfigEditOpen}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingConfig.id ? '编辑配置' : `新建${CONFIG_TYPE_META[configType]?.label || '配置'}`}
              </DialogTitle>
            </DialogHeader>

            <div className="py-4">
              {configType === 'TAX_RULE' && renderTaxEditForm()}
              {configType === 'APPROVAL_RULE' && renderApprovalEditForm()}
              {configType === 'AI_CONFIG' && renderAIEditForm()}
              {configType === 'UI_THEME' && renderThemeEditForm()}

              <div className="mt-4">
                <label className="text-sm font-medium">描述</label>
                <Textarea
                  value={editingConfig.description || ''}
                  onChange={(e) => setEditingConfig({ ...editingConfig, description: e.target.value })}
                  placeholder="配置描述（可选）"
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setIsConfigEditOpen(false)}>取消</Button>
              <Button onClick={handleSaveConfig}>保存</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Version Dialog */}
      <Dialog open={isVersionOpen} onOpenChange={setIsVersionOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>版本历史</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            {versions.length === 0 ? (
              <p className="text-center text-slate-500">暂无版本历史</p>
            ) : (
              <div className="space-y-2">
                {versions.map((v) => (
                  <div key={v.version} className="flex items-center justify-between p-3 bg-slate-50 rounded">
                    <div>
                      <div className="font-medium">版本 {v.version}</div>
                      <div className="text-xs text-slate-500">{new Date(v.created_at).toLocaleString()}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <ConfigStatusBadge status={v.status as Config['status']} />
                      <Button variant="outline" size="sm" onClick={() => versionConfigId && handleRollback(versionConfigId, v.version)}>回滚</Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsVersionOpen(false)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {editingProduct && (
        <Dialog open={isProductEditOpen} onOpenChange={setIsProductEditOpen}>
          <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingProduct.id ? '编辑 SKU' : '新建 SKU'}</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              {renderProductEditForm()}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsProductEditOpen(false)}>取消</Button>
              <Button onClick={handleSaveProduct}>保存</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

function ConfigStatusBadge({ status }: { status: Config['status'] }) {
  const meta = CONFIG_STATUS_META[status]
  return <Badge className={meta?.className}>{meta?.label}</Badge>
}

function RoleAccessCard({
  role,
  saving,
  onSave,
  users,
  departments,
  spaces,
}: {
  role: { id: string; code: string; name: string; description: string | null; permissions: string[] | null }
  saving: boolean
  onSave: (perms: string[]) => void
  users: OrgSummaryUser[]
  departments: OrgSummaryDepartment[]
  spaces: OrgSummarySpace[]
}) {
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
                        <div className="mt-2 font-mono text-[11px] text-slate-400">{item.key}</div>
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

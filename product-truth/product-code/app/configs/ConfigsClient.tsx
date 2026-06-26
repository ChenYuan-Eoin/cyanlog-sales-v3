'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import type { ContractPolicyRule } from '@/types/rules'
import {
  BotIcon,
  KeyRoundIcon,
  PaletteIcon,
  PackageIcon,
  PercentIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UsersIcon,
  FileTextIcon,
} from '@/components/icons'
import type { Config, ConfigsInitialData, ProductRecord, ProductPriceTier, OrgSummaryPayload, ConfigTabId, ConfigSectionId, PermissionCatalogGroup, FeishuSyncFeedback } from './types'
import { readBrowserCacheEntry, scopedCacheKey, writeBrowserCache } from '@/lib/browser-cache'
import { loadConfigProductsForCache } from '@/lib/core-page-warmup'
import { DEFAULT_THEME } from '@/lib/ui-theme-shared'
import TabsContent from './tabs/TabsContent'
import ConfigStatusBadge from './tabs/ConfigStatusBadge'
import { confirmAction } from '@/lib/toast'
import {
  buildFeishuErrorFeedback,
  buildFeishuNetworkErrorFeedback,
  buildFeishuSuccessFeedback,
  type FeishuSyncResponse,
} from './feishu-sync-feedback'

function DialogChunkFallback() {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
      加载编辑表单...
    </div>
  )
}

const ProductDialog = dynamic(() => import('./dialogs/ProductDialog'), {
  loading: () => null,
  ssr: false,
})

const TaxEditForm = dynamic(() => import('./dialogs/TaxEditForm'), {
  loading: DialogChunkFallback,
  ssr: false,
})

const ApprovalEditForm = dynamic(() => import('./dialogs/ApprovalEditForm'), {
  loading: DialogChunkFallback,
  ssr: false,
})

const AIEditForm = dynamic(() => import('./dialogs/AIEditForm'), {
  loading: DialogChunkFallback,
  ssr: false,
})

const ThemeEditForm = dynamic(() => import('./dialogs/ThemeEditForm'), {
  loading: DialogChunkFallback,
  ssr: false,
})

const CONFIG_TYPE_META: Record<string, { label: string; color: string }> = {
  CONTRACT_RULE: { label: '合同审核策略', color: 'bg-blue-100 text-blue-800' },
  TAX_RULE: { label: '税率规则', color: 'bg-emerald-100 text-emerald-800' },
  APPROVAL_RULE: { label: '审批权限', color: 'bg-purple-100 text-purple-800' },
  AI_CONFIG: { label: 'AI 配置', color: 'bg-amber-100 text-amber-800' },
  UI_THEME: { label: '界面主题', color: 'bg-cyan-100 text-cyan-800' },
}

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
    label: '合同审核策略',
    description: '管理合同审核策略规则，供合同审核与本地模型执行。',
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

const TAB_CACHE_TTL_MS = 5 * 60 * 1000
const TAB_BACKGROUND_REFRESH_MS = 60 * 1000
const tabDataInflight = new Map<string, Promise<unknown>>()

function loadInflightTabValue<T>(cacheKey: string, loader: () => Promise<T | null>) {
  const existing = tabDataInflight.get(cacheKey) as Promise<T | null> | undefined
  if (existing) return existing

  const request = loader().finally(() => {
    tabDataInflight.delete(cacheKey)
  })
  tabDataInflight.set(cacheKey, request)
  return request
}

type ConfigRoleRecord = {
  id: string
  code: string
  name: string
  description: string | null
  permissions: string[] | null
  sort_order: number | null
}

type ConfigsRouteState = {
  tab?: string | string[]
  ruleId?: string | string[]
  mode?: string | string[]
}

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] || null
  return value || null
}

function normalizeInitialRouteState(routeState?: ConfigsRouteState) {
  let requestedTab = firstParam(routeState?.tab)
  let ruleId = firstParam(routeState?.ruleId)
  let mode = firstParam(routeState?.mode)

  if (!requestedTab && !ruleId && !mode && typeof window !== 'undefined') {
    const searchParams = new URLSearchParams(window.location.search)
    requestedTab = searchParams.get('tab')
    ruleId = searchParams.get('ruleId')
    mode = searchParams.get('mode')
  }

  const tab = requestedTab && requestedTab in CONFIG_TABS
    ? requestedTab as ConfigTabId
    : (ruleId || mode === 'new' ? 'rules' : 'price-list')

  return { tab, ruleId, mode }
}

export default function ConfigsClient({
  initialData,
  orgId: _orgId,
  routeState,
}: {
  initialData?: ConfigsInitialData
  orgId?: string
  routeState?: ConfigsRouteState
}) {
  const [initialSearch] = useState(() => normalizeInitialRouteState(routeState))
  // 优先使用服务端预取的数据，避免客户端重复请求
  const [rules, setRules] = useState<ContractPolicyRule[]>(initialData?.rules || [])
  const [configs, setConfigs] = useState<Config[]>(initialData?.configs || [])
  const [products, setProducts] = useState<ProductRecord[]>(initialData?.products || [])
  const [loading, setLoading] = useState(!initialData)  // 有初始数据则不显示 loading
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<ConfigTabId>(initialSearch.tab)
  const [focusRuleId, setFocusRuleId] = useState<string | null>(initialSearch.ruleId)
  const [ruleMode, setRuleMode] = useState<string | null>(initialSearch.mode)
  const [tabReady, setTabReady] = useState(false)

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
  const [roles, setRoles] = useState<ConfigRoleRecord[]>((initialData?.roles as ConfigRoleRecord[] | undefined) || [])
  const [savingRoleId, setSavingRoleId] = useState<string | null>(null)
  const [feishuSyncing, setFeishuSyncing] = useState(false)
  const [feishuFeedback, setFeishuFeedback] = useState<FeishuSyncFeedback | null>(null)
  const [orgSummary, setOrgSummary] = useState<OrgSummaryPayload | null>(null)
  const [hasInitialData] = useState(() => Boolean(initialData))
  const [loadedTabs, setLoadedTabs] = useState<Set<ConfigTabId>>(new Set(hasInitialData ? ['price-list'] : []))
  const loadedTabsRef = useRef(loadedTabs)
  const loadingTabRef = useRef<ConfigTabId | null>(null) // 防重复请求锁
  // 保持 ref 与 state 同步
  useEffect(() => { loadedTabsRef.current = loadedTabs }, [loadedTabs])

  // 按需加载指定 tab 的数据
  const loadTabData = useCallback(async (tab: ConfigTabId) => {
    // 防重复请求：如果已经在加载该 tab，则跳过
    if (loadingTabRef.current === tab) return
    // 如果已经加载过，则跳过
    if (loadedTabsRef.current.has(tab)) return

    loadingTabRef.current = tab
    setError('')
    try {
      const token = localStorage.getItem('token')
      const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {}
      const cacheKey = scopedCacheKey(token, `configs:${tab}`)
      const cachedEntry = readBrowserCacheEntry<unknown>(cacheKey)
      const cacheAgeMs = cachedEntry ? Date.now() - cachedEntry.savedAt : Number.POSITIVE_INFINITY
      const cached = cacheAgeMs <= TAB_CACHE_TTL_MS ? cachedEntry?.value : null
      let didLoad = Boolean(cached)

      if (cached) {
        switch (tab) {
          case 'price-list':
            setProducts(cached as ProductRecord[])
            break
          case 'rules':
            setRules(cached as ContractPolicyRule[])
            break
          case 'tax':
          case 'approval':
          case 'ai':
          case 'theme':
            setConfigs(cached as Config[])
            break
          case 'role-access':
            setRoles(cached as ConfigRoleRecord[])
            break
          case 'org-structure':
            setOrgSummary(cached as OrgSummaryPayload)
            break
        }
        setLoadedTabs(prev => new Set(prev).add(tab))
        setLoading(false)
      } else {
        setLoading(true)
      }

      const shouldSkipBackgroundRefresh = (
        cached
        && cacheAgeMs < TAB_BACKGROUND_REFRESH_MS
        && tab !== 'org-structure'
        && tab !== 'role-access'
      )
      if (shouldSkipBackgroundRefresh) {
        return
      }

      switch (tab) {
        case 'price-list': {
          // 只加载 products (分页格式)
          const nextProducts = await loadInflightTabValue<ProductRecord[]>(cacheKey, async () => {
            if (token) {
              return (await loadConfigProductsForCache(token) || []) as ProductRecord[]
            }

            const productsRes = await fetch('/api/products?summary=1', { headers })
            if (!productsRes.ok) return null
            const productsJson = await productsRes.json()
            return productsJson.data ?? []
          })
          if (nextProducts) {
            setProducts(nextProducts)
            writeBrowserCache(cacheKey, nextProducts)
            didLoad = true
          }
          break
        }

        case 'rules': {
          // 只加载 rules (分页格式)
          const nextRules = await loadInflightTabValue<ContractPolicyRule[]>(cacheKey, async () => {
            const rulesRes = await fetch('/api/contract-policies/rules', { headers })
            if (!rulesRes.ok) return null
            const rulesJson = await rulesRes.json()
            return rulesJson.data ?? []
          })
          if (nextRules) {
            setRules(nextRules)
            writeBrowserCache(cacheKey, nextRules)
            didLoad = true
          }
          break
        }

        case 'tax':
        case 'approval':
        case 'ai':
        case 'theme': {
          // 这些 tab 共享 configs 数据 (分页格式)
          const nextConfigs = await loadInflightTabValue<Config[]>(cacheKey, async () => {
            const configsRes = await fetch('/api/configs', { headers })
            if (!configsRes.ok) return null
            const configsJson = await configsRes.json()
            return configsJson.data ?? []
          })
          if (nextConfigs) {
            setConfigs(nextConfigs)
            writeBrowserCache(cacheKey, nextConfigs)
            didLoad = true
          }
          break
        }

        case 'role-access': {
          const orgCacheKey = scopedCacheKey(token, 'configs:org-structure')
          const [nextRoles, nextOrgSummary] = await Promise.all([
            loadInflightTabValue<ConfigRoleRecord[]>(cacheKey, async () => {
              const rolesRes = await fetch('/api/roles', { headers })
              if (!rolesRes.ok) return null
              const rolesJson = await rolesRes.json()
              return rolesJson.data?.roles ?? []
            }),
            loadInflightTabValue<OrgSummaryPayload>(orgCacheKey, async () => {
              const orgRes = await fetch('/api/admin/org', { headers, cache: 'no-store' })
              if (!orgRes.ok) return null
              return orgRes.json()
            }),
          ])
          if (nextRoles) {
            setRoles(nextRoles)
            writeBrowserCache(cacheKey, nextRoles)
            didLoad = true
          }
          if (nextOrgSummary) {
            setOrgSummary(nextOrgSummary)
            writeBrowserCache(orgCacheKey, nextOrgSummary)
            setLoadedTabs(prev => new Set(prev).add('org-structure'))
            didLoad = true
          }
          break
        }

        case 'org-structure': {
          // 只加载 org
          const orgData = await loadInflightTabValue<OrgSummaryPayload>(cacheKey, async () => {
            const orgRes = await fetch('/api/admin/org', { headers, cache: 'no-store' })
            if (!orgRes.ok) return null
            return orgRes.json()
          })
          if (orgData) {
            setOrgSummary(orgData)
            writeBrowserCache(cacheKey, orgData)
            didLoad = true
          }
          break
        }
      }

      // 标记该 tab 已加载
      if (didLoad) {
        setLoadedTabs(prev => new Set(prev).add(tab))
      }
    } catch {
      setError('加载失败，请重试')
    } finally {
      setLoading(false)
      // 释放锁
      if (loadingTabRef.current === tab) {
        loadingTabRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    const tab = searchParams.get('tab')
    const nextRuleId = searchParams.get('ruleId')
    const nextMode = searchParams.get('mode')
    if (tab && tab in CONFIG_TABS) {
      setActiveTab(tab as ConfigTabId)
    } else if (nextRuleId || nextMode === 'new') {
      setActiveTab('rules')
    }
    setFocusRuleId(nextRuleId)
    setRuleMode(nextMode)
    setTabReady(true)
    // 按需加载：初始加载当前 tab 数据（如果还没加载过）
    if (!hasInitialData) {
      const initialTab = (tab && tab in CONFIG_TABS)
        ? tab as ConfigTabId
        : (nextRuleId || nextMode === 'new' ? 'rules' : 'price-list')
      // 使用 setTimeout 避免与第二个 useEffect 竞态
      setTimeout(() => {
        if (!loadedTabsRef.current.has(initialTab) && loadingTabRef.current !== initialTab) {
          void loadTabData(initialTab)
        }
      }, 0)
    }
  }, [hasInitialData, loadTabData])

  useEffect(() => {
    if (!tabReady) return
    const url = new URL(window.location.href)
    url.searchParams.set('tab', activeTab)
    if (activeTab !== 'rules') {
      url.searchParams.delete('ruleId')
      url.searchParams.delete('mode')
    }
    window.history.replaceState({}, '', url)
    // 按需加载：切换 tab 时加载对应数据（如果还没加载过，且不在加载中）
    if (!loadedTabsRef.current.has(activeTab) && loadingTabRef.current !== activeTab) {
      void loadTabData(activeTab)
    }
  }, [activeTab, tabReady, loadTabData])

  // 兼容原有调用：全部加载（供刷新按钮等使用）
  async function fetchData() {
    setLoading(true)
    setError('')
    try {
      const token = localStorage.getItem('token')
      const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {}

      const [rulesRes, configsRes, rolesRes, productsRes, orgRes] = await Promise.all([
        fetch('/api/contract-policies/rules', { headers }),
        fetch('/api/configs', { headers }),
        fetch('/api/roles', { headers }),
        fetch('/api/products', { headers }),
        fetch('/api/admin/org', { headers }),
      ])

      if (rulesRes.ok) {
        const rulesJson = await rulesRes.json()
        setRules(rulesJson.data ?? [])
      }

      if (configsRes.ok) {
        const configsJson = await configsRes.json()
        setConfigs(configsJson.data ?? [])
      }

      if (rolesRes.ok) {
        const rolesData = await rolesRes.json()
        setRoles(rolesData.data?.roles ?? [])
      }

      if (productsRes.ok) {
        const productsJson = await productsRes.json()
        setProducts(productsJson.data ?? [])
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

  const refreshOrgSummary = useCallback(async () => {
    const token = localStorage.getItem('token')
    const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {}
    const orgRes = await fetch('/api/admin/org', {
      headers,
      cache: 'no-store',
    })

    if (!orgRes.ok) {
      const data = await orgRes.json().catch(() => ({}))
      setError(typeof data.error === 'string' ? data.error : '组织数据刷新失败')
      return
    }

    const orgData = await orgRes.json()
    setOrgSummary(orgData)
    writeBrowserCache(scopedCacheKey(token, 'configs:org-structure'), orgData)
    setLoadedTabs(prev => new Set(prev).add('org-structure'))
  }, [])

  const getConfigsByType = useCallback((type: Config['type']) => (
    configs.filter((c) => c.type === type)
  ), [configs])
  const activeSection = CONFIG_TABS[activeTab].section
  const sectionMeta = CONFIG_SECTIONS.find((section) => section.id === activeSection) || CONFIG_SECTIONS[0]
  const sectionTabs = sectionMeta.tabs
  const activeTabLoading = loading && !loadedTabs.has(activeTab)

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

  const formatModuleCount = useCallback((tabId: ConfigTabId) => {
    if (activeTabLoading && tabId === activeTab) {
      return '...'
    }
    return String(moduleCounts[tabId] || 0)
  }, [activeTab, activeTabLoading, moduleCounts])

  const formatSectionCount = useCallback((sectionTabs: ConfigTabId[]) => {
    if (activeTabLoading && sectionTabs.includes(activeTab)) {
      return '...'
    }
    return String(sectionTabs.reduce((total, tab) => total + (moduleCounts[tab] || 0), 0))
  }, [activeTab, activeTabLoading, moduleCounts])

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
          { label: '启用规则', value: String(rules.filter((rule) => rule.is_active).length) },
          { label: '语义规则', value: String(rules.filter((rule) => rule.engine_type === 'semantic' || rule.engine_type === 'hybrid').length) },
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
          { label: '部门总数', value: activeTabLoading ? '...' : String(orgSummary?.departments.length ?? 0) },
          { label: '成员总数', value: activeTabLoading ? '...' : String(orgSummary?.users.length ?? 0) },
          { label: '销售空间', value: activeTabLoading ? '...' : String(orgSummary?.spaces.length ?? 0) },
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
  }, [activeTab, activeTabLoading, getConfigsByType, orgSummary?.departments.length, orgSummary?.spaces.length, orgSummary?.users.length, products, roles.length, rules])

  function switchSection(sectionId: ConfigSectionId) {
    const nextSection = CONFIG_SECTIONS.find((section) => section.id === sectionId)
    if (!nextSection) return
    setActiveTab(nextSection.tabs[0])
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

  // 飞书同步：当前 MVP 只同步部门结构，成员导入需单独设计。
  async function handleFeishuSync() {
    if (!await confirmAction('从飞书导入部门结构？现有部门树将保留，source=feishu 的记录会被刷新。本阶段不会导入成员。', { confirmText: '开始导入' })) return
    setFeishuSyncing(true)
    setFeishuFeedback(null)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/access/feishu/sync', {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })
      const data = await res.json().catch(() => ({})) as FeishuSyncResponse
      if (res.ok) {
        await refreshOrgSummary()
        setFeishuFeedback(buildFeishuSuccessFeedback(data))
      } else {
        setFeishuFeedback(buildFeishuErrorFeedback(res.status, data))
      }
    } catch {
      setFeishuFeedback(buildFeishuNetworkErrorFeedback())
    } finally {
      setFeishuSyncing(false)
    }
  }

  async function handleSaveRule(rule: Partial<ContractPolicyRule>, id?: string) {
    if (!rule.code || !rule.name) {
      setError('请填写规则编码和名称')
      return
    }

    try {
      const token = localStorage.getItem('token')
      const isUpdate = Boolean(id)
      const url = isUpdate ? `/api/contract-policies/rules/${id}` : '/api/contract-policies/rules'
      const method = isUpdate ? 'PATCH' : 'POST'
      const payload = {
        code: rule.code,
        name: rule.name,
        description: rule.description || '',
        category: rule.category || 'duration',
        engine_type: rule.engine_type || (rule.category === 'text' ? 'semantic' : 'structured'),
        target_field: rule.target_field || null,
        clause_category: rule.clause_category || null,
        field_hints: rule.field_hints || [],
        semantic_prompt: rule.semantic_prompt || null,
        applicable_scenarios: rule.applicable_scenarios || [],
        scope: rule.scope || 'org',
        level_a_operator: rule.level_a_operator || '<=',
        level_a_threshold: Number(rule.level_a_threshold ?? 30),
        level_a_unit: rule.level_a_unit || 'day',
        level_a_action: rule.level_a_action || 'auto_approve',
        level_b_operator: rule.level_b_operator || '>',
        level_b_threshold: Number(rule.level_b_threshold ?? 90),
        level_b_unit: rule.level_b_unit || 'day',
        level_b_action: rule.level_b_action || 'suggest_counterparty',
        level_b_counterparty: rule.level_b_counterparty || '',
        level_c_operator: rule.level_c_operator || '>',
        level_c_threshold: Number(rule.level_c_threshold ?? 180),
        level_c_unit: rule.level_c_unit || 'day',
        level_c_action: rule.level_c_action || 'block',
        level_c_message: rule.level_c_message || '',
        approval_roles: rule.approval_roles || [],
        priority: Number(rule.priority ?? 100),
        is_active: rule.is_active ?? true,
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

      const refreshed = await fetch('/api/contract-policies/rules', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })
      if (refreshed.ok) {
        const data = await refreshed.json()
        setRules(data.data || [])
      } else {
        await fetchData()
      }
    } catch {
      setError('网络错误')
    }
  }

  async function handleDeleteRule(id: string) {
    if (!await confirmAction('确定要删除这条规则吗？', { confirmText: '删除', danger: true })) return

    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/contract-policies/rules/${id}`, {
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
    if (!await confirmAction('确定要删除这个配置吗？', { confirmText: '删除', danger: true })) return

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
    if (!await confirmAction(`确定要回滚到版本 ${version} 吗？回滚后配置将变为草稿状态。`, { confirmText: '回滚' })) return

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

  async function openEditProduct(product: ProductRecord) {
    // 先打开编辑框加载基础数据
    setEditingProduct({ ...product, product_price_tiers: [] })
    setIsProductEditOpen(true)

    // 按需加载该产品的阶梯价
    if (product.id) {
      try {
        const token = localStorage.getItem('token')
        const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {}
        const res = await fetch(`/api/product-price-tiers?product_id=${product.id}`, { headers })
        if (res.ok) {
          const tiers = await res.json()
          setEditingProduct(prev => prev ? {
            ...prev,
            product_price_tiers: tiers.sort((left: ProductPriceTier, right: ProductPriceTier) =>
              (left.sort_order || 0) - (right.sort_order || 0)
            ),
          } : null)
        }
      } catch {
        // 忽略阶梯价加载失败，用户仍可编辑基础信息
      }
    }
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
    if (!await confirmAction('确定删除这个 SKU 吗？对应阶梯价也会一起删除。', { confirmText: '删除', danger: true })) return

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

  function handleConfigDialogOpenChange(open: boolean) {
    setIsConfigEditOpen(open)
    if (!open) {
      setEditingConfig(null)
    }
  }

  function handleProductDialogOpenChange(open: boolean) {
    setIsProductEditOpen(open)
    if (!open) {
      setEditingProduct(null)
    }
  }

  return (
    <div className="min-h-full bg-slate-50">
      <div className="mx-auto max-w-[1480px] px-4 py-6 pl-14 lg:px-8 lg:pl-8">
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
                          {formatSectionCount(section.tabs)}
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
                        {formatModuleCount(tabId)}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="mt-6 space-y-6">
              <TabsContent
                activeTab={activeTab}
                loading={loading && !loadedTabs.has(activeTab)}
                products={products}
                onNewProduct={openNewProduct}
                onEditProduct={openEditProduct}
                onDeleteProduct={handleDeleteProduct}
                rules={rules}
                focusRuleId={focusRuleId}
                ruleMode={ruleMode}
                onSaveRule={handleSaveRule}
                onDeleteRule={handleDeleteRule}
                configs={configs}
                onNewConfig={openNewConfig}
                onEditConfig={openEditConfig}
                onPublishConfig={handlePublishConfig}
                onFetchVersions={handleFetchVersions}
                onDeleteConfig={handleDeleteConfig}
                orgSummary={orgSummary}
                feishuSyncing={feishuSyncing}
                feishuFeedback={feishuFeedback}
                onFeishuSync={handleFeishuSync}
                onRefreshOrg={refreshOrgSummary}
                roles={roles}
                savingRoleId={savingRoleId}
                onSaveRole={handleSaveRole}
              />
            </div>
          </main>
        </div>
      </div>

      {/* Config Edit Dialog */}
      {editingConfig && (
        <Dialog open={isConfigEditOpen} onOpenChange={handleConfigDialogOpenChange}>
          <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingConfig.id ? '编辑配置' : `新建${CONFIG_TYPE_META[configType]?.label || '配置'}`}
              </DialogTitle>
            </DialogHeader>

            <div className="py-4">
              {configType === 'TAX_RULE' && <TaxEditForm config={editingConfig} onChange={setEditingConfig} />}
              {configType === 'APPROVAL_RULE' && <ApprovalEditForm config={editingConfig} onChange={setEditingConfig} />}
              {configType === 'AI_CONFIG' && <AIEditForm config={editingConfig} onChange={setEditingConfig} />}
              {configType === 'UI_THEME' && <ThemeEditForm config={editingConfig} onChange={setEditingConfig} />}

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
              <Button variant="outline" onClick={() => handleConfigDialogOpenChange(false)}>取消</Button>
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
        <ProductDialog
          product={editingProduct}
          open={isProductEditOpen}
          onOpenChange={handleProductDialogOpenChange}
          onLoadTiers={async (productId) => {
            const token = localStorage.getItem('token')
            const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {}
            const res = await fetch(`/api/product-price-tiers?product_id=${productId}`, { headers })
            if (!res.ok) throw new Error('加载失败')
            return res.json()
          }}
          onSave={handleSaveProduct}
        />
      )}
    </div>
  )
}

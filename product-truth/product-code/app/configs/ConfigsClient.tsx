'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
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
import { isAIRuntimeOverview } from './types'
import { buildRolePermissionDirectory } from './permission-directory'
import type { AIRuntimeOverview, Config, ConfigPublishFeedback, ConfigsInitialData, EditableConfig, ProductRecord, ProductPriceTier, OrgSummaryPayload, ConfigTabId, ConfigSectionId } from './types'
import { deleteBrowserCache, readBrowserCacheEntry, scopedCacheKey, writeBrowserCache } from '@/lib/browser-cache'
import { DEFAULT_THEME } from '@/lib/ui-theme-shared'
import { getAIConfigKind } from '@/lib/configs/ai-config-kind'
import type { AIPlatformAssetKind } from '@/lib/configs/types'
import { groupPlatformConfigRevisions } from './tabs/ai-config-presentation'
import { isMaskedApiKey } from '@/lib/configs/runtime'
import { isResolvedRuleContractComplete } from '@/lib/rules/rule-contract'
import TabsContent from './tabs/TabsContent'
import { isGenericallyAssignableRole } from './tabs/role-assignment-policy'
import { confirmAction } from '@/lib/toast'
import { loadConfigProductsForCache } from '@/lib/core-page-warmup'
import {
  loadOrgRolePermissionSnapshot,
  RolePermissionRequestError,
  saveAndReadOrgRolePermissions,
  type ConfigRoleRecord,
  type OrgRolePermissionSnapshot,
} from '@/lib/org-role-permission-readback'

const ProductDialog = dynamic(() => import('./dialogs/ProductDialog'), {
  loading: () => null,
  ssr: false,
})

const ConfigEditDialog = dynamic(() => import('./dialogs/ConfigEditDialog'), {
  loading: () => null,
  ssr: false,
})

const ConfigVersionDialog = dynamic(() => import('./dialogs/ConfigVersionDialog'), {
  loading: () => null,
  ssr: false,
})

const CONFIG_TABS: Record<ConfigTabId, {
  label: string
  description: string
  section: ConfigSectionId
  icon: React.ComponentType<{ className?: string; size?: number }>
}> = {
  'price-list': {
    label: '价盘与阶梯价',
    description: '维护产品价格和阶梯价。',
    section: 'trading',
    icon: PackageIcon,
  },
  tax: {
    label: '税率规则',
    description: '设置税率及适用地区。',
    section: 'trading',
    icon: PercentIcon,
  },
  approval: {
    label: '审批权限',
    description: '设置折扣、金额和合同风险的审批条件。',
    section: 'trading',
    icon: ShieldCheckIcon,
  },
  rules: {
    label: '合同审核规则',
    description: '按问题分类维护具体规则、属性、判定与处理，并随规则集统一发布。',
    section: 'contract-rules',
    icon: FileTextIcon,
  },
  'org-structure': {
    label: '组织架构',
    description: '维护当前生效的部门和成员，作为权限与审批的组织基础。',
    section: 'org-access',
    icon: UsersIcon,
  },
  integrations: {
    label: '外部系统接入',
    description: '统一管理纷享、飞书等连接，并分别核对目录同步与企业登录能力。',
    section: 'org-access',
    icon: ShieldCheckIcon,
  },
  'role-access': {
    label: '角色权限',
    description: '按业务能力维护角色，并按组织或部门分配数据范围。',
    section: 'org-access',
    icon: KeyRoundIcon,
  },
  ai: {
    label: 'AI 模型与消费',
    description: '管理模型连接、使用范围和备用模型。',
    section: 'ai-platform',
    icon: BotIcon,
  },
  theme: {
    label: '界面主题',
    description: '设置品牌颜色和界面主题。',
    section: 'experience',
    icon: PaletteIcon,
  },
  'business-params': {
    label: '业务参数',
    description: '所有业务数字（门槛/维保/高可用/赠送/税率/有效期等）以参数维护，默认值=现行业务值，改数不改代码。',
    section: 'trading',
    icon: SettingsIcon,
  },
  'product-versions': {
    label: '版本能力矩阵',
    description: '版本×部署×授权×能力标签，选品防呆与算价维度的结构数据。',
    section: 'trading',
    icon: PackageIcon,
  },
  'price-matrix': {
    label: '多维价盘',
    description: '产品×版本×部署×授权×期限×区间；累计刊例价+区间单账号价两口径。',
    section: 'trading',
    icon: PackageIcon,
  },
  'price-matrix-import': {
    label: '价盘导入',
    description: '批量导入价盘行并做数学一致性校验（累计=上档累计+边际×档差），0 失败后落库。',
    section: 'trading',
    icon: PackageIcon,
  },
  'approval-chains': {
    label: '审批链',
    description: '审批链（串行/并行、收口方式、节点指派角色/组织/关系），不绑人名。',
    section: 'trading',
    icon: ShieldCheckIcon,
  },
  'approval-rules': {
    label: '审批规则',
    description: '场景×条件（阈值比较器）→ 审批链；多条命中按优先级取最严。',
    section: 'trading',
    icon: ShieldCheckIcon,
  },
  'field-dictionary': {
    label: '字段字典',
    description: '报价字段即规则：来源/转换/输出分类/是否对外；内部字段永不进输出流。',
    section: 'quote-output',
    icon: FileTextIcon,
  },
  'output-templates': {
    label: '输出模板',
    description: '标准/客户模板管理，模板↔方案属性匹配。',
    section: 'quote-output',
    icon: FileTextIcon,
  },
  'clause-mappings': {
    label: '条款映射',
    description: '方案属性→条款/协议；无对应时输出提示，不静默。',
    section: 'quote-output',
    icon: FileTextIcon,
  },
  'numbering-rules': {
    label: '单号规则',
    description: '编号模板（前缀/日期/流水），唯一可回溯；复用现有 generate_quote_number。',
    section: 'quote-output',
    icon: KeyRoundIcon,
  },
  shipping: {
    label: '寄件连接与账号',
    description: '顺丰、企业微信与公司寄件资料。',
    section: 'shipping',
    icon: PackageIcon,
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
    label: '定价与审批',
    description: '价盘、税率和审批。',
    tabs: ['price-list', 'price-matrix', 'price-matrix-import', 'product-versions', 'business-params', 'approval-chains', 'approval-rules', 'tax', 'approval'],
  },
  {
    id: 'quote-output',
    label: '报价输出',
    description: '报价模板、条款和单号。',
    tabs: ['field-dictionary', 'output-templates', 'clause-mappings', 'numbering-rules'],
  },
  {
    id: 'contract-rules',
    label: '合同规则',
    description: '合同审核规则和问题分类。',
    tabs: ['rules'],
  },
  {
    id: 'shipping',
    label: '寄件配置',
    description: '顺丰连接、月结、寄件地址和表单规则。',
    tabs: ['shipping'],
  },
  {
    id: 'org-access',
    label: '组织与权限',
    description: '部门、成员、外部接入和角色权限。',
    tabs: ['org-structure', 'integrations', 'role-access'],
  },
  {
    id: 'experience',
    label: '品牌与主题',
    description: '品牌颜色和界面主题。',
    tabs: ['theme'],
  },
  {
    id: 'ai-platform',
    label: 'AI 平台',
    description: '模型连接与功能设置。',
    tabs: ['ai'],
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
    key: 'ORG',
    label: '全组织',
    description: '可查看组织范围内全部业务数据。',
  },
]

const TAB_CACHE_TTL_MS = 5 * 60 * 1000
const TAB_BACKGROUND_REFRESH_MS = 60 * 1000
const tabDataInflight = new Map<string, Promise<unknown>>()
const CONFIG_TYPE_BY_TAB: Partial<Record<ConfigTabId, Config['type']>> = {
  tax: 'TAX_RULE',
  approval: 'APPROVAL_RULE',
  ai: 'AI_CONFIG',
  theme: 'UI_THEME',
}

function loadInflightTabValue<T>(cacheKey: string, loader: () => Promise<T | null>) {
  const existing = tabDataInflight.get(cacheKey) as Promise<T | null> | undefined
  if (existing) return existing

  const request = loader().finally(() => {
    tabDataInflight.delete(cacheKey)
  })
  tabDataInflight.set(cacheKey, request)
  return request
}

function clearOrgAccessBrowserCache(token: string | null) {
  deleteBrowserCache(scopedCacheKey(token, 'configs:org-structure'))
  deleteBrowserCache(scopedCacheKey(token, 'configs:role-access'))
}

function preserveUnchangedRolePermissions(roles: ConfigRoleRecord[], currentRoles: ConfigRoleRecord[]): ConfigRoleRecord[] {
  const currentById = new Map(currentRoles.map(role => [role.id, role]))
  return roles.map(role => {
    const current = currentById.get(role.id)
    const previous = current?.permissions
    const next = role.permissions
    if (!previous || !next || current?.permissions_edit_block_reason !== role.permissions_edit_block_reason
      || previous.length !== next.length || !next.every(key => previous.includes(key))) return role
    const previousOwner = current?.owner_shipping_permissions
    const nextOwner = role.owner_shipping_permissions
    const sameOwner = previousOwner && nextOwner && previousOwner.length === nextOwner.length
      && nextOwner.every(key => previousOwner.includes(key))
    return { ...role, permissions: previous, ...(sameOwner ? { owner_shipping_permissions: previousOwner } : {}) }
  })
}

function aiRuntimeCacheKey(token: string | null) {
  return scopedCacheKey(token, 'configs:ai-runtime:v1')
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

function normalizeInitialRouteState(routeState: ConfigsRouteState | undefined, allowedTabs: ReadonlySet<ConfigTabId>, defaultTab: ConfigTabId) {
  let requestedTab = firstParam(routeState?.tab)
  let ruleId = firstParam(routeState?.ruleId)
  let mode = firstParam(routeState?.mode)

  if (!requestedTab && !ruleId && !mode && typeof window !== 'undefined') {
    const searchParams = new URLSearchParams(window.location.search)
    requestedTab = searchParams.get('tab')
    ruleId = searchParams.get('ruleId')
    mode = searchParams.get('mode')
  }

  const tab = requestedTab && allowedTabs.has(requestedTab as ConfigTabId)
    ? requestedTab as ConfigTabId
    : ((ruleId || mode === 'new') && allowedTabs.has('rules') ? 'rules' : defaultTab)

  return { tab, ruleId: tab === 'rules' ? ruleId : null, mode: tab === 'rules' ? mode : null }
}

function getApiErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback

  const data = payload as { error?: unknown; message?: unknown }
  if (typeof data.error === 'string') return data.error
  if (data.error && typeof data.error === 'object') {
    const error = data.error as { message?: unknown }
    if (typeof error.message === 'string') return error.message
  }
  if (typeof data.message === 'string') return data.message
  return fallback
}

async function readResponseErrorMessage(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => null)
  const message = getApiErrorMessage(payload, fallback)
  const reasons = payload && typeof payload === 'object'
    && 'error' in payload && payload.error && typeof payload.error === 'object'
    && 'details' in payload.error && payload.error.details && typeof payload.error.details === 'object'
    && 'reasons' in payload.error.details && Array.isArray(payload.error.details.reasons)
      ? payload.error.details.reasons.filter((reason: unknown): reason is string => typeof reason === 'string')
      : []
  return `${message}${reasons.length > 0 ? ` 原因：${reasons.join('；')}` : ''}（${response.status}）`
}

async function fetchJsonOrThrow<T>(input: RequestInfo | URL, init: RequestInit | undefined, fallback: string): Promise<T> {
  const response = await fetch(input, init)
  if (!response.ok) {
    throw new ConfigsRequestError(await readResponseErrorMessage(response, fallback), response.status)
  }
  return response.json() as Promise<T>
}

class ConfigsRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

function accessDenied(error: unknown): boolean {
  return (error instanceof ConfigsRequestError || error instanceof RolePermissionRequestError)
    && (error.status === 401 || error.status === 403)
}

function requestMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function unwrapListResponse<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[]
  if (payload && typeof payload === 'object') {
    const data = (payload as { data?: unknown }).data
    if (Array.isArray(data)) return data as T[]
  }
  return []
}

function configsEndpointForType(type: Config['type']) {
  return `/api/configs?type=${encodeURIComponent(type)}&limit=100`
}

function mergeConfigsByType(current: Config[], type: Config['type'], nextConfigs: Config[]) {
  const normalizedNext = nextConfigs.filter((config) => config.type === type)
  return [
    ...current.filter((config) => config.type !== type),
    ...normalizedNext,
  ]
}

type ConfigsClientProps = {
  initialData?: ConfigsInitialData
  orgId?: string
  routeState?: ConfigsRouteState
  tabAccess?: ConfigsTabAccess
}

export interface ConfigsTabAccess {
  general: boolean
  organization: boolean
  integrations: boolean
  roles: boolean
  shipping: boolean
}

function getVisibleConfigSections(tabAccess?: ConfigsTabAccess) {
  if (!tabAccess) return CONFIG_SECTIONS
  const organizationTabs = {
    'org-structure': tabAccess.organization,
    integrations: tabAccess.integrations,
    'role-access': tabAccess.roles,
  }
  return CONFIG_SECTIONS.flatMap(section => {
    if (section.id === 'shipping') return tabAccess.shipping ? [section] : []
    if (section.id !== 'org-access') return tabAccess.general ? [section] : []
    const tabs = section.tabs.filter(tab => tab in organizationTabs && organizationTabs[tab as keyof typeof organizationTabs])
    if (!tabs.length) return []
    if (tabs.length === section.tabs.length) return [section]
    return [{ ...section, tabs, description: tabs.map(tab => CONFIG_TABS[tab].label).join('、') + '。' }]
  })
}

export default function ConfigsClient({ initialData, routeState, tabAccess }: ConfigsClientProps) {
  const visibleSections = useMemo(() => getVisibleConfigSections(tabAccess), [tabAccess])
  const allowedTabs = useMemo(() => new Set(visibleSections.flatMap(section => section.tabs)), [visibleSections])
  const defaultTab = visibleSections[0]?.tabs[0] ?? 'price-list'
  const [initialSearch] = useState(() => normalizeInitialRouteState(routeState, allowedTabs, defaultTab))
  // 优先使用服务端预取的数据，避免客户端重复请求
  const [rules, setRules] = useState<ContractPolicyRule[]>(initialData?.rules || [])
  const [configs, setConfigs] = useState<Config[]>(initialData?.configs || [])
  const [aiRuntimeOverview, setAiRuntimeOverview] = useState<AIRuntimeOverview | null>(() => (
    isAIRuntimeOverview(initialData?.aiRuntimePolicy) ? initialData.aiRuntimePolicy : null
  ))
  const [aiRuntimeError, setAiRuntimeError] = useState('')
  const [products, setProducts] = useState<ProductRecord[]>(initialData?.products || [])
  const [loading, setLoading] = useState(!initialData)  // 有初始数据则不显示 loading
  const [error, setError] = useState('')
  const [requestedTab, setActiveTab] = useState<ConfigTabId>(initialSearch.tab)
  const activeTab = allowedTabs.has(requestedTab) ? requestedTab : defaultTab
  const [focusRuleId, setFocusRuleId] = useState<string | null>(initialSearch.ruleId)
  const [ruleMode, setRuleMode] = useState<string | null>(initialSearch.mode)
  const [tabReady, setTabReady] = useState(false)

  // Config dialog
  const [isConfigEditOpen, setIsConfigEditOpen] = useState(false)
  const [editingConfig, setEditingConfig] = useState<EditableConfig | null>(null)
  const [configType, setConfigType] = useState<Config['type']>('TAX_RULE')
  const [configDialogError, setConfigDialogError] = useState('')
  const [isSavingConfig, setIsSavingConfig] = useState(false)
  const configSaveInFlightRef = useRef(false)
  const [publishingConfigIds, setPublishingConfigIds] = useState<Set<string>>(new Set())
  const [configPublishFeedback, setConfigPublishFeedback] = useState<Record<string, ConfigPublishFeedback | undefined>>({})
  const publishingConfigIdsRef = useRef(new Set<string>())

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
  const roleSaveRef = useRef(false)
  const roleRequestEpochRef = useRef(0)
  const roleViewRef = useRef<{ orgId: string; token: string | null } | null>(null)
  const orgRequestEpochRef = useRef(0)
  const [orgSummary, setOrgSummary] = useState<OrgSummaryPayload | null>(null)
  const [roleAuthority, setRoleAuthority] = useState<Omit<OrgRolePermissionSnapshot, 'roles'> | null>(null)
  const [roleLoadError, setRoleLoadError] = useState<string | null>(null)
  const permissionsEditable = roleAuthority?.permissionsEditable === true
  const permissionsEditBlockReason = roleLoadError ?? (roleAuthority
    ? roleAuthority.permissionsEditBlockReason
    : '正在确认当前组织的角色管理权限。')
  const [hasInitialData] = useState(() => Boolean(initialData))
  const [loadedTabs, setLoadedTabs] = useState<Set<ConfigTabId>>(new Set(hasInitialData ? ['price-list'] : []))
  const loadedTabsRef = useRef(loadedTabs)
  const loadingTabRef = useRef<ConfigTabId | null>(null) // 防重复请求锁
  // 保持 ref 与 state 同步
  useEffect(() => { loadedTabsRef.current = loadedTabs }, [loadedTabs])

  const clearRoleView = useCallback(() => {
    roleViewRef.current = null
    setRoleAuthority(null)
    setRoles([])
  }, [])

  const applyRoleSnapshot = useCallback((snapshot: OrgRolePermissionSnapshot, token: string | null, preserveRoleDraft: boolean) => {
    const { roles: nextRoles, ...authority } = snapshot
    const keepBaseline = preserveRoleDraft && roleViewRef.current?.orgId === snapshot.orgId && snapshot.permissionsEditable
    roleViewRef.current = { orgId: snapshot.orgId, token }
    setRoles(current => keepBaseline ? preserveUnchangedRolePermissions(nextRoles, current) : nextRoles)
    setRoleAuthority(authority)
    setRoleLoadError(null)
    setOrgSummary(current => current && current.organization?.id !== snapshot.orgId ? null : current)
  }, [])

  const handleOrgReadFailure = useCallback(() => {
    setOrgSummary(null)
  }, [])

  const handleRoleReadFailure = useCallback((reason: unknown) => {
    clearRoleView()
    setRoleLoadError(requestMessage(reason, '角色权限加载失败，请刷新后重试。'))
  }, [clearRoleView])

  const readOrgSummary = useCallback(async (headers: HeadersInit) => {
    const summary = await fetchJsonOrThrow<OrgSummaryPayload>(
      '/api/admin/org', { headers, cache: 'no-store' }, '组织架构加载失败',
    )
    if (!summary.organization?.id) throw new ConfigsRequestError('无法确认当前组织，请重新载入配置中心。', 409)
    return summary
  }, [])

  const readRoleSnapshot = useCallback(loadOrgRolePermissionSnapshot, [])

  // 按需加载指定 tab 的数据
  const loadTabData = useCallback(async (
    tab: ConfigTabId,
    options?: { force?: boolean; background?: boolean; preserveRoleDraft?: boolean },
  ) => {
    if (!allowedTabs.has(tab)) return
    // 防重复请求：如果已经在加载该 tab，则跳过
    if (loadingTabRef.current === tab && !options?.force) return
    // 如果已经加载过，则跳过
    if (loadedTabsRef.current.has(tab) && !options?.force) return
    // A save already reads its result with fresh authority. Do not replace that
    // readback with an earlier snapshot when the same window regains focus.
    if (options?.preserveRoleDraft && roleSaveRef.current
      && roleViewRef.current?.token === localStorage.getItem('token')) return

    loadingTabRef.current = tab
    if (!options?.background) {
      setError('')
    }
    try {
      const token = localStorage.getItem('token')
      const headers: HeadersInit = token ? { 'Authorization': `Bearer ${token}` } : {}
      const cacheKey = scopedCacheKey(token, `configs:${tab}`)
      const usesOrgAccess = tab === 'role-access' || tab === 'org-structure'
      if (usesOrgAccess) clearOrgAccessBrowserCache(token)
      const cachedEntry = options?.force || usesOrgAccess ? null : readBrowserCacheEntry<unknown>(cacheKey)
      const cacheAgeMs = cachedEntry ? Date.now() - cachedEntry.savedAt : Number.POSITIVE_INFINITY
      const cached = cacheAgeMs <= TAB_CACHE_TTL_MS ? cachedEntry?.value : null
      const runtimeCacheKey = aiRuntimeCacheKey(token)
      const cachedRuntimeEntry = tab === 'ai' && !options?.force
        ? readBrowserCacheEntry<AIRuntimeOverview>(runtimeCacheKey)
        : null
      const runtimeCacheAgeMs = cachedRuntimeEntry ? Date.now() - cachedRuntimeEntry.savedAt : Number.POSITIVE_INFINITY
      const cachedRuntimeOverview = runtimeCacheAgeMs <= TAB_CACHE_TTL_MS
        && isAIRuntimeOverview(cachedRuntimeEntry?.value)
        ? cachedRuntimeEntry.value
        : null
      if (cachedRuntimeEntry && !isAIRuntimeOverview(cachedRuntimeEntry.value)) {
        deleteBrowserCache(runtimeCacheKey)
      }
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
          case 'theme': {
            const configTypeForTab = CONFIG_TYPE_BY_TAB[tab]
            const cachedConfigs = cached as Config[]
            if (configTypeForTab) {
              setConfigs((current) => mergeConfigsByType(current, configTypeForTab, cachedConfigs))
            } else {
              setConfigs(cachedConfigs)
            }
            if (tab === 'ai' && cachedRuntimeOverview) {
              setAiRuntimeOverview(cachedRuntimeOverview)
              setAiRuntimeError('')
            }
            break
          }
        }
        setLoadedTabs(prev => new Set(prev).add(tab))
        if (!options?.background) {
          setLoading(false)
        }
      } else {
        if (!options?.background) {
          setLoading(true)
        }
      }

      const shouldSkipBackgroundRefresh = (
        cached
        && cacheAgeMs < TAB_BACKGROUND_REFRESH_MS
        && (tab !== 'ai' || (cachedRuntimeOverview && runtimeCacheAgeMs < TAB_BACKGROUND_REFRESH_MS))
        && !CONFIG_TYPE_BY_TAB[tab]
        && tab !== 'org-structure'
        && tab !== 'role-access'
        && !options?.force
      )
      if (shouldSkipBackgroundRefresh) {
        return
      }

      switch (tab) {
        case 'price-list': {
          // 只加载 products (分页格式)
          const nextProducts = await loadInflightTabValue<ProductRecord[]>(cacheKey, async () => {
            if (token) {
              const products = await loadConfigProductsForCache(token)
              if (!products) {
                throw new Error('价盘数据加载失败，请检查登录状态或接口权限')
              }
              return products as ProductRecord[]
            }

            const productsJson = await fetchJsonOrThrow<{ data?: ProductRecord[] }>(
              '/api/products?summary=1',
              { headers },
              '价盘数据加载失败'
            )
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
            const rulesJson = await fetchJsonOrThrow<{ data?: ContractPolicyRule[] }>(
              '/api/contract-policies/rules',
              { headers },
              '合同审核规则加载失败'
            )
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
        case 'theme': {
          const configTypeForTab = CONFIG_TYPE_BY_TAB[tab]
          if (!configTypeForTab) {
            throw new Error('配置项类型未定义')
          }
          const nextConfigs = await loadInflightTabValue<Config[]>(cacheKey, async () => {
            const configsJson = await fetchJsonOrThrow<{ data?: Config[] }>(
              configsEndpointForType(configTypeForTab),
              { headers },
              '配置项加载失败'
            )
            return configsJson.data ?? []
          })
          if (nextConfigs) {
            setConfigs((current) => mergeConfigsByType(current, configTypeForTab, nextConfigs))
            writeBrowserCache(cacheKey, nextConfigs)
            didLoad = true
          }
          break
        }

        case 'ai': {
          const configTypeForTab = CONFIG_TYPE_BY_TAB.ai
          if (!configTypeForTab) {
            throw new Error('AI 配置项类型未定义')
          }
          const [configsResult, runtimeResult] = await Promise.allSettled([
            loadInflightTabValue<Config[]>(cacheKey, async () => {
              const configsJson = await fetchJsonOrThrow<{ data?: Config[] }>(
                configsEndpointForType(configTypeForTab),
                { headers },
                '配置项加载失败'
              )
              return configsJson.data ?? []
            }),
            loadInflightTabValue<AIRuntimeOverview>(runtimeCacheKey, async () => {
              const runtimeJson = await fetchJsonOrThrow<{ data?: unknown }>(
                '/api/configs/ai-runtime',
                { headers, cache: 'no-store' },
                'AI 实际执行路线与调用结果加载失败'
              )
              if (!isAIRuntimeOverview(runtimeJson.data)) {
                throw new Error('AI 运行证据结构版本不兼容，请刷新后重试')
              }
              return runtimeJson.data
            }),
          ])

          if (configsResult.status === 'fulfilled' && configsResult.value) {
            const nextConfigs = configsResult.value
            setConfigs((current) => mergeConfigsByType(current, configTypeForTab, nextConfigs))
            writeBrowserCache(cacheKey, nextConfigs)
            didLoad = true
          } else if (configsResult.status === 'rejected') {
            throw configsResult.reason
          }

          if (runtimeResult.status === 'fulfilled' && runtimeResult.value) {
            setAiRuntimeOverview(runtimeResult.value)
            setAiRuntimeError('')
            writeBrowserCache(runtimeCacheKey, runtimeResult.value)
          } else if (runtimeResult.status === 'rejected') {
            setAiRuntimeOverview(null)
            deleteBrowserCache(runtimeCacheKey)
            setAiRuntimeError(runtimeResult.reason instanceof Error
              ? runtimeResult.reason.message
              : 'AI 实际执行路线与调用结果加载失败')
          }
          break
        }

        case 'role-access': {
          const roleEpoch = ++roleRequestEpochRef.current
          const orgEpoch = ++orgRequestEpochRef.current
          const preserveRoleDraft = options?.preserveRoleDraft === true
            && token !== null && roleViewRef.current?.token === token
          if (!preserveRoleDraft) {
            clearRoleView()
            setRoleLoadError(null)
            handleOrgReadFailure()
          }
          const [roleResult, orgResult] = await Promise.allSettled([readRoleSnapshot(headers), readOrgSummary(headers)])
          if (roleEpoch !== roleRequestEpochRef.current || orgEpoch !== orgRequestEpochRef.current) break
          const sessionChanged = token !== localStorage.getItem('token')
          const organizationMismatch = roleResult.status === 'fulfilled' && orgResult.status === 'fulfilled'
            && roleResult.value.orgId !== orgResult.value.organization?.id
          if (sessionChanged || organizationMismatch) {
            const reason = new ConfigsRequestError(sessionChanged
              ? '当前登录会话已变化，请重新载入角色权限。'
              : '当前组织已切换，请刷新后重试。', 409)
            handleRoleReadFailure(reason)
            handleOrgReadFailure()
            setError(reason.message)
            break
          }
          if (roleResult.status === 'fulfilled') {
            applyRoleSnapshot(roleResult.value, token, preserveRoleDraft)
            didLoad = true
          } else {
            handleRoleReadFailure(roleResult.reason)
            setError(requestMessage(roleResult.reason, '角色权限加载失败'))
          }
          if (orgResult.status === 'fulfilled') {
            setOrgSummary(orgResult.value)
            setLoadedTabs(prev => new Set(prev).add('org-structure'))
          } else {
            handleOrgReadFailure()
            if (didLoad) setError(requestMessage(orgResult.reason, '组织架构加载失败'))
          }
          break
        }

        case 'shipping': {
          didLoad = true
          break
        }

        case 'org-structure': {
          const orgEpoch = ++orgRequestEpochRef.current
          setOrgSummary(null)
          try {
            const summary = await readOrgSummary(headers)
            if (orgEpoch !== orgRequestEpochRef.current) break
            const roleView = roleViewRef.current
            if (roleView && (roleView.orgId !== summary.organization?.id || roleView.token !== token)) {
              roleRequestEpochRef.current += 1
              clearRoleView()
            }
            setOrgSummary(summary)
            setRoleAuthority(current => current?.orgId === summary.organization?.id ? current : null)
            didLoad = true
          } catch (error) {
            if (orgEpoch !== orgRequestEpochRef.current) break
            handleOrgReadFailure()
            throw error
          }
          break
        }
      }

      // 标记该 tab 已加载
      if (didLoad) {
        setLoadedTabs(prev => new Set(prev).add(tab))
      }
    } catch (err) {
      if (!options?.background) {
        setError(err instanceof Error ? err.message : '加载失败，请重试')
      }
    } finally {
      if (!options?.background) {
        setLoading(false)
      }
      // 释放锁
      if (loadingTabRef.current === tab) {
        loadingTabRef.current = null
      }
    }
  }, [allowedTabs, applyRoleSnapshot, clearRoleView, handleOrgReadFailure, handleRoleReadFailure, readOrgSummary, readRoleSnapshot])

  const refreshTabData = useCallback(async (tab: ConfigTabId) => {
    const token = localStorage.getItem('token')
    if (tab === 'org-structure' || tab === 'role-access') {
      clearOrgAccessBrowserCache(token)
    } else {
      deleteBrowserCache(scopedCacheKey(token, `configs:${tab}`))
      if (tab === 'ai') {
        deleteBrowserCache(aiRuntimeCacheKey(token))
        setAiRuntimeOverview(null)
        setAiRuntimeError('')
      }
    }

    // A refresh is a data update, not a navigation event. Keep the already
    // rendered tab mounted so its selected RuleSet/category/rule and open test
    // workspace survive saves, test runs and publishes. `force: true` still
    // bypasses the loaded-tab guard and replaces the data when the request
    // completes.
    await loadTabData(tab, { force: true })
  }, [loadTabData])

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    const browserRoute = {
      tab: searchParams.get('tab') ?? undefined,
      ruleId: searchParams.get('ruleId') ?? undefined,
      mode: searchParams.get('mode') ?? undefined,
    }
    const { tab, ruleId, mode } = normalizeInitialRouteState({
      tab: browserRoute.tab ?? routeState?.tab,
      ruleId: browserRoute.ruleId ?? routeState?.ruleId,
      mode: browserRoute.mode ?? routeState?.mode,
    }, allowedTabs, defaultTab)
    setActiveTab(tab)
    setFocusRuleId(ruleId)
    setRuleMode(mode)
    setTabReady(true)
    // 按需加载：初始加载当前 tab 数据（如果还没加载过）
    if (!hasInitialData) {
      // 使用 setTimeout 避免与第二个 useEffect 竞态
      const pending = setTimeout(() => {
        if (!loadedTabsRef.current.has(tab) && loadingTabRef.current !== tab) {
          void loadTabData(tab)
        }
      }, 0)
      return () => clearTimeout(pending)
    }
  }, [allowedTabs, defaultTab, hasInitialData, loadTabData, routeState])

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
    if ((activeTab === 'role-access' || activeTab === 'org-structure') && loadingTabRef.current !== activeTab) {
      void loadTabData(activeTab, { force: true })
    } else if (!loadedTabsRef.current.has(activeTab) && loadingTabRef.current !== activeTab) {
      void loadTabData(activeTab)
    }
  }, [activeTab, tabReady, loadTabData])

  const refreshOrgSummary = useCallback(async () => {
    await loadTabData(allowedTabs.has('role-access') ? 'role-access' : 'org-structure', { force: true })
  }, [allowedTabs, loadTabData])

  useEffect(() => {
    if (activeTab !== 'role-access' && activeTab !== 'org-structure') return
    const revalidate = () => {
      const revalidateRoleDraft = activeTab === 'role-access'
      void loadTabData(activeTab, { force: true, background: revalidateRoleDraft, preserveRoleDraft: revalidateRoleDraft })
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === 'token') void loadTabData(activeTab, { force: true })
    }
    window.addEventListener('focus', revalidate)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('focus', revalidate)
      window.removeEventListener('storage', onStorage)
    }
  }, [activeTab, loadTabData])

  const getConfigsByType = useCallback((type: Config['type']) => (
    configs.filter((c) => c.type === type)
  ), [configs])
  const activeSection = CONFIG_TABS[activeTab].section
  const sectionMeta = visibleSections.find((section) => section.id === activeSection) || CONFIG_SECTIONS[0]
  const sectionTabs = sectionMeta.tabs
  const organizationViewTabs = sectionTabs.filter(tab => tab === 'org-structure' || tab === 'role-access')
  const activeOrganizationView = organizationViewTabs.find(tab => tab === activeTab)
  const activeTabLoading = loading && !loadedTabs.has(activeTab)

  const moduleCounts = useMemo<Record<ConfigTabId, number>>(() => ({
    'price-list': products.length,
    rules: rules.length,
    tax: getConfigsByType('TAX_RULE').length,
    approval: getConfigsByType('APPROVAL_RULE').length,
    ai: groupPlatformConfigRevisions(getConfigsByType('AI_CONFIG')).length,
    theme: getConfigsByType('UI_THEME').length,
    'org-structure': orgSummary?.departments.length ?? 0,
    integrations: 0,
    'role-access': roles.length,
    'business-params': 0,
    'product-versions': 0,
    'price-matrix': 0,
    'price-matrix-import': 0,
    'approval-chains': 0,
    'approval-rules': 0,
    'field-dictionary': 0,
    'output-templates': 0,
    'clause-mappings': 0,
    'numbering-rules': 0,
    shipping: 0,
  }), [getConfigsByType, orgSummary?.departments.length, products, rules, roles])

  const formatModuleCount = useCallback((tabId: ConfigTabId) => {
    if (error && tabId === activeTab && !loadedTabs.has(tabId) && !activeTabLoading) {
      return '!'
    }
    if (activeTabLoading && tabId === activeTab) {
      return '…'
    }
    if (!loadedTabs.has(tabId)) {
      return '…'
    }
    return String(moduleCounts[tabId] || 0)
  }, [activeTab, activeTabLoading, error, loadedTabs, moduleCounts])

  const activeModuleMetrics = useMemo(() => {
    const countValue = (count: number | null) => {
      if (activeTabLoading) return '…'
      if (!loadedTabs.has(activeTab)) return error ? '加载失败' : '…'
      return count === null ? '待核对' : String(count)
    }

    switch (activeTab) {
      case 'price-list':
        return [
          { label: 'SKU 总数', value: countValue(products.length) },
          { label: '启用阶梯价', value: countValue(products.filter((product) => product.tier_pricing_enabled).length) },
          { label: '在售 SKU', value: countValue(products.filter((product) => product.status === 'active').length) },
        ]
      case 'rules':
        return [
          { label: '规则总数', value: countValue(rules.length) },
          { label: '启用规则', value: countValue(rules.filter((rule) => rule.is_active).length) },
          { label: '结构完整', value: countValue(rules.filter(isResolvedRuleContractComplete).length) },
        ]
      case 'tax': {
        const taxConfigs = getConfigsByType('TAX_RULE')
        return [
          { label: '税率配置', value: countValue(taxConfigs.length) },
          { label: '已发布', value: countValue(taxConfigs.filter((config) => config.status === 'PUBLISHED').length) },
          { label: '草稿', value: countValue(taxConfigs.filter((config) => config.status === 'DRAFT').length) },
        ]
      }
      case 'approval': {
        const approvalConfigs = getConfigsByType('APPROVAL_RULE')
        return [
          { label: '审批配置', value: countValue(approvalConfigs.length) },
          { label: '已发布', value: countValue(approvalConfigs.filter((config) => config.status === 'PUBLISHED').length) },
          { label: '草稿', value: countValue(approvalConfigs.filter((config) => config.status === 'DRAFT').length) },
        ]
      }
      case 'ai': {
        // AI configuration is a relationship graph. Raw object counts do not
        // tell administrators whether a business feature is actually usable,
        // so the AI workspace presents plan-derived status instead.
        return []
      }
      case 'theme': {
        const themeConfigs = getConfigsByType('UI_THEME')
        return [
          { label: '主题方案', value: countValue(themeConfigs.length) },
          { label: '已发布', value: countValue(themeConfigs.filter((config) => config.status === 'PUBLISHED').length) },
          { label: '草稿', value: countValue(themeConfigs.filter((config) => config.status === 'DRAFT').length) },
        ]
      }
      case 'org-structure':
        return [
          { label: '部门总数', value: countValue(orgSummary?.departments.length ?? 0) },
          { label: '同步在职', value: countValue(orgSummary?.directory_roster?.status === 'ready' ? orgSummary.directory_roster.members.length : null) },
        ]
      case 'role-access':
        return [
          { label: '角色总数', value: countValue(roles.length) },
          { label: '能力分组', value: String(buildRolePermissionDirectory(roleAuthority?.modulePermissionCatalog).length) },
          { label: '作用域层级', value: String(DATA_SCOPE_LEVELS.length) },
        ]
      default:
        return []
    }
  }, [activeTab, activeTabLoading, error, getConfigsByType, loadedTabs, orgSummary?.departments.length, orgSummary?.directory_roster, products, roleAuthority?.modulePermissionCatalog, roles.length, rules])

  function switchSection(sectionId: ConfigSectionId) {
    const nextSection = visibleSections.find((section) => section.id === sectionId)
    if (!nextSection) return
    setActiveTab(nextSection.tabs[0])
  }


  // 角色权限：保存单个角色的 permissions
  async function handleSaveRole(roleId: string, newPerms: string[], newOwnerPermissions?: string[]) {
    if (roleSaveRef.current) return
    const role = roles.find(candidate => candidate.id === roleId)
    const ownerProjection = role?.owner_shipping_permissions
    const ownerChange = newOwnerPermissions && ownerProjection
      ? { expected: ownerProjection, permissions: newOwnerPermissions } : undefined
    if (!roleAuthority?.permissionsEditable || !role || !isGenericallyAssignableRole(role.code) || !Array.isArray(role.permissions)
      || (newOwnerPermissions && !ownerChange)
      || (role.permissions_edit_block_reason && !(role.code === 'FXIAOKE_BASELINE' && ownerChange))) {
      setError('无法确认当前组织的角色编辑权限，请刷新后重试。')
      return
    }
    const token = localStorage.getItem('token')
    if (roleViewRef.current?.token !== token) {
      void loadTabData('role-access', { force: true })
      return
    }
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {}
    const roleRequestEpoch = ++roleRequestEpochRef.current
    const isCurrentSave = () => {
      if (roleRequestEpoch !== roleRequestEpochRef.current) return false
      if (token === localStorage.getItem('token')) return true
      void loadTabData('role-access', { force: true })
      return false
    }
    roleSaveRef.current = true
    setSavingRoleId(roleId)
    setError('')
    try {
      const { role: verifiedRole, snapshot } = await saveAndReadOrgRolePermissions(headers, {
        orgId: roleAuthority.orgId, roleId, expectedPermissions: role.permissions, permissions: newPerms, ownerChange,
      })
      if (!isCurrentSave()) return
      setRoles(current => current.map(candidate => candidate.id === roleId ? verifiedRole : candidate))
      setRoleAuthority({
        orgId: snapshot.orgId,
        permissionsEditable: snapshot.permissionsEditable,
        modulePermissionCatalog: snapshot.modulePermissionCatalog,
        canAppointSystemSuperAdmin: snapshot.canAppointSystemSuperAdmin,
        permissionsEditBlockReason: snapshot.permissionsEditBlockReason,
      })
      clearOrgAccessBrowserCache(token)
    } catch (error) {
      if (!isCurrentSave()) return
      if (accessDenied(error)) handleRoleReadFailure(error)
      if (error instanceof RolePermissionRequestError && (error.requiresRefresh || error.status === 409)) {
        setRoleAuthority(null)
        setRoleLoadError(error.message)
      }
      setError(requestMessage(error, '角色权限保存失败，请刷新后重试。'))
    } finally {
      roleSaveRef.current = false
      setSavingRoleId(null)
    }
  }

  async function handleSaveRule(rule: Partial<ContractPolicyRule>, id?: string) {
    if (!rule.name) {
      setError('请填写规则名称')
      throw new Error('请填写规则名称')
    }

    try {
      const token = localStorage.getItem('token')
      const isUpdate = Boolean(id)
      const url = isUpdate ? `/api/contract-policies/rules/${id}` : '/api/contract-policies/rules'
      const method = isUpdate ? 'PATCH' : 'POST'
      const payload = {
        // Rule codes are immutable after creation. The PATCH contract is
        // strict and intentionally does not accept `code`, so sending the
        // disabled form value here made every existing-rule save fail before
        // the draft RPC could run.
        ...(!isUpdate ? { code: rule.code } : {}),
        name: rule.name,
        rule_set_id: rule.rule_set_id || null,
        problem_category_id: rule.problem_category_id,
        description: rule.description || '',
        business_domain: rule.business_domain || 'contract_review',
        risk_level: rule.risk_level || 'yellow',
        rule_contract: rule.rule_contract,
        applicable_scenarios: rule.applicable_scenarios || [],
        scope: rule.scope || 'org',
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

      const savedPayload = await res.json().catch(() => ({}))
      if (!res.ok) {
        const message = getApiErrorMessage(savedPayload, '保存失败')
        setError(message)
        throw new Error(message)
      }

      const refreshed = await fetch('/api/contract-policies/rules', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })
      if (refreshed.ok) {
        const data = await refreshed.json()
        const nextRules = data.data || []
        setRules(nextRules)
        writeBrowserCache(scopedCacheKey(token, 'configs:rules'), nextRules)
        setLoadedTabs(prev => new Set(prev).add('rules'))
      } else {
        await refreshTabData('rules')
      }
      return savedPayload?.data as ContractPolicyRule | undefined
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : '网络错误'
      setError(message)
      throw saveError
    }
  }

  async function handleDeleteRule(id: string): Promise<boolean> {
    if (!await confirmAction(
      '停用会先生成规则集草稿；当前线上版本继续生效，直到所属规则集完成测试并统一发布。是否继续？',
      { title: '停用规则', confirmText: '标记待停用', danger: true }
    )) return false

    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/contract-policies/rules/${id}`, {
        method: 'DELETE',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        setError(getApiErrorMessage(payload, '停用规则失败'))
        return false
      }

      await refreshTabData('rules')
      return true
    } catch {
      setError('网络错误')
      return false
    }
  }

  // Config handlers
  async function handleSaveConfig() {
    if (configSaveInFlightRef.current) return
    if (!editingConfig?.key || !editingConfig?.name) {
      setConfigDialogError('请填写配置编号和显示名称。')
      return
    }

    configSaveInFlightRef.current = true
    setIsSavingConfig(true)
    setConfigDialogError('')
    try {
      const token = localStorage.getItem('token')
      const isUpdate = 'id' in editingConfig && editingConfig.id
      const url = isUpdate ? `/api/configs/${editingConfig.id}` : '/api/configs'
      const method = isUpdate ? 'PUT' : 'POST'
      const sanitizedValue = { ...(editingConfig.value || getDefaultValue(configType)) }
      if (typeof sanitizedValue.api_key === 'string' && isMaskedApiKey(sanitizedValue.api_key)) {
        delete sanitizedValue.api_key
      }
      const isProviderRevision = !isUpdate
        && Boolean(editingConfig.revision_source_id)
        && getAIConfigKind(sanitizedValue) === 'provider_connection'
      const credentialAction = sanitizedValue.auth_mode === 'none'
        ? 'clear'
        : typeof sanitizedValue.api_key === 'string' && sanitizedValue.api_key.length > 0
          ? 'replace'
          : editingConfig.credential_action || 'clear'

      const payload = isUpdate
        ? {
            name: editingConfig.name,
            value: sanitizedValue,
            description: editingConfig.description,
          }
        : {
            key: editingConfig.key,
            name: editingConfig.name,
            type: configType,
            value: sanitizedValue,
            description: editingConfig.description,
            ...(isProviderRevision ? {
              revision_source_id: editingConfig.revision_source_id,
              credential_action: credentialAction,
            } : {}),
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
        const data = await res.json().catch(() => ({}))
        setConfigDialogError(getApiErrorMessage(data, '保存失败'))
        return
      }

      setIsConfigEditOpen(false)
      setEditingConfig(null)
      setConfigDialogError('')
      await refreshTabData(activeTab)
    } catch {
      setConfigDialogError('保存请求失败，请检查网络后重试。')
    } finally {
      configSaveInFlightRef.current = false
      setIsSavingConfig(false)
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

      await refreshTabData(activeTab)
    } catch {
      setError('网络错误')
    }
  }

  async function handlePublishConfig(id: string) {
    if (publishingConfigIdsRef.current.has(id)) return
    publishingConfigIdsRef.current.add(id)
    setPublishingConfigIds(new Set(publishingConfigIdsRef.current))
    setConfigPublishFeedback((current) => ({ ...current, [id]: undefined }))
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/configs/${id}/publish`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const message = getApiErrorMessage(data, '发布失败')
        const correctiveMessage = `${message}。请根据该行的依赖检查修正配置后重试。`
        setConfigPublishFeedback((current) => ({
          ...current,
          [id]: { tone: 'error', message: correctiveMessage },
        }))
        setError(correctiveMessage)
        return
      }

      await refreshTabData(activeTab)
      setConfigPublishFeedback((current) => ({
        ...current,
        [id]: { tone: 'success', message: '发布成功，当前版本与依赖关系已更新。' },
      }))
    } catch {
      const message = '发布请求失败，请检查网络连接后重试。'
      setConfigPublishFeedback((current) => ({
        ...current,
        [id]: { tone: 'error', message },
      }))
      setError(message)
    } finally {
      publishingConfigIdsRef.current.delete(id)
      setPublishingConfigIds(new Set(publishingConfigIdsRef.current))
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
      setVersions(unwrapListResponse<{ version: number; status: string; created_at: string }>(data))
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
        setError(getApiErrorMessage(data, '回滚失败'))
        return
      }

      setIsVersionOpen(false)
      setVersionConfigId(null)
      await refreshTabData(activeTab)
    } catch {
      setError('网络错误')
    }
  }

  function openNewConfig(type: Config['type'], aiKind?: AIPlatformAssetKind) {
    const nextValue = getDefaultValue(type, aiKind)
    const aiSuffix = Date.now().toString(36).toUpperCase()
    const assetSuffix = aiSuffix.toLowerCase()
    const aiKeyPrefix: Record<AIPlatformAssetKind, string> = {
      provider_connection: 'AI_PROVIDER',
      model_catalog_entry: 'AI_MODEL',
      ai_application: 'AI_APP',
      business_use_point: 'AI_USE_POINT',
      application_binding: 'AI_BINDING',
      route_policy: 'AI_ROUTE',
    }
    const aiName: Record<AIPlatformAssetKind, string> = {
      provider_connection: '新模型服务',
      model_catalog_entry: '新模型',
      ai_application: '新 AI 能力',
      business_use_point: '新产品功能入口',
      application_binding: '新业务能力选择',
      route_policy: '新模型降级顺序',
    }
    const aiAssetPrefix: Record<AIPlatformAssetKind, string> = {
      provider_connection: 'provider.connection',
      model_catalog_entry: 'model.catalog',
      ai_application: 'application.ai',
      business_use_point: 'business.use-point',
      application_binding: 'binding.application',
      route_policy: 'route.policy',
    }
    if (type === 'AI_CONFIG' && aiKind && aiKind !== 'business_use_point') {
      nextValue.asset_id = `${aiAssetPrefix[aiKind]}.${assetSuffix}`
    }
    setConfigType(type)
    setConfigDialogError('')
    setEditingConfig({
      key: type === 'AI_CONFIG' && aiKind ? `${aiKeyPrefix[aiKind]}_${aiSuffix}` : '',
      name: type === 'AI_CONFIG' && aiKind ? aiName[aiKind] : '',
      value: nextValue,
      description: '',
    })
    setIsConfigEditOpen(true)
  }

  function openEditConfig(config: Config) {
    setConfigType(config.type)
    setConfigDialogError('')
    setEditingConfig({ ...config })
    setIsConfigEditOpen(true)
  }

  function openReviseConfig(config: Config) {
    const { api_key: _discardedSecret, ...safeValue } = config.value
    const isProviderRevision = getAIConfigKind(config.value) === 'provider_connection'
    const canUseProviderRevisionSource = isProviderRevision && config.status !== 'ARCHIVED'
    const canReuseCredential = canUseProviderRevisionSource
      && typeof config.value.api_key === 'string'
      && isMaskedApiKey(config.value.api_key)
    const suffix = Date.now().toString(36).toUpperCase()
    const nextKey = `${config.key}_R${config.version + 1}_${suffix}`.slice(0, 100)
    setConfigType(config.type)
    setConfigDialogError('')
    setEditingConfig({
      key: nextKey,
      name: config.name,
      value: safeValue,
      revision_asset_locked: true,
      description: config.description
        ? `${config.description}（基于 v${config.version} 新建草稿）`
        : `基于 ${config.key} v${config.version} 新建草稿`,
      ...(canUseProviderRevisionSource ? {
        revision_source_id: config.id,
        credential_action: canReuseCredential ? 'reuse' : 'clear',
        credential_reuse_available: canReuseCredential,
      } : {}),
    })
    setIsConfigEditOpen(true)
  }

  function getDefaultValue(type: Config['type'], aiKind: AIPlatformAssetKind = 'provider_connection'): Record<string, unknown> {
    switch (type) {
      case 'TAX_RULE':
        return { rate: 0.13, category: '货物销售', enabled: true }
      case 'APPROVAL_RULE':
        return { rule_type: 'discount', thresholds: [{ limit: 5, approver_role: 'auto', enabled: true }] }
      case 'AI_CONFIG':
        switch (aiKind) {
          case 'provider_connection':
            return {
              schema_version: 'ai-platform.v1',
              kind: aiKind,
              asset_id: '',
              provider_type: 'openai_compatible',
              runtime_location: 'cloud',
              auth_mode: 'none',
              base_url: '',
              connection_timeout_ms: 45000,
              enabled: true,
            }
          case 'model_catalog_entry':
            return {
              schema_version: 'ai-platform.v1',
              kind: aiKind,
              asset_id: '',
              provider_connection_id: '',
              model_id: '',
              capabilities: ['text_generation'],
              enabled: true,
            }
          case 'ai_application':
            return {
              schema_version: 'ai-platform.v1',
              kind: aiKind,
              asset_id: '',
              capabilities: ['text_generation'],
              enabled: true,
            }
          case 'business_use_point':
            return {
              schema_version: 'ai-platform.v1',
              kind: aiKind,
              asset_id: '',
              module_id: '',
              required_capabilities: [],
              enabled: true,
            }
          case 'application_binding':
            return {
              schema_version: 'ai-platform.v1',
              kind: aiKind,
              asset_id: '',
              business_use_point_id: '',
              ai_application_id: '',
              enabled: true,
            }
          case 'route_policy':
            return {
              schema_version: 'ai-platform.v1',
              kind: aiKind,
              asset_id: '',
              ai_application_id: '',
              model_catalog_entry_ids: [],
              strategy: 'ordered_fallback',
              timeout_ms: 120000,
              failure_action: 'manual_review',
              enabled: true,
            }
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
        setError(getApiErrorMessage(data, '保存 SKU 失败'))
        return
      }

      setIsProductEditOpen(false)
      setEditingProduct(null)
      await refreshTabData('price-list')
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
        setError(getApiErrorMessage(data, '删除 SKU 失败'))
        return
      }

      await refreshTabData('price-list')
    } catch {
      setError('网络错误')
    }
  }

  function handleConfigDialogOpenChange(open: boolean) {
    if (!open && configSaveInFlightRef.current) return
    setIsConfigEditOpen(open)
    if (!open) {
      setEditingConfig(null)
      setConfigDialogError('')
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
      <div className="mx-auto max-w-[1480px] px-4 py-4 pl-14 lg:px-8 lg:pl-8 xl:py-6">
        <div className="mb-4 flex flex-col gap-4 xl:mb-8 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-950">配置中心</h1>
          </div>

          <div className={activeTab === 'shipping' ? 'hidden' : 'hidden gap-3 sm:grid-cols-3 xl:grid xl:min-w-[420px]'}>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="text-xs font-medium text-slate-500">生效范围</div>
              <div className="mt-2 text-sm font-semibold text-slate-900">组织级统一发布</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="text-xs font-medium text-slate-500">适用模块</div>
              <div className="mt-2 text-sm font-semibold text-slate-900">报价 / 合同 / 标书</div>
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

        <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)] xl:gap-8">
          <nav aria-label="配置域快捷导航" className="flex gap-2 overflow-x-auto pb-1 xl:hidden">
            {visibleSections.map((section) => {
              const isActiveSection = section.id === activeSection
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => switchSection(section.id)}
                  aria-current={isActiveSection ? 'page' : undefined}
                  className={`min-h-11 shrink-0 rounded-xl border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-600 focus-visible:ring-offset-2 ${
                    isActiveSection
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-700'
                  }`}
                >
                  {section.label}
                </button>
              )
            })}
          </nav>

          <aside className="hidden self-start xl:sticky xl:top-8 xl:block">
            <div className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="px-3 pb-3 pt-2">
                <div className="text-sm font-semibold text-slate-900">应用配置</div>
              </div>

              <div className="space-y-2">
                {visibleSections.map((section) => {
                  const isActiveSection = section.id === activeSection
                  return (
                    <div key={section.id} className={section.id === 'org-access' ? 'border-t border-slate-200 pt-3' : undefined}>
                      {section.id === 'org-access' && <div className="px-3 pb-3 text-sm font-semibold text-slate-900">基础设置</div>}
                      <button
                        type="button"
                        onClick={() => switchSection(section.id)}
                        className={`w-full rounded-2xl border px-4 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-600 focus-visible:ring-offset-2 ${
                          isActiveSection
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-transparent bg-slate-50 text-slate-700 hover:border-slate-200 hover:bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold">{section.label}</div>
                        </div>
                        <p className={`mt-2 text-xs leading-5 ${
                          isActiveSection ? 'text-slate-300' : 'text-slate-500'
                        }`}>
                          {section.description}
                        </p>
                      </button>
                    </div>
                  )
                })}
              </div>


            </div>
          </aside>

          <main className="min-w-0">
            <div className={activeTab === 'shipping' ? 'hidden' : 'rounded-3xl border border-slate-200 bg-white p-4 shadow-sm xl:p-6'}>
              <div className="flex flex-col gap-6 2xl:flex-row 2xl:items-start 2xl:justify-between">
                <div className="min-w-0">
                  <div className="hidden items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-slate-400 xl:flex">
                    <span>配置中心</span>
                    <span>/</span>
                    <span>{sectionMeta.label}</span>
                  </div>
                  <div className="flex items-center gap-3 xl:mt-4">
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

                {activeModuleMetrics.length > 0 && (
                  <div className={`hidden gap-3 xl:grid xl:w-full 2xl:w-auto ${
                    activeModuleMetrics.length === 4
                      ? 'xl:grid-cols-2 2xl:min-w-[520px] 2xl:grid-cols-4'
                      : 'xl:grid-cols-3 2xl:min-w-[360px]'
                  }`}>
                    {activeModuleMetrics.map((metric) => (
                      <div key={metric.label} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <div className="text-xs font-medium text-slate-500">{metric.label}</div>
                        <div className="mt-2 text-lg font-semibold text-slate-900">{metric.value}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-200 pt-4 xl:mt-6 xl:pt-6">
                {organizationViewTabs.length > 0 && (
                  <select
                    aria-label="组织与权限视图"
                    value={activeOrganizationView ?? ''}
                    onChange={event => {
                      const selectedView = organizationViewTabs.find(tab => tab === event.target.value)
                      if (selectedView) setActiveTab(selectedView)
                    }}
                    className={`min-h-10 rounded-full border py-2 pl-4 pr-8 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-600 focus-visible:ring-offset-2 ${
                      activeOrganizationView
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
                    }`}
                  >
                    {!activeOrganizationView && <option value="" disabled hidden>选择视图</option>}
                    {organizationViewTabs.map(tab => (
                      <option key={tab} value={tab} className="bg-white text-slate-900">{tab === 'role-access' ? '角色' : '组织架构'}</option>
                    ))}
                  </select>
                )}
                {sectionTabs.filter(tab => tab !== 'org-structure' && tab !== 'role-access').map((tabId) => {
                  const meta = CONFIG_TABS[tabId]
                  const TabIcon = meta.icon
                  const isActive = tabId === activeTab

                  return (
                    <button
                      key={tabId}
                      type="button"
                      onClick={() => setActiveTab(tabId)}
                      onMouseEnter={() => { void loadTabData(tabId, { background: true }) }}
                      onFocus={() => { void loadTabData(tabId, { background: true }) }}
                      className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-600 focus-visible:ring-offset-2 ${
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
                        {tabId === 'shipping' ? '独立设置' : `${formatModuleCount(tabId)} 项`}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className={activeTab === 'shipping' ? 'space-y-6' : 'mt-6 space-y-6'}>
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
                onRefreshRules={() => refreshTabData('rules')}
                configs={configs}
                aiRuntimeOverview={aiRuntimeOverview}
                aiRuntimeError={aiRuntimeError}
                onNewConfig={openNewConfig}
                onEditConfig={openEditConfig}
                onReviseConfig={openReviseConfig}
                onPublishConfig={handlePublishConfig}
                publishingConfigIds={publishingConfigIds}
                configPublishFeedback={configPublishFeedback}
                onFetchVersions={handleFetchVersions}
                onDeleteConfig={handleDeleteConfig}
                onRefreshConfigs={() => refreshTabData(activeTab)}
                orgSummary={orgSummary}
                onRefreshOrg={refreshOrgSummary}
                onOpenIntegrations={allowedTabs.has('integrations') ? () => setActiveTab('integrations') : undefined}
                roles={roles}
                savingRoleId={savingRoleId}
                permissionsEditable={permissionsEditable}
                modulePermissionCatalog={roleAuthority?.modulePermissionCatalog}
                permissionsEditBlockReason={permissionsEditBlockReason}
                systemSuperAdminAuthority={roleAuthority?.canAppointSystemSuperAdmin && roleAuthority.orgId === orgSummary?.organization?.id
                  ? { orgId: roleAuthority.orgId } : undefined}
                onSaveRole={handleSaveRole}
              />
            </div>
          </main>
        </div>
      </div>

      {editingConfig && (
        <ConfigEditDialog
          open={isConfigEditOpen}
          configType={configType}
          config={editingConfig}
          configs={configs}
          error={configDialogError}
          saving={isSavingConfig}
          onOpenChange={handleConfigDialogOpenChange}
          onConfigChange={(nextConfig) => {
            setConfigDialogError('')
            setEditingConfig(nextConfig)
          }}
          onSave={handleSaveConfig}
        />
      )}

      <ConfigVersionDialog
        open={isVersionOpen}
        versions={versions}
        versionConfigId={versionConfigId}
        onOpenChange={setIsVersionOpen}
        onRollback={handleRollback}
      />

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

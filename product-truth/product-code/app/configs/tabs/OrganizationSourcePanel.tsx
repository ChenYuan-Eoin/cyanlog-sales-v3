'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangleIcon,
  ArrowLeftRightIcon,
  Building2Icon,
  CheckCircle2Icon,
  HistoryIcon,
  LogInIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  Settings2Icon,
  ShieldCheckIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { confirmAction, error, success } from '@/lib/toast'
import type { OrganizationConnectionProvider, ProviderCapability } from '@/lib/organization-connections/types'
import type { DirectoryCutoverClientPlan } from '@/lib/organization-connections/directory-cutover'
import { OrganizationConnectionForm } from './OrganizationConnectionForm'
import { DirectoryInspectionPanel } from './DirectoryInspectionPanel'

type SourceStatus = 'draft' | 'active' | 'disabled'
type SyncMode = 'read_only' | 'authoritative' | 'enrichment'
type ConnectionState = 'unconfigured' | 'configured' | 'verified' | 'failed' | 'disabled'
type DraftCheckStatus = 'not_checked' | 'preview_ready' | 'failed'

type Source = {
  id: string
  provider: string
  externalTenantId: string
  priority: number
  status: SourceStatus
  connectionState: ConnectionState
  connectionRevision: string
  draftCheckStatus: DraftCheckStatus
  authorityScope: Record<string, unknown>
  syncMode: SyncMode
  lastSuccessfulSyncAt: string | null
  lastError: string | null
}

type SourcePayload = {
  sources?: Source[]
  providers?: ProviderCapability[]
  active_primary_source_id?: string | null
}

type OrganizationSourcePanelProps = {
  onRefresh?: () => void | Promise<void>
}

type DirectoryAction = 'preview' | 'apply' | 'rollback' | null
type DirectoryAvailability = { available: boolean; reason: string | null }

function authHeaders(withJson = false): HeadersInit {
  let token: string | null = null
  if (typeof window !== 'undefined') {
    try { token = window.localStorage.getItem('token') } catch { token = null }
  }
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(withJson ? { 'Content-Type': 'application/json' } : {}),
  }
}

function sourceStateLabel(source: Source | undefined) {
  if (!source || source.connectionState === 'unconfigured') return '未配置'
  if (source.connectionState === 'disabled' || source.status === 'disabled') return '已停用'
  if (source.draftCheckStatus === 'failed') {
    return source.connectionState === 'verified' ? '连接已验证 · 目录读取失败' : '连接验证失败'
  }
  if (source.connectionState === 'failed') return '验证失败'
  if (source.connectionState === 'verified') {
    if (source.draftCheckStatus === 'preview_ready') return '连接已验证'
    return '连接已验证 · 新草稿待验证'
  }
  return '连接已保存 · 待验证'
}

function providerBadgeVariant(source: Source | undefined): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (!source || source.connectionState === 'unconfigured') return 'outline'
  if (source.connectionState === 'failed' || source.draftCheckStatus === 'failed') return 'destructive'
  if (source.connectionState === 'verified') return 'default'
  return 'secondary'
}

function methodLabel(method: DirectoryCutoverClientPlan['identityChanges'][number]['matchMethod']) {
  return {
    provider_id: '既有外部身份',
    employee_id: '工号',
    email: '邮箱',
    phone: '手机号',
    manual: '人工绑定',
  }[method]
}

function formatTime(value: string | null | undefined) {
  if (!value) return '—'
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString('zh-CN') : value
}

function Metric({ label, value, tone = 'slate' }: { label: string; value: number; tone?: 'slate' | 'amber' | 'rose' | 'emerald' }) {
  const toneClass = {
    slate: 'text-slate-900',
    amber: 'text-amber-700',
    rose: 'text-rose-700',
    emerald: 'text-emerald-700',
  }[tone]
  return (
    <div className="rounded-md bg-slate-50 px-2.5 py-2">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`mt-0.5 text-base font-semibold ${toneClass}`}>{value}</div>
    </div>
  )
}

export function OrganizationSourcePanel({ onRefresh }: OrganizationSourcePanelProps) {
  const [sources, setSources] = useState<Source[]>([])
  const [providers, setProviders] = useState<ProviderCapability[]>([])
  const [selectedProvider, setSelectedProvider] = useState<OrganizationConnectionProvider | null>(null)
  const selectedProviderRef = useRef<OrganizationConnectionProvider | null>(null)
  const [latestPlan, setLatestPlan] = useState<DirectoryCutoverClientPlan | null>(null)
  const [directoryAvailability, setDirectoryAvailability] = useState<DirectoryAvailability | null>(null)
  const [loading, setLoading] = useState(true)
  const [directoryAction, setDirectoryAction] = useState<DirectoryAction>(null)
  const [inspectionGeneration, setInspectionGeneration] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const sourceResponse = await fetch('/api/admin/organization-sources', { headers: authHeaders(), cache: 'no-store' })
      const sourceBody = await sourceResponse.json().catch(() => ({})) as { data?: SourcePayload; error?: string }
      if (!sourceResponse.ok) throw new Error(sourceBody.error || '组织来源读取失败。')
      const nextSources = sourceBody.data?.sources || []
      const nextProviders = sourceBody.data?.providers || []
      const activeSource = nextSources.find(item => item.status === 'active' && item.priority === 1)
      const currentProvider = selectedProviderRef.current
      const configurableProviderKeys = new Set(
        nextProviders
          .filter(item => item.configurable)
          .map(item => item.key as OrganizationConnectionProvider),
      )
      const activeProvider = activeSource && configurableProviderKeys.has(activeSource.provider as OrganizationConnectionProvider)
        ? activeSource.provider as OrganizationConnectionProvider
        : null
      const preferredProvider = (
        currentProvider
        && configurableProviderKeys.has(currentProvider)
          ? currentProvider
          : activeProvider
            ? activeProvider
            : nextProviders.find(item => item.configurable && item.syncAvailable)?.key
              ?? nextProviders.find(item => item.configurable)?.key
              ?? null
      ) as OrganizationConnectionProvider | null

      setSources(nextSources)
      setProviders(nextProviders)
      setSelectedProvider(preferredProvider)
      selectedProviderRef.current = preferredProvider
      setLatestPlan(null)

      if (preferredProvider) {
        const directoryResponse = await fetch(
          `/api/admin/organization-sources/directory?provider=${encodeURIComponent(preferredProvider)}`,
          { headers: authHeaders(), cache: 'no-store' },
        )
        const directoryBody = await directoryResponse.json().catch(() => ({})) as {
          data?: {
            plan?: DirectoryCutoverClientPlan | null
            directory_cutover?: DirectoryAvailability
          }
          error?: string
        }
        if (!directoryResponse.ok) throw new Error(directoryBody.error || '目录切源状态读取失败。')
        setDirectoryAvailability(directoryBody.data?.directory_cutover || null)
        setLatestPlan(directoryBody.data?.plan || null)
      }
    } catch (readError) {
      error(readError instanceof Error ? readError.message : '组织来源读取失败。')
    } finally {
      setLoading(false)
    }
  }, [])

  async function selectProvider(provider: OrganizationConnectionProvider) {
    selectedProviderRef.current = provider
    setSelectedProvider(provider)
    setLatestPlan(null)
    try {
      const response = await fetch(
        `/api/admin/organization-sources/directory?provider=${encodeURIComponent(provider)}`,
        { headers: authHeaders(), cache: 'no-store' },
      )
      const body = await response.json().catch(() => ({})) as {
        data?: {
          plan?: DirectoryCutoverClientPlan | null
          directory_cutover?: DirectoryAvailability
        }
        error?: string
      }
      if (!response.ok) throw new Error(body.error || '目录切源状态读取失败。')
      setDirectoryAvailability(body.data?.directory_cutover || null)
      setLatestPlan(body.data?.plan || null)
    } catch (readError) {
      error(readError instanceof Error ? readError.message : '目录切源状态读取失败。')
    }
  }

  useEffect(() => {
    void load()
  }, [load])

  async function refreshAll() {
    setInspectionGeneration(value => value + 1)
    await load()
    await onRefresh?.()
  }

  async function previewDirectory() {
    const provider = selectedProviderRef.current
    if (!provider) return
    const providerLabel = providers.find(item => item.key === provider)?.label || provider
    setDirectoryAction('preview')
    try {
      const response = await fetch('/api/admin/organization-sources/directory', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ action: 'preview', provider }),
      })
      const body = await response.json().catch(() => ({})) as {
        data?: { plan?: DirectoryCutoverClientPlan }
        error?: string
      }
      if (!response.ok || !body.data?.plan) throw new Error(body.error || `${providerLabel}目录差异生成失败。`)
      setLatestPlan(body.data.plan)
      success(body.data.plan.applyable ? '目录差异计划已生成，请核对后明确确认。' : '差异计划已生成，但仍有冲突，当前不能切换。')
    } catch (previewError) {
      error(previewError instanceof Error ? previewError.message : `${providerLabel}目录差异生成失败。`)
    } finally {
      setDirectoryAction(null)
    }
  }

  async function applyLatestPlan() {
    if (!latestPlan) return
    const providerLabel = providers.find(item => item.key === latestPlan.provider)?.label || latestPlan.provider
    const accepted = await confirmAction(
      `确认把${providerLabel}切换为唯一组织目录主来源？`
      + `本计划新增 ${latestPlan.summary.departmentsAdded} 个部门、更新 ${latestPlan.summary.identitiesUpdated} 条身份映射，`
      + '旧外部来源与手工部门会保留但不再作为目录主来源。',
      { confirmText: '确认切换目录', danger: true },
    )
    if (!accepted) return
    setDirectoryAction('apply')
    try {
      const response = await fetch('/api/admin/organization-sources/directory', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          action: 'apply',
          plan_id: latestPlan.id,
          plan_hash: latestPlan.planHash,
          connection_revision: latestPlan.connectionRevision,
          source_revisions: latestPlan.sourceRevisions,
        }),
      })
      const body = await response.json().catch(() => ({})) as { data?: { run?: DirectoryCutoverClientPlan['run'] }; error?: string }
      const run = body.data?.run
      if (!response.ok || !run) throw new Error(body.error || '目录主来源切换失败。')
      setLatestPlan(current => current ? {
        ...current,
        status: 'applied',
        appliedAt: run.appliedAt || new Date().toISOString(),
        run,
      } : current)
      success('目录主来源已原子切换；旧目录数据仍保留，可按本次运行回滚。')
      await refreshAll()
    } catch (applyError) {
      error(applyError instanceof Error ? applyError.message : '目录主来源切换失败。')
    } finally {
      setDirectoryAction(null)
    }
  }

  async function rollbackLatestPlan() {
    if (!latestPlan) return
    const accepted = await confirmAction(
      '确认回滚本次目录切源？系统只会在连接、目录和成员关系均未发生后续变化时恢复切换前的精确状态。',
      { confirmText: '确认回滚', danger: true },
    )
    if (!accepted) return
    setDirectoryAction('rollback')
    try {
      const response = await fetch('/api/admin/organization-sources/directory', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ action: 'rollback', plan_id: latestPlan.id }),
      })
      const body = await response.json().catch(() => ({})) as { data?: { run?: DirectoryCutoverClientPlan['run'] }; error?: string }
      const run = body.data?.run
      if (!response.ok || !run) throw new Error(body.error || '目录切源回滚失败。')
      setLatestPlan(current => current ? {
        ...current,
        status: 'rolled_back',
        rolledBackAt: run.rolledBackAt || new Date().toISOString(),
        run,
      } : current)
      success('目录切源已回滚到本次操作前的状态。')
      await refreshAll()
    } catch (rollbackError) {
      error(rollbackError instanceof Error ? rollbackError.message : '目录切源回滚失败。')
    } finally {
      setDirectoryAction(null)
    }
  }

  const selected = selectedProvider
    ? providers.find((item): item is ProviderCapability & { key: OrganizationConnectionProvider } => (
        item.key === selectedProvider && item.configurable
      ))
    : null
  const activePrimary = sources.find(source => source.status === 'active' && source.priority === 1) || null
  const directoryProvider = selectedProvider
  const directorySource = directoryProvider
    ? sources.find(source => source.provider === directoryProvider) || null
    : null
  const directoryCapability = directoryProvider
    ? providers.find(provider => provider.key === directoryProvider) || null
    : null
  const directoryLabel = directoryCapability?.label || directoryProvider || '外部系统'
  const directoryReady = Boolean(
    directorySource
    && directorySource.status !== 'disabled'
    && directorySource.connectionState === 'verified'
    && directoryCapability?.syncAvailable
    && directoryAvailability?.available !== false,
  )
  const identityAuthoritative = Boolean(
    directorySource?.status === 'active'
    && directorySource.connectionState === 'verified'
    && directoryCapability?.ssoAvailable
    && directorySource.authorityScope.identity === 'authoritative',
  )
  const planExpired = Boolean(latestPlan && Date.parse(latestPlan.expiresAt) <= Date.now())
  const canApply = Boolean(
    latestPlan
    && latestPlan.provider === directoryProvider
    && latestPlan.snapshot.scopeVerified
    && latestPlan.status === 'planned'
    && latestPlan.applyable
    && !planExpired
    && directoryAction === null,
  )
  const canRollback = Boolean(
    latestPlan
    && latestPlan.status === 'applied'
    && latestPlan.run?.status === 'applied'
    && directoryAction === null,
  )
  const connectionState = sourceStateLabel(directorySource || undefined)
  const directoryScopeState = !directoryProvider || !directoryCapability?.syncAvailable
    ? '未接入'
    : latestPlan?.snapshot.scopeVerified
      ? `全公司范围已证明 · ${latestPlan.snapshot.departmentCount}/${latestPlan.snapshot.employeeCount}`
      : latestPlan
        ? `授权范围已读取 · ${latestPlan.snapshot.departmentCount}/${latestPlan.snapshot.employeeCount}`
        : directoryReady
          ? '可读取 · 全公司范围未证明'
          : '待连接验证'
  const directoryAuthorityState = !directoryProvider || !directoryCapability?.syncAvailable
    ? '未接入'
    : directorySource?.authorityScope.organization === 'authoritative' && directorySource.status === 'active'
      ? '已生效'
      : latestPlan?.applyable && latestPlan.status === 'planned'
        ? '待显式确认'
        : latestPlan
          ? '计划被阻断'
          : '未切换'
  const ssoState = !directoryCapability?.ssoAvailable
    ? '未接入'
    : identityAuthoritative
      ? '已启用 · 待真人验收'
      : directorySource?.connectionState === 'verified'
        ? '身份权威未启用'
        : '待连接验证'
  const identityConflict = latestPlan?.conflicts.some(item => item.kind.startsWith('identity_'))
  const identityMappingState = !directorySource
    ? '未配置'
    : identityConflict
      ? '映射有冲突 · 寄件授权未验收'
      : latestPlan?.status === 'planned' && latestPlan.identityChanges.length
        ? '映射待确认 · 寄件授权未验收'
        : latestPlan?.status === 'applied'
          ? '本次映射已应用 · 寄件授权未验收'
          : latestPlan?.status === 'rolled_back'
            ? '映射已回滚 · 寄件授权未验收'
            : '待目录差异计划 · 寄件授权未验收'
  const capabilityBadge = (ready: boolean) => ready ? 'default' as const : 'secondary' as const

  return (
    <div className="rounded-lg border bg-white p-4">
      <div>
        <h3 className="font-medium text-slate-900">外部系统接入</h3>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          每个提供方只有一张连接记录；下列五项能力分别证明、分别启停、分别验收。
        </p>
      </div>

      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2" aria-label="接入能力状态">
        <div className="mb-1 text-[11px] font-medium text-slate-500">
          当前查看：{directoryLabel}
        </div>
        <div className="divide-y divide-slate-200">
          <div className="flex items-center justify-between gap-3 py-1.5">
            <span className="flex min-w-0 items-center gap-2 text-xs text-slate-700">
              <Settings2Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span>连接凭据</span>
            </span>
            <Badge variant={capabilityBadge(Boolean(directorySource?.connectionState === 'verified'))}>{connectionState}</Badge>
          </div>
          <div className="flex items-center justify-between gap-3 py-1.5">
            <span className="flex min-w-0 items-center gap-2 text-xs text-slate-700">
              <Building2Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span>目录读取范围</span>
            </span>
            <Badge variant={capabilityBadge(Boolean(latestPlan?.snapshot.scopeVerified))}>{directoryScopeState}</Badge>
          </div>
          <div className="flex items-center justify-between gap-3 py-1.5">
            <span className="flex min-w-0 items-center gap-2 text-xs text-slate-700">
              <ArrowLeftRightIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span>目录主来源</span>
            </span>
            <Badge variant={capabilityBadge(Boolean(directorySource?.authorityScope.organization === 'authoritative' && directorySource.status === 'active'))}>{directoryAuthorityState}</Badge>
          </div>
          <div className="flex items-center justify-between gap-3 py-1.5">
            <span className="flex min-w-0 items-center gap-2 text-xs text-slate-700">
              <LogInIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span>企业单点登录</span>
            </span>
            <Badge variant={capabilityBadge(identityAuthoritative)}>{ssoState}</Badge>
          </div>
          <div className="flex items-center justify-between gap-3 py-1.5">
            <span className="flex min-w-0 items-center gap-2 text-xs text-slate-700">
              <ShieldCheckIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span>身份映射与寄件授权</span>
            </span>
            <Badge variant="secondary">{identityMappingState}</Badge>
          </div>
        </div>
      </div>

      <section className="mt-4" aria-labelledby="connection-sources-title">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 id="connection-sources-title" className="text-sm font-medium text-slate-900">连接管理</h4>
            <p className="mt-0.5 text-[11px] text-slate-500">保存凭据并检查实际可读范围；连接通过不会自动开启目录同步或企业登录。</p>
          </div>
          <Settings2Icon className="h-4 w-4 text-slate-400" />
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-2">
            <Building2Icon className="h-4 w-4 text-emerald-700" />
            <div className="mt-1 text-xs font-medium text-slate-900">手工维护</div>
            <div className="mt-0.5 text-[11px] text-emerald-700">始终保留</div>
          </div>
          {providers.map(provider => {
            const source = sources.find(item => item.provider === provider.key)
            const configurable = provider.configurable
            return (
              <button
                key={provider.key}
                type="button"
                disabled={!configurable || loading}
                aria-pressed={selectedProvider === provider.key}
                onClick={() => configurable && void selectProvider(provider.key as OrganizationConnectionProvider)}
                className={`min-h-20 rounded-md border px-2.5 py-2 text-left transition ${
                  selectedProvider === provider.key
                    ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                    : configurable
                      ? 'border-slate-200 bg-slate-50 hover:border-blue-300 hover:bg-blue-50/50'
                      : 'cursor-not-allowed border-slate-200 bg-slate-50'
                }`}
              >
                <Settings2Icon className={`h-4 w-4 ${configurable ? 'text-slate-700' : 'text-slate-400'}`} />
                <div className="mt-1 text-xs font-medium text-slate-900">{provider.label}</div>
                <div className={`mt-0.5 text-[11px] ${configurable ? 'text-slate-600' : 'text-amber-700'}`}>
                  {configurable ? sourceStateLabel(source) : '尚未接入'}
                </div>
              </button>
            )
          })}
        </div>

        {selected && (
          <div className="mt-3">
            <OrganizationConnectionForm key={selected.key} provider={selected} onChanged={refreshAll} />
            <DirectoryInspectionPanel key={`${selected.key}:${inspectionGeneration}`} provider={selected} />
          </div>
        )}

        <div className="mt-3 space-y-2">
          {loading && <div className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-500">正在读取组织接入状态…</div>}
          {!loading && sources.length === 0 && (
            <div className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">
              尚未配置外部组织连接。选择上方提供方开始配置。
            </div>
          )}
          {sources.map(source => {
            const provider = providers.find(item => item.key === source.provider)
            return (
              <div key={source.id} className="rounded-lg border border-slate-200 px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-900">{provider?.label || source.provider}</span>
                  <Badge variant={providerBadgeVariant(source)}>{sourceStateLabel(source)}</Badge>
                  {source.status === 'active' && source.priority === 1 && <Badge variant="secondary">目录主来源</Badge>}
                </div>
                <div className="mt-1 break-all text-xs text-slate-500">{source.externalTenantId}</div>
                <div className="mt-1 text-[11px] text-slate-400">
                  优先级 {source.priority} · {source.syncMode === 'authoritative' ? '权威目录' : source.syncMode === 'enrichment' ? '身份补充' : '只读'}
                  {source.lastSuccessfulSyncAt ? ` · 最近应用 ${formatTime(source.lastSuccessfulSyncAt)}` : ''}
                </div>
                {source.lastError && <div className="mt-1 text-xs text-rose-600">{source.lastError}</div>}
              </div>
            )
          })}
        </div>
      </section>

      <section className="mt-5 border-t pt-4" aria-labelledby="directory-authority-title">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 id="directory-authority-title" className="text-sm font-medium text-slate-900">目录同步</h4>
            <p className="mt-0.5 text-[11px] leading-5 text-slate-500">
              先检查完整读取权限，再冻结差异并确认。冲突、范围不明、过期计划或不完整快照都会整批阻断。
            </p>
          </div>
          <ArrowLeftRightIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        </div>

        {directoryAvailability?.available === false && directoryAvailability.reason && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
            {directoryAvailability.reason}
          </p>
        )}

        <div className="mt-3 rounded-lg border border-slate-200 p-3">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500">当前</span>
            <span className="font-medium text-slate-900">
              {activePrimary
                ? `${providers.find(provider => provider.key === activePrimary.provider)?.label || activePrimary.provider} · 权威`
                : '暂无外部目录主来源'}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-5 text-slate-500">
            手工部门与旧来源会继续保留。切换只更新{directoryLabel}来源部门、身份映射和成员主部门，不创建新成员，也不按姓名合并。
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3 w-full justify-center"
            disabled={!directoryReady || directoryAction !== null}
            aria-busy={directoryAction === 'preview'}
            onClick={() => void previewDirectory()}
          >
            <RefreshCwIcon className={`mr-1 h-4 w-4 ${directoryAction === 'preview' ? 'animate-spin' : ''}`} />
            {directoryAction === 'preview'
              ? '正在检查并生成差异…'
              : directoryAvailability?.available === false
                ? '目录切源升级后可用'
                : directoryReady
                  ? '检查可读范围并生成差异'
                  : `${directoryLabel}连接验证后可用`}
          </Button>
        </div>

        {latestPlan && (
          <div className="mt-3 rounded-lg border border-slate-200 p-3" data-testid="directory-cutover-plan">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {latestPlan.applyable && latestPlan.conflicts.length === 0
                  ? <CheckCircle2Icon className="h-4 w-4 text-emerald-600" />
                  : <AlertTriangleIcon className="h-4 w-4 text-rose-600" />}
                <span className="text-sm font-medium text-slate-900">
                  {latestPlan.status === 'applied'
                    ? '已应用'
                    : latestPlan.status === 'rolled_back'
                      ? '已回滚'
                      : latestPlan.status === 'superseded'
                        ? '已被新计划替代'
                        : latestPlan.applyable
                          ? '差异计划可执行'
                          : '差异计划被阻断'}
                </span>
              </div>
              <Badge variant={latestPlan.applyable && latestPlan.conflicts.length === 0 ? 'default' : 'destructive'}>
                {latestPlan.conflicts.length} 个冲突
              </Badge>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <Metric label="新增部门" value={latestPlan.summary.departmentsAdded} />
              <Metric label="更新部门" value={latestPlan.summary.departmentsUpdated} />
              <Metric label={`停用旧${directoryLabel}部门`} value={latestPlan.summary.departmentsToDeactivate} tone="amber" />
              <Metric label="新增身份映射" value={latestPlan.summary.identitiesAdded} />
              <Metric label="更新身份映射" value={latestPlan.summary.identitiesUpdated} />
              <Metric label="冲突" value={latestPlan.summary.conflicts} tone={latestPlan.summary.conflicts ? 'rose' : 'emerald'} />
            </div>

            <div
              className={`mt-3 rounded-md border px-2.5 py-2 text-[11px] leading-5 ${
                latestPlan.snapshot.scopeVerified
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-amber-200 bg-amber-50 text-amber-800'
              }`}
              data-testid="directory-scope-evidence"
            >
              <div className="font-medium">
                {latestPlan.snapshot.scopeVerified ? '全公司读取范围已证明' : '仅完成授权范围内分页，尚不能证明全公司读取范围'}
              </div>
              <div className="mt-0.5">
                快照结构：{latestPlan.snapshot.complete ? '完整' : '不完整'}。
                {latestPlan.snapshot.scopeEvidence ? `证据：${latestPlan.snapshot.scopeEvidence}` : '范围证据缺失，目录切换保持阻断。'}
              </div>
            </div>

            <div className="mt-3 rounded-md bg-slate-50 px-2.5 py-2 text-[11px] leading-5 text-slate-600">
              保留手工部门 {latestPlan.preserved.manualDepartmentCount} 个；保留旧来源部门 {latestPlan.preserved.previousPrimaryDepartmentsRetained} 个；
              保留旧来源身份 {latestPlan.preserved.previousPrimaryIdentitiesRetained} 条。计划有效至 {formatTime(latestPlan.expiresAt)}。
            </div>

            {latestPlan.conflicts.length > 0 && (
              <ul className="mt-3 space-y-1.5" aria-label="目录切源冲突">
                {latestPlan.conflicts.map((item, index) => (
                  <li key={`${item.kind}-${item.externalId || index}`} className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-2 text-[11px] leading-5 text-rose-800">
                    {item.message}
                  </li>
                ))}
              </ul>
            )}

            {latestPlan.notices.length > 0 && latestPlan.conflicts.length === 0 && (
              <ul className="mt-3 space-y-1 text-[11px] leading-5 text-slate-500">
                {latestPlan.notices.map(notice => <li key={notice}>• {notice}</li>)}
              </ul>
            )}

            {latestPlan.identityChanges.some(change => change.kind !== 'unchanged') && (
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer font-medium text-slate-700">查看身份匹配证据</summary>
                <ul className="mt-2 space-y-1.5">
                  {latestPlan.identityChanges.filter(change => change.kind !== 'unchanged').slice(0, 8).map(change => (
                    <li key={change.externalUserId} className="rounded-md bg-slate-50 px-2.5 py-2 text-[11px] text-slate-600">
                      {change.displayName} · {change.kind === 'added' ? '新增' : '更新'} · 依据 {methodLabel(change.matchMethod)}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {latestPlan.status === 'planned' && planExpired && (
              <p className="mt-3 text-xs font-medium text-amber-700">计划已过期，请重新生成差异。</p>
            )}

            {canApply && (
              <Button
                type="button"
                className="mt-3 w-full justify-center bg-blue-600 hover:bg-blue-700"
                disabled={directoryAction !== null}
                onClick={() => void applyLatestPlan()}
              >
                <ShieldCheckIcon className="mr-1 h-4 w-4" />
                {directoryAction === 'apply' ? '正在原子切换…' : '确认切换目录主来源'}
              </Button>
            )}

            {latestPlan.status === 'applied' && (
              <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-[11px] leading-5 text-emerald-800">
                已于 {formatTime(latestPlan.run?.appliedAt || latestPlan.appliedAt)} 应用。
                后续目录或来源发生变化时，旧回滚会被拒绝。
              </div>
            )}

            {canRollback && (
              <Button
                type="button"
                variant="outline"
                className="mt-3 w-full justify-center"
                disabled={directoryAction !== null}
                onClick={() => void rollbackLatestPlan()}
              >
                <RotateCcwIcon className={`mr-1 h-4 w-4 ${directoryAction === 'rollback' ? 'animate-spin' : ''}`} />
                {directoryAction === 'rollback' ? '正在回滚…' : '回滚本次目录切源'}
              </Button>
            )}

            {latestPlan.status === 'rolled_back' && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] leading-5 text-slate-600">
                <HistoryIcon className="mt-0.5 h-4 w-4 shrink-0" />
                本次计划已回滚；如需再次切换，请重新生成新的差异计划。
              </div>
            )}
          </div>
        )}
      </section>

      <section className="mt-5 border-t pt-4" aria-labelledby="login-entry-title">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h4 id="login-entry-title" className="text-sm font-medium text-slate-900">{directoryLabel}企业单点登录</h4>
              <Badge variant={capabilityBadge(identityAuthoritative)}>{ssoState}</Badge>
            </div>
            <p className="mt-0.5 text-[11px] leading-5 text-slate-500">
              企业登录只接受已验证的外部身份并绑定到既有系统成员，不从登录请求创建人员。
            </p>
          </div>
          <LogInIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        </div>
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-[11px] leading-5 text-slate-600">
          {identityAuthoritative
            ? '该提供方已被显式设为身份权威来源。登录仍须稳定身份映射、成员状态、有效角色和正式站真人验收，任何一项失败都会拒绝。'
            : '目录读取、目录主来源或连接验证都不会自动开启登录。只有该提供方被显式设为身份权威来源并具备稳定映射后，企业登录才可启用。'}
        </div>
      </section>
    </div>
  )
}

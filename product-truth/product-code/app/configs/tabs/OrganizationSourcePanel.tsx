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
import type { OrganizationSourceAccess } from '@/lib/admin/organization-source-access'
import type { OrganizationConnectionProvider, ProviderCapability } from '@/lib/organization-connections/types'
import type { DirectoryAuthorityReviewSummary, DirectoryCutoverClientPlan } from '@/lib/organization-connections/directory-cutover'
import { connectionPresentation } from '@/lib/organization-connections/presentation'
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
  effectiveConnectionRevision?: string | null
  connectionConfigured?: boolean
  draftCheckStatus: DraftCheckStatus
  authorityScope: Record<string, unknown>
  syncMode: SyncMode
  lastSuccessfulSyncAt: string | null
  lastError: string | null
}

function primaryDirectorySource(sources: Source[]) {
  return sources.find(source => source.authorityScope.directory === 'authoritative' || source.authorityScope.directory === true)
    || sources.find(source => source.status === 'active' && source.priority === 1 && source.syncMode === 'authoritative')
    || null
}

type SourcePayload = {
  sources?: Source[]
  providers?: ProviderCapability[]
  permissions?: OrganizationSourceAccess
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

function sourcePresentation(source: Source | null | undefined) {
  return connectionPresentation(source ? {
    configured: source.connectionConfigured ?? Boolean(source.connectionRevision),
    state: source.connectionState,
    revision: source.connectionRevision,
    effectiveRevision: source.effectiveConnectionRevision,
    effectiveVerified: Boolean(source.status === 'active' && source.connectionState === 'verified'
      && source.effectiveConnectionRevision),
    draftCheckStatus: source.draftCheckStatus,
  } : null)
}

function sourceStateLabel(source: Source | undefined) {
  if (!source) return '未配置'
  const presentation = sourcePresentation(source)
  return `${presentation.checkLabel} · ${presentation.directoryLabel}`
}

function providerBadgeVariant(source: Source | undefined): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (!source || source.connectionState === 'unconfigured') return 'outline'
  if (source.draftCheckStatus === 'failed') return 'destructive'
  if (sourcePresentation(source).currentConfigurationEnabled) return 'default'
  return 'secondary'
}

function methodLabel(method: DirectoryCutoverClientPlan['identityChanges'][number]['matchMethod']) {
  return {
    none: '待关联账号',
    provider_id: '既有外部身份',
    employee_id: '工号',
    email: '邮箱',
    phone: '手机号',
    manual: '人工绑定',
  }[method]
}

function directoryAuthoritySummary(summary: DirectoryAuthorityReviewSummary) {
  const automatic = (summary.automaticRoleSourcesAdded ?? 0) + (summary.automaticRoleSourcesRemoved ?? 0) > 0
    ? `新增部门角色来源 ${summary.automaticRoleSourcesAdded ?? 0} 项，结束 ${summary.automaticRoleSourcesRemoved ?? 0} 项。`
    : ''
  const scope = (summary.automaticRoleScopeWidenedMembers ?? 0) + (summary.automaticRoleScopeNarrowedMembers ?? 0) > 0
    ? `已有部门角色的数据范围扩大 ${summary.automaticRoleScopeWidenedMembers ?? 0} 人，收缩 ${summary.automaticRoleScopeNarrowedMembers ?? 0} 人。`
    : ''
  return `归属变化 ${summary.members} 人，部门基线变化 ${summary.baselineChanges} 人，待复核角色 ${summary.rolesForReview} 项、数据范围 ${summary.scopesForReview} 项、个人例外 ${summary.personalExceptions} 项。${automatic}${scope}`
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

function readErrorMessage(value: unknown, fallback: string) {
  if (typeof value === 'string' && value.trim()) return value
  if (value && typeof value === 'object' && 'message' in value
    && typeof value.message === 'string' && value.message.trim()) return value.message
  return fallback
}

export function OrganizationSourcePanel({ onRefresh }: OrganizationSourcePanelProps) {
  const [sources, setSources] = useState<Source[]>([])
  const [providers, setProviders] = useState<ProviderCapability[]>([])
  const [access, setAccess] = useState<OrganizationSourceAccess | null>(null)
  const [selectedProvider, setSelectedProvider] = useState<OrganizationConnectionProvider | null>(null)
  const selectedProviderRef = useRef<OrganizationConnectionProvider | null>(null)
  const [latestPlan, setLatestPlan] = useState<DirectoryCutoverClientPlan | null>(null)
  const [directoryAvailability, setDirectoryAvailability] = useState<DirectoryAvailability | null>(null)
  const [loading, setLoading] = useState(true)
  const [sourceReadError, setSourceReadError] = useState('')
  const [directoryReadError, setDirectoryReadError] = useState('')
  const [directoryLoading, setDirectoryLoading] = useState(false)
  const directoryReadGeneration = useRef(0)
  const [directoryAction, setDirectoryAction] = useState<DirectoryAction>(null)
  const [ssoAction, setSsoAction] = useState(false)
  const [inspectionGeneration, setInspectionGeneration] = useState(0)

  const load = useCallback(async () => {
    const generation = ++directoryReadGeneration.current
    setLoading(true)
    setAccess(null)
    setSourceReadError('')
    let sourcesLoaded = false
    try {
      const sourceResponse = await fetch('/api/admin/organization-sources', { headers: authHeaders(), cache: 'no-store' })
      const sourceBody = await sourceResponse.json().catch(() => ({})) as { data?: SourcePayload; error?: unknown }
      if (!sourceResponse.ok) throw new Error(readErrorMessage(sourceBody.error, '组织来源读取失败。'))
      if (!Array.isArray(sourceBody.data?.sources) || !Array.isArray(sourceBody.data?.providers)) {
        throw new Error('组织来源读取结果不完整，请重新读取。')
      }
      const nextSources = sourceBody.data.sources
      const nextProviders = sourceBody.data.providers
      const activeSource = primaryDirectorySource(nextSources)
      if (generation !== directoryReadGeneration.current) return
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
      setAccess(sourceBody.data.permissions ?? null)
      setSelectedProvider(preferredProvider)
      selectedProviderRef.current = preferredProvider
      setLatestPlan(null)
      setDirectoryAvailability(null)
      setDirectoryReadError('')
      sourcesLoaded = true

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
        if (!directoryBody.data || !('plan' in directoryBody.data)) throw new Error('同步记录读取结果不完整，请重新读取。')
        if (generation !== directoryReadGeneration.current) return
        setDirectoryAvailability(directoryBody.data?.directory_cutover || null)
        setLatestPlan(directoryBody.data?.plan || null)
      }
    } catch (readError) {
      if (generation !== directoryReadGeneration.current) return
      const message = readError instanceof Error ? readError.message : '组织来源读取失败。'
      if (!sourcesLoaded) setSourceReadError(message)
      else setDirectoryReadError(message)
      error(message)
    } finally {
      if (generation === directoryReadGeneration.current) {
        setLoading(false)
        setDirectoryLoading(false)
      }
    }
  }, [])

  async function selectProvider(provider: OrganizationConnectionProvider) {
    const generation = ++directoryReadGeneration.current
    selectedProviderRef.current = provider
    setSelectedProvider(provider)
    setLatestPlan(null)
    setDirectoryAvailability(null)
    setDirectoryReadError('')
    setDirectoryLoading(true)
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
      if (!body.data || !('plan' in body.data)) throw new Error('同步记录读取结果不完整，请重新读取。')
      if (generation !== directoryReadGeneration.current) return
      setDirectoryAvailability(body.data?.directory_cutover || null)
      setLatestPlan(body.data?.plan || null)
    } catch (readError) {
      if (generation !== directoryReadGeneration.current) return
      const message = readError instanceof Error ? readError.message : '目录切源状态读取失败。'
      setDirectoryReadError(message)
      error(message)
    } finally {
      if (generation === directoryReadGeneration.current) setDirectoryLoading(false)
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

  async function setSsoEnabled(enabled: boolean) {
    if (!access?.enterpriseLogin || selectedProviderRef.current !== 'fxiaoke' || !directorySource?.connectionRevision || ssoAction) return
    const accepted = await confirmAction(
      enabled
        ? '启用纷享企业登录？已匹配的在职员工可凭纷享身份先登录，无需邀请码；未分配 ICU 角色时只能看到待授权页。目录同步本身不会授予业务权限。'
        : '停用纷享企业登录？现有纷享成员会话将失效，角色和组织资料会保留。',
      { confirmText: enabled ? '启用企业登录' : '停用企业登录', danger: !enabled },
    )
    if (!accepted) return
    setSsoAction(true)
    try {
      const result = await fetch('/api/admin/organization-sources/fxiaoke/sso', {
        method: 'PATCH', headers: authHeaders(true),
        body: JSON.stringify({ enabled, connectionRevision: directorySource.connectionRevision }),
      })
      const body = await result.json().catch(() => ({})) as { error?: string }
      if (!result.ok) throw new Error(body.error || '企业登录状态保存失败。')
      success(enabled ? '纷享企业登录已启用。' : '纷享企业登录已停用，现有会话已失效。')
      await refreshAll()
    } catch (saveError) {
      error(saveError instanceof Error ? saveError.message : '企业登录状态保存失败。')
    } finally {
      setSsoAction(false)
    }
  }

  async function previewDirectory() {
    const provider = selectedProviderRef.current
    if (!access?.preview || !provider || !directoryReady || directoryAction !== null) return
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
      if (selectedProviderRef.current !== provider) return
      setLatestPlan(body.data.plan)
      success(body.data.plan.applyable ? '目录差异计划已生成，请核对后明确确认。' : '差异计划已生成，但仍有冲突，当前不能切换。')
    } catch (previewError) {
      error(previewError instanceof Error ? previewError.message : `${providerLabel}目录差异生成失败。`)
    } finally {
      setDirectoryAction(null)
    }
  }

  async function applyLatestPlan() {
    if (!latestPlan || !canApply) return
    const providerLabel = providers.find(item => item.key === latestPlan.provider)?.label || latestPlan.provider
    const accepted = await confirmAction(
      `确认整体同步${providerLabel}组织目录，并将其作为目录主来源？`
      + `本次包含 ${latestPlan.snapshot.departmentCount} 个部门、${latestPlan.snapshot.employeeCount} 位员工及其归属，`
      + '旧来源与手工数据保留；未关联员工仍会显示，不会自动开账号或改变登录状态。'
      + (latestPlan.authorityReview ? directoryAuthoritySummary(latestPlan.authorityReview) : ''),
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
    if (!latestPlan || !canRollback || directoryAction !== null) return
    setDirectoryAction('rollback')
    try {
      const previewResponse = await fetch('/api/admin/organization-sources/directory', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ action: 'rollback_preview', plan_id: latestPlan.id }),
      })
      const previewBody = await previewResponse.json().catch(() => ({})) as {
        data?: { preview?: { previewId: string; summary: DirectoryAuthorityReviewSummary } }
        error?: string
      }
      const preview = previewBody.data?.preview
      if (!previewResponse.ok || !preview) throw new Error(previewBody.error || '无法预览目录回滚。')
      if (!await confirmAction(
        '确认回滚本次目录切源？' + directoryAuthoritySummary(preview.summary)
        + '回滚只恢复组织关系。已经暂停的授权仍待复核。',
        { confirmText: '确认回滚', danger: true },
      )) return
      const response = await fetch('/api/admin/organization-sources/directory', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ action: 'rollback', plan_id: latestPlan.id, preview_id: preview.previewId }),
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
      success('目录归属已回滚，暂停的授权仍待复核。')
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
  const activePrimary = primaryDirectorySource(sources)
  const directoryProvider = selectedProvider
  const directorySource = directoryProvider
    ? sources.find(source => source.provider === directoryProvider) || null
    : null
  const directoryCapability = directoryProvider
    ? providers.find(provider => provider.key === directoryProvider) || null
    : null
  const directoryLabel = directoryCapability?.label || directoryProvider || '外部系统'
  const connectionDisplay = sourcePresentation(directorySource)
  const directoryReady = Boolean(
    directorySource
    && connectionDisplay.currentConfigurationEnabled
    && directorySource.connectionRevision
    && directoryCapability?.syncAvailable
    && directoryAvailability?.available !== false
    && !directoryReadError && !directoryLoading && !loading,
  )
  const identityAuthoritative = Boolean(
    directorySource?.status === 'active'
    && directorySource.connectionState === 'verified'
    && directoryCapability?.ssoAvailable
    && directorySource.authorityScope.identity === 'authoritative',
  )
  const planExpired = Boolean(latestPlan && Date.parse(latestPlan.expiresAt) <= Date.now())
  const planVersionChanged = Boolean(latestPlan?.status === 'planned' && directorySource
    && (latestPlan.targetSourceId !== directorySource.id
      || latestPlan.connectionRevision !== directorySource.connectionRevision))
  const canApply = Boolean(
    access?.apply && directoryReady && latestPlan
    && latestPlan.provider === directoryProvider
    && latestPlan.snapshot.connectionVerified
    && latestPlan.contractVersion === 'f003-directory-cutover-v2'
    && latestPlan.status === 'planned'
    && latestPlan.applyable
    && !planExpired
    && !planVersionChanged
    && directoryAction === null,
  )
  const canRollback = Boolean(
    access?.apply && latestPlan
    && latestPlan.status === 'applied'
    && latestPlan.run?.status === 'applied'
    && directoryAction === null,
  )
  const connectionState = connectionDisplay.checkLabel
  const directoryScopeState = !directoryProvider || !directoryCapability?.syncAvailable
    ? '未接入'
    : latestPlan
      ? `${latestPlan.snapshot.departmentCount} 个部门 · ${latestPlan.snapshot.employeeCount} 位员工`
      : directoryReadError ? '同步记录读取失败'
        : directoryReady ? '待读取组织目录' : connectionDisplay.directoryLabel
  const directoryAuthorityState = !directoryProvider || !directoryCapability?.syncAvailable
    ? '未接入'
    : directorySource?.authorityScope.directory === 'authoritative'
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

  if (loading && providers.length === 0) {
    return <div className="rounded-lg border bg-white p-4" role="status">正在读取组织接入状态…</div>
  }

  if (sourceReadError) {
    return (
      <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
        <div role="alert">
          <h3 className="font-medium text-amber-950">组织接入状态暂时无法核验</h3>
          <p className="mt-1 text-sm text-amber-900">{sourceReadError}</p>
          <p className="mt-2 text-sm text-amber-900">读取失败不表示尚未配置连接。成功读取前，连接和目录状态保持未知，不能据此进行目录操作。</p>
        </div>
        <Button type="button" variant="outline" onClick={() => void load()}>重新读取组织接入状态</Button>
      </div>
    )
  }

  return (
    <div className="rounded-lg border bg-white p-4">
      <div>
        <h3 className="font-medium text-slate-900">外部系统接入</h3>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          配置检查、目录连接和同步结果分别显示；检查通过或启用连接都不会自动更新组织架构。
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
            <Badge variant={directorySource?.draftCheckStatus === 'failed' ? 'destructive' : capabilityBadge(directorySource?.draftCheckStatus === 'preview_ready')}>{connectionState}</Badge>
          </div>
          <div className="flex items-center justify-between gap-3 py-1.5">
            <span className="text-xs text-slate-700">目录连接</span>
            <Badge variant={capabilityBadge(connectionDisplay.currentConfigurationEnabled)}>{connectionDisplay.directoryLabel}</Badge>
          </div>
          <div className="flex items-center justify-between gap-3 py-1.5">
            <span className="flex min-w-0 items-center gap-2 text-xs text-slate-700">
              <Building2Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span>组织目录读取</span>
            </span>
            <Badge variant={capabilityBadge(Boolean(latestPlan?.snapshot.complete))}>{directoryScopeState}</Badge>
          </div>
          <div className="flex items-center justify-between gap-3 py-1.5">
            <span className="flex min-w-0 items-center gap-2 text-xs text-slate-700">
              <ArrowLeftRightIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span>目录主来源</span>
            </span>
            <Badge variant={capabilityBadge(Boolean(directorySource?.authorityScope.directory === 'authoritative'))}>{directoryAuthorityState}</Badge>
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
                disabled={!configurable || loading || directoryAction !== null}
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
            <OrganizationConnectionForm
              key={selected.key}
              provider={selected}
              canConnect={access?.connect === true}
              canApply={access?.apply === true}
              onChanged={refreshAll}
            />
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
                  {source.id === activePrimary?.id && <Badge variant="secondary">目录主来源</Badge>}
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
              读取同一来源的部门、员工及归属，核对一份差异后整体同步。未关联账号的员工也会进入组织架构。
            </p>
          </div>
          <ArrowLeftRightIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        </div>

        {selected && access?.preview && <details className="mt-3 text-xs text-slate-500">
          <summary className="cursor-pointer">查看连接读取诊断</summary>
          <DirectoryInspectionPanel key={`${selected.key}:${inspectionGeneration}`} provider={selected} />
        </details>}

        {directoryAvailability?.available === false && directoryAvailability.reason && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
            {directoryAvailability.reason}
          </p>
        )}
        {directoryReadError && <div className="mt-3 space-y-2 rounded-md bg-amber-50 p-3">
          <p role="alert" className="text-sm text-amber-900">{directoryReadError} 当前同步记录未知，重新读取后再操作；已同步的组织数据保留。</p>
          <Button type="button" variant="outline" disabled={directoryLoading || !directoryProvider}
            onClick={() => directoryProvider && void selectProvider(directoryProvider)}>重新读取同步记录</Button>
        </div>}
        {!directoryReady && !directoryReadError && !directoryLoading && (
          <p className="mt-3 text-xs leading-5 text-slate-600">{connectionDisplay.directoryDetail}</p>
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
            手工部门与旧来源会继续保留。同步统一更新{directoryLabel}的部门、目录员工和归属；未关联账号的员工显示为待关联，账号关联和角色保持不变。
          </p>
          {access?.preview && <Button
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
              : directoryLoading ? '正在读取同步记录…'
              : directoryReadError ? '重新读取同步记录后可用'
              : directoryAvailability?.available === false
                ? '目录切源升级后可用'
                : directoryReady
                  ? '读取组织目录并生成差异'
                  : `${directoryLabel}启用目录连接后可用`}
          </Button>}
        </div>

        {latestPlan && (access?.preview || access?.apply) && (
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
                        : planExpired ? '差异计划已过期'
                        : planVersionChanged ? '配置已改变 · 需重新生成差异'
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
              <Metric label="新增目录员工" value={latestPlan.summary.identitiesAdded} />
              <Metric label="更新目录员工" value={latestPlan.summary.identitiesUpdated} />
              <Metric label="冲突" value={latestPlan.summary.conflicts} tone={latestPlan.summary.conflicts ? 'rose' : 'emerald'} />
            </div>

            <div className="mt-3 rounded-md border border-slate-200 px-2.5 py-2 text-xs leading-5" data-testid="directory-scope-evidence">
              <div>本次读取：{latestPlan.snapshot.departmentCount} 个部门，{latestPlan.snapshot.employeeCount} 位员工。</div>
              <div>部门与人员关系：{latestPlan.snapshot.complete ? '校验通过' : '校验未通过'}；本次新建待关联人员 {latestPlan.identityChanges.filter(employee => employee.createsMember).length} 人。</div>
            </div>

            <div className="mt-3 rounded-md bg-slate-50 px-2.5 py-2 text-[11px] leading-5 text-slate-600">
              保留手工部门 {latestPlan.preserved.manualDepartmentCount} 个；保留旧来源部门 {latestPlan.preserved.previousPrimaryDepartmentsRetained} 个；
              保留旧来源身份 {latestPlan.preserved.previousPrimaryIdentitiesRetained} 条。计划有效至 {formatTime(latestPlan.expiresAt)}。
            </div>
            {latestPlan.authorityReview && (latestPlan.authorityReview.members > 0
              || (latestPlan.authorityReview.automaticRoleSourcesAdded ?? 0) > 0
              || (latestPlan.authorityReview.automaticRoleSourcesRemoved ?? 0) > 0
              || (latestPlan.authorityReview.automaticRoleScopeWidenedMembers ?? 0) > 0
              || (latestPlan.authorityReview.automaticRoleScopeNarrowedMembers ?? 0) > 0) && (
              <p className="mt-3 text-xs text-slate-700">{directoryAuthoritySummary(latestPlan.authorityReview)}</p>
            )}

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
            {planVersionChanged && (
              <p className="mt-3 text-xs font-medium text-amber-700">本计划对应旧配置。请检查并应用当前配置后，重新读取组织目录并生成差异。</p>
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
              在职员工使用纷享身份登录，无需邀请码或本地密码。无角色时仅进入待授权页；组织管理员分配 ICU 角色后才可进入业务。
            </p>
          </div>
          <LogInIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        </div>
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-[11px] leading-5 text-slate-600">
          {identityAuthoritative
            ? '纷享已是身份权威来源。停用或冲突身份仍会被拒绝；正式站真人登录验收尚需单独完成。'
            : '确认至少一位已匹配的在职纷享成员后可启用企业登录。未分配角色的员工只会进入待授权页，不能访问业务接口。'}
        </div>
        {access?.enterpriseLogin && directoryProvider === 'fxiaoke' && directorySource?.status === 'active'
          && directorySource.connectionState === 'verified'
          && directorySource.authorityScope.directory === 'authoritative' && (
            <Button
              type="button" variant={identityAuthoritative ? 'outline' : 'default'}
              className="mt-3"
              disabled={ssoAction}
              onClick={() => void setSsoEnabled(!identityAuthoritative)}
            >
              {ssoAction ? '正在保存…' : identityAuthoritative ? '停用纷享登录' : '启用纷享登录'}
            </Button>
          )}
      </section>
    </div>
  )
}

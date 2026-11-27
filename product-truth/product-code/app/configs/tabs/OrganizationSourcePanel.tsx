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
import type { FxiaokeRotationProof } from '@/lib/fxiaoke/credential-rotation'
import type { OrganizationConnectionProvider, ProviderCapability } from '@/lib/organization-connections/types'
import type { DirectoryAuthorityReviewSummary, DirectoryCutoverClientPlan, DirectoryPermissionChoice, DirectoryPermissionReview } from '@/lib/organization-connections/directory-cutover'
import { BUILTIN_PERMISSION_BY_KEY } from '@/lib/permission-catalog'
import { connectionPresentation } from '@/lib/organization-connections/presentation'
import { OrganizationConnectionForm } from './OrganizationConnectionForm'
import { DirectoryInspectionPanel } from './DirectoryInspectionPanel'
import { DirectoryChangeSummary, directoryOverview, directoryScopeUnverified } from './DirectoryChangeSummary'

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
  directoryOnly?: boolean
}

type DirectoryAction = 'preview' | 'apply' | 'rollback' | 'review' | null
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
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : value
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

function DirectoryPermissionReviewPanel({
  review, busy, onReview,
}: {
  review: DirectoryPermissionReview
  busy: boolean
  onReview?: (choices: DirectoryPermissionChoice[]) => Promise<boolean>
}) {
  const [selected, setSelected] = useState<Record<string, DirectoryPermissionChoice['choice']>>({})
  const choices = review.permissions.flatMap(({ permissionCode }) => (
    selected[permissionCode] ? [{ permissionCode, choice: selected[permissionCode] }] : []
  ))

  return (
    <fieldset className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3">
      <legend className="px-1 text-xs font-medium text-slate-900">{review.displayName}的个人权限</legend>
      <p className="text-xs text-slate-700">核对后，才可应用此员工的相关变更。</p>
      {review.permissions.map(permission => {
        const name = BUILTIN_PERMISSION_BY_KEY.get(permission.permissionCode)?.label ?? permission.permissionCode
        return (
          <label key={permission.permissionCode} className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-800">
            <span>{name}</span>
            {onReview && (
              <select aria-label={`${review.displayName} · ${name}`}
                className="rounded border border-slate-300 bg-white px-2 py-1" disabled={busy}
                value={selected[permission.permissionCode] || ''}
                onChange={event => {
                  const choice = event.target.value as DirectoryPermissionChoice['choice'] | ''
                  setSelected(current => {
                    if (choice) return { ...current, [permission.permissionCode]: choice }
                    const next = { ...current }
                    delete next[permission.permissionCode]
                    return next
                  })
                }}>
                <option value="">选择处理方式</option>
                <option value="new_baseline">使用新部门权限</option>
                {permission.retainable && <option value="retain_eligible">保留仍适用的个人例外</option>}
              </select>
            )}
          </label>
        )
      })}
      {onReview && (
        <Button variant="outline" size="sm" disabled={busy || choices.length !== review.permissions.length}
          onClick={async () => { if (await onReview(choices)) setSelected({}) }}>保存权限核对</Button>
      )}
    </fieldset>
  )
}

function FxiaokeScopeProofForm({ source, onVerified }: { source: Source; onVerified: () => void | Promise<void> }) {
  const [file, setFile] = useState<File | null>(null)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState('')
  const [receipt, setReceipt] = useState<{ expiresAt: string; departmentCount: number; employeeCount: number } | null>(null)

  async function verifyScope() {
    if (!file || pending || !source.effectiveConnectionRevision) return
    setFailure('')
    setReceipt(null)
    setPending(true)
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('请选择不超过 2 MB 的目录核对清单。')
      const manifest: unknown = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('未能读取目录核对清单。'))
        reader.readAsText(file)
      }).then(text => {
        try { return JSON.parse(text) as unknown }
        catch { throw new Error('目录核对清单必须是有效的 JSON 文件。') }
      })
      if (!manifest || Array.isArray(manifest) || typeof manifest !== 'object') throw new Error('目录核对清单格式不正确。')
      const input = { sourceId: source.id, connectionRevision: source.effectiveConnectionRevision, ...manifest }
      if (input.sourceId !== source.id || input.connectionRevision !== source.effectiveConnectionRevision) {
        throw new Error('清单记录的来源或生效凭证已变化，请重新取得目录。')
      }
      const response = await fetch('/api/admin/organization-sources/fxiaoke/scope-proof', {
        method: 'POST', headers: authHeaders(true), body: JSON.stringify(input),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || !body.data?.proof) throw new Error(readErrorMessage(body.error, '未能核实本次通讯录范围。'))
      setReceipt(body.data.proof)
      await onVerified()
    } catch (submitError) {
      setFailure(submitError instanceof Error ? submitError.message : '未能核实本次通讯录范围。')
    } finally {
      setPending(false)
    }
  }

  return (
    <details className="mt-3 rounded-md border border-slate-200 px-3 py-2 text-xs text-slate-700">
      <summary className="cursor-pointer text-sm font-medium text-slate-900">核对全公司读取范围</summary>
      <p className="mt-2">选择从纷享组织管理员目录整理的核对清单。包含停用部门和人员，保留稳定标识、部门上下级、主属及全部兼岗。</p>
      <p className="mt-1">清单只需要目录关系和导出信息。请去除姓名、邮箱和手机号。</p>
      <label className="mt-2 block">
        目录核对清单
        <input type="file" accept=".json,application/json" className="mt-1 block max-w-full" disabled={pending}
          onChange={event => { setFile(event.target.files?.[0] ?? null); setFailure(''); setReceipt(null) }} />
      </label>
      <Button variant="outline" size="sm" className="mt-2" disabled={!file || pending || !source.effectiveConnectionRevision}
        onClick={verifyScope}>{pending ? '正在与纷享目录核对…' : '核对读取范围'}</Button>
      {failure && <p className="mt-2 text-rose-700" role="alert">{failure}</p>}
      {receipt && <p className="mt-2 text-emerald-700" role="status">
        已核实 {receipt.departmentCount} 个部门及 {receipt.employeeCount} 位人员。
        可在北京时间 {new Date(receipt.expiresAt).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' })} 前核对并确认差异。
      </p>}
    </details>
  )
}

type IdentityReview = NonNullable<DirectoryCutoverClientPlan['conflicts'][number]['identityReview']>
type IdentityReviewChoice = 'keep_binding' | 'link_existing' | 'create'

function DirectoryIdentityReviewPanel({
  review, busy, onReview,
}: {
  review: IdentityReview
  busy: boolean
  onReview?: (choice: IdentityReviewChoice, userId: string | null, evidence: string) => Promise<boolean>
}) {
  const [choice, setChoice] = useState<{ choice: IdentityReviewChoice; userId: string | null } | null>(null)
  const [evidence, setEvidence] = useState('')
  const sources = { manual: '自建', fxiaoke: '纷享', feishu: '飞书', wecom: '企业微信', dingtalk: '钉钉' } as Record<string, string>
  function personDetails(person: IdentityReview['incoming']) {
    return [person.maskedPhone || '未提供手机', person.primaryDepartment || '未分配主部门',
      ...person.sources.map(source => sources[source] || source)].join(' · ')
  }

  return (
    <details className="mt-1.5">
      <summary className="cursor-pointer font-medium">核对身份</summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div className="rounded bg-white p-2">
          <div className="font-medium">纷享 · {review.incoming.name}</div>
          <div>{personDetails(review.incoming)}</div>
        </div>
        <div className="space-y-2">
          {review.candidates.length === 0 && <p>当前没有可比较的 ICU 成员。</p>}
          {review.candidates.map(person => (
            <div key={person.userId} className="rounded bg-white p-2">
              <div className="font-medium">ICU · {person.name}</div>
              <div>{personDetails(person)}</div>
              {onReview && review.keepUserId === person.userId && (
                <Button variant="outline" size="sm" disabled={busy}
                  onClick={() => setChoice({ choice: 'keep_binding', userId: person.userId })}>保留原关联</Button>
              )}
              {onReview && review.linkUserIds?.includes(person.userId) && (
                <Button variant="outline" size="sm" disabled={busy}
                  onClick={() => setChoice({ choice: 'link_existing', userId: person.userId })}>关联此人</Button>
              )}
            </div>
          ))}
          {onReview && review.canCreate && (
            <Button variant="outline" size="sm" disabled={busy}
              onClick={() => setChoice({ choice: 'create', userId: null })}>作为新成员</Button>
          )}
        </div>
      </div>
      {onReview && choice && (
        <div className="mt-2 space-y-2">
          <label className="block">
            核对说明
            <textarea className="mt-1 block w-full rounded border px-2 py-1" rows={2} maxLength={500}
              value={evidence} disabled={busy} onChange={event => setEvidence(event.target.value)}
              placeholder="说明核对过的人员记录，请勿填写完整手机号、邮箱或凭证" />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={busy || evidence.trim().length < 4} onClick={async () => {
              if (await onReview(choice.choice, choice.userId, evidence.trim())) {
                setChoice(null)
                setEvidence('')
              }
            }}>保存身份核对</Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setChoice(null); setEvidence('') }}>稍后</Button>
          </div>
        </div>
      )}
    </details>
  )
}

function FxiaokeCredentialVerification({ source, onChanged }: { source: Source; onChanged: () => void }) {
  const [proof, setProof] = useState<FxiaokeRotationProof | null>(null)
  const [memberId, setMemberId] = useState('')
  const [trialUrl, setTrialUrl] = useState('')
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState('')
  const verifiedTrial = proof?.trial?.verifiedAt ? proof.trial : null

  const refresh = useCallback(async () => {
    const query = new URLSearchParams({ provider: 'fxiaoke', view: 'employee-verification', sourceId: source.id })
    const result = await fetch(`/api/admin/organization-sources/connection?${query}`, { headers: authHeaders(), cache: 'no-store' })
    const body = await result.json()
    if (!result.ok) throw new Error(readErrorMessage(body.error, '无法读取员工验证结果。'))
    setProof(body.data)
  }, [source.id])

  async function perform(action: 'prepare_employee_verification' | 'activate_verified_credentials' | 'refresh') {
    setPending(true)
    setFailure('')
    try {
      if (action === 'refresh') {
        await refresh()
        return
      }
      if (action === 'prepare_employee_verification') setTrialUrl('')
      const result = await fetch('/api/admin/organization-sources/connection', {
        method: 'POST', headers: authHeaders(true),
        body: JSON.stringify({
          provider: 'fxiaoke', revision: source.connectionRevision, action, memberId, trialId: verifiedTrial?.id,
        }),
      })
      const body = await result.json()
      if (!result.ok) throw new Error(readErrorMessage(body.error, '纷享凭证验证暂不可用。'))
      if (action === 'activate_verified_credentials') {
        success('已启用通过员工验证的新凭证。')
        onChanged()
      } else {
        const trialPath = body.data?.trialPath
        if (typeof trialPath !== 'string' || !/^\/api\/auth\/fxiaoke\/start\?trial=[0-9a-f]{48}$/.test(trialPath)) {
          throw new Error('验证链接读取失败，请重新发起。')
        }
        setTrialUrl(new URL(trialPath, window.location.origin).href)
        await refresh()
      }
    } catch (error) {
      setFailure(error instanceof Error ? error.message : '纷享凭证验证暂不可用。')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mt-3 space-y-2 rounded-md border border-slate-200 p-3">
      <h5 className="text-sm font-medium">更换凭证前验证员工登录</h5>
      <p className="text-xs text-slate-600">原连接继续使用。请让一位已关联的在职员工通过验证链接完成纷享认证。</p>
      {proof ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs">
            <span className="mb-1 block">测试员工</span>
            <select className="rounded border border-slate-300 bg-white p-2" value={memberId} onChange={event => setMemberId(event.target.value)}>
              <option value="">选择已关联员工</option>
              {proof.employees.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
            </select>
          </label>
          <Button type="button" variant="outline" disabled={pending || !memberId} onClick={() => void perform('prepare_employee_verification')}>生成验证链接</Button>
          <Button type="button" variant="outline" disabled={pending} onClick={() => void perform('refresh')}>刷新验证结果</Button>
          {verifiedTrial ? <Button type="button" disabled={pending} onClick={() => {
            void confirmAction('启用通过员工验证的新凭证？这会切换目录读取与员工登录使用的连接。', { confirmText: '启用新凭证' })
              .then(confirmed => { if (confirmed) return perform('activate_verified_credentials') })
          }}>启用新凭证</Button> : null}
        </div>
      ) : <Button type="button" variant="outline" disabled={pending} onClick={() => void perform('refresh')}>开始员工验证</Button>}
      {proof?.employees.length === 0 ? <p className="text-xs">请先关联一位可登录的在职员工。</p> : null}
      {trialUrl && !verifiedTrial ? (
        <label className="block text-xs">员工验证链接
          <input className="mt-1 block w-full rounded border border-slate-300 p-2" readOnly value={trialUrl} onFocus={event => event.target.select()} />
        </label>
      ) : null}
      {proof?.trial ? <p role="status" className="text-xs">{verifiedTrial ? '员工验证已通过，可以确认启用。' : '等待选定员工完成验证。'}</p> : null}
      {failure ? <p role="alert" className="text-xs text-red-700">{failure}</p> : null}
    </div>
  )
}

export function OrganizationSourcePanel({ onRefresh, directoryOnly = false }: OrganizationSourcePanelProps) {
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
  const [directoryCheckError, setDirectoryCheckError] = useState('')
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
      const preferredProvider = (directoryOnly
        ? configurableProviderKeys.has('fxiaoke') ? 'fxiaoke' : null
        : currentProvider
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
      setLatestPlan(current => current?.provider === preferredProvider ? current : null)
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
  }, [directoryOnly])

  async function selectProvider(provider: OrganizationConnectionProvider) {
    const generation = ++directoryReadGeneration.current
    selectedProviderRef.current = provider
    setSelectedProvider(provider)
    setLatestPlan(current => current?.provider === provider ? current : null)
    setDirectoryCheckError('')
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
    setDirectoryCheckError('')
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
      if (directoryScopeUnverified(body.data.plan)) success('检查完成。读取范围待核实，只可预览。')
      else if (body.data.plan.applyable && body.data.plan.conflicts.length > 0) success('检查完成。可以应用独立变更，其余项目待核对。')
      else success(body.data.plan.applyable ? '目录差异计划已生成，请核对后明确确认。' : '差异计划已生成，请查看阻断原因。')
    } catch (previewError) {
      const message = previewError instanceof Error ? previewError.message : `${providerLabel}目录差异生成失败。`
      if (selectedProviderRef.current === provider) setDirectoryCheckError(message)
      error(message)
    } finally {
      setDirectoryAction(null)
    }
  }

  async function applyLatestPlan() {
    if (!latestPlan || !canApply) return
    const providerLabel = providers.find(item => item.key === latestPlan.provider)?.label || latestPlan.provider
    setDirectoryAction('apply')
    try {
      const applyingFxiaoke = latestPlan.provider === 'fxiaoke'
      const confirmSummary = applyingFxiaoke
        ? `确认应用本次列明的纷享组织变更？${activePrimary?.id === latestPlan.targetSourceId ? '' : '应用后，纷享将成为目录主来源。'}`
          + (latestPlan.conflicts.length > 0 ? `${latestPlan.conflicts.length} 项待核对内容会保留。` : '')
        : `确认整体同步${providerLabel}组织目录，并将其作为目录主来源？`
          + `本次包含 ${latestPlan.snapshot.departmentCount} 个部门、${latestPlan.snapshot.employeeCount} 位员工及其归属，`
          + '旧来源与手工数据保留；未关联员工仍会显示，不会自动开账号或改变登录状态。'
      const accepted = await confirmAction(confirmSummary
        + (latestPlan.authorityReview ? directoryAuthoritySummary(latestPlan.authorityReview) : ''), {
        confirmText: applyingFxiaoke ? '确认应用' : '确认切换目录', danger: true,
      })
      if (!accepted) return
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
      if (!response.ok || !run) throw new Error(body.error || '组织变更应用失败。')
      setLatestPlan(current => current ? {
        ...current,
        status: 'applied',
        appliedAt: run.appliedAt || new Date().toISOString(),
        run,
      } : current)
      success(applyingFxiaoke ? '本次组织变更已应用。' : '目录主来源已原子切换；旧目录数据仍保留，可按本次运行回滚。')
      await refreshAll()
    } catch (applyError) {
      error(applyError instanceof Error ? applyError.message : '组织变更应用失败。')
    } finally {
      setDirectoryAction(null)
    }
  }

  async function resolvePrimaryReview(externalUserId: string, choice: 'keep_local' | 'adopt_source') {
    if (!access?.apply || !latestPlan || latestPlan.status !== 'planned' || directoryAction !== null) return
    setDirectoryAction('review')
    try {
      const response = await fetch('/api/admin/organization-sources/directory', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          action: 'review_primary', plan_id: latestPlan.id, plan_hash: latestPlan.planHash,
          external_user_id: externalUserId, choice,
        }),
      })
      const body = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(body.error || '主部门核对结果保存失败。')
      success(choice === 'keep_local' ? '已记录保留 ICU 的选择。' : '已记录采用纷享的选择，仍须确认应用。')
      await previewDirectory()
    } catch (reviewError) {
      error(reviewError instanceof Error ? reviewError.message : '主部门核对结果保存失败。')
    } finally {
      setDirectoryAction(null)
    }
  }

  async function resolveIdentityReview(externalUserId: string, choice: IdentityReviewChoice, userId: string | null, evidence: string) {
    if (!access?.apply || !access.enterpriseLogin || !latestPlan || latestPlan.status !== 'planned' || directoryAction !== null) return false
    setDirectoryAction('review')
    try {
      const response = await fetch('/api/admin/organization-sources/directory', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          action: 'review_identity', plan_id: latestPlan.id, plan_hash: latestPlan.planHash,
          external_user_id: externalUserId, choice, user_id: userId, evidence,
        }),
      })
      const body = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(readErrorMessage(body.error, '身份核对保存失败。'))
      success('已记录身份核对结果，请查看更新后的差异。')
      await previewDirectory()
      return true
    } catch (reviewError) {
      error(reviewError instanceof Error ? reviewError.message : '身份核对保存失败。')
      return false
    } finally {
      setDirectoryAction(null)
    }
  }

  async function resolvePermissionReview(userId: string, choices: DirectoryPermissionChoice[]) {
    if (!access?.apply || !access.enterpriseLogin || !latestPlan || latestPlan.status !== 'planned' || directoryAction !== null) return false
    setDirectoryAction('review')
    try {
      const response = await fetch('/api/admin/organization-sources/directory', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          action: 'review_permissions', plan_id: latestPlan.id, plan_hash: latestPlan.planHash,
          user_id: userId, choices,
        }),
      })
      const body = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(readErrorMessage(body.error, '权限核对保存失败。'))
      success('已记录权限核对结果，请查看更新后的差异。')
      await previewDirectory()
      return true
    } catch (reviewError) {
      error(reviewError instanceof Error ? reviewError.message : '权限核对保存失败。')
      return false
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
  const fxiaokeDirectory = directoryProvider === 'fxiaoke'
  const scopeUnverified = Boolean(latestPlan && directoryScopeUnverified(latestPlan))
  const pendingScopeReview = scopeUnverified && latestPlan?.status === 'planned'
  const overview = latestPlan && fxiaokeDirectory ? directoryOverview(latestPlan) : null
  const permissionReviews = latestPlan?.permissionReviews ?? []
  const reviewCount = (latestPlan?.conflicts.length ?? 0) + permissionReviews.length
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
    && !scopeUnverified && !directoryCheckError
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
    : pendingScopeReview ? '读取范围待核实'
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
  const rotationNeeded = Boolean(selectedProvider === 'fxiaoke' && directorySource?.status === 'active'
    && directorySource.connectionState === 'verified' && identityAuthoritative && directorySource.effectiveConnectionRevision
    && directorySource.effectiveConnectionRevision !== directorySource.connectionRevision)
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
    <div className={directoryOnly ? '' : 'rounded-lg border bg-white p-4'}>
      {!directoryOnly && <>
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
            <Badge variant={capabilityBadge(Boolean(latestPlan?.snapshot.complete) && !pendingScopeReview)}>{directoryScopeState}</Badge>
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
              canApply={access?.apply === true && !rotationNeeded}
              onChanged={refreshAll}
            />
            {rotationNeeded && directorySource?.draftCheckStatus === 'preview_ready' && access?.enterpriseLogin && access.apply ? (
              <FxiaokeCredentialVerification key={directorySource.connectionRevision} source={directorySource} onChanged={refreshAll} />
            ) : null}
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
      </>}

      <section className={directoryOnly ? undefined : 'mt-5 border-t pt-4'} aria-labelledby="directory-authority-title">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 id="directory-authority-title" className="text-sm font-medium text-slate-900">目录同步</h4>
            <p className="mt-0.5 text-[11px] leading-5 text-slate-500">
              {fxiaokeDirectory ? '检查纷享部门、员工及归属，确认后应用可处理的变更。' : '读取同一来源的部门、员工及归属，核对一份差异后整体同步。未关联账号的员工也会进入组织架构。'}
            </p>
          </div>
          <ArrowLeftRightIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        </div>

        {!directoryOnly && fxiaokeDirectory && directorySource && access?.enterpriseLogin && directoryReady && (
          <FxiaokeScopeProofForm key={`${directorySource.id}:${directorySource.effectiveConnectionRevision}`}
            source={directorySource} onVerified={previewDirectory} />
        )}
        {!directoryOnly && selected && access?.preview && (fxiaokeDirectory
          ? <DirectoryInspectionPanel
              key={`${selected.key}:${inspectionGeneration}`}
              provider={selected}
              showSchedule
              canEditSchedule={access.connect}
              onCheckCompleted={() => selectProvider(selected.key)}
            />
          : <details className="mt-3 text-xs text-slate-500">
              <summary className="cursor-pointer">查看连接读取诊断</summary>
              <DirectoryInspectionPanel key={`${selected.key}:${inspectionGeneration}`} provider={selected} />
            </details>)}

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
        {directoryCheckError && <p role="alert" className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
          本次检查失败。{directoryCheckError} {latestPlan ? '保留上次检查结果。' : ''}
        </p>}

        <div className="mt-3 rounded-lg border border-slate-200 p-3">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500">当前</span>
            <span className="font-medium text-slate-900">
              {activePrimary
                ? `${providers.find(provider => provider.key === activePrimary.provider)?.label || activePrimary.provider} · 权威`
                : '暂无外部目录主来源'}
            </span>
          </div>
          {!fxiaokeDirectory && <p className="mt-1 text-[11px] leading-5 text-slate-500">
            手工部门与旧来源会继续保留。同步统一更新{directoryLabel}的部门、目录员工和归属；未关联账号的员工显示为待关联，账号关联和角色保持不变。
          </p>}
          {fxiaokeDirectory && <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
            <span>差异确认单更新 {formatTime(latestPlan?.snapshot.checkedAt)}</span>
            <span>上次生效 {formatTime(directorySource?.lastSuccessfulSyncAt)}</span>
          </div>}
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
                  ? fxiaokeDirectory ? '生成差异确认单' : '读取组织目录并生成差异'
                  : `${directoryLabel}启用目录连接后可用`}
          </Button>}
        </div>

        {latestPlan && (access?.preview || access?.apply) && (
          <div className="mt-3 rounded-lg border border-slate-200 p-3" data-testid="directory-cutover-plan">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {latestPlan.applyable && !scopeUnverified
                  ? <CheckCircle2Icon className="h-4 w-4 text-emerald-600" />
                  : <AlertTriangleIcon className="h-4 w-4 text-amber-700" />}
                <span className="text-sm font-medium text-slate-900">
                  {latestPlan.status === 'applied'
                    ? '已应用'
                    : latestPlan.status === 'rolled_back'
                      ? '已回滚'
                      : latestPlan.status === 'superseded'
                        ? '已被新计划替代'
                        : planExpired ? '差异计划已过期'
                        : planVersionChanged ? '配置已改变 · 需重新生成差异'
                        : pendingScopeReview ? '读取范围待核实，只可预览'
                        : latestPlan.applyable
                          ? reviewCount > 0 ? '可应用独立变更' : '差异计划可执行'
                          : '差异计划被阻断'}
                </span>
              </div>
              {!fxiaokeDirectory && <Badge variant={latestPlan.applyable && reviewCount === 0 ? 'default' : 'destructive'}>
                {reviewCount} 个冲突
              </Badge>}
            </div>

            {overview ? <div className="mt-2"><DirectoryChangeSummary overview={overview} /></div> : <div className="mt-3 grid grid-cols-2 gap-2">
              <Metric label="新增部门" value={latestPlan.summary.departmentsAdded} />
              <Metric label="更新部门" value={latestPlan.summary.departmentsUpdated} />
              <Metric label={`停用旧${directoryLabel}部门`} value={latestPlan.summary.departmentsToDeactivate} tone="amber" />
              <Metric label="新增目录员工" value={latestPlan.summary.identitiesAdded} />
              <Metric label="更新目录员工" value={latestPlan.summary.identitiesUpdated} />
              <Metric label="冲突" value={latestPlan.summary.conflicts} tone={latestPlan.summary.conflicts ? 'rose' : 'emerald'} />
            </div>}

            <div className="mt-3 rounded-md border border-slate-200 px-2.5 py-2 text-xs leading-5" data-testid="directory-scope-evidence">
              <div>本次读取：{latestPlan.snapshot.departmentCount} 个部门，{latestPlan.snapshot.employeeCount} 位员工。</div>
              {fxiaokeDirectory
                ? <>
                  <div>部门与人员关系{latestPlan.snapshot.complete ? '校验通过' : '校验未通过'}。范围{scopeUnverified ? '待核实' : '已核实'}。</div>
                  {pendingScopeReview && <div className="text-amber-800">本次检查保留已生效的人员状态和部门关系。</div>}
                </>
                : <div>部门与人员关系：{latestPlan.snapshot.complete ? '校验通过' : '校验未通过'}；本次新建待关联人员 {latestPlan.identityChanges.filter(employee => employee.createsMember).length} 人。</div>}
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

            {permissionReviews.length > 0 && (
              <section className="mt-3 space-y-2" aria-label="个人权限待核对">
                <h5 className="text-xs font-medium text-slate-700">个人权限待核对</h5>
                {permissionReviews.map(review => (
                  <DirectoryPermissionReviewPanel key={`${review.userId}:${review.revision}`} review={review} busy={directoryAction !== null}
                    onReview={access?.apply && access.enterpriseLogin && !planExpired && !planVersionChanged && latestPlan.status === 'planned' && !scopeUnverified
                      ? choices => resolvePermissionReview(review.userId, choices) : undefined} />
                ))}
              </section>
            )}
            {latestPlan.conflicts.length > 0 && (
              <section className="mt-3" aria-label={latestPlan.applyable ? '待核对' : '待核对与阻断原因'}>
                <h5 className="text-xs font-medium text-slate-700">{latestPlan.applyable ? '待核对' : '待核对与阻断原因'}</h5>
                <ul className="mt-1 space-y-1.5">
                  {latestPlan.conflicts.map((item, index) => (
                  <li key={`${item.kind}-${item.externalId || index}`} className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-2 text-[11px] leading-5 text-rose-800">
                    {item.message}
                    {item.identityReview && (
                      <DirectoryIdentityReviewPanel review={item.identityReview} busy={directoryAction !== null}
                        onReview={item.externalId && access?.apply && access.enterpriseLogin && !planExpired && !planVersionChanged
                          && latestPlan.status === 'planned' && !directoryScopeUnverified(latestPlan)
                          ? (choice, userId, evidence) => resolveIdentityReview(item.externalId!, choice, userId, evidence)
                          : undefined} />
                    )}
                    {item.primaryReview && (
                      <div className="mt-1 space-y-1">
                        <p>ICU：{item.primaryReview.currentDepartmentName || '未分配'} · 纷享：{item.primaryReview.incomingDepartmentName}</p>
                        {item.externalId && access?.apply && !planExpired && !planVersionChanged
                          && latestPlan.status === 'planned' && !directoryScopeUnverified(latestPlan) && (
                          <div className="flex flex-wrap gap-2">
                            <Button variant="outline" size="sm" disabled={directoryAction !== null} onClick={() => resolvePrimaryReview(item.externalId!, 'keep_local')}>
                              保留 ICU 主部门
                            </Button>
                            <Button variant="outline" size="sm" disabled={directoryAction !== null} onClick={() => resolvePrimaryReview(item.externalId!, 'adopt_source')}>
                              采用纷享主部门
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                  ))}
                </ul>
              </section>
            )}

            {latestPlan.notices.length > 0 && (fxiaokeDirectory || reviewCount === 0) && (
              <ul className="mt-3 space-y-1 text-[11px] leading-5 text-slate-500">
                {latestPlan.notices.map(notice => <li key={notice}>• {notice}</li>)}
              </ul>
            )}

            {(latestPlan.identityChanges.some(change => change.kind !== 'unchanged')
              || (fxiaokeDirectory && latestPlan.departmentChanges.some(change => change.kind !== 'unchanged'))) && (
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer font-medium text-slate-700">
                  {fxiaokeDirectory ? latestPlan.status === 'applied' ? '查看已应用项目' : latestPlan.applyable && !pendingScopeReview ? '查看可应用项目' : '查看差异预览' : '查看身份匹配证据'}
                </summary>
                <ul className="mt-2 max-h-64 space-y-1.5 overflow-y-auto">
                  {fxiaokeDirectory && latestPlan.departmentChanges.filter(change => change.kind !== 'unchanged').map(change => (
                    <li key={`department-${change.externalId}`} className="rounded-md bg-slate-50 px-2.5 py-2 text-[11px] text-slate-600">
                      {change.name} · {change.kind === 'added' ? '新增部门' : '更新部门'}
                    </li>
                  ))}
                  {latestPlan.identityChanges.filter(change => change.kind !== 'unchanged').map(change => (
                    <li key={change.externalUserId} className="rounded-md bg-slate-50 px-2.5 py-2 text-[11px] text-slate-600">
                      {change.displayName} · {change.createsMember ? '新增成员' : change.kind === 'added' ? '关联已有成员' : change.changedFields.includes('primaryDepartmentExternalId') ? '更新归属' : '更新资料'}
                      {!change.createsMember && ` · 依据 ${methodLabel(change.matchMethod)}`}
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

            {(canApply || directoryAction === 'apply') && (
              <Button
                type="button"
                className="mt-3 w-full justify-center bg-blue-600 hover:bg-blue-700"
                disabled={directoryAction !== null}
                onClick={() => void applyLatestPlan()}
              >
                <ShieldCheckIcon className="mr-1 h-4 w-4" />
                {directoryAction === 'apply' ? '正在确认…' : fxiaokeDirectory ? '应用变更' : '确认切换目录主来源'}
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

      {!directoryOnly && <section className="mt-5 border-t pt-4" aria-labelledby="login-entry-title">
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
        {access?.enterpriseLogin && directoryProvider === 'fxiaoke' && (
          <dl className="mt-3 grid gap-1 text-xs text-slate-700">
            <div><dt className="inline font-medium">登录授权发起页域名</dt> <dd className="inline">sales.cyanlog.icu</dd></div>
            <div><dt className="inline font-medium">ICU 生产回调地址</dt> <dd className="inline break-all">https://sales.cyanlog.icu/api/auth/fxiaoke/callback</dd></div>
            <div><dt className="inline font-medium">纷享应用的 ICU 入口</dt> <dd className="inline break-all">https://sales.cyanlog.icu/api/auth/fxiaoke/entry</dd></div>
          </dl>
        )}
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
      </section>}
    </div>
  )
}

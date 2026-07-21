'use client'

import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  getAIConfigKind,
  groupAIConfigs,
  isAIPlatformAssetKind,
} from '@/lib/configs/ai-config-kind'
import {
  validateAIPlatformPublishGraph,
  type AIPlatformReferenceValidation,
} from '@/lib/configs/ai-platform'
import { BUSINESS_USE_POINT_REGISTRY } from '@/lib/configs/ai-platform-registry'
import { isMaskedApiKey } from '@/lib/configs/runtime'
import type { AIPlatformAssetKind } from '@/lib/configs/types'
import type {
  AIRuntimeAttempt,
  AIRuntimeOverview,
  AIRuntimePlan,
  AIRuntimeUsePointOverview,
  Config,
  ConfigPublishFeedback,
} from '../types'
import {
  AI_PLATFORM_KIND_LABELS,
  groupPlatformConfigRevisions,
  orderAndFilterReleaseConfigs,
  type PlatformConfigRevisionGroup,
  type ReleaseStatusFilter,
} from './ai-config-presentation'
import ConfigStatusBadge from './ConfigStatusBadge'
import { IntrinsicCardStack } from './IntrinsicCardStack'
import { PublishActionControl } from './PublishActionControl'
import {
  MODULE_LABELS,
  VERIFICATION_PRESENTATION,
  attemptFailureSummary,
  attemptOutcomeLabel,
  formatRuntimeNumber,
  formatRuntimeTime,
} from './ai-runtime-presentation'
import {
  RuntimeAttemptOutcomeStatus,
  RuntimeOverviewUnavailable,
  RuntimeRefreshButton,
  RuntimeReviewRunStatus,
} from './ai-runtime-status'

type AIWorkspaceView = 'models' | 'usage' | 'routing' | 'runtime' | 'release'

interface AIConfigTabProps {
  configs: Config[]
  runtimeOverview: AIRuntimeOverview | null
  runtimeError: string
  onRefreshRuntime: () => void | Promise<void>
  onNew: (kind: AIPlatformAssetKind) => void
  onEdit: (config: Config) => void
  onRevise: (config: Config) => void
  onPublish: (id: string) => void
  onVersions: (id: string) => void
  onDelete: (id: string) => void
  publishingConfigIds: ReadonlySet<string>
  publishFeedback: Record<string, ConfigPublishFeedback | undefined>
}

const TASKS: Array<{
  id: AIWorkspaceView
  step: string
  label: string
  description: string
}> = [
  { id: 'models', step: '1', label: '模型能力', description: '接入、可选模型与可用状态' },
  { id: 'usage', step: '2', label: '业务使用', description: '哪些产品功能使用 AI' },
  { id: 'routing', step: '3', label: '降级顺序', description: '主模型、备用模型与失败动作' },
  { id: 'runtime', step: '4', label: '实际执行', description: '本机与托管路线、真实调用' },
  { id: 'release', step: '5', label: '发布与版本', description: '依赖检查、草稿与历史' },
]

function viewFromUrl(href: string): AIWorkspaceView {
  const requested = new URL(href).searchParams.get('view')
  const migrated = requested === 'connections'
    ? 'models'
    : requested === 'applications' || requested === 'bindings'
      ? 'usage'
      : requested
  return TASKS.some((task) => task.id === migrated) ? migrated as AIWorkspaceView : 'models'
}

function releaseQueryFromUrl(href: string) {
  return new URL(href).searchParams.get('release_q') || ''
}

function releaseStatusFromUrl(href: string): ReleaseStatusFilter {
  const requested = new URL(href).searchParams.get('release_status')
  return requested === 'DRAFT' || requested === 'PUBLISHED' || requested === 'ARCHIVED'
    ? requested
    : 'ALL'
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

const CAPABILITY_LABELS: Record<string, string> = {
  text_generation: '文本生成',
  structured_output: '结构化结果',
  long_context: '长文档理解',
  vision: '视觉理解',
  tool_calling: '工具调用',
}

function capabilityText(values: string[]) {
  return values.map((value) => CAPABILITY_LABELS[value] || value).join(' / ')
}

function statusText(status: Config['status']) {
  if (status === 'PUBLISHED') return '已发布'
  if (status === 'ARCHIVED') return '已归档'
  return '草稿'
}

function formatUpdatedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '更新时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function credentialText(config: Config) {
  if (config.value.auth_mode !== 'bearer') return '无需认证'
  return typeof config.value.api_key === 'string' && isMaskedApiKey(config.value.api_key)
    ? 'Bearer Token · 凭据已安全保存'
    : 'Bearer Token · 凭据未配置'
}

function InlinePublishFeedback({ feedback }: { feedback?: ConfigPublishFeedback }) {
  if (!feedback) return null
  return (
    <div
      role={feedback.tone === 'error' ? 'alert' : 'status'}
      aria-live={feedback.tone === 'error' ? 'assertive' : 'polite'}
      className={feedback.tone === 'error'
        ? 'rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800'
        : 'rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800'}
    >
      {feedback.message}
    </div>
  )
}

function AssetActions({
  config,
  onEdit,
  onRevise,
  onPublish,
  onVersions,
  onDelete,
  publishingConfigIds,
  publishFeedback,
}: Pick<AIConfigTabProps, 'onEdit' | 'onRevise' | 'onPublish' | 'onVersions' | 'onDelete' | 'publishingConfigIds' | 'publishFeedback'> & { config: Config }) {
  const publishing = publishingConfigIds.has(config.id)
  const feedback = publishFeedback[config.id]

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {config.status === 'DRAFT' ? (
          <>
            <Button variant="outline" size="sm" className="min-h-11" disabled={publishing} onClick={() => onEdit(config)}>编辑</Button>
            <PublishActionControl
              pending={publishing}
              feedback={feedback}
              onPublish={() => onPublish(config.id)}
            />
            <Button variant="outline" size="sm" className="min-h-11" disabled={publishing} onClick={() => onDelete(config.id)}>删除草稿</Button>
          </>
        ) : (
          <Button variant="outline" size="sm" className="min-h-11" onClick={() => onRevise(config)}>
            {config.status === 'ARCHIVED' ? '重新创建草稿' : '基于当前版本新建草稿'}
          </Button>
        )}
        <Button variant="ghost" size="sm" className="min-h-11" onClick={() => onVersions(config.id)}>版本记录</Button>
      </div>
      {config.status !== 'DRAFT' && <InlinePublishFeedback feedback={feedback} />}
    </div>
  )
}

function EmptyState({ title, action, onClick }: { title: string; action: string; onClick: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center">
      <p className="text-sm text-slate-600">{title}</p>
      <Button className="mt-4 min-h-11" onClick={onClick}>{action}</Button>
    </div>
  )
}

function AssetHeader({ config, showStatus = true }: { config: Config; showStatus?: boolean }) {
  const kind = getAIConfigKind(config.value)
  return (
    <div className="flex min-w-0 flex-1 items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-slate-950">{config.name}</h3>
          {showStatus && <ConfigStatusBadge status={config.status} />}
          {config.value.enabled === false && <Badge variant="outline">已停用</Badge>}
        </div>
      </div>
      {kind && isAIPlatformAssetKind(kind) && (
        <Badge variant="outline" className="shrink-0">{AI_PLATFORM_KIND_LABELS[kind]}</Badge>
      )}
    </div>
  )
}

function RevisionSummary({ group }: { group: PlatformConfigRevisionGroup }) {
  const hasPublished = group.published.length > 0
  const hasDraft = group.drafts.length > 0

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2" aria-label="版本状态摘要">
        {hasPublished && <Badge className="bg-emerald-100 text-emerald-800">当前已发布版本</Badge>}
        {hasDraft && <Badge className="bg-blue-100 text-blue-800">待发布草稿 {group.drafts.length} 份</Badge>}
        {group.archived.length > 0 && <Badge variant="outline">历史版本 {group.archived.length} 个</Badge>}
      </div>
      {hasDraft && (
        <p className="mt-3 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-900">
          {hasPublished
            ? '草稿尚未影响当前业务。下方展示的是已发布版本；编辑、发布和删除操作只针对草稿。'
            : '当前还没有已发布版本，草稿不会被业务功能使用；完成检查并发布后才会生效。'}
        </p>
      )}
      <details className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-slate-700">查看版本与审计标识</summary>
        <div className="border-t border-slate-200 pt-3">
          <div className="text-xs text-slate-500">稳定配置编号</div>
          <div className="mt-1 break-all font-mono text-xs text-slate-700">{group.assetId}</div>
          <ol className="mt-3 space-y-2">
            {group.records.map((record) => (
              <li key={record.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-slate-900">
                    {record.status === 'PUBLISHED' ? '当前已发布' : record.status === 'DRAFT' ? '待发布草稿' : '历史版本'}
                  </span>
                  <span>{formatUpdatedAt(record.updated_at)}</span>
                </div>
                <div className="mt-1 break-all font-mono">版本记录编号：{record.key}</div>
              </li>
            ))}
          </ol>
        </div>
      </details>
    </div>
  )
}

function RevisionCard({
  group,
  children,
  ...actions
}: Pick<AIConfigTabProps, 'onEdit' | 'onRevise' | 'onPublish' | 'onVersions' | 'onDelete' | 'publishingConfigIds' | 'publishFeedback'> & {
  group: PlatformConfigRevisionGroup
  children: React.ReactNode
}) {
  const actionTarget = group.drafts[0] || group.primary

  return (
    <article className="rounded-2xl border border-slate-200 p-4 [contain-intrinsic-size:auto_320px] [content-visibility:auto]">
      <AssetHeader config={group.primary} showStatus={false} />
      <RevisionSummary group={group} />
      {children}
      <div className="mt-4 border-t border-slate-100 pt-4">
        <AssetActions config={actionTarget} {...actions} />
      </div>
    </article>
  )
}

function BusinessStatusLayers({ item }: { item?: AIRuntimeUsePointOverview }) {
  const planReady = item?.plan.state === 'ready'
  const verification = item?.verification
  const invocationState = verification === 'passed'
    ? '当前计划调用通过'
    : verification === 'fallback_passed'
      ? '备用模型调用通过'
      : verification === 'failed'
        ? '最近调用失败'
        : verification === 'incomplete_evidence'
          ? '调用记录不完整'
          : verification === 'stale'
            ? '调用结果已过期'
            : verification === 'evidence_unavailable'
              ? '调用记录暂不可读'
              : verification === 'not_verified'
                ? '尚未执行真实任务'
                : planReady
                  ? '尚未执行真实任务'
                  : '需先补全运行计划'
  const layers = [
    {
      label: '1. 配置发布',
      value: planReady ? '所需配置已发布' : item ? '发布关系待补全' : '状态尚未加载',
    },
    {
      label: '2. 当前环境',
      value: planReady ? '具备可执行路线' : item ? '暂不可执行' : '状态尚未加载',
    },
    { label: '3. 模型调用', value: invocationState },
    { label: '4. 业务结果', value: '回到对应功能验收' },
  ]

  return (
    <ol className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="配置到业务验收的四层状态">
      {layers.map((layer) => (
        <li key={layer.label} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
          <div className="text-xs font-medium text-slate-500">{layer.label}</div>
          <div className="mt-1 text-sm font-medium text-slate-900">{layer.value}</div>
        </li>
      ))}
    </ol>
  )
}

export default function AIConfigTab({
  configs,
  runtimeOverview,
  runtimeError,
  onRefreshRuntime,
  onNew,
  onEdit,
  onRevise,
  onPublish,
  onVersions,
  onDelete,
  publishingConfigIds,
  publishFeedback,
}: AIConfigTabProps) {
  const [view, setView] = useState<AIWorkspaceView>('models')
  const grouped = useMemo(() => groupAIConfigs(configs), [configs])
  const platformConfigs = useMemo(() => configs.filter((config) => {
    const kind = getAIConfigKind(config.value)
    return kind !== null && isAIPlatformAssetKind(kind)
  }), [configs])
  const revisionGroups = useMemo(() => groupPlatformConfigRevisions(platformConfigs), [platformConfigs])
  const providerGroups = revisionGroups.filter((group) => group.kind === 'provider_connection')
  const modelGroups = revisionGroups.filter((group) => group.kind === 'model_catalog_entry')
  const applicationGroups = revisionGroups.filter((group) => group.kind === 'ai_application')
  const usePointGroups = revisionGroups.filter((group) => group.kind === 'business_use_point')
  const bindingGroups = revisionGroups.filter((group) => group.kind === 'application_binding')
  const routeGroups = revisionGroups.filter((group) => group.kind === 'route_policy')
  const legacyConfigs = [
    ...grouped.legacyProviders,
    ...grouped.legacyApplications,
    ...grouped.legacyToolPolicies,
    ...grouped.unclassified,
  ]
  const draftReadiness = useMemo(() => new Map(platformConfigs
    .filter((config) => config.status === 'DRAFT')
    .map((config) => [config.id, validateAIPlatformPublishGraph(config, platformConfigs, {
      allowMaskedCredentialForPresentation: true,
    })])), [platformConfigs])

  useEffect(() => {
    const syncViewFromUrl = () => setView(viewFromUrl(window.location.href))
    syncViewFromUrl()
    const onPopState = () => syncViewFromUrl()
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  function changeView(next: AIWorkspaceView) {
    setView(next)
    const url = new URL(window.location.href)
    url.searchParams.set('view', next)
    window.history.pushState({}, '', url)
  }

  return (
    <div className="space-y-6" data-testid="ai-platform-workspace">
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle className="text-lg">AI 平台配置</CardTitle>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                先确认有哪些模型能力可用，再决定哪些产品功能使用它、失败时按什么顺序切换，最后核对本机与托管环境真正会执行哪条路线。
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
              <div className="font-semibold text-slate-900">四层状态不能混淆</div>
              配置已发布、当前环境可执行、模型真实调用、业务结果验收，必须逐层确认。
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <nav aria-label="AI 平台配置任务" className="flex gap-2 overflow-x-auto pb-1 xl:grid xl:grid-cols-5 xl:overflow-visible xl:pb-0">
            {TASKS.map((task) => {
              const active = view === task.id
              return (
                <button
                  key={task.id}
                  type="button"
                  aria-current={active ? 'step' : undefined}
                  onClick={() => changeView(task.id)}
                  className={`min-h-16 min-w-[168px] rounded-xl border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-600 focus-visible:ring-offset-2 xl:min-h-[76px] xl:min-w-0 ${
                    active
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'
                  }`}
                >
                  <div className="text-sm font-semibold">{task.step}. {task.label}</div>
                  <div className={`mt-1 text-xs ${active ? 'text-slate-300' : 'text-slate-500'}`}>{task.description}</div>
                </button>
              )
            })}
          </nav>
        </CardContent>
      </Card>

      {view === 'models' && (
        <div className="space-y-6">
          <TaskSection
            title="模型服务接入"
            description="先配置如何访问本地或云端模型服务。这里不选择合同功能，也不决定降级顺序。"
            actionLabel="新增模型服务"
            onAction={() => onNew('provider_connection')}
          >
            {providerGroups.length === 0 ? (
              <EmptyState title="还没有模型服务连接。" action="创建第一条连接" onClick={() => onNew('provider_connection')} />
            ) : (
              <IntrinsicCardStack label="模型服务连接列表">
                {providerGroups.map((group) => {
                  const config = group.primary
                  const isLocal = config.value.runtime_location === 'local'
                  return (
                    <RevisionCard
                      key={group.key}
                      group={group}
                      {...{ onEdit, onRevise, onPublish, onVersions, onDelete, publishingConfigIds, publishFeedback }}
                    >
                      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                        <Fact label="服务位置" value={isLocal ? '本机模型服务' : '公网云模型服务'} />
                        <Fact label="访问方式" value={credentialText(config)} />
                        <Fact label="服务地址" value={String(config.value.base_url || '未配置')} wide />
                      </dl>
                      <p className={`mt-3 rounded-xl border px-3 py-2 text-xs leading-5 ${isLocal
                        ? 'border-blue-200 bg-blue-50 text-blue-900'
                        : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}
                      >
                        {isLocal
                          ? '仅本机运行时可以访问；部署到托管环境后会在调用前排除，不会记成模型失败或降级。'
                          : '本机和托管环境都可加入执行路线；是否真实可用仍以模型测试和业务调用记录为准。'}
                      </p>
                    </RevisionCard>
                  )
                })}
              </IntrinsicCardStack>
            )}
          </TaskSection>

          <TaskSection
            title="可用模型与能力"
            description="一个模型服务可以登记多个模型。这里说明模型能做什么；业务模块和降级顺序在后续步骤选择。"
            actionLabel="新增模型"
            onAction={() => onNew('model_catalog_entry')}
          >
            {modelGroups.length === 0 ? (
              <EmptyState title="还没有可供业务选择的模型。" action="登记模型" onClick={() => onNew('model_catalog_entry')} />
            ) : (
              <IntrinsicCardStack label="可用模型列表">
                {modelGroups.map((group) => {
                  const config = group.primary
                  const provider = providerGroups.find((item) => item.assetId === config.value.provider_connection_id)
                  return (
                    <RevisionCard
                      key={group.key}
                      group={group}
                      {...{ onEdit, onRevise, onPublish, onVersions, onDelete, publishingConfigIds, publishFeedback }}
                    >
                      <dl className="mt-4 grid gap-3 text-sm md:grid-cols-3">
                        <Fact label="所属模型服务" value={provider?.primary.name || '连接已停用或不存在'} />
                        <Fact label="服务商模型名称" value={String(config.value.model_id || '未设置')} />
                        <Fact label="可提供能力" value={capabilityText(stringList(config.value.capabilities)) || '未定义'} />
                      </dl>
                      <ModelAvailabilitySummary
                        modelGroup={group}
                        providerGroup={provider}
                        overview={runtimeOverview}
                      />
                    </RevisionCard>
                  )
                })}
              </IntrinsicCardStack>
            )}
          </TaskSection>
        </div>
      )}

      {view === 'usage' && (
        <div className="space-y-6">
          <TaskSection
            title="业务使用总览"
            description="从产品功能出发查看它需要什么 AI 能力、当前绑定到哪个应用，以及是否已经具备可执行路线。"
          >
            <IntrinsicCardStack label="业务使用总览列表">
              {BUSINESS_USE_POINT_REGISTRY.map((definition) => {
                const runtimeItem = runtimeOverview?.use_points.find((item) => item.use_point.asset_id === definition.asset_id)
                const readyPlan = runtimeItem?.plan.state === 'ready' ? runtimeItem.plan : null
                const planReady = readyPlan !== null
                return (
                  <article key={definition.asset_id} className="rounded-2xl border border-slate-200 p-4">
                    <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-semibold text-slate-950">{definition.display_name}</h3>
                          <Badge variant="outline">{MODULE_LABELS[definition.module_id] || definition.module_id}</Badge>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-600">{definition.description}</p>
                      </div>
                      <Badge className={planReady ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}>
                        {planReady ? '当前环境可执行' : runtimeItem ? '运行计划待补全' : '状态尚未加载'}
                      </Badge>
                    </header>
                    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                      <Fact label="需要的能力" value={capabilityText(definition.required_capabilities)} />
                      <Fact label="当前 AI 能力" value={readyPlan?.application.name || '尚无可执行选择'} />
                      <Fact label="执行与降级" value={readyPlan?.route.name || '尚无可执行路线'} />
                    </dl>
                    <BusinessStatusLayers item={runtimeItem} />
                  </article>
                )
              })}
            </IntrinsicCardStack>
          </TaskSection>

          <details className="rounded-2xl border border-slate-200 bg-white px-4 py-2">
            <summary className="min-h-12 cursor-pointer py-3 text-sm font-semibold text-slate-900">
              调整产品功能与 AI 能力的详细配置
            </summary>
            <div className="space-y-6 border-t border-slate-200 py-5">
              <TaskSection
                title="可复用 AI 能力"
                description="一项 AI 能力可以被多个产品功能复用；它不直接保存服务地址或具体模型。"
                actionLabel="新增 AI 能力"
                onAction={() => onNew('ai_application')}
              >
                <AssetList
                  groups={applicationGroups}
                  empty="还没有可复用的 AI 能力。"
                  detail={(config) => `可以提供：${capabilityText(stringList(config.value.capabilities)) || '未定义'}`}
                  {...{ onEdit, onRevise, onPublish, onVersions, onDelete, publishingConfigIds, publishFeedback }}
                />
              </TaskSection>

              <TaskSection
                title="产品功能入口"
                description="登记产品中真正需要 AI 的动作和能力要求；这里只选择系统已经支持的功能入口。"
                actionLabel="登记功能入口"
                onAction={() => onNew('business_use_point')}
              >
                <IntrinsicCardStack label="产品功能入口列表">
                  {BUSINESS_USE_POINT_REGISTRY.map((definition) => {
                    const group = usePointGroups.find((item) => item.assetId === definition.asset_id)
                    const detail = (
                      <>
                        <p className="mt-3 text-sm leading-6 text-slate-600">{definition.description}</p>
                        <p className="mt-2 text-xs text-slate-500">需要：{capabilityText(definition.required_capabilities)}</p>
                      </>
                    )
                    if (group) {
                      return (
                        <RevisionCard
                          key={group.key}
                          group={group}
                          {...{ onEdit, onRevise, onPublish, onVersions, onDelete, publishingConfigIds, publishFeedback }}
                        >
                          {detail}
                        </RevisionCard>
                      )
                    }
                    return (
                      <article key={definition.asset_id} className="rounded-2xl border border-slate-200 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="text-sm font-semibold text-slate-950">{definition.display_name}</h3>
                          <Badge variant="outline">未登记</Badge>
                        </div>
                        {detail}
                      </article>
                    )
                  })}
                </IntrinsicCardStack>
              </TaskSection>
              <TaskSection
                title="选择每个功能使用的 AI 能力"
                description="把产品功能连接到已发布 AI 能力。模型选择和备用顺序仍由下一步统一管理。"
                actionLabel="新增业务选择"
                onAction={() => onNew('application_binding')}
              >
                <AssetList
                  groups={bindingGroups}
                  empty="还没有产品功能与 AI 能力的选择关系。"
                  detail={(config) => {
                    const usePoint = usePointGroups.find((item) => item.assetId === config.value.business_use_point_id)
                    const application = applicationGroups.find((item) => item.assetId === config.value.ai_application_id)
                    return `${usePoint?.primary.name || '产品功能入口已停用或不存在'} → ${application?.primary.name || 'AI 能力已停用或不存在'}`
                  }}
                  {...{ onEdit, onRevise, onPublish, onVersions, onDelete, publishingConfigIds, publishFeedback }}
                />
              </TaskSection>
            </div>
          </details>
        </div>
      )}

      {view === 'routing' && (
        <TaskSection
          title="主模型与备用模型顺序"
          description="管理员为每项 AI 能力配置主模型、备用模型和全部失败后的处理方式。这里保存的是发布顺序；托管环境会在调用前排除仅本机可达的模型。"
          actionLabel="新增降级策略"
          onAction={() => onNew('route_policy')}
        >
          {routeGroups.length === 0 ? (
            <EmptyState title="还没有模型执行顺序。" action="配置第一条降级策略" onClick={() => onNew('route_policy')} />
          ) : (
            <IntrinsicCardStack label="模型降级策略列表">
              {routeGroups.map((group) => {
                const config = group.primary
                const application = applicationGroups.find((item) => item.assetId === config.value.ai_application_id)
                const modelIds = stringList(config.value.model_catalog_entry_ids)
                return (
                  <RevisionCard
                    key={group.key}
                    group={group}
                    {...{ onEdit, onRevise, onPublish, onVersions, onDelete, publishingConfigIds, publishFeedback }}
                  >
                    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                      <div className="font-medium text-slate-950">
                        服务能力：{application?.primary.name || 'AI 能力已停用或不存在'}
                      </div>
                      <ol className="mt-3 space-y-2" aria-label="管理员配置的模型降级顺序">
                        {modelIds.map((modelId, index) => {
                          const model = modelGroups.find((item) => item.assetId === modelId)
                          const provider = providerGroups.find((item) => item.assetId === model?.primary.value.provider_connection_id)
                          const isLocal = provider?.primary.value.runtime_location === 'local'
                          return (
                            <li key={modelId} className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white px-3 py-3 sm:flex-row sm:items-center">
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">{index + 1}</span>
                              <div className="min-w-0 flex-1">
                                <div className="truncate font-medium text-slate-950">{model?.primary.name || '不可用模型'}</div>
                                <div className="mt-1 truncate text-xs text-slate-500">{provider?.primary.name || '模型服务不可用'}</div>
                              </div>
                              <Badge variant="outline" className={isLocal ? 'border-blue-200 bg-blue-50 text-blue-900' : undefined}>
                                {isLocal ? '仅本机可达' : '托管可达'}
                              </Badge>
                            </li>
                          )
                        })}
                      </ol>
                      <p className="mt-3 text-xs leading-5 text-slate-600">
                        全部可执行模型失败后：{config.value.failure_action === 'stop' ? '停止任务并提示错误' : '转交人工处理'}。
                      </p>
                    </div>
                  </RevisionCard>
                )
              })}
            </IntrinsicCardStack>
          )}
        </TaskSection>
      )}

      {view === 'release' && (
        <div className="space-y-6">
          <TaskSection
            title="发布检查"
            description="每类配置独立发布。系统在发布前检查引用、启用状态和能力匹配；缺少哪一环会明确说明。"
          >
            <ReleaseList
              configs={platformConfigs}
              readiness={draftReadiness}
              {...{ onEdit, onRevise, onPublish, onVersions, onDelete, publishingConfigIds, publishFeedback }}
            />
          </TaskSection>

          <Card>
            <CardHeader><CardTitle className="text-base">历史配置边界</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm leading-6 text-slate-600">
              <p>
                当前只读保留 <strong className="text-slate-950">{legacyConfigs.length}</strong> 条旧版配置记录。
                它们不参与当前运行计划，也不能作为模型可用证据。
              </p>
              {legacyConfigs.length > 0 && (
                <details className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <summary className="cursor-pointer font-medium text-slate-900">查看只读兼容记录</summary>
                  <ul className="mt-3 space-y-2">
                    {legacyConfigs.map((config) => (
                      <li key={config.id} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2">
                        <span className="min-w-0 truncate">{config.name}</span>
                        <span className="shrink-0 text-xs text-slate-500">{statusText(config.status)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {view === 'runtime' && (
        <RuntimeTruthPanel overview={runtimeOverview} error={runtimeError} onRefresh={onRefreshRuntime} />
      )}
    </div>
  )
}

function ModelAvailabilitySummary({
  modelGroup,
  providerGroup,
  overview,
}: {
  modelGroup: PlatformConfigRevisionGroup
  providerGroup?: PlatformConfigRevisionGroup
  overview: AIRuntimeOverview | null
}) {
  const publishedModel = modelGroup.published[0]
  const publishedProvider = providerGroup?.published[0]
  const isLocal = publishedProvider?.value.runtime_location === 'local'
  const publishedModelAssetId = publishedModel && String(publishedModel.value.asset_id || modelGroup.assetId)
  const publishedProviderAssetId = publishedProvider && String(publishedProvider.value.asset_id || providerGroup?.assetId || '')
  const latestAttempt = publishedModelAssetId && publishedProviderAssetId
    ? overview?.use_points
      .flatMap((item) => item.latest_attempts)
      .filter((attempt) => (
        attempt.matches_current_plan
        && attempt.model_catalog_entry_id === publishedModelAssetId
        && attempt.provider_connection_id === publishedProviderAssetId
      ))
      .sort((left, right) => String(right.occurred_at || '').localeCompare(String(left.occurred_at || '')))[0]
    : undefined

  let label = '已发布，尚未真实验证'
  let description = '可以加入业务执行顺序；请通过模型测试或真实业务任务验证。'
  let className = 'border-slate-200 bg-slate-50 text-slate-800'

  if (!publishedModel) {
    label = '模型尚未发布'
    description = '草稿不会被任何业务功能使用。'
    className = 'border-amber-200 bg-amber-50 text-amber-900'
  } else if (!publishedProvider) {
    label = '模型服务尚未发布'
    description = '先发布并启用所属模型服务，模型才能进入业务路线。'
    className = 'border-rose-200 bg-rose-50 text-rose-900'
  } else if (publishedModel.value.enabled === false) {
    label = '模型已停用'
    description = '已停用模型不会进入任何产品功能的执行路线。'
    className = 'border-amber-200 bg-amber-50 text-amber-900'
  } else if (publishedProvider.value.enabled === false) {
    label = '模型服务已停用'
    description = '先启用并重新发布模型服务，所属模型才可能进入执行路线。'
    className = 'border-amber-200 bg-amber-50 text-amber-900'
  } else if (latestAttempt?.snapshot_integrity === 'invalid') {
    label = '最近调用记录无效'
    description = '记录无法对应当前已发布计划，不能用来判断这个模型是否可用。'
    className = 'border-amber-200 bg-amber-50 text-amber-900'
  } else if (latestAttempt?.freshness === 'stale') {
    label = '最近验证已过期'
    description = '需要在当前已发布计划下重新执行模型测试或真实业务任务。'
    className = 'border-amber-200 bg-amber-50 text-amber-900'
  } else if (
    latestAttempt?.snapshot_integrity === 'verified'
    && latestAttempt.freshness === 'fresh'
    && (latestAttempt.outcome === 'passed' || latestAttempt.outcome === 'fallback_passed')
  ) {
    label = latestAttempt.execution_mode === 'pinned' ? '最近模型测试通过' : '最近真实业务调用通过'
    description = latestAttempt.tokens.total === null
      ? '调用成功但用量记录缺失，不能作为完整验收。'
      : `已记录 ${formatRuntimeNumber(latestAttempt.tokens.total)} token；业务输出质量仍在对应功能中验收。${isLocal ? ' 此模型只在本机可达，托管路线会在调用前排除。' : ''}`
    className = 'border-emerald-200 bg-emerald-50 text-emerald-900'
  } else if (latestAttempt?.freshness === 'fresh' && latestAttempt.outcome === 'failed') {
    label = '最近真实调用失败'
    description = `${attemptFailureSummary(latestAttempt) || '请检查模型服务后重新验证。'}${isLocal ? ' 此模型只在本机可达，托管路线不会执行。' : ''}`
    className = 'border-rose-200 bg-rose-50 text-rose-900'
  } else if (isLocal) {
    label = '本机可选，托管路线会排除'
    description = '此模型服务只在本机可达；托管环境会在调用前排除，不记为模型失败或降级。'
    className = 'border-blue-200 bg-blue-50 text-blue-900'
  }

  return (
    <div
      className={`mt-3 rounded-xl border px-3 py-2 text-xs leading-5 ${className}`}
      data-testid={`model-availability-${modelGroup.assetId}`}
    >
      <div className="font-semibold">{label}</div>
      <p className="mt-1">{description}</p>
    </div>
  )
}

function ProjectionPlanColumn({ title, plan }: { title: string; plan: AIRuntimePlan }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h5 className="text-sm font-semibold text-slate-900">{title}</h5>
        <Badge className={plan.state === 'ready'
          ? 'bg-emerald-100 text-emerald-800'
          : 'bg-amber-100 text-amber-900'}
        >
          {plan.state === 'ready' ? '可执行' : '待补全'}
        </Badge>
      </div>
      {plan.state === 'blocked' ? (
        <div className="mt-3 rounded-lg bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-900">
          <div>{plan.reason}</div>
          <div className="mt-2 font-medium">下一步：{plan.next_action}</div>
        </div>
      ) : (
        <ol className="mt-3 space-y-2">
          {plan.candidates.map((candidate) => (
            <li key={`${title}:${candidate.model_catalog_entry_id}:${candidate.provider_connection_id}`} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-slate-950">{candidate.position}. {candidate.model_name}</span>
                <span className="text-xs text-slate-500">{candidate.role === 'primary' ? '本环境首选' : '失败后备用'}</span>
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {candidate.provider_name} · {candidate.runtime_location === 'local' ? '本机模型服务' : '云模型服务'}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function RuntimeRouteProjection({ item }: { item: AIRuntimeUsePointOverview }) {
  const localPlan = item.environment_projections.local
  const hostedPlan = item.environment_projections.hosted
  const configuredPlan = localPlan.state === 'ready'
    ? localPlan
    : hostedPlan.state === 'ready'
      ? hostedPlan
      : null
  const hostedExcluded = hostedPlan.state === 'ready'
    ? hostedPlan.configured_candidates.filter((candidate) => candidate.execution_status === 'excluded_from_hosted')
    : []

  return (
    <section className="rounded-2xl border border-slate-200" data-testid="runtime-route-projection">
      <div className="border-b border-slate-200 px-4 py-3">
        <h4 className="text-sm font-semibold text-slate-950">配置顺序与实际执行</h4>
        <p className="mt-1 text-xs leading-5 text-slate-500">实际调用只沿管理员发布的顺序执行，不会绕过配置选择其他模型。</p>
      </div>
      <div className="grid gap-4 p-4 xl:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-3">
          <h5 className="text-sm font-semibold text-slate-900">管理员发布顺序</h5>
          {configuredPlan ? (
            <ol className="mt-3 space-y-2">
              {configuredPlan.configured_candidates.map((candidate) => (
                <li key={`configured:${candidate.model_catalog_entry_id}:${candidate.provider_connection_id}`} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
                  <div className="font-medium text-slate-950">{candidate.position}. {candidate.model_name}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {candidate.provider_name} · {candidate.runtime_location === 'local' ? '仅本机可达' : '本机与托管均可达'}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-900">
              发布关系尚未形成完整路线，暂时无法展示管理员模型顺序。
            </p>
          )}
        </section>
        <ProjectionPlanColumn title="本机实际路线" plan={localPlan} />
        <ProjectionPlanColumn title="托管实际路线" plan={hostedPlan} />
      </div>
      {hostedExcluded.length > 0 && (
        <p className="border-t border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-950">
          托管路线已排除 {hostedExcluded.length} 个仅本机模型。排除发生在调用前，不计为失败或降级；排除后的第一个云模型仍是托管执行的首选模型。
        </p>
      )}
    </section>
  )
}

export function RuntimeTruthPanel({
  overview,
  error,
  onRefresh,
}: {
  overview: AIRuntimeOverview | null
  error: string
  onRefresh: () => void | Promise<void>
}) {
  if (error) {
    return (
      <Card>
        <CardContent className="py-8">
          <RuntimeOverviewUnavailable error={error} onRefresh={onRefresh} />
        </CardContent>
      </Card>
    )
  }

  if (!overview) {
    return (
      <Card>
        <CardContent className="py-4">
          <RuntimeOverviewUnavailable error="" onRefresh={onRefresh} />
        </CardContent>
      </Card>
    )
  }

  const environmentLabel = overview.execution_environment === 'hosted' ? '托管服务端' : '本机服务端'

  return (
    <div className="space-y-6" aria-live="polite" data-testid="ai-runtime-truth">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle className="text-base">实际执行路线与真实结果</CardTitle>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                每个产品功能先选择 AI 能力，再使用管理员发布的模型顺序。这里分别展示管理员配置、本机路线和托管路线，避免把本机可用误当成线上可用。
              </p>
            </div>
            <div className="shrink-0 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <div className="font-semibold text-slate-950">检查环境：{environmentLabel}</div>
              <div className="mt-1 text-xs text-slate-500">更新于 {formatRuntimeTime(overview.generated_at)}</div>
              <RuntimeRefreshButton onRefresh={onRefresh} className="mt-3 w-full" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">
            本次检查覆盖 {formatRuntimeNumber(overview.summary.registered_use_points)} 个产品功能：
            {formatRuntimeNumber(overview.summary.ready_plans)} 个在{environmentLabel}具备可执行路线，
            {formatRuntimeNumber(overview.summary.blocked_plans)} 个仍需补全配置，
            {formatRuntimeNumber(overview.summary.verified_current_plans)} 个已有当前计划的真实调用结果。
          </p>
          {!overview.evidence.available && (
            <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
              {overview.evidence.error || '真实模型调用证据不可读；当前不能判断模型是否可用。'}
            </div>
          )}
          <p className="text-xs leading-5 text-slate-500">
            “当前环境可执行”只说明发布关系完整且至少有一个当前环境可达的模型；它不等于模型连接成功，也不等于业务输出通过验收。
          </p>
          <p className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-900">
            “模型真实通过”只证明同一次执行获得模型服务响应、完整用量记录和所需审核记录；
            规则加载、业务输出质量与独立金标准确度仍需回到对应产品功能单独验收。
          </p>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {overview.use_points.map((item) => (
          <RuntimeUsePointCard key={item.use_point.asset_id} item={item} />
        ))}
      </div>
    </div>
  )
}

function RuntimeUsePointCard({ item }: { item: AIRuntimeUsePointOverview }) {
  const presentation = VERIFICATION_PRESENTATION[item.verification]
  const currentAttempt = item.latest_current_attempt

  return (
    <article
      className="rounded-2xl border border-slate-200 bg-white p-5 [contain-intrinsic-size:auto_520px] [content-visibility:auto]"
      data-testid={`runtime-use-point-${item.use_point.asset_id}`}
    >
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-slate-950">{item.use_point.name}</h3>
            <Badge variant="outline">{MODULE_LABELS[item.use_point.module_id] || item.use_point.module_id}</Badge>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{item.use_point.description}</p>
        </div>
        <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${presentation.className}`}>
          {presentation.label}
        </span>
      </header>

      <p className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">
        {presentation.description}
      </p>

      <BusinessStatusLayers item={item} />

      {!item.evidence_available && (
        <div role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
          这个产品功能的调用结果暂时不可读；执行路线仍可检查，但不能判断模型是否可用。
        </div>
      )}

      {item.plan.state === 'blocked' ? (
        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm leading-6 text-rose-900">
          <div className="font-semibold">阻断原因</div>
          <p className="mt-1 break-words">{item.plan.reason}</p>
          <div className="mt-3 font-semibold">下一步</div>
          <p className="mt-1 break-words">{item.plan.next_action}</p>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <RuntimeFact label="业务模块" value={MODULE_LABELS[item.use_point.module_id] || item.use_point.module_id} />
            <RuntimeFact label="使用的 AI 能力" value={item.plan.application.name} />
            <RuntimeFact label="降级策略" value={item.plan.route.name} />
            <RuntimeFact
              label="全部候选失败后"
              value={item.plan.route.failure_action === 'manual_review' ? '转人工处理' : '停止并报错'}
            />
          </dl>

          {item.latest_current_execution_attempts.length > 0 && !item.latest_current_execution_complete && (
            <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
              最近一次业务执行的候选序号、前序失败或最终结果不完整；这组记录只作为排错线索，不能证明模型可用。
            </div>
          )}

          {item.latest_pinned_attempt && (
            <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-950">
              <div className="font-semibold">最近单模型测试：{attemptOutcomeLabel(item.latest_pinned_attempt)}</div>
              <p className="mt-1 leading-6">
                模型 {item.latest_pinned_attempt.model || '标识缺失'} · {formatRuntimeTime(item.latest_pinned_attempt.occurred_at)}。
                这只证明该模型单独被调用，不计入当前发布路由的通过或失败。
              </p>
              <p className="mt-1 text-xs leading-5">
                模型用量：{item.latest_pinned_attempt.tokens.total === null
                  ? '缺失'
                  : `${formatRuntimeNumber(item.latest_pinned_attempt.tokens.total)} token`}
                {(item.latest_pinned_attempt.failure_code || item.latest_pinned_attempt.error_message)
                  ? ` · 原因：${attemptFailureSummary(item.latest_pinned_attempt)}`
                  : ''}
              </p>
            </div>
          )}

          <CurrentAttemptEvidence
            attempt={currentAttempt}
            hasHistoricalAttempts={item.latest_attempts.some((attempt) => !attempt.matches_current_plan)}
          />
        </div>
      )}

      <div className="mt-4">
        <RuntimeRouteProjection item={item} />
      </div>

      {item.latest_attempts.length > 0 && (
        <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2">
          <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-slate-800">
            查看最近 {item.latest_attempts.length} 次真实模型尝试
          </summary>
          <ol className="space-y-3 border-t border-slate-200 py-4">
            {item.latest_attempts.map((attempt) => (
              <RuntimeAttemptRow key={attempt.id} attempt={attempt} />
            ))}
          </ol>
        </details>
      )}
    </article>
  )
}

function RuntimeFact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl bg-slate-50 px-3 py-3">
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 break-words font-medium text-slate-900">{value}</dd>
    </div>
  )
}

function CurrentAttemptEvidence({
  attempt,
  hasHistoricalAttempts,
}: {
  attempt: AIRuntimeAttempt | null
  hasHistoricalAttempts: boolean
}) {
  if (!attempt) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm leading-6 text-slate-600">
        {hasHistoricalAttempts
          ? '存在旧计划的历史尝试，但当前发布计划还没有真实调用，历史成功不能证明当前模型可用。'
          : '当前发布计划还没有真实模型尝试。请从对应产品功能执行一次真实任务，再回到这里核对结果和模型用量。'}
      </div>
    )
  }

  return (
    <div className={attempt.freshness === 'stale'
      ? 'rounded-2xl border border-amber-200 bg-amber-50 p-4'
      : attempt.outcome === 'failed' || attempt.outcome === 'incomplete_evidence'
      ? 'rounded-2xl border border-rose-200 bg-rose-50 p-4'
      : attempt.outcome === 'fallback_passed'
        ? 'rounded-2xl border border-amber-200 bg-amber-50 p-4'
        : 'rounded-2xl border border-emerald-200 bg-emerald-50 p-4'}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-slate-950">最近一次当前业务调用</h4>
        <span className="text-xs text-slate-600">{formatRuntimeTime(attempt.occurred_at)}</span>
      </div>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <RuntimeFact label="结果" value={<RuntimeAttemptOutcomeStatus attempt={attempt} />} />
        <RuntimeFact label="模型" value={attempt.model || '模型标识缺失'} />
        <RuntimeFact
          label="模型用量"
          value={attempt.tokens.evidence === 'provider' && attempt.tokens.total !== null
            ? `${formatRuntimeNumber(attempt.tokens.total)}（输入 ${formatRuntimeNumber(attempt.tokens.input || 0)} / 输出 ${formatRuntimeNumber(attempt.tokens.output || 0)}）`
            : '缺失，不能验收为成功'}
        />
        <RuntimeFact
          label="耗时"
          value={attempt.latency_ms === null ? '未记录' : `${formatRuntimeNumber(attempt.latency_ms)} ms`}
        />
      </dl>
      {(attempt.failure_code || attempt.error_message) && (
        <p className="mt-3 break-words text-sm leading-6 text-slate-800">
          原因：{attemptFailureSummary(attempt)}
        </p>
      )}
      <RuntimeReviewRunStatus attempt={attempt} />
    </div>
  )
}

function RuntimeAttemptRow({ attempt }: { attempt: AIRuntimeAttempt }) {
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-slate-950">{attemptOutcomeLabel(attempt)}</span>
          <Badge variant="outline">{attempt.matches_current_plan ? '当前计划' : '历史计划'}</Badge>
          <Badge variant="outline">{attempt.execution_mode === 'route' ? '业务路线' : attempt.execution_mode === 'pinned' ? '单模型测试' : '旧记录'}</Badge>
          {attempt.snapshot_integrity === 'invalid' && <Badge variant="outline">快照无效</Badge>}
          {attempt.attempt_no && <span className="text-xs text-slate-500">第 {attempt.attempt_no} 次候选</span>}
        </div>
        <span className="text-xs text-slate-500">{formatRuntimeTime(attempt.occurred_at)}</span>
      </div>
      <div className="mt-2 grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
        <span className="min-w-0 truncate" translate="no">模型：{attempt.model || '未记录'}</span>
        <span className="min-w-0 truncate">模型用量：{attempt.tokens.total === null ? '缺失' : `${formatRuntimeNumber(attempt.tokens.total)} token`}</span>
        <span className="min-w-0 truncate">审核记录：{attempt.review_run_id ? '已关联' : '未关联'}</span>
      </div>
      {(attempt.error_message || attempt.failure_code) && (
        <p className="mt-2 break-words text-xs leading-5 text-rose-700">
          {attemptFailureSummary(attempt)}
        </p>
      )}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-slate-500">审计标识</summary>
        <div className="mt-2 space-y-1 break-all font-mono text-[11px] leading-5 text-slate-500" translate="no">
          <div>Invocation: {attempt.id}</div>
          <div>Execution: {attempt.execution_id || '未记录'}</div>
          <div>Plan: {attempt.plan_snapshot_id || '未记录'}</div>
          {attempt.review_run_id && <div>ReviewRun: {attempt.review_run_id}</div>}
          {attempt.failure_code && <div>Failure code: {attempt.failure_code}</div>}
          {attempt.error_message && <div>Error summary: {attempt.error_message}</div>}
        </div>
      </details>
    </li>
  )
}

function TaskSection({
  title,
  description,
  actionLabel,
  onAction,
  children,
}: {
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{description}</p>
          </div>
          {actionLabel && onAction && <Button className="min-h-11 shrink-0" onClick={onAction}>+ {actionLabel}</Button>}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function Fact({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 break-all text-slate-800">{value}</dd>
    </div>
  )
}

function AssetList({
  groups,
  empty,
  detail,
  ...actions
}: Pick<AIConfigTabProps, 'onEdit' | 'onRevise' | 'onPublish' | 'onVersions' | 'onDelete' | 'publishingConfigIds' | 'publishFeedback'> & {
  groups: PlatformConfigRevisionGroup[]
  empty: string
  detail: (config: Config) => string
}) {
  if (groups.length === 0) {
    return <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">{empty}</div>
  }
  return (
    <IntrinsicCardStack label="平台配置列表">
      {groups.map((group) => (
        <RevisionCard key={group.key} group={group} {...actions}>
          <p className="mt-3 break-words text-sm leading-6 text-slate-600">{detail(group.primary)}</p>
        </RevisionCard>
      ))}
    </IntrinsicCardStack>
  )
}

function ReleaseList({
  configs,
  readiness,
  ...actions
}: Pick<AIConfigTabProps, 'onEdit' | 'onRevise' | 'onPublish' | 'onVersions' | 'onDelete' | 'publishingConfigIds' | 'publishFeedback'> & {
  configs: Config[]
  readiness: Map<string, AIPlatformReferenceValidation>
}) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<ReleaseStatusFilter>('ALL')
  const [urlReady, setUrlReady] = useState(false)
  const visibleConfigs = useMemo(
    () => orderAndFilterReleaseConfigs(configs, query, status),
    [configs, query, status],
  )

  useEffect(() => {
    const syncFiltersFromUrl = () => {
      setQuery(releaseQueryFromUrl(window.location.href))
      setStatus(releaseStatusFromUrl(window.location.href))
      setUrlReady(true)
    }
    syncFiltersFromUrl()
    window.addEventListener('popstate', syncFiltersFromUrl)
    return () => window.removeEventListener('popstate', syncFiltersFromUrl)
  }, [])

  useEffect(() => {
    if (!urlReady) return
    const url = new URL(window.location.href)
    if (query.trim()) url.searchParams.set('release_q', query)
    else url.searchParams.delete('release_q')
    if (status === 'ALL') url.searchParams.delete('release_status')
    else url.searchParams.set('release_status', status)
    window.history.replaceState({}, '', url)
  }, [query, status, urlReady])

  if (configs.length === 0) {
    return <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">还没有平台配置。</div>
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[minmax(0,1fr)_180px]">
        <div>
          <label htmlFor="release-config-search" className="text-xs font-medium text-slate-600">搜索待发布配置</label>
          <Input
            id="release-config-search"
            name="release-config-search"
            type="search"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="按名称或配置编号搜索"
            className="mt-1 min-h-11 bg-white"
          />
        </div>
        <div>
          <label htmlFor="release-status-filter" className="text-xs font-medium text-slate-600">状态</label>
          <select
            id="release-status-filter"
            name="release-status-filter"
            autoComplete="off"
            value={status}
            onChange={(event) => setStatus(event.target.value as ReleaseStatusFilter)}
            className="mt-1 min-h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
          >
            <option value="ALL">全部状态</option>
            <option value="DRAFT">草稿</option>
            <option value="PUBLISHED">已发布</option>
            <option value="ARCHIVED">已归档</option>
          </select>
        </div>
        <p className="text-xs text-slate-500 sm:col-span-2" aria-live="polite">
          按“模型服务 → 可用模型 → AI 能力 → 产品功能 → 模型顺序 → 业务选择”的依赖顺序显示，共 {visibleConfigs.length} / {configs.length} 条版本记录。
        </p>
      </div>

      {visibleConfigs.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
          没有符合当前搜索和状态条件的配置。
        </div>
      )}

      {visibleConfigs.map((config) => {
        const validation = readiness.get(config.id)
        return (
          <div key={config.id} className="rounded-2xl border border-slate-200 p-4 [contain-intrinsic-size:auto_280px] [content-visibility:auto]">
            <AssetHeader config={config} />
            {config.status === 'DRAFT' && (
              <div className={`mt-3 rounded-xl border px-3 py-2 text-sm ${
                validation?.valid
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-amber-200 bg-amber-50 text-amber-900'
              }`}>
                {validation?.valid ? '依赖检查通过，可以提交发布。' : (
                  <ul className="list-disc space-y-1 pl-5">
                    {(validation?.reasons || ['请补全配置必填项后再发布。']).map((reason) => <li key={reason}>{reason}</li>)}
                  </ul>
                )}
              </div>
            )}
            <div className="mt-4 border-t border-slate-100 pt-4"><AssetActions config={config} {...actions} /></div>
          </div>
        )
      })}
    </div>
  )
}

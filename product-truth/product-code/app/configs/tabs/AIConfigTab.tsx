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

type AIWorkspaceView = 'connections' | 'models' | 'applications' | 'bindings' | 'release' | 'runtime'

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
  { id: 'connections', step: '1', label: '模型接入', description: '账号、端点与认证' },
  { id: 'models', step: '2', label: '模型目录', description: '同一连接下的可用模型' },
  { id: 'applications', step: '3', label: 'AI 应用', description: '能力、候选模型与降级' },
  { id: 'bindings', step: '4', label: '业务绑定', description: '业务用点只绑定应用' },
  { id: 'release', step: '5', label: '发布状态', description: '依赖检查与版本' },
  { id: 'runtime', step: '6', label: '运行验证', description: '当前计划与真实调用' },
]

function viewFromUrl(href: string): AIWorkspaceView {
  const requested = new URL(href).searchParams.get('view')
  return TASKS.some((task) => task.id === requested) ? requested as AIWorkspaceView : 'connections'
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
  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2" aria-label="版本状态摘要">
        {group.published.length > 0 && <Badge className="bg-emerald-100 text-emerald-800">当前 {group.published.length}</Badge>}
        {group.drafts.length > 0 && <Badge className="bg-blue-100 text-blue-800">草稿 {group.drafts.length}</Badge>}
        {group.archived.length > 0 && <Badge variant="outline">归档 {group.archived.length}</Badge>}
      </div>
      <details className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-slate-700">版本与高级标识</summary>
        <div className="border-t border-slate-200 pt-3">
          <div className="text-xs text-slate-500">稳定资产标识</div>
          <div className="mt-1 break-all font-mono text-xs text-slate-700">{group.assetId}</div>
          <ol className="mt-3 space-y-2">
            {group.records.map((record) => (
              <li key={record.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-slate-900">
                    {record.status === 'PUBLISHED' ? '当前' : record.status === 'DRAFT' ? '草稿' : '归档'}
                  </span>
                  <span>{formatUpdatedAt(record.updated_at)}</span>
                </div>
                <div className="mt-1 break-all font-mono">记录键：{record.key}</div>
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
  return (
    <article className="rounded-2xl border border-slate-200 p-4 [contain-intrinsic-size:auto_320px] [content-visibility:auto]">
      <AssetHeader config={group.primary} showStatus={false} />
      <RevisionSummary group={group} />
      {children}
      <div className="mt-4 border-t border-slate-100 pt-4">
        <AssetActions config={group.primary} {...actions} />
      </div>
    </article>
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
  const [view, setView] = useState<AIWorkspaceView>('connections')
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

  const counts: Record<AIWorkspaceView, number> = {
    connections: providerGroups.length,
    models: modelGroups.length,
    applications: applicationGroups.length + routeGroups.length,
    bindings: usePointGroups.length + bindingGroups.length,
    release: revisionGroups.length,
    runtime: runtimeOverview?.use_points.length || 0,
  }

  return (
    <div className="space-y-6" data-testid="ai-platform-workspace">
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle className="text-lg">AI 平台配置</CardTitle>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                平台先接入模型服务和模型目录，再由 AI 应用定义路由；业务模块只绑定已发布应用，不直接写死 Provider 或模型。
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
              <div className="font-semibold text-slate-900">配置状态</div>
              这里负责建立和发布平台资产；真实业务调用与输出质量需要单独运行验证。
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <nav aria-label="AI 平台配置任务" className="flex gap-2 overflow-x-auto pb-1 xl:grid xl:grid-cols-6 xl:overflow-visible xl:pb-0">
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
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold">{task.step}. {task.label}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${active ? 'bg-white/10' : 'bg-slate-100'}`}>
                      {counts[task.id]}
                    </span>
                  </div>
                  <div className={`mt-1 text-xs ${active ? 'text-slate-300' : 'text-slate-500'}`}>{task.description}</div>
                </button>
              )
            })}
          </nav>
        </CardContent>
      </Card>

      {view === 'connections' && (
        <TaskSection
          title="模型接入"
          description="一条连接只回答“如何访问模型服务”。具体模型、合同阶段、规则集和降级顺序都不在这里配置。"
          actionLabel="新增 Provider 连接"
          onAction={() => onNew('provider_connection')}
        >
          {providerGroups.length === 0 ? (
            <EmptyState title="还没有平台 Provider 连接。" action="创建第一条连接" onClick={() => onNew('provider_connection')} />
          ) : (
            <IntrinsicCardStack label="Provider 连接列表">
              {providerGroups.map((group) => {
                const config = group.primary
                return (
                <RevisionCard
                  key={group.key}
                  group={group}
                  {...{ onEdit, onRevise, onPublish, onVersions, onDelete, publishingConfigIds, publishFeedback }}
                >
                  <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                    <Fact label="位置" value={config.value.runtime_location === 'local' ? '本地服务' : '云端服务'} />
                    <Fact label="协议" value="OpenAI compatible" />
                    <Fact label="端点" value={String(config.value.base_url || '未配置')} wide />
                    <Fact label="认证" value={credentialText(config)} />
                  </dl>
                </RevisionCard>
                )
              })}
            </IntrinsicCardStack>
          )}
        </TaskSection>
      )}

      {view === 'models' && (
        <TaskSection
          title="模型目录"
          description="同一个 Provider 可以登记多个模型。模型条目说明远端模型 ID 和通用能力，不包含任何合同规则。"
          actionLabel="新增模型"
          onAction={() => onNew('model_catalog_entry')}
        >
          {modelGroups.length === 0 ? (
            <EmptyState title="还没有可供应用选择的模型。" action="登记模型" onClick={() => onNew('model_catalog_entry')} />
          ) : (
            <IntrinsicCardStack label="模型目录列表">
              {modelGroups.map((group) => {
                const config = group.primary
                const provider = providerGroups.find((item) => item.assetId === config.value.provider_connection_id)
                return (
                  <RevisionCard
                    key={group.key}
                    group={group}
                    {...{ onEdit, onRevise, onPublish, onVersions, onDelete, publishingConfigIds, publishFeedback }}
                  >
                    <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
                      <Fact label="Provider" value={provider?.primary.name || '连接已停用或不存在'} />
                      <Fact label="远端模型 ID" value={String(config.value.model_id || '未设置')} />
                      <Fact label="能力" value={capabilityText(stringList(config.value.capabilities)) || '未定义'} />
                    </div>
                  </RevisionCard>
                )
              })}
            </IntrinsicCardStack>
          )}
        </TaskSection>
      )}

      {view === 'applications' && (
        <div className="space-y-6">
          <TaskSection
            title="AI 应用"
            description="AI 应用定义可被多个业务模块复用的逻辑能力；它不保存 Provider 或具体模型。"
            actionLabel="新增 AI 应用"
            onAction={() => onNew('ai_application')}
          >
            <AssetList
              groups={applicationGroups}
              empty="还没有 AI 应用。"
              detail={(config) => `能力：${capabilityText(stringList(config.value.capabilities)) || '未定义'}`}
              {...{ onEdit, onRevise, onPublish, onVersions, onDelete, publishingConfigIds, publishFeedback }}
            />
          </TaskSection>
          <TaskSection
            title="路由与降级"
            description="路由把应用连接到有序候选模型；候选全部失败后只能转人工或明确停止。"
            actionLabel="新增路由策略"
            onAction={() => onNew('route_policy')}
          >
            <AssetList
              groups={routeGroups}
              empty="还没有应用路由。"
              detail={(config) => {
                const application = applicationGroups.find((item) => item.assetId === config.value.ai_application_id)
                const modelNames = stringList(config.value.model_catalog_entry_ids).map((modelId) => (
                  modelGroups.find((item) => item.assetId === modelId)?.primary.name || '不可用模型'
                ))
                return `${application?.primary.name || '应用已停用或不存在'} → ${modelNames.join(' → ') || '未选择模型'}`
              }}
              {...{ onEdit, onRevise, onPublish, onVersions, onDelete, publishingConfigIds, publishFeedback }}
            />
          </TaskSection>
        </div>
      )}

      {view === 'bindings' && (
        <div className="space-y-6">
          <TaskSection
            title="业务用点"
            description="业务用点代表产品里真正需要 AI 的动作。这里只登记已有功能入口和所需能力，不创建系统无法执行的虚假入口。"
            actionLabel="登记业务用点"
            onAction={() => onNew('business_use_point')}
          >
            <IntrinsicCardStack label="业务用点列表">
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
            title="应用绑定"
            description="绑定只连接“业务用点 → 已发布 AI 应用”；具体模型由应用路由决定。"
            actionLabel="新增绑定"
            onAction={() => onNew('application_binding')}
          >
            <AssetList
              groups={bindingGroups}
              empty="还没有业务应用绑定。"
              detail={(config) => {
                const usePoint = usePointGroups.find((item) => item.assetId === config.value.business_use_point_id)
                const application = applicationGroups.find((item) => item.assetId === config.value.ai_application_id)
                return `${usePoint?.primary.name || '产品功能入口已停用或不存在'} → ${application?.primary.name || 'AI 应用已停用或不存在'}`
              }}
              {...{ onEdit, onRevise, onPublish, onVersions, onDelete, publishingConfigIds, publishFeedback }}
            />
          </TaskSection>
        </div>
      )}

      {view === 'release' && (
        <div className="space-y-6">
          <TaskSection
            title="发布检查"
            description="每类资产独立发布。系统在发布前检查引用、启用状态和能力匹配；缺少哪一环会明确说明。"
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

function currentCandidateAttempt(
  item: AIRuntimeUsePointOverview,
  modelAssetId: string,
  providerAssetId: string,
) {
  return item.latest_current_execution_attempts.find((attempt) => (
    attempt.model_catalog_entry_id === modelAssetId
    && attempt.provider_connection_id === providerAssetId
  )) || null
}

function pinnedCandidateAttempt(
  item: AIRuntimeUsePointOverview,
  modelAssetId: string,
  providerAssetId: string,
) {
  const attempt = item.latest_pinned_attempt
  return attempt
    && attempt.model_catalog_entry_id === modelAssetId
    && attempt.provider_connection_id === providerAssetId
    ? attempt
    : null
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
              <CardTitle className="text-base">当前运行真相</CardTitle>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                每个业务用点都必须沿“业务用点 → 应用绑定 → AI 应用 → 路由 → 模型 → Provider”形成唯一计划。
                只有当前计划快照的真实模型尝试和 token 记录，才能证明可用。
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
          <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <RuntimeMetric label="业务用点" value={overview.summary.registered_use_points} />
            <RuntimeMetric label="计划可编译" value={overview.summary.ready_plans} />
            <RuntimeMetric label="当前计划真实通过" value={overview.summary.verified_current_plans} />
            <RuntimeMetric label="计划被阻断" value={overview.summary.blocked_plans} tone={overview.summary.blocked_plans > 0 ? 'danger' : 'neutral'} />
          </dl>
          {!overview.evidence.available && (
            <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
              {overview.evidence.error || '真实模型调用证据不可读；当前不能判断模型是否可用。'}
            </div>
          )}
          <p className="text-xs leading-5 text-slate-500">
            “计划可编译”只说明六对象发布关系完整；它不等于模型连接成功，也不等于业务输出通过验收。
          </p>
          <p className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-900">
            “模型真实通过”只证明同一次 execution 内获得 Provider 响应、完整 token 和所需 ReviewRun 绑定；
            规则包加载、业务输出质量与独立金标准确度仍需在对应业务模块单独验收。
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

function RuntimeMetric({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: number
  tone?: 'neutral' | 'danger'
}) {
  return (
    <div className={tone === 'danger'
      ? 'rounded-2xl border border-rose-200 bg-rose-50 p-4'
      : 'rounded-2xl border border-slate-200 bg-slate-50 p-4'}
    >
      <dt className={tone === 'danger' ? 'text-xs font-medium text-rose-700' : 'text-xs font-medium text-slate-500'}>{label}</dt>
      <dd className={tone === 'danger'
        ? 'mt-2 text-2xl font-semibold tabular-nums text-rose-900'
        : 'mt-2 text-2xl font-semibold tabular-nums text-slate-950'}
      >
        {formatRuntimeNumber(value)}
      </dd>
    </div>
  )
}

function RuntimeUsePointCard({ item }: { item: AIRuntimeUsePointOverview }) {
  const presentation = VERIFICATION_PRESENTATION[item.verification]
  const currentAttempt = item.latest_current_attempt

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 [contain-intrinsic-size:auto_520px] [content-visibility:auto]">
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

      {!item.evidence_available && (
        <div role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
          这个业务用点的调用证据暂时不可读；计划仍可检查，但不能判断模型是否可用。
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
            <RuntimeFact label="消费模块" value={MODULE_LABELS[item.use_point.module_id] || item.use_point.module_id} />
            <RuntimeFact label="AI 应用" value={item.plan.application.name} />
            <RuntimeFact label="路由" value={item.plan.route.name} />
            <RuntimeFact
              label="全部候选失败后"
              value={item.plan.route.failure_action === 'manual_review' ? '转人工处理' : '停止并报错'}
            />
          </dl>

          <div className="rounded-2xl border border-slate-200">
            <div className="border-b border-slate-200 px-4 py-3">
              <h4 className="text-sm font-semibold text-slate-950">模型执行顺序</h4>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                严格按顺序尝试；状态来自同一个 execution ID 的最近执行链，不会跨运行拼接，也不会改走环境变量或历史策略。
              </p>
            </div>
            <ol className="divide-y divide-slate-100">
              {item.plan.candidates.map((candidate) => {
                const attempt = currentCandidateAttempt(
                  item,
                  candidate.model_catalog_entry_id,
                  candidate.provider_connection_id,
                )
                const pinnedAttempt = pinnedCandidateAttempt(
                  item,
                  candidate.model_catalog_entry_id,
                  candidate.provider_connection_id,
                )
                return (
                  <li key={`${candidate.model_catalog_entry_id}:${candidate.provider_connection_id}`} className="grid gap-3 px-4 py-3 text-sm md:grid-cols-[64px_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center">
                    <span className="text-xs font-semibold text-slate-500">第 {candidate.position} 位</span>
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-950">{candidate.model_name}</div>
                      <div className="mt-1 truncate text-xs text-slate-500" translate="no">{candidate.model_id}</div>
                    </div>
                    <div className="min-w-0 text-slate-700">
                      <div className="truncate">{candidate.provider_name}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {candidate.runtime_location === 'local' ? '本地 Provider' : '云端 Provider'} · {candidate.auth_mode === 'none' ? '免认证' : 'Bearer 已保存'}
                      </div>
                    </div>
                    <div className="flex flex-col items-start gap-1 md:items-end">
                      <span className={attempt
                        ? 'rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700'
                        : 'rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-500'}
                      >
                        {attempt ? attemptOutcomeLabel(attempt) : '路由状态未确认'}
                      </span>
                      {pinnedAttempt && (
                        <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-800">
                          {attemptOutcomeLabel(pinnedAttempt)}
                        </span>
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>
          </div>

          {item.latest_current_execution_attempts.length > 0 && !item.latest_current_execution_complete && (
            <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
              最近 execution 的候选序号、前序失败或最终结果不完整；这组记录只作为排错线索，不能证明模型可用。
            </div>
          )}

          {item.latest_pinned_attempt && (
            <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-950">
              <div className="font-semibold">最近指定模型探测：{attemptOutcomeLabel(item.latest_pinned_attempt)}</div>
              <p className="mt-1 leading-6">
                模型 {item.latest_pinned_attempt.model || '标识缺失'} · {formatRuntimeTime(item.latest_pinned_attempt.occurred_at)}。
                这只证明该模型单独被调用，不计入当前发布路由的通过或失败。
              </p>
              <p className="mt-1 text-xs leading-5">
                Token：{item.latest_pinned_attempt.tokens.total === null
                  ? '缺失'
                  : formatRuntimeNumber(item.latest_pinned_attempt.tokens.total)}
                {(item.latest_pinned_attempt.failure_code || item.latest_pinned_attempt.error_message)
                  ? ` · 原因：${item.latest_pinned_attempt.failure_code || item.latest_pinned_attempt.error_message}`
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
          : '当前发布计划还没有真实模型尝试。请从对应业务入口执行一次真实任务，再回到这里核对结果和 token。'}
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
        <h4 className="text-sm font-semibold text-slate-950">最近一次当前计划尝试</h4>
        <span className="text-xs text-slate-600">{formatRuntimeTime(attempt.occurred_at)}</span>
      </div>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <RuntimeFact label="结果" value={<RuntimeAttemptOutcomeStatus attempt={attempt} />} />
        <RuntimeFact label="模型" value={attempt.model || '模型标识缺失'} />
        <RuntimeFact
          label="Token 证据"
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
          {attempt.failure_code ? `原因：${attempt.failure_code}` : ''}
          {attempt.failure_code && attempt.error_message ? '；' : ''}
          {attempt.error_message || ''}
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
          <Badge variant="outline">{attempt.execution_mode === 'route' ? '发布路由' : attempt.execution_mode === 'pinned' ? '指定模型探测' : '旧证据'}</Badge>
          {attempt.snapshot_integrity === 'invalid' && <Badge variant="outline">快照无效</Badge>}
          {attempt.attempt_no && <span className="text-xs text-slate-500">第 {attempt.attempt_no} 次候选</span>}
        </div>
        <span className="text-xs text-slate-500">{formatRuntimeTime(attempt.occurred_at)}</span>
      </div>
      <div className="mt-2 grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
        <span className="min-w-0 truncate" translate="no">模型：{attempt.model || '未记录'}</span>
        <span className="min-w-0 truncate">Token：{attempt.tokens.total === null ? '缺失' : formatRuntimeNumber(attempt.tokens.total)}</span>
        <span className="min-w-0 truncate">ReviewRun：{attempt.review_run_id ? '已绑定' : '未绑定'}</span>
      </div>
      {(attempt.error_message || attempt.failure_code) && (
        <p className="mt-2 break-words text-xs leading-5 text-rose-700">
          {attempt.failure_code || attempt.error_message}
        </p>
      )}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-slate-500">审计标识</summary>
        <div className="mt-2 space-y-1 break-all font-mono text-[11px] leading-5 text-slate-500" translate="no">
          <div>Invocation: {attempt.id}</div>
          <div>Execution: {attempt.execution_id || '未记录'}</div>
          <div>Plan: {attempt.plan_snapshot_id || '未记录'}</div>
          {attempt.review_run_id && <div>ReviewRun: {attempt.review_run_id}</div>}
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
    <IntrinsicCardStack label="平台资产列表">
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
    return <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">还没有平台资产。</div>
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[minmax(0,1fr)_180px]">
        <div>
          <label htmlFor="release-config-search" className="text-xs font-medium text-slate-600">搜索发布资产</label>
          <Input
            id="release-config-search"
            name="release-config-search"
            type="search"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="按名称、配置编号或资产 ID 搜索"
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
          按“连接 → 模型 → 应用 → 业务用点 → 路由 → 绑定”的依赖顺序显示，共 {visibleConfigs.length} / {configs.length} 条版本记录。
        </p>
      </div>

      {visibleConfigs.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
          没有符合当前搜索和状态条件的资产。
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
                    {(validation?.reasons || ['请补全资产字段后再发布。']).map((reason) => <li key={reason}>{reason}</li>)}
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

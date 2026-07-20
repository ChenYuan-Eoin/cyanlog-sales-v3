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
import type { Config, ConfigPublishFeedback, RuntimePolicy } from '../types'
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

type AIWorkspaceView = 'connections' | 'models' | 'applications' | 'bindings' | 'release'

interface AIConfigTabProps {
  configs: Config[]
  runtimePolicy: RuntimePolicy | null
  runtimeError: string
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
  { id: 'release', step: '5', label: '发布状态', description: '依赖检查、版本与兼容' },
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
  runtimePolicy,
  runtimeError,
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
            <CardHeader><CardTitle className="text-base">兼容运行边界</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm leading-6 text-slate-600">
              <p>
                当前有 <strong className="text-slate-950">{legacyConfigs.length}</strong> 条旧版运行配置只读保留。
                新平台资产尚未切换业务运行；配置发布不等于真实调用已经验证。
              </p>
              <p>
                旧版兼容状态：{runtimePolicy
                  ? `保留 ${runtimePolicy.provider_chain.length} 个历史连接，仅供切换前回溯`
                  : runtimeError || '暂无可回溯的旧版运行配置'}
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
    </div>
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

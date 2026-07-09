'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import ConfigStatusBadge from './ConfigStatusBadge'
import type { Config, RuntimePolicy, RuntimeProvider } from '../types'
import {
  canAttemptModelInvocation,
  hasFormalModelInvocationEvidence,
  hasModelInvocationEvidence,
} from '@/lib/configs/ai-runtime-state'

interface AIConfigTabProps {
  configs: Config[]
  runtimePolicy: RuntimePolicy | null
  runtimeError: string
  onNew: () => void
  onEdit: (config: Config) => void
  onPublish: (id: string) => void
  onDelete: (id: string) => void
}

function runtimeStateLabel(state: RuntimeProvider['runtime_state']) {
  const labels: Record<RuntimeProvider['runtime_state'], string> = {
    builtin_ready: '兜底可用',
    missing_base_url: '地址缺失',
    missing_credential: '密钥缺失',
    unreachable_in_vercel: '生产不可达',
    local_health_ok: '本地可达',
    local_cli_ready: 'CLI 可调用',
    local_auth_failed: 'Token 未通过',
    local_health_failed: '本地不可达',
    local_generation_failed: '本地生成失败',
    remote_health_ok: '发布配置云端可达',
    remote_auth_failed: '云端认证失败',
    remote_health_failed: '云端不可达',
    remote_generation_failed: '云端生成失败',
    ready_to_call: '发布配置待实测',
    recent_invocation_passed: '最近 ReviewRun 通过',
    recent_invocation_partial: '最近 ReviewRun 部分通过',
    recent_invocation_failed: '最近调用失败',
  }
  return labels[state]
}

function runtimeStateClass(state: RuntimeProvider['runtime_state']) {
  if (hasFormalModelInvocationEvidence(state)) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  }
  if (canAttemptModelInvocation(state)) {
    return 'border-blue-200 bg-blue-50 text-blue-800'
  }
  if (
    state === 'missing_base_url'
    || state === 'missing_credential'
    || state === 'unreachable_in_vercel'
    || state === 'local_auth_failed'
    || state === 'local_health_failed'
    || state === 'local_generation_failed'
    || state === 'remote_auth_failed'
    || state === 'remote_health_failed'
    || state === 'remote_generation_failed'
    || state === 'recent_invocation_failed'
  ) {
    return 'border-red-200 bg-red-50 text-red-700'
  }
  return 'border-amber-200 bg-amber-50 text-amber-800'
}

function hasFormalModelProviderEvidence(provider: RuntimeProvider) {
  return hasFormalModelInvocationEvidence(provider.runtime_state)
}

function hasModelProviderInvocationEvidence(provider: RuntimeProvider) {
  return hasModelInvocationEvidence(provider.runtime_state)
}

function canAttemptModelProvider(provider: RuntimeProvider) {
  return canAttemptModelInvocation(provider.runtime_state)
}

function RuntimeEvidenceScopeNotice() {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
      <div className="font-semibold">运行证据口径</div>
      <p className="mt-1">
        本区只展示“已发布模型策略”和“最近 ReviewRun / 长文档解析”的证据；编辑弹窗里的连接测试代表当前草稿配置。
        如果当前草稿测试失败，不能用这里的历史通过记录证明新配置可用。
      </p>
    </div>
  )
}

function configProviderKind(config: Config) {
  const model = config.value?.model
  if (config.value?.provider_kind === 'builtin' || model === 'rule-engine') return 'builtin'
  return 'openai_compatible'
}

function isLocalBaseUrl(value: unknown) {
  if (typeof value !== 'string' || value.trim().length === 0) return false
  try {
    const parsed = new URL(value)
    return ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(parsed.hostname)
  } catch {
    return false
  }
}

function configCredentialLabel(config: Config) {
  if (configProviderKind(config) === 'builtin') return '无需密钥'
  if (typeof config.value?.api_key === 'string' && config.value.api_key.length > 0) return '已保存'
  return isLocalBaseUrl(config.value?.base_url) ? '未保存 Token' : '未配置'
}

function latestInvocationText(invocation: RuntimeProvider['latest_invocation'], fallbackModel: string) {
  if (!invocation) return null
  const failure = invocation.attempt_errors.find(Boolean) || invocation.error_message || invocation.fallback_reason
  const parts = [
    invocation.status || 'unknown',
    invocation.degraded ? 'degraded' : 'not-degraded',
    invocation.transport || invocation.provider_kind,
  ].filter(Boolean)
  return failure
    ? `${parts.join(' · ')} · ${failure}`
    : `${parts.join(' · ')} · ${invocation.model || fallbackModel}`
}

function plannedInvocationText(provider: RuntimeProvider) {
  const invocation = provider.latest_intended_invocation || provider.latest_requested_invocation
  if (!invocation || invocation.id === provider.latest_invocation?.id) return null
  const plannedProfile = invocation.intended_provider_profile
    || invocation.requested_provider_profile
    || provider.profile
  const actualProvider = invocation.provider || 'unknown'
  const summary = latestInvocationText(invocation, provider.model)
  return `最近计划使用 ${plannedProfile}，实际记录在 ${actualProvider}${summary ? `：${summary}` : ''}`
}

function providerCredentialLabel(provider: RuntimeProvider) {
  if (provider.credential_state === 'not_required') return '无需密钥'
  if (provider.credential_state === 'configured') return '密钥已配置'
  if (provider.local_endpoint && provider.latest_invocation?.transport === 'lm_studio_cli') {
    return 'CLI 通道可用 / HTTP Token 未配置'
  }
  if (provider.local_endpoint && ['local_health_ok', 'recent_invocation_passed', 'recent_invocation_partial'].includes(provider.runtime_state)) {
    return '本地免密可用'
  }
  if (provider.local_endpoint && provider.runtime_state === 'local_cli_ready') return 'CLI 通道可用 / HTTP Token 未配置'
  return provider.local_endpoint ? '本地 Token 未配置' : '密钥缺失'
}

function sourceSummaryText(runtimePolicy: RuntimePolicy) {
  const summary = runtimePolicy.source_summary
  if (!summary) return '来源：已发布策略来自配置中心数据库；编辑弹窗是表单草稿。'
  const envText = summary.environment_source === 'present_not_consumed_by_published_policy'
    ? `环境变量存在但不自动进入当前发布策略：${summary.environment_keys_present.join(' / ')}`
    : '未检测到运行时模型环境变量'

  return `来源：ModelPolicy 来自数据库，Provider 来自 configs 表，编辑弹窗是表单草稿；${envText}。`
}

function providerSourceText(provider: RuntimeProvider) {
  if (provider.source_kind === 'builtin_rule_engine') return '来源：内置规则引擎兜底'
  if (provider.source_kind === 'missing_database_config') return '来源异常：发布策略引用的 AI_CONFIG 已缺失'
  return `来源：${provider.source_label || '配置中心数据库 AI_CONFIG'}${provider.source_config_key ? ` · ${provider.source_config_key}` : ''}`
}

function stageProviders(runtimePolicy: RuntimePolicy | null, stage: string) {
  return runtimePolicy?.provider_chain.filter((provider) => provider.stages.includes(stage)) ?? []
}

function providerPoolLabel(providers: RuntimeProvider[]) {
  if (providers.length === 0) return '无已发布实例'
  return providers.map((provider) => `${provider.profile}/${provider.model}`).join(' -> ')
}

export default function AIConfigTab({ configs, runtimePolicy, runtimeError, onNew, onEdit, onPublish, onDelete }: AIConfigTabProps) {
  const externalProviders = runtimePolicy?.provider_chain.filter((provider) => provider.provider_kind !== 'builtin') ?? []
  const hasExternalProvider = externalProviders.length > 0
  const hasFormalExternalProviderEvidence = externalProviders.some(hasFormalModelProviderEvidence)
  const hasExternalProviderInvocationEvidence = externalProviders.some(hasModelProviderInvocationEvidence)
  const hasAttemptableExternalProvider = externalProviders.some(canAttemptModelProvider)
  const cloudProvider = runtimePolicy?.provider_chain.find((provider) => provider.runtime_location === 'cloud')
  const builtinProvider = runtimePolicy?.provider_chain.find((provider) => provider.provider_kind === 'builtin')
  const localConfig = configs.find((config) => (
    config.value?.profile === 'local_primary'
    || isLocalBaseUrl(config.value?.base_url)
    || config.key === 'AI_LEVEL_1'
  ))
  const cloudConfig = configs.find((config) => (
    config.value?.profile === 'cloud_primary'
    || config.value?.profile === 'sales_cloud_backup'
    || (
      configProviderKind(config) !== 'builtin'
      && !isLocalBaseUrl(config.value?.base_url)
      && typeof config.value?.base_url === 'string'
      && config.value.base_url.length > 0
    )
    || config.key === 'AI_LEVEL_2'
  ))
  const hasLocalCliFallback = externalProviders.some((provider) => (
    provider.runtime_state === 'local_cli_ready'
    || (provider.local_endpoint && provider.latest_invocation?.transport === 'lm_studio_cli')
  ))
  const hasHttpAuthBlock = externalProviders.some((provider) => provider.runtime_state === 'local_auth_failed')
  const hasRecentInvocationFailed = externalProviders.some((provider) => provider.runtime_state === 'recent_invocation_failed')
  const hasProductionBlockedLocalProvider = externalProviders.some((provider) => (
    provider.runtime_state === 'unreachable_in_vercel'
  ))
  const tenderCloudState = cloudProvider?.tender_runtime?.runtime_state
  const tenderCloudEvidencePassed = tenderCloudState
    ? hasFormalModelInvocationEvidence(tenderCloudState)
    : false
  const tenderCloudAttemptable = tenderCloudState
    ? canAttemptModelInvocation(tenderCloudState)
    : false
  const routeRows = [
    {
      level: '审核',
      title: '合同审核策略',
      stage: 'stage:semantic_review',
      target: 'ReviewRun 只声明合同审核任务；网关按语义审核能力池选择模型，失败后按降级链继续。',
      providers: stageProviders(runtimePolicy, 'semantic_review'),
    },
    {
      level: '长文',
      title: '标书 / 长 PDF 策略',
      stage: 'stage:tender_long_document_parse',
      target: '长文档不写死本地优先；优先使用具备长上下文能力的云模型实例，并记录 chunk、Token 和降级原因。',
      providers: stageProviders(runtimePolicy, 'tender_long_document_parse'),
    },
    {
      level: '起草',
      title: '合同起草 / 批注草案策略',
      stage: 'stage:comment_patch_draft',
      target: '起草和批注文案走生成模型；规则引擎只校验模板、条款限制和必填结构。',
      providers: stageProviders(runtimePolicy, 'comment_patch_draft'),
    },
    {
      level: '对比',
      title: '文档对比策略',
      stage: 'stage:template_compare -> executor:rule-engine',
      target: '对比先做确定性差异和版式/文本定位；AI 只解释风险变化，不替代原文渲染。',
      providers: [
        ...stageProviders(runtimePolicy, 'template_compare'),
        ...(builtinProvider ? [builtinProvider] : []),
      ],
    },
  ]
  const capabilityRows = [
    {
      name: '合同审核',
      trigger: 'ReviewRun / 再审核',
      route: '前端只提交 task_type=contract_review；网关按当前策略匹配本地/云端候选池，失败后进入规则兜底',
      evidence: '必须写入 semantic_review 的 model_invocations；规则兜底不能显示 AI 审核完成',
    },
    {
      name: '文档对比',
      trigger: '旧文件 + 新文件',
      route: '先做文本/结构差异规则计算，再按策略调用具备长文档能力的模型解释风险变化',
      evidence: '对比差异报告记录文件版本、精度、差异类型和风险解释来源',
    },
    {
      name: '合同起草',
      trigger: '客户需求 + 模板 + 条款约束',
      route: '按 drafting 策略选择长上下文生成模型；规则引擎校验条款限制和必填结构',
      evidence: '草稿需记录模型、Token 成本、模板版本和条款约束命中情况',
    },
    {
      name: '标书 / 长文档解析',
      trigger: '长 PDF / 长 DOCX / 标书附件',
      route: '按 tender_long_document_parse 策略选择具备长文本/文件能力的模型实例，必要时分段解析',
      evidence: '记录 chunk、耗时、Token、失败重试和降级原因',
    },
  ]
  const strategyCards = [
    {
      title: '模型实例',
      body: '每个 Provider 是一个可独立探测和调用的实例：Base URL、Token、模型 ID、能力阶段和优先级都来自配置。',
    },
    {
      title: '策略',
      body: '业务侧只传任务类型、文本长度、敏感级别和可选偏好；策略按顺序选择候选模型，不要求前端理解底层模型。',
    },
    {
      title: '降级链',
      body: '模型失败、超时、Token 不可用或超长文本时，网关进入下一个候选实例，最后才走规则引擎兜底。',
    },
    {
      title: '调用证据',
      body: '每次正式任务必须写入 model_invocations，记录 provider、model、phase、状态、降级原因和耗时。',
    },
  ]

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[280px_minmax(0,1fr)] 2xl:grid-cols-[300px_minmax(420px,1fr)_360px]">
      <Card className="min-w-0">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">模型实例 ({configs.length})</CardTitle>
          <Button size="sm" onClick={onNew}>+ 新增</Button>
        </CardHeader>
        <CardContent>
          <div className="max-h-[720px] space-y-3 overflow-y-auto pr-1">
            {configs.map((config) => (
              <div key={config.id} className="rounded-lg border p-4">
                <div className="flex items-baseline justify-between mb-3">
                  <div className="text-sm font-semibold text-slate-900">
                    优先级 {(config.value?.level as number)} · {config.name}
                  </div>
                  <div className="flex gap-1">
                    <ConfigStatusBadge status={config.status} />
                    {config.value?.enabled === true && <Badge className="bg-emerald-100 text-emerald-700">启用</Badge>}
                  </div>
                </div>

                <div className="text-xs text-slate-600 space-y-1.5 mb-4">
                  <div>来源: 配置中心数据库 · {config.status === 'DRAFT' ? '表单草稿/未发布' : config.status === 'PUBLISHED' ? '已发布' : '已归档'}</div>
                  <div className="truncate">画像: {(config.value?.profile as string) || '未设置'}</div>
                  <div className="truncate">类型: {configProviderKind(config)}</div>
                  <div className="truncate">模型: {config.value?.model as string}</div>
                  <div className="truncate">地址: {(config.value?.base_url as string) || '（内置）'}</div>
                  <div>超时: {(config.value?.timeout_ms as number) / 1000}s</div>
                  <div>密钥: {configCredentialLabel(config)}</div>
                </div>

                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => onEdit(config)}>编辑</Button>
                  {config.status !== 'PUBLISHED' && (
                    <Button variant="outline" size="sm" onClick={() => onPublish(config.id)}>发布</Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => onDelete(config.id)}>删除</Button>
                </div>
              </div>
            ))}
          </div>

        {configs.length === 0 && (
          <div className="text-center py-12">
            <p className="text-slate-500">暂无 AI 模型配置</p>
            <p className="text-sm text-slate-400 mt-2">点击上方按钮创建第一条模型实例</p>
          </div>
        )}
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="text-base">模型路由与能力策略</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="rounded-lg border border-slate-200">
            <div className="border-b bg-slate-50 px-4 py-2 text-xs font-medium text-slate-700">
              策略模板：业务任务 → 能力池 → 模型实例 → 降级链
            </div>
            <div className="divide-y">
              {routeRows.map((row) => (
                <div key={row.level} className="grid grid-cols-[44px_minmax(0,1fr)] items-start gap-3 px-4 py-3">
                  <span className="rounded bg-slate-100 px-2 py-1 text-center font-mono text-xs font-semibold text-slate-700">
                    {row.level}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900">{row.title}</div>
                        <div className="mt-0.5 line-clamp-2 text-xs leading-5 text-slate-500">{row.target}</div>
                      </div>
                      <span className={`shrink-0 rounded border px-2 py-1 text-[11px] font-medium ${row.providers.length > 0 ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
                        {row.providers.length > 0 ? `${row.providers.length} 个实例` : '未配置'}
                      </span>
                    </div>
                    <div className="mt-2 grid gap-2 text-xs text-slate-600 md:grid-cols-[1fr_1fr]">
                      <div className="rounded bg-slate-50 px-2 py-1">
                        阶段：{row.stage}
                      </div>
                      <div className="rounded bg-slate-50 px-2 py-1">
                        候选：{providerPoolLabel(row.providers)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {strategyCards.map((card) => (
              <div key={card.title} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="text-sm font-semibold text-slate-900">{card.title}</div>
                <p className="mt-1 text-xs leading-5 text-slate-600">{card.body}</p>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-slate-200">
            <div className="border-b bg-slate-50 px-4 py-2 text-xs font-medium text-slate-700">
              平台能力路由矩阵
            </div>
            <div className="divide-y">
              {capabilityRows.map((row) => (
                <div key={row.name} className="grid gap-3 px-4 py-3 md:grid-cols-[112px_minmax(0,1fr)]">
                  <div>
                    <div className="text-sm font-semibold text-slate-950">{row.name}</div>
                    <div className="mt-1 text-[11px] text-slate-500">{row.trigger}</div>
                  </div>
                  <div className="space-y-2 text-xs leading-5 text-slate-600">
                    <div className="rounded bg-slate-50 px-2 py-1">
                      路由：{row.route}
                    </div>
                    <div className="rounded bg-blue-50 px-2 py-1 text-blue-800">
                      证据：{row.evidence}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-xs leading-5 text-blue-900">
            <div className="flex items-center justify-between gap-3">
              <div className="font-semibold">推荐配置方式</div>
              <div className="flex shrink-0 gap-2">
                <Button variant="outline" size="sm" className="h-7 bg-white px-2 text-xs" onClick={() => localConfig ? onEdit(localConfig) : onNew()}>
                  配置本地实例
                </Button>
                <Button variant="outline" size="sm" className="h-7 bg-white px-2 text-xs" onClick={() => cloudConfig ? onEdit(cloudConfig) : onNew()}>
                  配置云端实例
                </Button>
              </div>
            </div>

            <RuntimeEvidenceScopeNotice />
            <div className="mt-2 space-y-1">
              <p>本地实例：LM Studio 保持运行，Base URL 使用 http://127.0.0.1:1234/v1，模型标识使用 gpt-oss-20b。</p>
              <p>云端实例：使用 OpenAI-compatible 网关，填入 Base URL、模型 ID 和 Token；Token 只保存在系统配置中，不展示明文。</p>
              <p>规则引擎：只做确定性校验，不能冒充 AI 审核完成。</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-3">
              <div className="text-lg font-semibold text-slate-900">{configs.length}</div>
              <div className="text-[11px] text-slate-500">实例</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-3">
              <div className="text-lg font-semibold text-slate-900">
                {configs.filter((config) => config.value?.enabled === true).length}
              </div>
              <div className="text-[11px] text-slate-500">启用</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-3">
              <div className="text-lg font-semibold text-slate-900">
                {configs.filter((config) => config.status === 'PUBLISHED').length}
              </div>
              <div className="text-[11px] text-slate-500">发布</div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 p-4">
            <div className="text-xs font-medium text-slate-500">消费边界</div>
            <div className="mt-3 space-y-2 text-xs leading-5 text-slate-600">
              <p>平台 AI 策略只决定模型接入、能力路由、超时、降级、调用证据和成本。</p>
              <p>合同规则集决定审核规则、输出结构、风险事实和批注模板。</p>
              <p>正式验收必须看到 semantic_review 的模型调用证据。</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="min-w-0 xl:col-span-2 2xl:col-span-1">
      <CardHeader>
        <CardTitle className="text-base">运行证据与验收口径</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {runtimeError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700">
            {runtimeError}
          </div>
        )}

        {!runtimePolicy && !runtimeError && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-8 text-center text-slate-500">
            运行时策略加载中
          </div>
        )}

        {runtimePolicy && (
          <>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium text-slate-900">{runtimePolicy.key}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    v{runtimePolicy.version} · {runtimePolicy.status} · {runtimePolicy.timeout_ms / 1000}s
                  </div>
                  <div className="mt-2 max-w-[620px] text-xs leading-5 text-slate-600">
                    {sourceSummaryText(runtimePolicy)}
                  </div>
                </div>
                <Badge variant={runtimePolicy.is_current ? 'default' : 'secondary'}>
                  {runtimePolicy.is_current ? '当前' : '历史'}
                </Badge>
              </div>
            </div>

            <RuntimeEvidenceScopeNotice />

            <div className={`rounded-lg border px-3 py-2 ${
              hasRecentInvocationFailed
                ? 'border-red-200 bg-red-50 text-red-700'
                : hasFormalExternalProviderEvidence
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : hasAttemptableExternalProvider
                ? 'border-blue-200 bg-blue-50 text-blue-800'
                : hasExternalProvider
                  ? 'border-amber-200 bg-amber-50 text-amber-800'
                  : 'border-amber-200 bg-amber-50 text-amber-800'
            }`}>
              {hasRecentInvocationFailed
                ? '模型链存在最近正式调用失败的实例；当前不能按完整模型路由链验收。'
                : hasFormalExternalProviderEvidence
                  ? '外部模型 Provider 已有最近 ReviewRun 正式调用通过证据，可作为当前模型实例验收依据。'
                : hasExternalProviderInvocationEvidence
                  ? '外部模型 Provider 已有最近 ReviewRun 真实调用证据，但输出质量或规则映射仍需复核。'
                : hasAttemptableExternalProvider
                  ? hasLocalCliFallback
                    ? '本机已检测到 LM Studio 已加载模型，当前可通过 CLI 通道调用；HTTP Token 尚未统一时只能作为本机预验收能力。'
                    : '外部模型 Provider 已具备尝试调用条件，但仍缺真实 ReviewRun 的 completed 调用证据。'
                : hasExternalProvider
                  ? externalProviders.some((provider) => provider.runtime_state === 'recent_invocation_failed')
                    ? '外部模型 Provider 配置存在，但最近一次正式语义审核调用失败；当前不能按正式模型链验收。'
                    : hasProductionBlockedLocalProvider
                    ? '存在本地模型 Provider，但在 Vercel 生产环境不可达；当前不能按正式模型链验收。'
                    : hasHttpAuthBlock
                      ? '本地模型服务已启动但 HTTP Token 未通过；请保存 LM Studio Token，或确认本机 CLI 通道可用于本地验收。'
                    : '外部模型 Provider 已发布，但密钥、地址或运行时健康检查未通过；当前不能按正式模型链验收。'
                  : '当前仅有内置规则引擎兜底；这不是模拟，但语义模型能力尚未配置。'}
            </div>

            <div className={`rounded-lg border px-3 py-2 ${
              tenderCloudEvidencePassed
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : tenderCloudAttemptable
                  ? 'border-blue-200 bg-blue-50 text-blue-800'
                  : 'border-red-200 bg-red-50 text-red-700'
            }`}>
              {cloudProvider
                ? tenderCloudEvidencePassed
                  ? '长标书 / 长 PDF 云模型解析已有正式调用通过证据。'
                  : tenderCloudAttemptable
                    ? '长标书 / 长 PDF 云模型配置具备调用条件，但还缺真实上传解析后的 completed 证据。'
                    : '长标书 / 长 PDF 云模型链路不可验收；云端 Provider 未通过配置、健康或最近调用检查。'
                : '未找到可服务长文档的云模型实例；标书解析和长 PDF 不能按目标运行。'}
            </div>

            <div className={`rounded-lg border px-3 py-2 ${
              hasExternalProvider
                ? hasRecentInvocationFailed
                  ? 'border-red-200 bg-red-50 text-red-700'
                  : hasFormalExternalProviderEvidence
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : hasAttemptableExternalProvider
                  ? 'border-blue-200 bg-blue-50 text-blue-800'
                  : 'border-red-200 bg-red-50 text-red-700'
                : 'border-amber-200 bg-amber-50 text-amber-800'
            }`}>
              {hasExternalProvider
                ? hasRecentInvocationFailed
                  ? '验收口径：先修复失败模型实例并重新触发 ReviewRun；失败实例不能靠静态配置或旧通过记录验收。'
                  : hasFormalExternalProviderEvidence
                    ? '验收口径：最近 semantic_review 已有 completed 且未降级的模型调用记录；变更 Token 或模型后必须重新触发 ReviewRun。'
                  : hasExternalProviderInvocationEvidence
                    ? '验收口径：semantic_review 已写入真实模型调用记录；输出质量告警归入规则资产和批注质量目标继续验收。'
                  : hasAttemptableExternalProvider
                    ? hasLocalCliFallback
                      ? '验收口径：本机可以先触发真实 ReviewRun；线上验收仍需要云模型 Token 或可公网访问的模型网关。'
                      : '验收口径：仍需用真实合同触发一次模型调用，并确认 semantic_review invocation 为 completed。'
                  : '验收口径：请先在 AI 模型配置中补齐密钥与地址，再进行真实模型调用验收。'
                : '验收口径：规则引擎可审计，但不能替代大模型审核目标。'}
            </div>

            <div className="rounded-lg border border-slate-200 p-3 text-xs leading-5 text-slate-600">
              <div className="font-medium text-slate-900">OpenAI-compatible 配置说明</div>
              <div className="mt-2 space-y-1">
                <p>LM Studio：Base URL 使用 http://127.0.0.1:1234/v1；如果开启认证，需要填写 Developer 页生成的 Token。</p>
                <p>
                  云端网关：从{' '}
                  <a className="font-medium text-blue-700 underline" href="https://cloud.yiyongai.cn/console/token" target="_blank" rel="noreferrer">
                    cloud.yiyongai.cn/console/token
                  </a>
                  {' '}获取 Key，按供应商给出的 Base URL 和模型 ID 配置成云端模型实例。
                </p>
                <p>CC Switch 适合管理 Codex/Claude/Gemini 等开发工具配置；产品运行时仍以本系统发布的 AI_CONFIG / ModelPolicy 为准。</p>
              </div>
            </div>

            <div className="space-y-2">
              {runtimePolicy.provider_chain.map((provider) => (
                <div key={`${provider.level}-${provider.profile}-${provider.model}`} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 font-medium text-slate-900">
                      优先级 {provider.level} · {provider.profile}
                    </div>
                    <Badge variant={provider.role === 'primary' ? 'default' : 'secondary'}>
                      {provider.role}
                    </Badge>
                  </div>
                  <div className="mt-2 space-y-1 text-xs text-slate-500">
                      <div className="truncate">{provider.runtime_location} / {provider.provider_kind} / {provider.model}</div>
                    <div className={`rounded border px-2 py-1 ${
                      provider.source_kind === 'missing_database_config'
                        ? 'border-red-200 bg-red-50 text-red-700'
                        : 'border-slate-200 bg-slate-50 text-slate-600'
                    }`}>
                      {providerSourceText(provider)}
                    </div>
                    <div className={`rounded border px-2 py-1 ${runtimeStateClass(provider.runtime_state)}`}>
                      {runtimeStateLabel(provider.runtime_state)} · {provider.runtime_reason}
                    </div>
                    {provider.runtime_action && (
                      <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-slate-600">
                        处理：{provider.runtime_action}
                      </div>
                    )}
                    {provider.latest_invocation && (
                      <div className="rounded border border-slate-200 bg-white px-2 py-1 text-slate-600">
                        最近合同审核：{latestInvocationText(provider.latest_invocation, provider.model)}
                      </div>
                    )}
                    {plannedInvocationText(provider) && (
                      <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800">
                        策略计划记录：{plannedInvocationText(provider)}
                      </div>
                    )}
                    {provider.tender_runtime && (
                      <div className={`rounded border px-2 py-1 ${runtimeStateClass(provider.tender_runtime.runtime_state)}`}>
                        标书长文档：{runtimeStateLabel(provider.tender_runtime.runtime_state)} · {provider.tender_runtime.runtime_reason}
                      </div>
                    )}
                    {provider.tender_runtime?.runtime_action && (
                      <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-slate-600">
                        标书处理：{provider.tender_runtime.runtime_action}
                      </div>
                    )}
                    {provider.latest_tender_invocation && (
                      <div className="rounded border border-slate-200 bg-white px-2 py-1 text-slate-600">
                        最近标书解析：{latestInvocationText(provider.latest_tender_invocation, provider.model)}
                      </div>
                    )}
                    <div>
                      {provider.timeout_ms / 1000}s · {provider.health_check_required ? '需健康检查' : '无需健康检查'} · {providerCredentialLabel(provider)}
                    </div>
                    {provider.provider_kind !== 'builtin' && (
                      <div>
                        {provider.base_url_configured ? '地址已配置' : '地址缺失'} · {provider.runtime_environment}
                        {provider.local_endpoint ? ' · 本地端点' : ''}
                      </div>
                    )}
                    <div className="line-clamp-2">阶段: {provider.stages.join(', ')}</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
    </div>
  )
}

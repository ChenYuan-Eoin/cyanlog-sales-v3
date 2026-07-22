'use client'

import { useEffect, useState } from 'react'
import {
  BrainCircuitIcon,
  CheckCircle2Icon,
  CpuIcon,
  DatabaseZapIcon,
  GitBranchIcon,
  PlugZapIcon,
  RouteIcon,
  ShieldCheckIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import ConfigStatusBadge from './ConfigStatusBadge'
import type { Config } from '../types'

interface AIConfigTabProps {
  configs: Config[]
  onNew: (kind: 'provider' | 'application' | 'tool_policy') => void
  onEdit: (config: Config) => void
  onPublish: (id: string) => void
  onDelete: (id: string) => void
}

interface AIViewValue {
  kind?: 'provider' | 'application' | 'tool_policy'
  level?: number
  name?: string
  instance_id?: string
  profile?: string
  provider_name?: string
  provider_url?: string
  provider_kind?: string
  api_format?: string
  base_url?: string
  api_key?: string
  model?: string
  timeout_ms?: number
  enabled?: boolean
  capabilities?: string[]
  bound_apps?: string[]
  system_prompt?: string
  model_mappings?: Array<{
    role?: string
    display_name?: string
    request_model?: string
    context_window?: number
    enabled?: boolean
  }>
  fallback_chain?: string[]
  retry_count?: number
  cost_tracking?: boolean
  routing?: { max_pages?: number; strategy?: string }
  application_id?: string
  plan_mode?: string
  bound_tools?: string[]
  default_policy_key?: string
  tool?: string
  capability?: string
  application_key?: string
  strategy?: string
  priority?: number
  provider_chain?: string[]
  conditions?: {
    min_chars?: number
    max_chars?: number
    min_pages?: number
    max_pages?: number
    document_formats?: string[]
    sensitive_data?: string
  }
}

interface RuntimeProviderStatus {
  id: string
  name: string
  source: 'published_config' | 'environment_default'
  level: number
  model: string
  status: 'ready' | 'needs_probe' | 'unavailable' | 'misconfigured' | 'rule_engine'
  hasApiKey: boolean
  blockingReasons: string[]
  warnings: string[]
  lastProbe?: {
    providerKey: string
    model: string
    status: 'completed' | 'failed' | 'degraded'
    latencyMs?: number
    usage?: {
      inputTokens?: number
      outputTokens?: number
      totalTokens?: number
    }
    error?: string
    checkedAt: string
  }
}

interface RuntimeReadiness {
  source: 'published_config' | 'environment_default'
  hasPublishedConfigs: boolean
  tool: string
  capability: string
  selectedProvider: string | null
  providerChain: string[]
  policyKey: string | null
  policyName: string | null
  applicationKey: string | null
  strategy: string | null
  routingMode: 'structured_policy' | 'legacy_provider_inference' | 'environment_default'
  providers: RuntimeProviderStatus[]
  generatedAt: string
}

const APP_LABELS: Record<string, string> = {
  contract_review: '合同审核',
  contract_compare: '合同对比',
  contract_draft: '合同起草',
  tender_parse: '标书/长文档解析',
  rule_translation: '规则转译',
  comment_patch: '批注草案',
  report_summary: '报告摘要',
}

const CAPABILITY_LABELS: Record<string, string> = {
  short_text: '短文本',
  long_text: '长文本',
  document_parse: '文档解析',
  contract_review: '合同语义审核',
  rule_translation: '规则转译',
  comment_patch: '批注生成',
  report_summary: '报告摘要',
  vision: '图片/视觉',
  deterministic_rule_scan: '确定性规则',
}

const TOOL_COVERAGE = [
  { key: 'contract_review', label: '合同审核', capability: 'contract_review', purpose: '语义审核 / 批注 / 报告' },
  { key: 'contract_compare', label: '合同对比', capability: 'long_text', purpose: '长文档 / 差异解释' },
  { key: 'contract_draft', label: '合同起草', capability: 'long_text', purpose: '生成 / 改写 / 导出' },
  { key: 'tender_parse', label: '标书/长文档', capability: 'long_text', purpose: '长 PDF / 长 DOCX 解析' },
  { key: 'rule_translation', label: '规则转译', capability: 'rule_translation', purpose: '规则声明转执行单元' },
  { key: 'comment_patch', label: '批注输出', capability: 'comment_patch', purpose: 'Word 批注草案' },
  { key: 'report_summary', label: '报告摘要', capability: 'report_summary', purpose: '摘要 / 复核说明' },
]

function valueOf(config: Config): AIViewValue {
  return (config.value || {}) as AIViewValue
}

function configKind(config: Config): 'provider' | 'application' | 'tool_policy' {
  const kind = valueOf(config).kind
  return kind === 'application' || kind === 'tool_policy' ? kind : 'provider'
}

function list(value: string[] | undefined, fallback: string[] = []) {
  return Array.isArray(value) && value.length > 0 ? value : fallback
}

function labelItems(items: string[], labels: Record<string, string>) {
  return items.map((item) => labels[item] || item)
}

function formatTimeout(timeoutMs: number | undefined) {
  if (!timeoutMs) return '未设置'
  if (timeoutMs >= 1000) return `${Math.round(timeoutMs / 1000)}s`
  return `${timeoutMs}ms`
}

function providerInstanceId(config: Config, value: AIViewValue) {
  return value.instance_id || value.profile || config.key
}

function runtimeModel(value: AIViewValue) {
  if (value.model) return value.model
  const enabledMapping = value.model_mappings?.find((mapping) => (
    mapping.enabled !== false && !!mapping.request_model
  ))
  return enabledMapping?.request_model || ''
}

function isRuleEngine(value: AIViewValue) {
  return value.provider_kind === 'rule_engine'
    || value.provider_kind === 'builtin'
    || value.model === 'rule-engine'
}

function providerReadiness(config: Config, value: AIViewValue) {
  if (value.enabled !== true) {
    return {
      label: '未启用',
      className: 'bg-slate-100 text-slate-600',
      description: '只保存配置，不会被合同审核、对比或起草工具消费。',
    }
  }
  if (config.status !== 'PUBLISHED') {
    return {
      label: '草稿未发布',
      className: 'bg-amber-100 text-amber-700',
      description: '可做草稿连接测试，但还不会进入运行时路由。',
    }
  }
  if (isRuleEngine(value)) {
    return {
      label: '规则兜底',
      className: 'bg-slate-900 text-white',
      description: '只做确定性校验和证据定位，不能冒充 AI 审核完成。',
    }
  }
  if (!value.base_url) {
    return {
      label: '缺请求地址',
      className: 'bg-red-100 text-red-700',
      description: '缺少 Base URL，发布后也无法真实调用模型。',
    }
  }
  if (!runtimeModel(value)) {
    return {
      label: '缺请求模型',
      className: 'bg-red-100 text-red-700',
      description: '缺少模型 ID 或启用的模型映射，网关无法发起请求。',
    }
  }
  return {
    label: '可进入运行时',
    className: 'bg-emerald-100 text-emerald-700',
    description: '已发布且具备请求地址与模型映射；是否真实成功以 model_invocations 为准。',
  }
}

function coversTool(config: Config, value: AIViewValue, key: string) {
  if (config.status !== 'PUBLISHED' || value.enabled !== true) return false
  return configKind(config) === 'tool_policy' && (value.tool === key || value.tool === '*')
}

function runtimeStatusMeta(status: RuntimeProviderStatus['status']) {
  switch (status) {
    case 'ready':
      return { label: '推理通过', className: 'bg-emerald-100 text-emerald-700' }
    case 'needs_probe':
      return { label: '待推理测试', className: 'bg-amber-100 text-amber-700' }
    case 'unavailable':
      return { label: '推理不可用', className: 'bg-red-100 text-red-700' }
    case 'misconfigured':
      return { label: '配置缺失', className: 'bg-red-100 text-red-700' }
    case 'rule_engine':
      return { label: '规则兜底', className: 'bg-slate-900 text-white' }
  }
}

export default function AIConfigTab({ configs, onNew, onEdit, onPublish, onDelete }: AIConfigTabProps) {
  const [runtimeReadinessByTool, setRuntimeReadinessByTool] = useState<Record<string, RuntimeReadiness>>({})
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const [runtimeLoading, setRuntimeLoading] = useState(false)
  const providerConfigs = configs.filter((config) => configKind(config) === 'provider')
  const applicationConfigs = configs.filter((config) => configKind(config) === 'application')
  const policyConfigs = configs.filter((config) => configKind(config) === 'tool_policy')
  const enabledProviders = providerConfigs.filter((config) => valueOf(config).enabled === true)
  const publishedProviders = providerConfigs.filter((config) => config.status === 'PUBLISHED')
  const appBindings = new Set(applicationConfigs.flatMap((config) => list(valueOf(config).bound_tools)))
  const toolCoverage = TOOL_COVERAGE.map((tool) => ({
    ...tool,
    covered: policyConfigs.some((config) => coversTool(config, valueOf(config), tool.key)),
    runtime: runtimeReadinessByTool[tool.key],
  }))

  async function loadRuntimeReadiness() {
    setRuntimeLoading(true)
    setRuntimeError(null)
    try {
      const entries = await Promise.all(TOOL_COVERAGE.map(async (tool) => {
        const response = await fetch(
          `/api/configs/ai-runtime?tool=${encodeURIComponent(tool.key)}&capability=${encodeURIComponent(tool.capability)}`,
          { credentials: 'include' }
        )
        const payload = await response.json().catch(() => null)
        if (!response.ok || payload?.success !== true) {
          throw new Error(`${tool.label}: ${payload?.error?.message || '运行时状态获取失败'}`)
        }
        return [tool.key, payload.data as RuntimeReadiness] as const
      }))
      setRuntimeReadinessByTool(Object.fromEntries(entries))
    } catch (error) {
      setRuntimeReadinessByTool({})
      setRuntimeError(error instanceof Error ? error.message : '运行时状态获取失败')
    } finally {
      setRuntimeLoading(false)
    }
  }

  useEffect(() => {
    void loadRuntimeReadiness()
  }, [])

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>平台 AI 能力底座</CardTitle>
          <p className="mt-2 text-sm text-slate-500">
            模型是 Provider 配置，应用是 Agent/场景绑定，工具只消费已发布策略；L1/L2/L3 只是策略模板，不是底层结构。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => onNew('application')}>新增模型应用</Button>
          <Button variant="outline" onClick={() => onNew('tool_policy')}>新增工具策略</Button>
          <Button onClick={() => onNew('provider')}>新增 Provider</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
              <PlugZapIcon className="h-4 w-4 text-blue-600" />
              Provider 配置（ccswitch）
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md bg-slate-50 p-2">
                <div className="text-xl font-semibold">{providerConfigs.length}</div>
                <div className="text-xs text-slate-500">Provider</div>
              </div>
              <div className="rounded-md bg-slate-50 p-2">
                <div className="text-xl font-semibold">{enabledProviders.length}</div>
                <div className="text-xs text-slate-500">启用</div>
              </div>
              <div className="rounded-md bg-slate-50 p-2">
                <div className="text-xl font-semibold">{publishedProviders.length}</div>
                <div className="text-xs text-slate-500">发布</div>
              </div>
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-500">
              只回答“怎么连”：供应商、官网、Base URL、API 格式、Token、模型映射和 JSON 扩展。
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
              <BrainCircuitIcon className="h-4 w-4 text-violet-600" />
              模型应用（Paseo / Agent）
            </div>
            <div className="flex flex-wrap gap-2">
              {labelItems(Array.from(appBindings), APP_LABELS).slice(0, 6).map((app) => (
                <Badge key={app} variant="outline" className="bg-violet-50 text-violet-700">{app}</Badge>
              ))}
              {appBindings.size === 0 && <span className="text-sm text-slate-500">未绑定应用</span>}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-center">
              <div className="rounded-md bg-violet-50 p-2">
                <div className="text-xl font-semibold text-violet-800">{applicationConfigs.length}</div>
                <div className="text-xs text-violet-600">模型应用</div>
              </div>
              <div className="rounded-md bg-emerald-50 p-2">
                <div className="text-xl font-semibold text-emerald-800">{policyConfigs.length}</div>
                <div className="text-xs text-emerald-600">工具策略</div>
              </div>
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-500">
              只回答“怎么用”：开启哪些计划、Agent 统一 System Prompt、服务哪些业务场景。
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
              <RouteIcon className="h-4 w-4 text-emerald-600" />
              工具消费覆盖
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm text-slate-600">
              {toolCoverage.map((tool) => (
                <div key={tool.key} className="rounded-md bg-slate-50 px-2 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-900">{tool.label}</span>
                    <span className={tool.covered ? 'text-emerald-600' : 'text-amber-600'}>
                      {tool.covered ? '已覆盖' : '缺策略'}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">{tool.purpose}</div>
                  <div className="mt-0.5 truncate text-xs text-slate-400">
                    能力: {CAPABILITY_LABELS[tool.capability] || tool.capability}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900">运行时策略证据</h3>
              <p className="mt-1 text-sm text-slate-500">
                这里按工具展示已发布配置或环境兜底链；规则引擎只算兜底，不算 AI 模型调用成功。
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={loadRuntimeReadiness} disabled={runtimeLoading}>
              {runtimeLoading ? '刷新中' : '刷新运行时'}
            </Button>
          </div>
          {runtimeError && (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {runtimeError}
            </div>
          )}
          {toolCoverage.some((tool) => tool.runtime) && (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                <div className="rounded-md bg-slate-50 px-3 py-2">
                  <div className="text-xs text-slate-500">配置来源</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">
                    {toolCoverage.some((tool) => tool.runtime?.source === 'published_config')
                      ? '配置中心发布版本'
                      : '环境变量兜底'}
                  </div>
                </div>
                <div className="rounded-md bg-slate-50 px-3 py-2">
                  <div className="text-xs text-slate-500">工具覆盖</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">
                    {toolCoverage.filter((tool) => tool.runtime?.selectedProvider).length} / {TOOL_COVERAGE.length}
                  </div>
                </div>
                <div className="rounded-md bg-slate-50 px-3 py-2">
                  <div className="text-xs text-slate-500">AI 推理阻断</div>
                  <div className="mt-1 truncate text-sm font-semibold text-slate-900">
                    {toolCoverage.filter((tool) => {
                      const runtime = tool.runtime
                      if (!runtime) return false
                      return !runtime.providerChain.some((providerId) => (
                        runtime.providers.find((provider) => provider.id === providerId)?.status === 'ready'
                      ))
                    }).length}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {toolCoverage.map((tool) => {
                  const runtime = tool.runtime
                  const selected = runtime?.providers.find((provider) => provider.id === runtime.selectedProvider)
                  const meta = selected
                    ? runtimeStatusMeta(selected.status)
                    : { label: '未命中', className: 'bg-red-100 text-red-700' }
                  const issues = selected ? [...selected.blockingReasons, ...selected.warnings] : ['no_provider_matched']
                  const readyFallback = runtime?.providerChain
                    .map((providerId) => runtime.providers.find((provider) => provider.id === providerId))
                    .find((provider) => provider?.status === 'ready')
                  return (
                    <div key={tool.key} className="rounded-md border border-slate-200 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">{tool.label}</div>
                          <div className="mt-0.5 text-xs text-slate-500">
                            {CAPABILITY_LABELS[tool.capability] || tool.capability} · {runtime?.source === 'published_config' ? '发布配置' : '环境兜底'}
                          </div>
                        </div>
                        <Badge className={meta.className}>{meta.label}</Badge>
                      </div>
                      <div className="mt-3 space-y-1 text-xs text-slate-600">
                        <div className="truncate">首选: {selected?.id || runtime?.selectedProvider || '未命中'}</div>
                        <div className="truncate">模型: {selected?.model || '未配置'}</div>
                        <div className="truncate">应用: {runtime?.applicationKey || '未绑定'}</div>
                        <div className="truncate">策略: {runtime?.policyKey || '未发布结构化策略'}{runtime?.strategy ? ` · ${runtime.strategy}` : ''}</div>
                        <div className="truncate">降级链: {runtime?.providerChain.join(' → ') || '无可用链路'}</div>
                        <div>Token: {selected?.hasApiKey ? '已配置' : '未配置'}</div>
                        {selected?.lastProbe && (
                          <div>
                            最近推理: {new Date(selected.lastProbe.checkedAt).toLocaleString('zh-CN')}
                            {selected.lastProbe.latencyMs ? ` · ${selected.lastProbe.latencyMs}ms` : ''}
                            {selected.lastProbe.usage?.totalTokens ? ` · ${selected.lastProbe.usage.totalTokens} tokens` : ''}
                          </div>
                        )}
                        {readyFallback && readyFallback.id !== selected?.id && (
                          <div className="truncate text-emerald-700">可降级到: {readyFallback.id} · {readyFallback.model}</div>
                        )}
                        <div className="break-words">
                          说明: {selected?.lastProbe?.error || (issues.length > 0 ? issues.join(' / ') : '当前发布配置已有真实推理证据')}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-900">模型 Provider</h3>
              <p className="text-sm text-slate-500">供应商、请求地址、API 格式、模型映射和健康状态在这里维护。</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {providerConfigs.map((config) => (
            <div key={config.id} className="rounded-lg border border-slate-200 bg-white p-4">
              {(() => {
                const value = valueOf(config)
                const readiness = providerReadiness(config, value)
                const mappings = Array.isArray(value.model_mappings) ? value.model_mappings : []
                return (
                  <>
              <div className="flex items-baseline justify-between mb-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{config.name}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    实例: {providerInstanceId(config, value)} · 配置对象: {config.key}
                  </div>
                </div>
                <div className="flex gap-1">
                  <ConfigStatusBadge status={config.status} />
                  <Badge className={readiness.className}>{readiness.label}</Badge>
                  {value.enabled === true && <Badge className="bg-emerald-100 text-emerald-700">启用</Badge>}
                </div>
              </div>

              <div className="text-xs text-slate-600 space-y-1.5 mb-4">
                <div className="truncate">供应商: {value.provider_name || '未命名'}</div>
                <div className="truncate">格式: {value.api_format || value.provider_kind || 'openai_compatible'}</div>
                <div className="truncate">地址: {value.base_url || '（内置 / 未配置）'}</div>
                <div className="truncate">请求模型: {runtimeModel(value) || mappings[0]?.request_model || '未配置'}</div>
                <div>Provider 超时: {formatTimeout(value.timeout_ms)}</div>
                <div>密钥: {typeof value.api_key === 'string' && value.api_key.length > 0 ? '已保存' : '未配置'}</div>
              </div>

              <div className="mb-4 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                <div className="font-medium text-slate-900">运行入口</div>
                <div>{readiness.description}</div>
                <div className="mt-1">业务 Prompt 和降级链由“模型应用 / 工具策略”维护。</div>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => onEdit(config)}>编辑</Button>
                {config.status !== 'PUBLISHED' && (
                  <Button variant="outline" size="sm" onClick={() => onPublish(config.id)}>发布</Button>
                )}
                <Button variant="outline" size="sm" onClick={() => onDelete(config.id)}>删除</Button>
              </div>
                  </>
                )
              })()}
            </div>
          ))}
          </div>
        </section>

        {providerConfigs.length === 0 && (
          <div className="text-center py-12">
            <p className="text-slate-500">暂无 AI Provider</p>
            <p className="text-sm text-slate-400 mt-2">先新增本地 LM Studio 或 OpenAI-compatible 云端 Provider</p>
          </div>
        )}

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white">
            <div className="flex items-center gap-2 border-b bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900">
              <BrainCircuitIcon className="h-4 w-4 text-violet-600" />
              模型应用
            </div>
            <div className="divide-y">
              {applicationConfigs.map((config) => {
                const value = valueOf(config)
                return (
                  <div key={config.id} className="px-4 py-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium text-slate-900">{config.name}</div>
                        <div className="mt-1 text-xs text-slate-500">{value.application_id || config.key} · {value.plan_mode || 'always_on'}</div>
                      </div>
                      <ConfigStatusBadge status={config.status} />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1">
                      {labelItems(list(value.bound_tools), APP_LABELS).map((tool) => (
                        <Badge key={tool} variant="outline" className="bg-violet-50 text-violet-700">{tool}</Badge>
                      ))}
                    </div>
                    <div className="mt-2 text-xs text-slate-500">
                      System Prompt: {value.system_prompt?.trim() ? '已配置' : '未配置'} · 默认策略: {value.default_policy_key || '未绑定'}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1" onClick={() => onEdit(config)}>编辑应用</Button>
                      {config.status !== 'PUBLISHED' && <Button variant="outline" size="sm" onClick={() => onPublish(config.id)}>发布</Button>}
                      <Button variant="outline" size="sm" onClick={() => onDelete(config.id)}>删除</Button>
                    </div>
                  </div>
                )
              })}
              {applicationConfigs.length === 0 && <div className="px-4 py-6 text-sm text-slate-500">暂无模型应用，Provider 不会自行获得业务 Prompt。</div>}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white">
            <div className="flex items-center gap-2 border-b bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900">
              <GitBranchIcon className="h-4 w-4 text-emerald-600" />
              工具路由与降级策略
            </div>
            <div className="divide-y">
              {policyConfigs.map((config) => {
                const value = valueOf(config)
                const chain = [...list(value.provider_chain), ...list(value.fallback_chain)]
                return (
                  <div key={config.id} className="px-4 py-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium text-slate-900">{config.name}</div>
                        <div className="mt-1 text-xs text-slate-500">{APP_LABELS[value.tool || ''] || value.tool || '未绑定工具'} · {CAPABILITY_LABELS[value.capability || ''] || value.capability || '未绑定能力'}</div>
                      </div>
                      <div className="flex gap-1"><Badge variant="outline">P{value.priority ?? '-'}</Badge><ConfigStatusBadge status={config.status} /></div>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-500">
                      <span>应用: {value.application_key || '未绑定'}</span>
                      <span>策略: {value.strategy || '未设置'}</span>
                      <span className="col-span-2 truncate">调用链: {chain.length > 0 ? chain.join(' → ') : '未配置'}</span>
                      <span>超时: {formatTimeout(value.timeout_ms)}</span>
                      <span>重试: {value.retry_count ?? 0}</span>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1" onClick={() => onEdit(config)}>编辑策略</Button>
                      {config.status !== 'PUBLISHED' && <Button variant="outline" size="sm" onClick={() => onPublish(config.id)}>发布</Button>}
                      <Button variant="outline" size="sm" onClick={() => onDelete(config.id)}>删除</Button>
                    </div>
                  </div>
                )
              })}
              {policyConfigs.length === 0 && <div className="px-4 py-6 text-sm text-slate-500">暂无工具策略。结构化配置启用后，未匹配策略的工具会被明确阻断。</div>}
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center gap-2 border-b bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900">
            <ShieldCheckIcon className="h-4 w-4" />
            验收证据口径
          </div>
          <div className="grid gap-3 p-4 text-sm text-slate-600 lg:grid-cols-3">
            <div className="flex gap-2"><CheckCircle2Icon className="mt-0.5 h-4 w-4 text-emerald-600" /><span>Provider、模型应用和工具策略分别保存、分别发布。</span></div>
            <div className="flex gap-2"><DatabaseZapIcon className="mt-0.5 h-4 w-4 text-blue-600" /><span>正式调用必须写入 model_invocations，并记录策略、应用、Provider、模型和 token。</span></div>
            <div className="flex gap-2"><CpuIcon className="mt-0.5 h-4 w-4 text-slate-700" /><span>规则引擎只做确定性兜底，不能标记为 AI 审核完成。</span></div>
          </div>
        </section>
      </CardContent>
    </Card>
  )
}

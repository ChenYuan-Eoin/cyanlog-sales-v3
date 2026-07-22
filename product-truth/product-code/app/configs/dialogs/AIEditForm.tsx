'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { Config } from '../types'

interface AIValue {
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
  json_config?: Record<string, unknown>
  json_config_text?: string
  routing?: { max_pages?: number; strategy?: string }
  application_id?: string
  plan_mode?: 'always_on' | 'manual' | 'scheduled'
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
    sensitive_data?: 'local_only' | 'allow_cloud' | 'any'
  }
}

interface ProbeResult {
  ok: boolean
  provider_kind: string
  api_format: string
  base_url: string
  model: string
  latency_ms: number
  status?: number
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
  message: string
  error?: string
  checked_at: string
  evidence_saved?: boolean
  runtime_config_match?: boolean
  evidence_note?: string
}

interface ModelListResult {
  ok: boolean
  provider_kind: string
  api_format: string
  base_url: string
  models: Array<{
    id: string
    owned_by?: string
  }>
  latency_ms: number
  status?: number
  message: string
  error?: string
  checked_at: string
}

interface AIEditFormProps {
  config: Partial<Config>
  availableConfigs?: Config[]
  onChange: (config: Partial<Config>) => void
}

const CAPABILITY_OPTIONS = [
  { key: 'contract_review', label: '合同语义审核', description: '识别合同风险并输出结构化风险项' },
  { key: 'long_text', label: '长文本', description: '处理长 DOCX、长 PDF 和标书解析' },
  { key: 'document_parse', label: '文档解析', description: '抽取章节、条款、页码和证据范围' },
  { key: 'rule_translation', label: '规则转译', description: '把规则资产转成可执行 SkillBundle' },
  { key: 'comment_patch', label: '批注草案', description: '生成 Word 原生批注或修订建议文案' },
  { key: 'report_summary', label: '报告摘要', description: '生成审核结论、复核说明和客户侧说明' },
  { key: 'vision', label: '图片/视觉', description: '处理图片、扫描页和视觉证据' },
  { key: 'deterministic_rule_scan', label: '确定性规则', description: '只做确定性校验，不冒充 AI 审核' },
]

const APP_OPTIONS = [
  { key: 'contract_review', label: '合同审核', description: 'ReviewRun 风险定位、谈判跟进、批注输出' },
  { key: 'contract_compare', label: '合同对比', description: '旧/新文件差异解释和风险披露' },
  { key: 'contract_draft', label: '合同起草', description: '需求生成可编辑合同草稿' },
  { key: 'tender_parse', label: '标书/长文档解析', description: '长 PDF/长 DOCX 抽取与归纳' },
  { key: 'rule_translation', label: '规则转译', description: '配置中心规则转成 SkillBundle' },
  { key: 'comment_patch', label: '批注输出', description: '把风险项写成 Word 批注或修订建议' },
  { key: 'report_summary', label: '报告摘要', description: '生成审核报告、复核摘要和导出原因' },
  { key: 'ai_chat', label: '审核对话', description: '围绕合同风险和证据进行上下文问答' },
]

const DEFAULT_MAPPINGS = [
  { role: 'default', display_name: '默认模型', request_model: '', enabled: true },
  { role: 'long_context', display_name: '长文本模型', request_model: '', enabled: false },
  { role: 'vision', display_name: '视觉模型', request_model: '', enabled: false },
]

const PROVIDER_KIND_OPTIONS = [
  { value: 'lm_studio', label: 'LM Studio 本地模型' },
  { value: 'openai_compatible', label: 'OpenAI-compatible 网关' },
  { value: 'openai', label: 'OpenAI 官方' },
  { value: 'anthropic', label: 'Anthropic-compatible' },
  { value: 'rule_engine', label: '规则引擎兜底' },
  { value: 'custom', label: '自定义 Provider' },
]

const ROUTING_STRATEGY_OPTIONS = [
  { value: 'local_first', label: '本地优先' },
  { value: 'quality_first', label: '质量优先' },
  { value: 'cost_first', label: '成本优先' },
  { value: 'compliance_first', label: '合规优先' },
  { value: 'full', label: '整文优先' },
  { value: 'chunked', label: '分块长文档' },
  { value: 'rule', label: '规则兜底' },
]

export default function AIEditForm({ config, availableConfigs = [], onChange }: AIEditFormProps) {
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null)
  const [isProbing, setIsProbing] = useState(false)
  const [probeError, setProbeError] = useState<string | null>(null)
  const [modelListResult, setModelListResult] = useState<ModelListResult | null>(null)
  const [isFetchingModels, setIsFetchingModels] = useState(false)
  const [modelListError, setModelListError] = useState<string | null>(null)
  const value = (config.value as AIValue) || {}
  const resolvedProviderKind = value.provider_kind === 'builtin'
    || value.model === 'rule-engine'
    || value.instance_id === 'rule_engine'
    ? 'rule_engine'
    : value.provider_kind || 'openai_compatible'
  const isRuleEngine = resolvedProviderKind === 'rule_engine'
  const mappings = value.model_mappings && value.model_mappings.length > 0
    ? value.model_mappings
    : DEFAULT_MAPPINGS
  const jsonText = value.json_config_text
    ?? (value.json_config ? JSON.stringify(value.json_config, null, 2) : '{\n}')

  const updateValue = (patch: Partial<AIValue>) => {
    onChange({ ...config, value: { ...value, ...patch } })
  }

  const providerOptions = availableConfigs
    .filter((candidate) => {
      const candidateValue = candidate.value as AIValue
      return candidate.type === 'AI_CONFIG'
        && candidate.status === 'PUBLISHED'
        && candidateValue.kind !== 'application'
        && candidateValue.kind !== 'tool_policy'
    })
    .map((candidate) => {
      const candidateValue = candidate.value as AIValue
      return {
        id: candidateValue.instance_id || candidateValue.profile || candidate.key,
        label: candidate.name,
        status: candidate.status,
      }
    })

  const applicationOptions = availableConfigs
    .filter((candidate) => (
      candidate.type === 'AI_CONFIG'
      && candidate.status === 'PUBLISHED'
      && (candidate.value as AIValue).kind === 'application'
    ))
    .map((candidate) => ({
      id: (candidate.value as AIValue).application_id || candidate.key,
      label: candidate.name,
      status: candidate.status,
    }))

  const providerReferences = Array.from(new Set([
    ...providerOptions.map((option) => option.id),
    ...(value.provider_chain || []),
    ...(value.fallback_chain || []),
  ]))

  const setProviderRole = (providerId: string, role: 'primary' | 'fallback' | 'unused') => {
    const primary = (value.provider_chain || []).filter((entry) => entry !== providerId)
    const fallback = (value.fallback_chain || []).filter((entry) => entry !== providerId)
    if (role === 'primary') primary.push(providerId)
    if (role === 'fallback') fallback.push(providerId)
    updateValue({ provider_chain: primary, fallback_chain: fallback })
  }

  const moveProvider = (chainKey: 'provider_chain' | 'fallback_chain', providerId: string, direction: -1 | 1) => {
    const chain = [...(value[chainKey] || [])]
    const index = chain.indexOf(providerId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= chain.length) return
    ;[chain[index], chain[target]] = [chain[target], chain[index]]
    updateValue({ [chainKey]: chain } as Partial<AIValue>)
  }

  const handleProbe = async () => {
    setIsProbing(true)
    setProbeError(null)
    setProbeResult(null)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/configs/ai-probe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ config_id: config.id, value }),
      })
      const payload = await res.json()
      if (!res.ok || payload.success === false) {
        setProbeError(payload?.error?.message || payload?.error || '推理测试失败')
        return
      }
      setProbeResult(payload.data)
    } catch (error) {
      setProbeError(error instanceof Error ? error.message : '推理测试异常')
    } finally {
      setIsProbing(false)
    }
  }

  const toggleListValue = (key: 'capabilities' | 'bound_apps' | 'bound_tools', item: string) => {
    const current = Array.isArray(value[key]) ? value[key] : []
    const next = current.includes(item)
      ? current.filter((entry) => entry !== item)
      : [...current, item]
    updateValue({ [key]: next } as Partial<AIValue>)
  }

  const updateMapping = (
    index: number,
    patch: Partial<NonNullable<AIValue['model_mappings']>[number]>
  ) => {
    const next = mappings.map((mapping, mappingIndex) => (
      mappingIndex === index ? { ...mapping, ...patch } : mapping
    ))
    const firstEnabledModel = next.find((mapping) => mapping.enabled !== false && mapping.request_model)?.request_model
    updateValue({
      model_mappings: next,
      model: firstEnabledModel || value.model || '',
    })
  }

  const applyModelsToMappings = (modelIds: string[]) => {
    if (modelIds.length === 0) {
      return
    }
    const next = mappings.map((mapping, index) => ({
      ...mapping,
      request_model: mapping.request_model || modelIds[Math.min(index, modelIds.length - 1)] || modelIds[0],
      enabled: mapping.role === 'default' ? true : mapping.enabled,
    }))
    const defaultModel = next.find((mapping) => mapping.enabled !== false && mapping.request_model)?.request_model || modelIds[0]
    updateValue({
      model_mappings: next,
      model: value.model || defaultModel,
    })
  }

  const handleFetchModels = async () => {
    setIsFetchingModels(true)
    setModelListError(null)
    setModelListResult(null)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/configs/ai-models', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ config_id: config.id, value }),
      })
      const payload = await res.json()
      if (!res.ok || payload.success === false) {
        setModelListError(payload?.error?.message || payload?.error || '获取模型列表失败')
        return
      }
      const result = payload.data as ModelListResult
      setModelListResult(result)
      if (result.ok) {
        applyModelsToMappings(result.models.map((model) => model.id))
      }
    } catch (error) {
      setModelListError(error instanceof Error ? error.message : '获取模型列表异常')
    } finally {
      setIsFetchingModels(false)
    }
  }

  const kind = value.kind === 'application' || value.kind === 'tool_policy' ? value.kind : 'provider'
  const identityFields = (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <label className="text-sm font-medium">配置键</label>
        <Input
          value={config.key || ''}
          onChange={(event) => onChange({ ...config, key: event.target.value })}
          placeholder={kind === 'application' ? 'contract_review_agent' : kind === 'tool_policy' ? 'contract_review_local_first' : 'local_primary'}
          disabled={!!config.id}
        />
        <p className="mt-1 text-xs text-slate-500">发布后由应用和策略稳定引用，创建后不再修改。</p>
      </div>
      <div>
        <label className="text-sm font-medium">显示名称</label>
        <Input
          value={config.name || ''}
          onChange={(event) => onChange({
            ...config,
            name: event.target.value,
            value: { ...value, name: event.target.value },
          })}
          placeholder="给管理员看的名称"
        />
      </div>
    </div>
  )

  const jsonEditor = (
    <section className="space-y-3 rounded-lg border p-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">高级 JSON 参数</h3>
        <p className="text-xs text-slate-500">只用于当前对象的扩展字段；常用配置必须在上方可视化维护。</p>
      </div>
      <Textarea
        className="min-h-[120px] font-mono text-xs"
        value={jsonText}
        onChange={(event) => updateValue({ json_config_text: event.target.value })}
        placeholder="{}"
      />
    </section>
  )

  if (kind === 'application') {
    return (
      <div className="space-y-6">
        <section className="rounded-lg border border-violet-200 bg-violet-50 p-4">
          <h3 className="font-semibold text-violet-950">模型应用</h3>
          <p className="mt-1 text-sm text-violet-800">定义 Agent 的计划、统一 System Prompt 和可服务工具；不保存 URL、Token 或降级链。</p>
        </section>
        <section className="space-y-4 rounded-lg border p-4">
          {identityFields}
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-sm font-medium">应用标识</label>
              <Input value={value.application_id || ''} onChange={(event) => updateValue({ application_id: event.target.value })} placeholder="contract_review_agent" />
            </div>
            <div>
              <label className="text-sm font-medium">开启计划</label>
              <select className="mt-1 w-full rounded-md border p-2 text-sm" value={value.plan_mode || 'always_on'} onChange={(event) => updateValue({ plan_mode: event.target.value as AIValue['plan_mode'] })}>
                <option value="always_on">持续可用</option>
                <option value="manual">人工触发</option>
                <option value="scheduled">计划触发</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">默认工具策略</label>
              <Input value={value.default_policy_key || ''} onChange={(event) => updateValue({ default_policy_key: event.target.value })} placeholder="contract_review_local_first" />
            </div>
            <label className="flex items-center gap-2 pt-6 text-sm">
              <input type="checkbox" checked={value.enabled !== false} onChange={(event) => updateValue({ enabled: event.target.checked })} />
              启用此模型应用
            </label>
          </div>
        </section>
        <section className="space-y-3 rounded-lg border p-4">
          <h3 className="text-sm font-semibold text-slate-900">可服务工具</h3>
          <div className="grid gap-2 md:grid-cols-2">
            {APP_OPTIONS.map((option) => (
              <label key={option.key} className="flex items-start gap-2 rounded-md border p-3 text-sm">
                <input className="mt-1" type="checkbox" checked={(value.bound_tools || []).includes(option.key)} onChange={() => toggleListValue('bound_tools', option.key)} />
                <span><span className="block font-medium">{option.label}</span><span className="mt-1 block text-xs text-slate-500">{option.description}</span></span>
              </label>
            ))}
          </div>
        </section>
        <section className="space-y-3 rounded-lg border p-4">
          <h3 className="text-sm font-semibold text-slate-900">Agent 能力与 System Prompt</h3>
          <div className="grid gap-2 md:grid-cols-2">
            {CAPABILITY_OPTIONS.map((option) => (
              <label key={option.key} className="flex items-start gap-2 rounded-md border p-3 text-sm">
                <input className="mt-1" type="checkbox" checked={(value.capabilities || []).includes(option.key)} onChange={() => toggleListValue('capabilities', option.key)} />
                <span><span className="block font-medium">{option.label}</span><span className="mt-1 block text-xs text-slate-500">{option.description}</span></span>
              </label>
            ))}
          </div>
          <Textarea className="min-h-[150px]" value={value.system_prompt || ''} onChange={(event) => updateValue({ system_prompt: event.target.value })} placeholder="为该应用下所有 Agent 注入的基础 System Prompt" />
        </section>
        {jsonEditor}
      </div>
    )
  }

  if (kind === 'tool_policy') {
    return (
      <div className="space-y-6">
        <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <h3 className="font-semibold text-emerald-950">工具消费策略</h3>
          <p className="mt-1 text-sm text-emerald-800">定义业务工具在什么条件下调用哪个应用和 Provider，并明确超时、重试、成本记录与降级顺序。</p>
        </section>
        <section className="space-y-4 rounded-lg border p-4">
          {identityFields}
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-sm font-medium">消费工具</label>
              <select className="mt-1 w-full rounded-md border p-2 text-sm" value={value.tool || 'contract_review'} onChange={(event) => updateValue({ tool: event.target.value })}>
                {APP_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">要求能力</label>
              <select className="mt-1 w-full rounded-md border p-2 text-sm" value={value.capability || 'contract_review'} onChange={(event) => updateValue({ capability: event.target.value })}>
                {CAPABILITY_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">模型应用 Key</label>
              <select className="mt-1 w-full rounded-md border p-2 text-sm" value={value.application_key || ''} onChange={(event) => updateValue({ application_key: event.target.value })}>
                <option value="">不绑定模型应用</option>
                {applicationOptions.map((option) => (
                  <option key={option.id} value={option.id}>{option.label} · {option.id} · {option.status}</option>
                ))}
                {value.application_key && !applicationOptions.some((option) => option.id === value.application_key) && (
                  <option value={value.application_key}>{value.application_key} · 历史引用</option>
                )}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">策略模板</label>
              <select className="mt-1 w-full rounded-md border p-2 text-sm" value={value.strategy || 'local_first'} onChange={(event) => updateValue({ strategy: event.target.value })}>
                {ROUTING_STRATEGY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">匹配优先级</label>
              <Input type="number" min={1} value={value.priority ?? 100} onChange={(event) => updateValue({ priority: Number(event.target.value) })} />
            </div>
            <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={value.enabled !== false} onChange={(event) => updateValue({ enabled: event.target.checked })} />启用此工具策略</label>
          </div>
        </section>
        <section className="space-y-4 rounded-lg border p-4">
          <div><h3 className="text-sm font-semibold text-slate-900">Provider 调用与降级链</h3><p className="text-xs text-slate-500">为每个模型实例选择“首选、降级或不使用”，并调整实际调用顺序。L1/L2/L3 只描述策略层级，不再作为模型身份。</p></div>
          <div className="space-y-2">
            {providerReferences.length === 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">请先创建并发布至少一个模型 Provider。</div>
            )}
            {providerReferences.map((providerId) => {
              const option = providerOptions.find((entry) => entry.id === providerId)
              const primaryIndex = (value.provider_chain || []).indexOf(providerId)
              const fallbackIndex = (value.fallback_chain || []).indexOf(providerId)
              const role = primaryIndex >= 0 ? 'primary' : fallbackIndex >= 0 ? 'fallback' : 'unused'
              const chainKey = role === 'primary' ? 'provider_chain' : 'fallback_chain'
              const index = role === 'primary' ? primaryIndex : fallbackIndex
              const chainLength = role === 'primary' ? (value.provider_chain || []).length : (value.fallback_chain || []).length
              return (
                <div key={providerId} className="grid items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 md:grid-cols-[minmax(0,1fr)_160px_auto]">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900">{option?.label || providerId}</div>
                    <div className="truncate text-xs text-slate-500">实例 ID: {providerId}{option ? ` · ${option.status}` : ' · 历史引用'}</div>
                  </div>
                  <select className="rounded-md border bg-white p-2 text-sm" value={role} onChange={(event) => setProviderRole(providerId, event.target.value as 'primary' | 'fallback' | 'unused')}>
                    <option value="primary">首选调用</option>
                    <option value="fallback">失败后降级</option>
                    <option value="unused">本策略不使用</option>
                  </select>
                  <div className="flex gap-1">
                    <button type="button" className="rounded border bg-white px-2 py-1 text-xs disabled:opacity-40" disabled={role === 'unused' || index <= 0} onClick={() => moveProvider(chainKey, providerId, -1)}>上移</button>
                    <button type="button" className="rounded border bg-white px-2 py-1 text-xs disabled:opacity-40" disabled={role === 'unused' || index < 0 || index >= chainLength - 1} onClick={() => moveProvider(chainKey, providerId, 1)}>下移</button>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div><label className="text-sm font-medium">单次超时（毫秒）</label><Input type="number" min={1000} step={1000} value={value.timeout_ms ?? 45000} onChange={(event) => updateValue({ timeout_ms: Number(event.target.value) })} /></div>
            <div><label className="text-sm font-medium">同一 Provider 重试次数</label><Input type="number" min={0} max={10} value={value.retry_count ?? 1} onChange={(event) => updateValue({ retry_count: Number(event.target.value) })} /></div>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.cost_tracking !== false} onChange={(event) => updateValue({ cost_tracking: event.target.checked })} />记录 token、时延与成本证据</label>
        </section>
        <section className="space-y-4 rounded-lg border p-4">
          <div><h3 className="text-sm font-semibold text-slate-900">匹配条件</h3><p className="text-xs text-slate-500">条件为空时匹配该工具的所有请求；可按长短文档、页数、格式和敏感性拆分多条策略。</p></div>
          <div className="grid gap-4 md:grid-cols-2">
            <div><label className="text-sm font-medium">最小字符数</label><Input type="number" min={0} value={value.conditions?.min_chars ?? ''} onChange={(event) => updateValue({ conditions: { ...value.conditions, min_chars: event.target.value ? Number(event.target.value) : undefined } })} /></div>
            <div><label className="text-sm font-medium">最大字符数</label><Input type="number" min={1} value={value.conditions?.max_chars ?? ''} onChange={(event) => updateValue({ conditions: { ...value.conditions, max_chars: event.target.value ? Number(event.target.value) : undefined } })} /></div>
            <div><label className="text-sm font-medium">最小页数</label><Input type="number" min={1} value={value.conditions?.min_pages ?? ''} onChange={(event) => updateValue({ conditions: { ...value.conditions, min_pages: event.target.value ? Number(event.target.value) : undefined } })} /></div>
            <div><label className="text-sm font-medium">最大页数</label><Input type="number" min={1} value={value.conditions?.max_pages ?? ''} onChange={(event) => updateValue({ conditions: { ...value.conditions, max_pages: event.target.value ? Number(event.target.value) : undefined } })} /></div>
            <div><label className="text-sm font-medium">文档格式</label><Input value={(value.conditions?.document_formats || []).join(', ')} onChange={(event) => updateValue({ conditions: { ...value.conditions, document_formats: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) } })} placeholder="docx, pdf" /></div>
            <div><label className="text-sm font-medium">数据边界</label><select className="mt-1 w-full rounded-md border p-2 text-sm" value={value.conditions?.sensitive_data || 'any'} onChange={(event) => updateValue({ conditions: { ...value.conditions, sensitive_data: event.target.value as NonNullable<AIValue['conditions']>['sensitive_data'] } })}><option value="any">不限</option><option value="local_only">仅本地处理</option><option value="allow_cloud">允许云端</option></select></div>
          </div>
        </section>
        {jsonEditor}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-blue-100 bg-blue-50/60 p-4">
        <div className="rounded-md border border-blue-100 bg-white p-3">
          <div className="text-sm font-semibold text-slate-900">Provider 连接配置</div>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            这里只维护供应商、官网、请求地址、API 格式、Token、模型映射和供应商扩展参数。Agent 的 System Prompt 与工具路由策略在独立对象中维护。
          </p>
        </div>
      </section>

      <section className="grid gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 md:grid-cols-3">
        <div>
          <div className="text-sm font-semibold text-amber-950">
            {isRuleEngine ? '规则兜底验证' : '真实推理测试'}
          </div>
          <p className="mt-1 text-xs leading-5 text-amber-900">
            {isRuleEngine
              ? '检查内置规则引擎配置；不调用 AI 模型，不消耗 Token，也不计为 AI 推理成功。'
              : '使用当前 Base URL、模型和 Token 发起最小推理，会产生延迟并消耗 Token。'}
          </p>
        </div>
        <div>
          <div className="text-sm font-semibold text-amber-950">发布运行策略</div>
          <p className="mt-1 text-xs leading-5 text-amber-900">
            保存并发布后进入 AI_CONFIG，网关才会按工具、能力和降级链调度。
          </p>
        </div>
        <div>
          <div className="text-sm font-semibold text-amber-950">正式调用证据</div>
          <p className="mt-1 text-xs leading-5 text-amber-900">
            只有 ReviewRun 写入 model_invocations，才算合同审核真实调用过模型。
          </p>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">1. 模型配置（Provider / ccswitch）</h3>
            <p className="text-xs text-slate-500">对应 ccswitch：供应商、请求地址、API 格式、Token 和默认模型。</p>
          </div>
          <button
            type="button"
            onClick={handleProbe}
            disabled={isProbing}
            className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isProbing
              ? (isRuleEngine ? '验证中...' : '推理中...')
              : (isRuleEngine ? '验证规则引擎兜底（不消耗 Token）' : '运行推理测试（消耗 Token）')}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">模型实例 ID</label>
            <Input
              value={value.instance_id || value.profile || ''}
              onChange={(event) => {
                const instanceId = event.target.value
                onChange({
                  ...config,
                  key: config.id ? config.key : (config.key || instanceId),
                  value: { ...value, instance_id: instanceId },
                })
              }}
              placeholder="如: local_primary"
              disabled={!!config.id && Boolean(value.instance_id)}
            />
            <p className="mt-1 text-xs text-slate-500">
              工具策略只引用此 ID；它不是 L1/L2/L3。配置对象键：{config.key || '创建后生成'}。
            </p>
          </div>
        <div>
            <label className="text-sm font-medium">显示名称</label>
            <Input
              value={config.name || ''}
              onChange={(e) => onChange({ ...config, name: e.target.value, value: { ...value, name: e.target.value } })}
              placeholder="如: LM Studio 本地模型"
            />
          </div>
          <div>
            <label className="text-sm font-medium">供应商名称</label>
            <Input
              value={value.provider_name || ''}
              onChange={(e) => updateValue({ provider_name: e.target.value })}
              placeholder="如: LM Studio / 易用云 / OpenAI"
            />
          </div>
          <div>
            <label className="text-sm font-medium">官网链接</label>
            <Input
              value={value.provider_url || ''}
              onChange={(e) => updateValue({ provider_url: e.target.value })}
              placeholder="https://..."
            />
          </div>
          <div>
            <label className="text-sm font-medium">Provider 类型</label>
            <select
              className="w-full mt-1 rounded-md border p-2 text-sm"
              value={resolvedProviderKind}
              onChange={(e) => {
                const nextKind = e.target.value
                updateValue({
                  provider_kind: nextKind,
                  api_format: nextKind === 'lm_studio' ? 'lm_studio' : nextKind === 'rule_engine' ? 'builtin' : value.api_format,
                  model: nextKind === 'rule_engine' ? 'rule-engine' : value.model,
                  base_url: nextKind === 'rule_engine' ? '' : value.base_url,
                })
              }}
            >
              {PROVIDER_KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">API 格式</label>
            <select
              className="w-full mt-1 rounded-md border p-2 text-sm"
              value={value.api_format || 'openai_compatible'}
              onChange={(e) => updateValue({ api_format: e.target.value })}
            >
              <option value="openai_compatible">OpenAI Chat Completions</option>
              <option value="lm_studio">LM Studio REST API</option>
              <option value="anthropic_compatible">Anthropic-compatible</option>
              <option value="builtin">Built-in</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">请求地址 Base URL</label>
            <Input
              value={value.base_url || ''}
              onChange={(e) => updateValue({ base_url: e.target.value })}
              placeholder={isRuleEngine ? '内置规则引擎无需地址' : '如: http://127.0.0.1:1234/v1'}
              disabled={isRuleEngine}
            />
          </div>
          <div>
            <label className="text-sm font-medium">API Key / Token</label>
            <Input
              type="password"
              value={value.api_key || ''}
              onChange={(e) => updateValue({ api_key: e.target.value })}
              placeholder="留空保持现有值"
              disabled={isRuleEngine}
            />
            <p className="mt-1 text-xs text-slate-500">安全存储，列表和 API 返回只展示脱敏状态。</p>
          </div>
          <label className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
            <input
              className="mt-1"
              type="checkbox"
              checked={value.enabled !== false}
              onChange={(event) => updateValue({ enabled: event.target.checked })}
            />
            <span>
              <span className="block font-medium text-slate-900">启用此 Provider</span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">关闭后保留配置，但不会进入任何已发布工具策略的候选链。</span>
            </span>
          </label>
        </div>
        {(probeResult || probeError) && (
          <div className={`rounded-md border p-3 text-sm ${probeResult?.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
            {probeResult ? (
              <div className="space-y-1">
                <div className="font-semibold">
                  {isRuleEngine
                    ? (probeResult.ok ? '规则兜底检查通过' : '规则兜底检查未通过')
                    : (probeResult.ok ? '推理测试通过' : '推理测试未通过')}
                </div>
                <div>{probeResult.message}</div>
                <div className="text-xs">
                  Provider: {probeResult.provider_kind} · Model: {probeResult.model || '未配置'} · Latency: {probeResult.latency_ms}ms
                  {probeResult.usage?.total_tokens ? ` · Tokens: ${probeResult.usage.total_tokens}` : ''}
                </div>
                {probeResult.error && <div className="text-xs">错误：{probeResult.error}</div>}
                {probeResult.evidence_note && <div className="text-xs">证据：{probeResult.evidence_note}</div>}
                {probeResult.evidence_saved === false && <div className="text-xs">警告：model_invocations 证据写入失败。</div>}
              </div>
            ) : (
              <div>{probeError}</div>
            )}
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-lg border p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              {isRuleEngine ? '2. 内置执行单元' : '2. 模型列表与映射（请求模型）'}
            </h3>
            <p className="text-xs text-slate-500">
              {isRuleEngine
                ? '规则引擎只做确定性条件校验、证据定位和失败解释，不包含远端模型映射。'
                : '显示名称给人看，请求模型给网关调用；默认模型会同步到兼容旧运行时的 model 字段。'}
            </p>
          </div>
          {!isRuleEngine && <button
            type="button"
            onClick={handleFetchModels}
            disabled={isFetchingModels}
            className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isFetchingModels ? '检查中...' : '检查连接并获取模型'}
          </button>}
        </div>
        {!isRuleEngine ? <div className="space-y-3">
          {mappings.map((mapping, index) => (
            <div key={`${mapping.role}-${index}`} className="grid grid-cols-[1fr_1.4fr_1fr_auto] gap-2 rounded-md bg-slate-50 p-2">
              <Input
                value={mapping.role || ''}
                onChange={(e) => updateMapping(index, { role: e.target.value })}
                placeholder="角色: default"
              />
              <Input
                value={mapping.display_name || ''}
                onChange={(e) => updateMapping(index, { display_name: e.target.value })}
                placeholder="显示名称"
              />
              <Input
                value={mapping.request_model || ''}
                onChange={(e) => updateMapping(index, { request_model: e.target.value })}
                placeholder="实际请求模型"
              />
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={mapping.enabled !== false}
                  onChange={(e) => updateMapping(index, { enabled: e.target.checked })}
                />
                启用
              </label>
            </div>
          ))}
        </div> : (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            执行单元：<span className="font-mono">rule-engine</span>。正式运行记录必须标记为降级或确定性兜底，不能显示为 AI 审核完成。
          </div>
        )}
        {(modelListResult || modelListError) && (
          <div className={`rounded-md border p-3 text-sm ${modelListResult?.ok ? 'border-blue-200 bg-blue-50 text-blue-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
            {modelListResult ? (
              <div className="space-y-2">
                <div className="font-semibold">{modelListResult.ok ? '已获取模型列表' : '模型列表不可用'}</div>
                <div>{modelListResult.message}</div>
                {modelListResult.models.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {modelListResult.models.slice(0, 12).map((model) => (
                      <span key={model.id} className="rounded bg-white px-2 py-1 text-xs font-medium text-slate-700">
                        {model.id}
                      </span>
                    ))}
                    {modelListResult.models.length > 12 && (
                      <span className="rounded bg-white px-2 py-1 text-xs text-slate-500">
                        +{modelListResult.models.length - 12}
                      </span>
                    )}
                  </div>
                )}
                <div className="text-xs">
                  Provider: {modelListResult.provider_kind} · Latency: {modelListResult.latency_ms}ms
                </div>
                {modelListResult.error && <div className="text-xs">错误：{modelListResult.error}</div>}
              </div>
            ) : (
              <div>{modelListError}</div>
            )}
          </div>
        )}
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          {isRuleEngine
            ? '规则兜底检查只证明内置执行单元配置有效；正式业务证据仍以 ReviewRun 的 model_invocations 降级记录为准。'
            : '模型列表只证明地址和认证可达，不证明模型能完成推理；发布配置需再运行推理测试，正式业务证据以 ReviewRun 的 model_invocations 为准。'}
        </div>
      </section>

      <section className="space-y-3 rounded-lg border p-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">3. JSON 扩展配置</h3>
          <p className="text-xs text-slate-500">用于保留供应商特定参数。当前会保存原文，后续网关可按 API 格式解释。</p>
        </div>
        <Textarea
          className="min-h-[120px] font-mono text-xs"
          value={jsonText}
          onChange={(e) => updateValue({ json_config_text: e.target.value })}
          placeholder='{"temperature":0.2,"max_tokens":4096}'
        />
      </section>
    </div>
  )
}

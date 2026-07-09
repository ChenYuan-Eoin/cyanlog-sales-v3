'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Config } from '../types'
import type { AIRuntimeState } from '../types'

interface AIValue {
  level?: number
  name?: string
  profile?: string
  provider_kind?: string
  base_url?: string
  api_key?: string
  model?: string
  timeout_ms?: number
  enabled?: boolean
  routing?: { max_pages?: number; strategy?: string }
  stages?: string[]
}

interface AIEditFormProps {
  config: Partial<Config>
  onChange: (config: Partial<Config>) => void
}

type ProbeResult = {
  runtime_state: AIRuntimeState
  runtime_reason: string
  runtime_action: string | null
  runtime_environment: string
  local_endpoint: boolean
  probe_scope: string
  available_models?: string[]
  chat_probe?: {
    ok: boolean
    status: number | null
    latency_ms: number
    model: string
    content_sample: string | null
    error: string | null
  } | null
  credential_checked: 'provided' | 'missing' | 'not_required'
}

function runtimeStateLabel(state: AIRuntimeState) {
  const labels: Record<AIRuntimeState, string> = {
    builtin_ready: '兜底可用',
    missing_base_url: '地址缺失',
    missing_credential: '密钥缺失',
    unreachable_in_vercel: '生产不可达',
    local_health_ok: '本地 HTTP 可达',
    local_cli_ready: 'CLI 可调用',
    local_auth_failed: 'Token 未通过',
    local_health_failed: '本地不可达',
    local_generation_failed: '本地生成失败',
    remote_health_ok: '云端可达',
    remote_auth_failed: '云端认证失败',
    remote_health_failed: '云端不可达',
    remote_generation_failed: '云端生成失败',
    ready_to_call: '具备调用条件',
    recent_invocation_passed: '正式调用通过',
    recent_invocation_partial: '调用部分通过',
    recent_invocation_failed: '最近调用失败',
  }
  return labels[state]
}

function runtimeStateClass(state: AIRuntimeState) {
  if (state === 'recent_invocation_passed') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  }
  if (state === 'ready_to_call' || state === 'local_health_ok' || state === 'remote_health_ok') {
    return 'border-blue-200 bg-blue-50 text-blue-800'
  }
  if (state === 'builtin_ready') {
    return 'border-slate-200 bg-slate-50 text-slate-700'
  }
  if (state === 'local_cli_ready' || state === 'recent_invocation_partial') {
    return 'border-blue-200 bg-blue-50 text-blue-800'
  }
  return 'border-rose-200 bg-rose-50 text-rose-700'
}

const STAGE_OPTIONS = [
  { value: 'structured_rules', label: '结构化规则' },
  { value: 'template_compare', label: '模板对比' },
  { value: 'semantic_review', label: '合同语义审核' },
  { value: 'tender_long_document_parse', label: '标书/长文档解析' },
  { value: 'comment_patch_draft', label: '批注草案' },
  { value: 'report_summary', label: '报告摘要' },
  { value: 'rule_fallback', label: '规则兜底' },
]

function defaultStagesForValue(value: AIValue, configKey?: string) {
  const profile = value.profile || ''
  if (value.provider_kind === 'builtin' || profile === 'rule_engine' || configKey === 'AI_RULE_ENGINE') {
    return ['structured_rules', 'rule_fallback']
  }
  if (value.level === 2 || profile === 'sales_cloud_backup' || profile === 'cloud_primary' || configKey === 'AI_CLOUD_PRIMARY') {
    return ['semantic_review', 'tender_long_document_parse', 'comment_patch_draft', 'report_summary']
  }
  return ['semantic_review', 'comment_patch_draft', 'report_summary']
}

function newModelKey(prefix: string) {
  return `${prefix}_${Date.now()}`
}

export default function AIEditForm({ config, onChange }: AIEditFormProps) {
  const value = (config.value as AIValue) || {}
  const [probing, setProbing] = useState(false)
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null)
  const [probeError, setProbeError] = useState<string | null>(null)
  const isLocalProvider = value.profile === 'local_primary' || (typeof value.base_url === 'string' && value.base_url.includes('127.0.0.1'))
  const isCloudProvider = value.profile === 'cloud_primary' || value.profile === 'sales_cloud_backup'
  const activeStages = Array.isArray(value.stages) && value.stages.length > 0
    ? value.stages
    : defaultStagesForValue(value, config.key)

  const updateValue = (patch: Partial<AIValue>) => {
    onChange({ ...config, value: { ...value, ...patch } })
  }

  const toggleStage = (stage: string) => {
    updateValue({
      stages: activeStages.includes(stage)
        ? activeStages.filter((item) => item !== stage)
        : [...activeStages, stage],
    })
  }

  const applyPreset = (preset: 'local' | 'cloud' | 'builtin') => {
    setProbeResult(null)
    setProbeError(null)
    if (preset === 'local') {
      onChange({
        ...config,
        key: config.id ? config.key : (config.key || newModelKey('AI_LOCAL_MODEL')),
        name: config.name || '本地 gpt-oss-20b',
        value: {
          ...value,
          level: 1,
          name: config.name || '本地 gpt-oss-20b',
          profile: 'local_primary',
          provider_kind: 'openai_compatible',
          base_url: 'http://127.0.0.1:1234/v1',
          model: value.model || 'gpt-oss-20b',
          timeout_ms: value.timeout_ms || 120000,
          enabled: true,
          routing: { ...value.routing, max_pages: value.routing?.max_pages || 15, strategy: 'chunked' },
          stages: ['semantic_review', 'comment_patch_draft', 'report_summary'],
        },
      })
      return
    }
    if (preset === 'cloud') {
      onChange({
        ...config,
        key: config.id ? config.key : (config.key || newModelKey('AI_CLOUD_MODEL')),
        name: config.name || '云端 OpenAI-compatible',
        value: {
          ...value,
          level: 2,
          name: config.name || '云端 OpenAI-compatible',
          profile: 'sales_cloud_backup',
          provider_kind: 'openai_compatible',
          base_url: value.base_url || 'https://cloud.yiyongai.cn/v1',
          model: value.model || '',
          timeout_ms: value.timeout_ms || 240000,
          enabled: true,
          routing: { ...value.routing, max_pages: value.routing?.max_pages || 80, strategy: 'chunked' },
          stages: ['semantic_review', 'tender_long_document_parse', 'comment_patch_draft', 'report_summary'],
        },
      })
      return
    }
    onChange({
      ...config,
      key: config.id ? config.key : (config.key || newModelKey('AI_RULE_ENGINE')),
      name: config.name || '规则引擎 (兜底)',
      value: {
        ...value,
        level: 3,
        name: config.name || '规则引擎 (兜底)',
        profile: 'rule_engine',
        provider_kind: 'builtin',
        base_url: '',
        api_key: '',
        model: 'rule-engine',
        timeout_ms: 15000,
        enabled: true,
        routing: { max_pages: 1, strategy: 'rule' },
        stages: ['structured_rules', 'rule_fallback'],
      },
    })
  }

  const handleProbe = async () => {
    setProbing(true)
    setProbeResult(null)
    setProbeError(null)
    try {
      const token = localStorage.getItem('token')
      const response = await fetch('/api/configs/ai-runtime/probe', {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider_kind: value.provider_kind || 'openai_compatible',
          base_url: value.base_url || '',
          api_key: value.api_key || '',
          model: value.model || '',
          timeout_ms: value.timeout_ms || (isLocalProvider ? 120000 : isCloudProvider ? 60000 : 15000),
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.success) {
        setProbeError(data?.error?.message || '连接测试失败')
        return
      }
      const result = data.data as ProbeResult
      setProbeResult(result)
      if (!value.model && result.available_models?.length === 1) {
        updateValue({ model: result.available_models[0] })
      }
    } catch {
      setProbeError('连接测试请求失败')
    } finally {
      setProbing(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
        <div className="font-medium">来源口径</div>
        <p className="mt-1">
          当前弹窗只维护一个“模型实例”。测试连接只使用正在输入的 Base URL、Model 和 Token。
          保存并发布后，它会进入数据库 AI_CONFIG，再由 ModelPolicy 生成策略快照；只有真实任务写入 model_invocations 后，才能算正式模型调用证据。
        </p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="text-sm font-medium text-slate-900">快速填充实例预设</div>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          预设只负责填表，不代表系统只能接三种模型。可以创建任意数量的本地、云端、专用长文档或规则执行器实例。
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => applyPreset('local')}>
            本地模型实例
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => applyPreset('cloud')}>
            云端模型实例
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => applyPreset('builtin')}>
            规则执行器
          </Button>
        </div>
      </div>
      <div>
        <label className="text-sm font-medium">模型实例 Key</label>
        <Input
          value={config.key || ''}
          onChange={(e) => onChange({ ...config, key: e.target.value })}
          placeholder="如: AI_LOCAL_MODEL_20260708"
          disabled={!!config.id}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium">策略优先级</label>
          <Input
            type="number"
            min={1}
            max={99}
            value={value.level || 1}
            onChange={(e) => updateValue({ level: parseInt(e.target.value) })}
          />
          <p className="mt-1 text-xs text-slate-500">数值越小越先进入候选池；实际调用由策略规则和降级链决定。</p>
        </div>
        <div>
          <label className="text-sm font-medium">显示名称</label>
          <Input
            value={config.name || ''}
            onChange={(e) => onChange({ ...config, name: e.target.value, value: { ...value, name: e.target.value } })}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium">运行画像</label>
          <select
            className="w-full mt-1 p-2 border rounded-md"
            value={value.profile || 'local_primary'}
            onChange={(e) => updateValue({ profile: e.target.value })}
          >
            <option value="local_primary">local_primary</option>
            <option value="cloud_primary">cloud_primary</option>
            <option value="sales_cloud_backup">sales_cloud_backup</option>
            <option value="rule_engine">rule_engine</option>
            <option value="custom">custom</option>
          </select>
        </div>
        <div>
          <label className="text-sm font-medium">Provider 类型</label>
          <select
            className="w-full mt-1 p-2 border rounded-md"
            value={value.provider_kind || 'openai_compatible'}
            onChange={(e) => updateValue({ provider_kind: e.target.value })}
          >
            <option value="openai_compatible">openai_compatible</option>
            <option value="builtin">builtin</option>
          </select>
        </div>
      </div>
      <div>
        <div className="mb-2 text-sm font-medium">可服务阶段 / 能力标签</div>
        <div className="grid grid-cols-2 gap-2">
          {STAGE_OPTIONS.map((stage) => (
            <label
              key={stage.value}
              className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${activeStages.includes(stage.value)
                ? 'border-blue-300 bg-blue-50 text-blue-900'
                : 'border-slate-200 bg-white text-slate-700'
              }`}
            >
              <input
                type="checkbox"
                checked={activeStages.includes(stage.value)}
                onChange={() => toggleStage(stage.value)}
              />
              <span>{stage.label}</span>
            </label>
          ))}
        </div>
      </div>
      <div>
        <label className="text-sm font-medium">模型标识</label>
        <Input
          value={value.model || ''}
          onChange={(e) => updateValue({ model: e.target.value })}
          placeholder={isLocalProvider ? '如: gpt-oss-20b' : '如: gemini-2.5-flash-lite'}
        />
      </div>
      <div>
        <label className="text-sm font-medium">API 地址</label>
        <Input
          value={value.base_url || ''}
          onChange={(e) => updateValue({ base_url: e.target.value })}
          placeholder={value.provider_kind === 'builtin' ? 'builtin 可留空' : isCloudProvider ? '如: https://cloud.yiyongai.cn/v1' : '如: http://127.0.0.1:1234/v1'}
        />
      </div>
      <div>
        <div className="flex items-center justify-between gap-3">
          <label className="text-sm font-medium">API Key / Token</label>
          <Button type="button" variant="outline" size="sm" disabled={probing} onClick={handleProbe}>
            {probing ? '测试中...' : '测试连接'}
          </Button>
        </div>
        <Input
          type="password"
          value={value.api_key || ''}
          onChange={(e) => updateValue({ api_key: e.target.value })}
          placeholder={isLocalProvider ? 'LM Studio 开启认证时填写 Developer Token' : '粘贴云模型 Token，留空保持现有值'}
        />
        <p className="text-xs text-slate-500 mt-1">安全存储，API 返回时脱敏显示；已保存的密钥留空不会被清空。</p>
        {probeResult ? (
          <div className={`mt-2 rounded-lg border px-3 py-2 text-xs leading-5 ${runtimeStateClass(probeResult.runtime_state)}`}>
            <div className="font-medium">{runtimeStateLabel(probeResult.runtime_state)}</div>
            <div className="mt-1">{probeResult.runtime_reason}</div>
            <div className="mt-1 rounded border border-current/20 bg-white/60 px-2 py-1">
              这是表单草稿连接测试，不是已发布策略，也不是 ReviewRun 运行证据。
            </div>
            {probeResult.runtime_action ? <div className="mt-1">处理：{probeResult.runtime_action}</div> : null}
            <div className="mt-1">
              {probeResult.runtime_environment} · {probeResult.local_endpoint ? '本地端点' : '外部端点'} · Token {probeResult.credential_checked}
            </div>
            {probeResult.chat_probe ? (
              <div className={`mt-2 rounded border px-2 py-1 ${
                probeResult.chat_probe.ok
                  ? 'border-emerald-200 bg-white/70 text-emerald-800'
                  : 'border-rose-200 bg-white/70 text-rose-800'
              }`}>
                <div className="font-medium">
                  表单草稿最小生成测试：{probeResult.chat_probe.ok ? '通过' : '失败'}
                  {probeResult.chat_probe.model ? ` · ${probeResult.chat_probe.model}` : ''}
                  {probeResult.chat_probe.latency_ms ? ` · ${probeResult.chat_probe.latency_ms}ms` : ''}
                </div>
                <div className="mt-1">
                  {probeResult.chat_probe.ok
                    ? `返回样例：${probeResult.chat_probe.content_sample || '已返回内容'}`
                    : probeResult.chat_probe.error || '模型未返回可用内容'}
                </div>
              </div>
            ) : (
              <div className="mt-2 rounded border border-slate-200 bg-white/70 px-2 py-1 text-slate-600">
                最小生成测试：未执行。内置规则引擎无需执行；外部模型需要填写 Base URL、Token 和模型 ID。
              </div>
            )}
            {probeResult.available_models && probeResult.available_models.length > 0 ? (
              <div className="mt-2">
                <div className="font-medium">发现模型</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {probeResult.available_models.slice(0, 8).map((modelId) => (
                    <button
                      key={modelId}
                      type="button"
                      className="rounded border border-current/20 bg-white/70 px-2 py-0.5 font-mono text-[11px]"
                      onClick={() => updateValue({ model: modelId })}
                    >
                      {modelId}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        {probeError ? (
          <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {probeError}
          </div>
        ) : null}
      </div>
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-900">
        <div className="font-medium">配置口径</div>
        <div className="mt-2 space-y-1">
          <p>本地模型实例：启动 LM Studio Local Server，Base URL 使用 http://127.0.0.1:1234/v1，模型标识使用已加载模型的 API Identifier。</p>
          <p>如果 LM Studio 开启 Require Authentication，必须填写 Developer Token；测试连接只验 HTTP，不把本机 CLI 当作正式接入。</p>
          <p>云端模型实例：用于复杂规则、标书解析、长文本和长 PDF；使用 OpenAI-compatible 网关，复制 Base URL、模型 ID 和 Token 到这里，根地址会自动按 /v1 调用。</p>
          <p>规则引擎实例：Provider 类型选择 builtin，模型标识固定 rule-engine，不填写地址和密钥；它只能兜底确定性规则，不能冒充 AI 审核。</p>
          <p>
            Token 控制台：{' '}
            <a className="font-medium underline" href="https://cloud.yiyongai.cn/console/token" target="_blank" rel="noreferrer">
              cloud.yiyongai.cn/console/token
            </a>
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium">超时 (毫秒)</label>
          <Input
            type="number"
            step={1000}
            value={value.timeout_ms || 45000}
            onChange={(e) => updateValue({ timeout_ms: parseInt(e.target.value) })}
          />
        </div>
        <div>
          <label className="text-sm font-medium">最大页数</label>
          <Input
            type="number"
            value={value.routing?.max_pages || 15}
            onChange={(e) => updateValue({ routing: { ...value.routing, max_pages: parseInt(e.target.value) } })}
          />
        </div>
      </div>
      <div>
        <label className="text-sm font-medium">文本路由策略</label>
        <select
          className="w-full mt-1 rounded-md border p-2 text-sm"
          value={value.routing?.strategy || (value.provider_kind === 'builtin' ? 'rule' : 'full')}
          onChange={(e) => updateValue({
            routing: {
              ...value.routing,
              strategy: e.target.value as 'full' | 'chunked' | 'rule',
            },
          })}
        >
          <option value="full">full - 短文/常规合同尽量完整送入模型</option>
          <option value="chunked">chunked - 长合同/标书分段选择和汇总</option>
          <option value="rule">rule - 只执行规则引擎确定性兜底</option>
        </select>
        <p className="mt-1 text-xs text-slate-500">
          路由网关会结合任务类型、页数、能力阶段和优先级决定候选模型；这里定义单个模型实例适合的文本处理方式。
        </p>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={value.enabled || false}
          onChange={(e) => updateValue({ enabled: e.target.checked })}
        />
        <span className="text-sm">启用此模型配置</span>
      </div>
    </div>
  )
}

'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getAIConfigKind, groupAIConfigs, isAIPlatformAssetKind } from '@/lib/configs/ai-config-kind'
import { BUSINESS_USE_POINT_REGISTRY } from '@/lib/configs/ai-platform-registry'
import { isMaskedApiKey } from '@/lib/configs/runtime'
import type { AIPlatformAssetKind } from '@/lib/configs/types'
import type { AIRuntimeState, Config, EditableConfig } from '../types'

interface AIEditFormProps {
  config: EditableConfig
  configs: Config[]
  onChange: (config: EditableConfig) => void
}

type ProbeResult = {
  runtime_state: AIRuntimeState
  runtime_reason: string
  runtime_action: string | null
  probe_scope: string
  available_models?: string[]
  chat_probe?: { ok: boolean; latency_ms: number; model: string; error: string | null } | null
  credential_checked: 'provided' | 'stored' | 'missing' | 'not_required'
}

const CAPABILITY_OPTIONS = [
  { id: 'text_generation', label: '文本生成' },
  { id: 'structured_output', label: '结构化输出' },
  { id: 'long_context', label: '长上下文' },
  { id: 'vision', label: '视觉理解' },
  { id: 'tool_calling', label: '工具调用' },
]

const KIND_LABELS: Record<AIPlatformAssetKind, string> = {
  provider_connection: '模型服务',
  model_catalog_entry: '可用模型',
  ai_application: 'AI 能力',
  business_use_point: '产品功能入口',
  application_binding: '业务能力选择',
  route_policy: '模型降级顺序',
}

function runtimeStateTone(state: AIRuntimeState) {
  if (['remote_health_ok', 'local_health_ok', 'ready_to_call', 'recent_invocation_passed'].includes(state)) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  }
  if (state === 'builtin_ready' || state === 'recent_invocation_partial') {
    return 'border-blue-200 bg-blue-50 text-blue-800'
  }
  return 'border-rose-200 bg-rose-50 text-rose-800'
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function credentialCheckedText(state: ProbeResult['credential_checked']) {
  if (state === 'provided') return '本次输入凭据已使用'
  if (state === 'stored') return '已安全复用保存的凭据'
  if (state === 'missing') return '缺少访问凭据'
  return '此连接无需凭据'
}

function businessProbeText(value: string) {
  return value
    .replaceAll('OpenAI-compatible Provider', '兼容接口的模型服务')
    .replaceAll('Provider', '模型服务')
    .replaceAll('base URL', '服务地址')
    .replaceAll('Base URL', '服务地址')
    .replaceAll('semantic_review', '合同语义审核')
}

function CapabilityPicker({
  id,
  value,
  onChange,
  label,
}: {
  id: string
  value: string[]
  onChange: (next: string[]) => void
  label: string
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-slate-900">{label}</legend>
      <div id={id} className="grid gap-2 sm:grid-cols-2">
        {CAPABILITY_OPTIONS.map((capability) => {
          const checked = value.includes(capability.id)
          return (
            <label
              key={capability.id}
              className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                checked ? 'border-blue-300 bg-blue-50 text-blue-900' : 'border-slate-200 bg-white text-slate-700'
              }`}
            >
              <input
                type="checkbox"
                name={`${id}-${capability.id}`}
                checked={checked}
                onChange={() => onChange(checked
                  ? value.filter((item) => item !== capability.id)
                  : [...value, capability.id])}
              />
              {capability.label}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

export default function AIEditForm({ config, configs, onChange }: AIEditFormProps) {
  const value = (config.value || {}) as Record<string, unknown>
  const kind = getAIConfigKind(value)
  const [probing, setProbing] = useState(false)
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null)
  const [probeError, setProbeError] = useState('')
  const initialSecret = typeof value.api_key === 'string' && !isMaskedApiKey(value.api_key) ? value.api_key : ''
  const [secretInput, setSecretInput] = useState(initialSecret)
  const grouped = useMemo(() => groupAIConfigs(configs), [configs])

  if (!kind || !isAIPlatformAssetKind(kind)) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
        这是旧版运行配置，不能继续用混合表单修改。请在对应的平台配置任务中创建新的 AI 配置；旧记录会保持只读，直到业务运行完成安全切换。
      </div>
    )
  }

  const publishedApplications = grouped.aiApplications.filter((item) => item.status === 'PUBLISHED' && item.value.enabled !== false)
  const publishedProviders = grouped.providerConnections.filter((item) => item.status === 'PUBLISHED' && item.value.enabled !== false)
  const publishedModels = grouped.modelCatalogEntries.filter((item) => item.status === 'PUBLISHED' && item.value.enabled !== false)
  const publishedUsePoints = grouped.businessUsePoints.filter((item) => item.status === 'PUBLISHED' && item.value.enabled !== false)
  const selectedPublishedProvider = kind === 'model_catalog_entry'
    ? publishedProviders.find((candidate) => candidate.value.asset_id === value.provider_connection_id)
    : undefined
  const selectedModelIds = [...new Set(stringList(value.model_catalog_entry_ids))]
  const availableRouteModels = publishedModels.filter((model) => !selectedModelIds.includes(String(model.value.asset_id || '')))
  const providerAuthMode = value.auth_mode === 'bearer' || (
    value.auth_mode !== 'none'
    && typeof value.api_key === 'string'
    && value.api_key.length > 0
  ) ? 'bearer' : 'none'

  const updateValue = (patch: Record<string, unknown>) => {
    onChange({ ...config, value: { ...value, ...patch } })
  }

  const updateCapabilities = (field: 'capabilities' | 'required_capabilities', next: string[]) => {
    updateValue({ [field]: next })
  }

  const updateProviderSecret = (nextSecret: string) => {
    const nextValue = { ...value }
    if (nextSecret) {
      nextValue.api_key = nextSecret
    } else {
      delete nextValue.api_key
    }
    onChange({
      ...config,
      value: nextValue,
      credential_action: config.revision_source_id
        ? nextSecret
          ? 'replace'
          : config.credential_reuse_available
            ? 'reuse'
            : 'clear'
        : config.credential_action,
    })
  }

  const handleProbe = async (mode: 'connection' | 'model') => {
    setProbing(true)
    setProbeError('')
    setProbeResult(null)
    try {
      const token = localStorage.getItem('token')
      let providerConfig: Config | undefined
      let baseUrl = String(value.base_url || '')
      let apiKey = secretInput
      let model = ''
      let configId = config.id || config.revision_source_id
      let runtimeLocation = String(value.runtime_location || 'cloud')
      let authMode = providerAuthMode
      let timeoutMs = Number(value.connection_timeout_ms || value.timeout_ms || 45000)

      if (kind === 'model_catalog_entry') {
        providerConfig = selectedPublishedProvider
        if (!providerConfig) {
          setProbeError('当前模型没有可用的已发布模型服务，请重新选择后再测试。')
          return
        }
        baseUrl = String(providerConfig?.value.base_url || '')
        const storedProviderKey = typeof providerConfig?.value.api_key === 'string' ? providerConfig.value.api_key : ''
        apiKey = storedProviderKey && !isMaskedApiKey(storedProviderKey) ? storedProviderKey : ''
        model = String(value.model_id || '')
        configId = providerConfig?.id
        runtimeLocation = String(providerConfig?.value.runtime_location || 'cloud')
        authMode = providerConfig?.value.auth_mode === 'bearer' || storedProviderKey ? 'bearer' : 'none'
        timeoutMs = Number(providerConfig?.value.connection_timeout_ms || 45000)
      }

      const response = await fetch('/api/configs/ai-runtime/probe', {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider_kind: 'openai_compatible',
          base_url: baseUrl,
          api_key: apiKey,
          model,
          timeout_ms: timeoutMs,
          config_id: configId,
          probe_mode: mode,
          runtime_location: runtimeLocation,
          auth_mode: authMode,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload?.success) {
        setProbeError(payload?.error?.message || '测试失败，请检查输入。')
        return
      }
      setProbeResult(payload.data as ProbeResult)
    } catch {
      setProbeError('测试请求失败，请检查网络后重试。')
    } finally {
      setProbing(false)
    }
  }

  const commonFields = (
    <div className="space-y-4">
      <div>
        <label htmlFor="ai-config-name" className="text-sm font-medium">显示名称</label>
        <Input
          id="ai-config-name"
          name="ai-config-name"
          autoComplete="off"
          className="min-h-11"
          value={config.name || ''}
          onChange={(event) => onChange({ ...config, name: event.target.value })}
          placeholder={KIND_LABELS[kind]}
        />
      </div>
      <details className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-slate-700">配置编号（通常无需修改）</summary>
        <div className="space-y-4 border-t border-slate-200 pt-4">
          <div>
            <label htmlFor="ai-config-key" className="text-sm font-medium">版本记录编号</label>
            <Input
              id="ai-config-key"
              name="ai-config-key"
              autoComplete="off"
              className="min-h-11"
              value={config.key || ''}
              disabled={Boolean(config.id)}
              onChange={(event) => onChange({ ...config, key: event.target.value.toUpperCase() })}
              placeholder="系统自动生成"
            />
            <p className="mt-1 text-xs text-slate-500">系统为每个草稿版本生成唯一编号。</p>
          </div>
          {kind !== 'business_use_point' && <div>
            <label htmlFor="ai-asset-id" className="text-sm font-medium">配置编号</label>
          <Input
            id="ai-asset-id"
            name="ai-asset-id"
            autoComplete="off"
            className="min-h-11"
            value={String(value.asset_id || '')}
            disabled={Boolean(config.id || config.revision_asset_locked)}
            onChange={(event) => updateValue({ asset_id: event.target.value.trim().toLowerCase() })}
            placeholder="系统自动生成"
          />
            <p className="mt-1 text-xs text-slate-500">同一配置的不同版本共用这个编号；已有配置不能更改。</p>
          </div>}
        </div>
      </details>
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
        <div className="font-semibold">{KIND_LABELS[kind]}</div>
        <p className="mt-1 leading-6">
          当前只编辑这一类平台配置。模型测试只证明当前输入可以访问服务，不代表产品功能已经运行或业务结果已经验收。
        </p>
      </div>

      {commonFields}

      {kind === 'provider_connection' && (
        <section className="space-y-4" aria-labelledby="provider-fields-heading">
          <h3 id="provider-fields-heading" className="text-sm font-semibold text-slate-950">连接信息</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="provider-location" className="text-sm font-medium">运行位置</label>
              <select
                id="provider-location"
                name="provider-location"
                autoComplete="off"
                className="mt-1 min-h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                value={String(value.runtime_location || 'cloud')}
                onChange={(event) => updateValue({ runtime_location: event.target.value })}
              >
                <option value="local">本地服务</option>
                <option value="cloud">云端服务</option>
              </select>
            </div>
            <div>
              <label htmlFor="provider-timeout" className="text-sm font-medium">连接超时（毫秒）</label>
              <Input
                id="provider-timeout"
                name="provider-timeout"
                autoComplete="off"
                className="min-h-11"
                type="number"
                inputMode="numeric"
                min={1000}
                max={300000}
                step={1000}
                value={Number(value.connection_timeout_ms || 45000)}
                onChange={(event) => updateValue({ connection_timeout_ms: Number(event.target.value) })}
              />
            </div>
          </div>
          <div>
            <label htmlFor="provider-auth-mode" className="text-sm font-medium">认证方式</label>
            <select
              id="provider-auth-mode"
              name="provider-auth-mode"
              autoComplete="off"
              className="mt-1 min-h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={providerAuthMode}
              onChange={(event) => {
                const authMode = event.target.value === 'bearer' ? 'bearer' : 'none'
                setSecretInput('')
                const nextValue: Record<string, unknown> = { ...value, auth_mode: authMode }
                if (authMode === 'none') delete nextValue.api_key
                onChange({
                  ...config,
                  value: nextValue,
                  credential_action: config.revision_source_id
                    ? authMode === 'none'
                      ? 'clear'
                      : config.credential_reuse_available
                        ? 'reuse'
                        : 'clear'
                    : config.credential_action,
                })
              }}
            >
              <option value="none">无需认证</option>
              <option value="bearer">Bearer Token</option>
            </select>
          </div>
          <div>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="provider-base-url" className="text-sm font-medium">服务地址（Base URL）</label>
              <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={probing} onClick={() => void handleProbe('connection')}>
                {probing ? '测试中…' : '测试连接'}
              </Button>
            </div>
            <Input
              id="provider-base-url"
              name="provider-base-url"
              type="url"
              inputMode="url"
              autoComplete="off"
              className="min-h-11"
              value={String(value.base_url || '')}
              onChange={(event) => updateValue({ base_url: event.target.value.trim() })}
              placeholder="https://provider.example/v1"
            />
            {value.runtime_location === 'local' && (
              <p className="mt-1 text-xs leading-5 text-slate-500">
                本地探测只在开发环境开放，并要求服务端显式允许这个精确来源；线上服务不会访问服务器回环端口。
              </p>
            )}
          </div>
          {providerAuthMode === 'bearer' && <div>
            <label htmlFor="provider-secret" className="text-sm font-medium">替换 API Key / Token</label>
            <Input
              id="provider-secret"
              name="provider-secret"
              className="min-h-11"
              type="password"
              autoComplete="new-password"
              value={secretInput}
              onChange={(event) => {
                setSecretInput(event.target.value)
                updateProviderSecret(event.target.value)
              }}
              placeholder={config.credential_reuse_available || (typeof value.api_key === 'string' && isMaskedApiKey(value.api_key))
                ? '已安全保存；留空继续使用，输入新值才替换'
                : '请输入服务商提供的 Token'}
            />
            <p className="mt-1 text-xs text-slate-500">浏览器不回填已存密钥；服务端只在连接身份未改变时受控复用。</p>
          </div>}
        </section>
      )}

      {kind === 'model_catalog_entry' && (
        <section className="space-y-4" aria-labelledby="model-fields-heading">
          <h3 id="model-fields-heading" className="text-sm font-semibold text-slate-950">模型信息</h3>
          <div>
            <label htmlFor="model-provider" className="text-sm font-medium">所属模型服务</label>
            <select
              id="model-provider"
              name="model-provider"
              autoComplete="off"
              className="mt-1 min-h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={String(value.provider_connection_id || '')}
              onChange={(event) => updateValue({ provider_connection_id: event.target.value })}
            >
              <option value="">请选择已发布且启用的连接</option>
              {Boolean(value.provider_connection_id) && !publishedProviders.some((provider) => provider.value.asset_id === value.provider_connection_id) && (
                <option value={String(value.provider_connection_id)} disabled>当前引用不可用，请重新选择</option>
              )}
              {publishedProviders.map((provider) => (
                <option key={provider.id} value={String(provider.value.asset_id || '')}>
                  {provider.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="model-id" className="text-sm font-medium">服务商模型名称 / ID</label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11"
                disabled={probing || !selectedPublishedProvider}
                onClick={() => void handleProbe('model')}
              >
                {probing ? '测试中…' : '测试此模型'}
              </Button>
            </div>
            <Input
              id="model-id"
              name="model-id"
              autoComplete="off"
              className="min-h-11"
              value={String(value.model_id || '')}
              onChange={(event) => updateValue({ model_id: event.target.value.trim() })}
              placeholder="如 gpt-5 或 vendor/model-name"
            />
            {!selectedPublishedProvider && (
              <p className="mt-1 text-xs leading-5 text-amber-700">
                请先选择一个已发布且启用的模型服务，才能测试模型。
              </p>
            )}
          </div>
          <CapabilityPicker
            id="model-capabilities"
            label="模型能力"
            value={stringList(value.capabilities)}
            onChange={(next) => updateCapabilities('capabilities', next)}
          />
          <div>
            <label htmlFor="model-context" className="text-sm font-medium">上下文窗口（可选）</label>
            <Input
              id="model-context"
              name="model-context"
              autoComplete="off"
              className="min-h-11"
              type="number"
              inputMode="numeric"
              min={1}
              value={typeof value.context_window === 'number' ? value.context_window : ''}
              onChange={(event) => updateValue({ context_window: event.target.value ? Number(event.target.value) : undefined })}
            />
          </div>
        </section>
      )}

      {kind === 'ai_application' && (
        <CapabilityPicker
          id="application-capabilities"
          label="应用提供的逻辑能力"
          value={stringList(value.capabilities)}
          onChange={(next) => updateCapabilities('capabilities', next)}
        />
      )}

      {kind === 'business_use_point' && (
        <section className="space-y-3" aria-labelledby="use-point-heading">
          <h3 id="use-point-heading" className="text-sm font-semibold text-slate-950">选择产品功能入口</h3>
          <p className="text-xs leading-5 text-slate-500">选择一个已经存在的产品动作，后续再为它选择已发布的 AI 能力。</p>
          <label htmlFor="business-use-point" className="sr-only">选择产品功能入口</label>
          <select
            id="business-use-point"
            name="business-use-point"
            autoComplete="off"
            className="min-h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={String(value.asset_id || '')}
            disabled={Boolean(config.id || config.revision_asset_locked)}
            onChange={(event) => {
              const definition = BUSINESS_USE_POINT_REGISTRY.find((item) => item.asset_id === event.target.value)
              if (!definition) return
              onChange({
                ...config,
                name: definition.display_name,
                value: {
                  ...value,
                  asset_id: definition.asset_id,
                  module_id: definition.module_id,
                  required_capabilities: definition.required_capabilities,
                },
              })
            }}
          >
            <option value="">选择产品功能入口</option>
            {BUSINESS_USE_POINT_REGISTRY.map((definition) => (
              <option key={definition.asset_id} value={definition.asset_id}>{definition.display_name}</option>
            ))}
          </select>
          {BUSINESS_USE_POINT_REGISTRY.find((item) => item.asset_id === value.asset_id) && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700">
              {BUSINESS_USE_POINT_REGISTRY.find((item) => item.asset_id === value.asset_id)?.description}
            </div>
          )}
        </section>
      )}

      {kind === 'route_policy' && (
        <section className="space-y-4" aria-labelledby="route-heading">
          <h3 id="route-heading" className="text-sm font-semibold text-slate-950">模型顺序与失败动作</h3>
          <div>
            <label htmlFor="route-application" className="text-sm font-medium">使用这条顺序的 AI 能力</label>
            <select
              id="route-application"
              name="route-application"
              autoComplete="off"
              className="mt-1 min-h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={String(value.ai_application_id || '')}
              onChange={(event) => updateValue({ ai_application_id: event.target.value })}
            >
              <option value="">请选择已发布 AI 能力</option>
              {publishedApplications.map((application) => (
                <option key={application.id} value={String(application.value.asset_id || '')}>
                  {application.name}
                </option>
              ))}
            </select>
          </div>
          <fieldset>
            <legend className="text-sm font-medium">有序候选模型</legend>
            <p className="mt-1 text-xs leading-5 text-slate-500">编号就是实际调用顺序；可以直接上移、下移或移除。</p>
            <div className="mt-3 space-y-2" aria-label="当前模型调用顺序">
              {selectedModelIds.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-slate-500">
                  尚未选择候选模型。
                </div>
              )}
              {selectedModelIds.map((modelAssetId, index) => {
                const model = publishedModels.find((item) => item.value.asset_id === modelAssetId)
                return (
                  <div key={modelAssetId} className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 sm:flex-row sm:items-center">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-900">{model?.name || modelAssetId}</div>
                      <div className="truncate font-mono text-xs text-slate-500">
                        {model ? String(model.value.model_id || modelAssetId) : '该模型已停用、未发布或不存在，请移除后重新选择'}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-h-11"
                        disabled={index === 0}
                        onClick={() => {
                          const next = [...selectedModelIds]
                          ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
                          updateValue({ model_catalog_entry_ids: next })
                        }}
                      >
                        上移
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-h-11"
                        disabled={index === selectedModelIds.length - 1}
                        onClick={() => {
                          const next = [...selectedModelIds]
                          ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
                          updateValue({ model_catalog_entry_ids: next })
                        }}
                      >
                        下移
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-h-11"
                        onClick={() => updateValue({
                          model_catalog_entry_ids: selectedModelIds.filter((item) => item !== modelAssetId),
                        })}
                      >
                        移除
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-sm font-medium text-slate-900">可添加的已发布模型</div>
              {availableRouteModels.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">没有其他可用模型；请先在“模型能力”中完成发布。</p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {availableRouteModels.map((model) => {
                    const modelAssetId = String(model.value.asset_id || '')
                    return (
                      <Button
                        key={model.id}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-h-11 bg-white"
                        onClick={() => updateValue({ model_catalog_entry_ids: [...selectedModelIds, modelAssetId] })}
                      >
                        + {model.name}
                      </Button>
                    )
                  })}
                </div>
              )}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="route-timeout" className="text-sm font-medium">单次超时（毫秒）</label>
              <Input
                id="route-timeout"
                name="route-timeout"
                autoComplete="off"
                className="min-h-11"
                type="number"
                inputMode="numeric"
                min={1000}
                max={300000}
                step={1000}
                value={Number(value.timeout_ms || 120000)}
                onChange={(event) => updateValue({ timeout_ms: Number(event.target.value) })}
              />
            </div>
            <div>
              <label htmlFor="route-failure" className="text-sm font-medium">全部失败后</label>
              <select
                id="route-failure"
                name="route-failure"
                autoComplete="off"
                className="mt-1 min-h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                value={String(value.failure_action || 'manual_review')}
                onChange={(event) => updateValue({ failure_action: event.target.value })}
              >
                <option value="manual_review">转人工处理</option>
                <option value="stop">停止并报错</option>
              </select>
            </div>
          </div>
        </section>
      )}

      {kind === 'application_binding' && (
        <section className="grid gap-4 sm:grid-cols-2" aria-labelledby="binding-heading">
          <h3 id="binding-heading" className="sr-only">产品功能选择 AI 能力</h3>
          <div>
            <label htmlFor="binding-use-point" className="text-sm font-medium">产品功能入口</label>
            <select
              id="binding-use-point"
              name="binding-use-point"
              autoComplete="off"
              className="mt-1 min-h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={String(value.business_use_point_id || '')}
              onChange={(event) => updateValue({ business_use_point_id: event.target.value })}
            >
              <option value="">请选择已登记产品功能</option>
              {publishedUsePoints.map((usePoint) => (
                <option key={usePoint.id} value={String(usePoint.value.asset_id || '')}>
                  {usePoint.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="binding-application" className="text-sm font-medium">要使用的 AI 能力</label>
            <select
              id="binding-application"
              name="binding-application"
              autoComplete="off"
              className="mt-1 min-h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={String(value.ai_application_id || '')}
              onChange={(event) => updateValue({ ai_application_id: event.target.value })}
            >
              <option value="">请选择已发布 AI 能力</option>
              {publishedApplications.map((application) => (
                <option key={application.id} value={String(application.value.asset_id || '')}>
                  {application.name}
                </option>
              ))}
            </select>
          </div>
        </section>
      )}

      {(probeResult || probeError) && (
        <div role={probeError ? 'alert' : 'status'} aria-live={probeError ? 'assertive' : 'polite'} className={probeResult
          ? `rounded-xl border p-4 text-sm leading-6 ${runtimeStateTone(probeResult.runtime_state)}`
          : 'rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800'}>
          {probeError ? businessProbeText(probeError) : (
            <>
              <div className="font-semibold">{businessProbeText(probeResult?.runtime_reason || '')}</div>
              <p className="mt-1">凭据状态：{probeResult ? credentialCheckedText(probeResult.credential_checked) : '未知'}</p>
              {probeResult?.runtime_action && <p className="mt-1">建议处理：{businessProbeText(probeResult.runtime_action)}</p>}
              {probeResult?.chat_probe && (
                <p className="mt-1">最小生成：{probeResult.chat_probe.ok ? `通过 · ${probeResult.chat_probe.latency_ms}ms` : `失败 · ${businessProbeText(probeResult.chat_probe.error || '未知错误')}`}</p>
              )}
              {probeResult?.available_models && probeResult.available_models.length > 0 && (
                <div className="mt-3">
                  <div className="font-medium">检测到 {probeResult.available_models.length} 个可用模型</div>
                  {kind === 'provider_connection' ? (
                    <>
                      <p className="mt-1 text-xs">模型服务测试不会自动添加具体模型；保存连接后，请到“可用模型”中选择并添加。</p>
                      <div className="mt-2 flex flex-wrap gap-2" aria-label="发现的模型（只读）">
                        {probeResult.available_models.slice(0, 12).map((modelId) => (
                          <span key={modelId} className="rounded-lg border border-current/20 bg-white/70 px-3 py-2 font-mono text-xs">
                            {modelId}
                          </span>
                        ))}
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="mt-1 text-xs">选择一个检测到的模型，作为当前可用模型。</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {probeResult.available_models.slice(0, 12).map((modelId) => (
                          <button
                            key={modelId}
                            type="button"
                            className="min-h-11 cursor-pointer rounded-lg border border-current/20 bg-white/70 px-3 py-2 font-mono text-xs transition-colors hover:bg-white hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                            onClick={() => updateValue({ model_id: modelId })}
                          >
                            {modelId}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      <label className="flex min-h-11 items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm">
        <input
          type="checkbox"
          name="ai-asset-enabled"
          checked={value.enabled === true}
          onChange={(event) => updateValue({ enabled: event.target.checked })}
        />
        启用此配置（产品功能只能使用已发布且启用的配置）
      </label>
    </div>
  )
}

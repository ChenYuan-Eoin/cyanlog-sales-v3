'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import ConfigStatusBadge from './ConfigStatusBadge'
import type { Config } from '../types'

interface AIConfigTabProps {
  configs: Config[]
  onNew: () => void
  onEdit: (config: Config) => void
  onPublish: (id: string) => void
  onDelete: (id: string) => void
}

type RuntimeProvider = {
  profile: string
  provider_kind: 'openai_compatible' | 'builtin'
  provider: string
  model: string
  level: number
  timeout_ms: number
  stages: string[]
  role: 'primary' | 'fallback'
  capabilities: string[]
  health_check_required: boolean
  base_url_configured: boolean
  credential_state: 'configured' | 'missing' | 'not_required'
  runtime_state:
    | 'builtin_ready'
    | 'missing_base_url'
    | 'missing_credential'
    | 'unreachable_in_vercel'
    | 'local_health_ok'
    | 'local_health_failed'
    | 'ready_to_call'
  runtime_reason: string
  runtime_action: string | null
  runtime_environment: string
  local_endpoint: boolean
}

type RuntimePolicy = {
  id: string
  key: string
  version: number
  status: string
  is_current: boolean
  timeout_ms: number
  provider_chain: RuntimeProvider[]
  source_config_ids: string[]
}

function runtimeStateLabel(state: RuntimeProvider['runtime_state']) {
  const labels: Record<RuntimeProvider['runtime_state'], string> = {
    builtin_ready: '兜底可用',
    missing_base_url: '地址缺失',
    missing_credential: '密钥缺失',
    unreachable_in_vercel: '生产不可达',
    local_health_ok: '本地可达',
    local_health_failed: '本地不可达',
    ready_to_call: '具备调用条件',
  }
  return labels[state]
}

function runtimeStateClass(state: RuntimeProvider['runtime_state']) {
  if (state === 'ready_to_call' || state === 'local_health_ok') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  }
  if (state === 'missing_base_url' || state === 'missing_credential' || state === 'unreachable_in_vercel') {
    return 'border-red-200 bg-red-50 text-red-700'
  }
  return 'border-amber-200 bg-amber-50 text-amber-800'
}

export default function AIConfigTab({ configs, onNew, onEdit, onPublish, onDelete }: AIConfigTabProps) {
  const [runtimePolicy, setRuntimePolicy] = useState<RuntimePolicy | null>(null)
  const [runtimeError, setRuntimeError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function loadRuntimePolicy() {
      setRuntimeError('')
      try {
        const token = localStorage.getItem('token')
        const response = await fetch('/api/configs/ai-runtime', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          cache: 'no-store',
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(typeof payload.error === 'string' ? payload.error : '运行时策略加载失败')
        }
        if (!cancelled) {
          setRuntimePolicy(payload.data as RuntimePolicy)
        }
      } catch (error) {
        if (!cancelled) {
          setRuntimeError(error instanceof Error ? error.message : '运行时策略加载失败')
        }
      }
    }

    void loadRuntimePolicy()
    return () => {
      cancelled = true
    }
  }, [configs.length])

  const externalProviders = runtimePolicy?.provider_chain.filter((provider) => provider.provider_kind !== 'builtin') ?? []
  const hasExternalProvider = externalProviders.length > 0
  const hasCallableExternalProvider = externalProviders.some((provider) => (
    provider.runtime_state === 'ready_to_call' || provider.runtime_state === 'local_health_ok'
  ))
  const hasProductionBlockedLocalProvider = externalProviders.some((provider) => (
    provider.runtime_state === 'unreachable_in_vercel'
  ))

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Card className="min-w-0">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>AI 模型配置（3级降级链）</CardTitle>
        <Button onClick={onNew}>+ 新增模型</Button>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          {configs.map((config) => (
            <div key={config.id} className="rounded-lg border p-4">
              <div className="flex items-baseline justify-between mb-3">
                <div className="text-sm font-semibold text-slate-900">
                  Level {(config.value?.level as number)} · {config.name}
                </div>
                <div className="flex gap-1">
                  <ConfigStatusBadge status={config.status} />
                  {config.value?.enabled === true && <Badge className="bg-emerald-100 text-emerald-700">启用</Badge>}
                </div>
              </div>

              <div className="text-xs text-slate-600 space-y-1.5 mb-4">
                <div className="truncate">画像: {(config.value?.profile as string) || '未设置'}</div>
                <div className="truncate">类型: {(config.value?.provider_kind as string) || 'openai_compatible'}</div>
                <div className="truncate">模型: {config.value?.model as string}</div>
                <div className="truncate">地址: {(config.value?.base_url as string) || '（内置）'}</div>
                <div>超时: {(config.value?.timeout_ms as number) / 1000}s</div>
                <div>
                  密钥: {typeof config.value?.api_key === 'string' && config.value.api_key.length > 0 ? '已保存' : '未配置'}
                </div>
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
            <p className="text-sm text-slate-400 mt-2">点击上方按钮创建第一条 AI 配置</p>
          </div>
        )}

        <div className="rounded-md border mt-4">
          <div className="px-4 py-2 bg-slate-50 border-b text-xs font-medium text-slate-700">路由策略（按文档页数）</div>
          <div className="divide-y">
            {[
              { pages: '≤ 15 页', level: 1, strategy: '整体送入本地' },
              { pages: '15 - 40 页', level: 1, strategy: '分段送入本地' },
              { pages: '> 40 页', level: 2, strategy: '强制云端' },
            ].map((row, idx) => (
              <div key={idx} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="font-mono text-slate-700">{row.pages}</span>
                <span className="text-xs text-slate-500">{row.strategy}</span>
                <span className="text-xs font-mono bg-blue-50 text-blue-700 px-2 py-0.5 rounded">Level {row.level}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-base">合同审核运行时策略</CardTitle>
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
                </div>
                <Badge variant={runtimePolicy.is_current ? 'default' : 'secondary'}>
                  {runtimePolicy.is_current ? '当前' : '历史'}
                </Badge>
              </div>
            </div>

            <div className={`rounded-lg border px-3 py-2 ${
              hasCallableExternalProvider
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : hasExternalProvider
                  ? 'border-amber-200 bg-amber-50 text-amber-800'
                  : 'border-amber-200 bg-amber-50 text-amber-800'
            }`}>
              {hasCallableExternalProvider
                ? '外部模型 Provider 已具备运行时调用条件，语义审核可进入正式模型链。'
                : hasExternalProvider
                  ? hasProductionBlockedLocalProvider
                    ? '存在本地模型 Provider，但在 Vercel 生产环境不可达；当前不能按正式模型链验收。'
                    : '外部模型 Provider 已发布，但密钥、地址或运行时健康检查未通过；当前不能按正式模型链验收。'
                  : '当前仅有内置规则引擎兜底；这不是模拟，但语义模型能力尚未配置。'}
            </div>

            <div className={`rounded-lg border px-3 py-2 ${
              hasExternalProvider
                ? hasCallableExternalProvider
                  ? 'border-slate-200 bg-white text-slate-600'
                  : 'border-red-200 bg-red-50 text-red-700'
                : 'border-amber-200 bg-amber-50 text-amber-800'
            }`}>
              {hasExternalProvider
                ? hasCallableExternalProvider
                  ? '验收口径：仍需用真实合同触发一次模型调用，并确认 semantic_review invocation 为 completed。'
                  : '验收口径：请先在 AI 模型配置中补齐密钥与地址，再进行真实模型调用验收。'
                : '验收口径：规则引擎可审计，但不能替代大模型审核目标。'}
            </div>

            <div className="space-y-2">
              {runtimePolicy.provider_chain.map((provider) => (
                <div key={`${provider.level}-${provider.profile}-${provider.model}`} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 font-medium text-slate-900">
                      Level {provider.level} · {provider.profile}
                    </div>
                    <Badge variant={provider.role === 'primary' ? 'default' : 'secondary'}>
                      {provider.role}
                    </Badge>
                  </div>
                  <div className="mt-2 space-y-1 text-xs text-slate-500">
                    <div className="truncate">{provider.provider_kind} / {provider.model}</div>
                    <div className={`rounded border px-2 py-1 ${runtimeStateClass(provider.runtime_state)}`}>
                      {runtimeStateLabel(provider.runtime_state)} · {provider.runtime_reason}
                    </div>
                    {provider.runtime_action && (
                      <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-slate-600">
                        处理：{provider.runtime_action}
                      </div>
                    )}
                    <div>
                      {provider.timeout_ms / 1000}s · {provider.health_check_required ? '需健康检查' : '无需健康检查'} · {
                        provider.credential_state === 'not_required'
                          ? '无需密钥'
                          : provider.credential_state === 'configured'
                            ? '密钥已配置'
                            : '密钥缺失'
                      }
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

'use client'

import { useCallback, useEffect, useState } from 'react'
import { Building2Icon, Link2Icon, RefreshCwIcon, Settings2Icon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { error, success } from '@/lib/toast'
import type { ConfigurableProvider, ProviderCapability } from '@/lib/organization-connections/types'
import { OrganizationConnectionForm } from './OrganizationConnectionForm'

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
  draftCheckStatus: DraftCheckStatus
  syncMode: SyncMode
  lastSuccessfulSyncAt: string | null
  lastError: string | null
}

type SourcePayload = {
  sources?: Source[]
  providers?: ProviderCapability[]
  active_primary_source_id?: string | null
  legacy_feishu_binding?: { provider: string; external_tenant_id: string; migration_available: boolean } | null
}

type OrganizationSourcePanelProps = {
  feishuSyncing?: boolean
  onFeishuSync?: () => void | Promise<void>
  onRefresh?: () => void | Promise<void>
}

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

function sourceStateLabel(source: Source | undefined) {
  if (!source || source.connectionState === 'unconfigured') return '未配置'
  if (source.connectionState === 'disabled' || source.status === 'disabled') return '已停用'
  if (source.draftCheckStatus === 'failed') {
    return source.connectionState === 'verified' ? '当前配置可用 · 新草稿验证失败' : '验证失败'
  }
  if (source.connectionState === 'failed') return '验证失败'
  if (source.connectionState === 'verified') {
    if (source.draftCheckStatus === 'preview_ready') return source.status === 'active' ? '已验证并启用' : '已验证 · 未启用'
    return source.status === 'active' ? '已启用 · 新草稿待验证' : '已验证 · 新草稿待验证'
  }
  return '已保存 · 待验证'
}

function providerBadgeVariant(source: Source | undefined): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (!source || source.connectionState === 'unconfigured') return 'outline'
  if (source.connectionState === 'failed' || source.draftCheckStatus === 'failed') return 'destructive'
  if (source.status === 'active' && source.connectionState === 'verified') return 'default'
  return 'secondary'
}

export function OrganizationSourcePanel({
  feishuSyncing = false,
  onFeishuSync,
  onRefresh,
}: OrganizationSourcePanelProps) {
  const [sources, setSources] = useState<Source[]>([])
  const [providers, setProviders] = useState<ProviderCapability[]>([])
  const [legacy, setLegacy] = useState<SourcePayload['legacy_feishu_binding']>(null)
  const [selectedProvider, setSelectedProvider] = useState<ConfigurableProvider | null>(null)
  const [loading, setLoading] = useState(true)
  const [importingLegacy, setImportingLegacy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/admin/organization-sources', {
        headers: authHeaders(),
        cache: 'no-store',
      })
      const body = await response.json().catch(() => ({})) as { data?: SourcePayload; error?: string }
      if (!response.ok) throw new Error(body.error || '组织来源读取失败。')
      setSources(body.data?.sources || [])
      setProviders(body.data?.providers || [])
      setLegacy(body.data?.legacy_feishu_binding || null)
    } catch (readError) {
      error(readError instanceof Error ? readError.message : '组织来源读取失败。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function refreshAll() {
    await load()
    await onRefresh?.()
  }

  async function importLegacyFeishu() {
    setImportingLegacy(true)
    try {
      const response = await fetch('/api/admin/organization-sources/connection', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ action: 'import_legacy_feishu' }),
      })
      const body = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(body.error || '旧飞书配置导入失败。')
      success('旧飞书配置已导入为草稿，请验证后再进入后续启用批次。')
      setLegacy(null)
      setSelectedProvider('feishu')
      await refreshAll()
    } catch (importError) {
      error(importError instanceof Error ? importError.message : '旧飞书配置导入失败。')
    } finally {
      setImportingLegacy(false)
    }
  }

  const selected = selectedProvider
    ? providers.find((item): item is ProviderCapability & { key: ConfigurableProvider } => (
        item.key === selectedProvider && item.configurable
      ))
    : null
  const activeFeishu = sources.find(source => (
    source.provider === 'feishu'
    && source.status === 'active'
    && source.syncMode === 'authoritative'
    && source.connectionState === 'verified'
  ))
  const feishuProvider = providers.find(provider => provider.key === 'feishu')

  return (
    <div className="rounded-lg border bg-white p-4">
      <div>
        <h3 className="font-medium text-slate-900">组织来源</h3>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          手工维护始终可用。外部提供方共用一张连接记录，只在凭据字段、验证方式和目录协议上不同。
        </p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-2">
          <Building2Icon className="h-4 w-4 text-emerald-700" />
          <div className="mt-1 text-xs font-medium text-slate-900">手工维护</div>
          <div className="mt-0.5 text-[11px] text-emerald-700">始终可用</div>
        </div>
        {providers.map(provider => {
          const source = sources.find(item => item.provider === provider.key)
          const configurable = provider.configurable && (provider.key === 'feishu' || provider.key === 'fxiaoke')
          return (
            <button
              key={provider.key}
              type="button"
              disabled={!configurable || loading}
              aria-pressed={selectedProvider === provider.key}
              onClick={() => configurable && setSelectedProvider(provider.key as ConfigurableProvider)}
              className={`min-h-24 rounded-md border px-2.5 py-2 text-left transition ${
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
                {configurable ? sourceStateLabel(source) : '未接入'}
              </div>
            </button>
          )
        })}
      </div>

      {legacy && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-900">
            <Link2Icon className="h-4 w-4" />
            发现旧飞书部署配置
          </div>
          <p className="mt-1 text-xs leading-5 text-amber-800">
            可以显式导入为连接草稿；导入不会启用来源、同步目录或替代现有主来源。外部标识：{legacy.external_tenant_id}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2 bg-white"
            disabled={importingLegacy}
            onClick={() => void importLegacyFeishu()}
          >
            {importingLegacy ? '导入中…' : '导入为飞书草稿'}
          </Button>
        </div>
      )}

      {selected && (
        <div className="mt-4">
          <OrganizationConnectionForm key={selected.key} provider={selected} onChanged={refreshAll} />
        </div>
      )}

      <div className="mt-4 space-y-2">
        {loading && <div className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-500">正在读取组织来源…</div>}
        {!loading && sources.length === 0 && !legacy && (
          <div className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">
            尚未配置外部组织连接。选择上方提供方开始配置。
          </div>
        )}
        {sources.map(source => {
          const provider = providers.find(item => item.key === source.provider)
          const canSync = source.provider === 'feishu'
            && Boolean(feishuProvider?.syncAvailable)
            && activeFeishu?.id === source.id
            && Boolean(onFeishuSync)
          return (
            <div key={source.id} className="rounded-lg border border-slate-200 px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-900">{provider?.label || source.provider}</span>
                    <Badge variant={providerBadgeVariant(source)}>{sourceStateLabel(source)}</Badge>
                    {source.status === 'active' && source.priority === 1 && <Badge variant="secondary">主来源</Badge>}
                  </div>
                  <div className="mt-1 break-all text-xs text-slate-500">{source.externalTenantId}</div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    优先级 {source.priority} · {source.syncMode === 'authoritative' ? '权威' : source.syncMode === 'enrichment' ? '补充' : '只读'}
                    {source.lastSuccessfulSyncAt ? ` · 最近同步 ${new Date(source.lastSuccessfulSyncAt).toLocaleString('zh-CN')}` : ''}
                  </div>
                  {source.lastError && <div className="mt-1 text-xs text-rose-600">{source.lastError}</div>}
                </div>
                {canSync && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    disabled={feishuSyncing}
                    aria-busy={feishuSyncing}
                    onClick={() => void onFeishuSync?.()}
                  >
                    <RefreshCwIcon className={`mr-1 h-4 w-4 ${feishuSyncing ? 'animate-spin' : ''}`} />
                    {feishuSyncing ? '同步中…' : '同步飞书组织'}
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {sources.some(source => source.status === 'active') && (
        <p className="mt-3 text-[11px] leading-5 text-slate-500">
          主来源切换与停用将在目录差异预览批次开放；本页只保存和验证连接，不会改变现有主来源。
        </p>
      )}
    </div>
  )
}

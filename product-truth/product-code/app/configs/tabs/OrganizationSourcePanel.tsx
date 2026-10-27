'use client'

import { useCallback, useEffect, useState } from 'react'
import { Link2Icon, PlusIcon, UnplugIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { confirmAction, error, success } from '@/lib/toast'
import { FxiaokeSourceForm } from './FxiaokeSourceForm'

type SourceStatus = 'draft' | 'active' | 'disabled'
type SyncMode = 'read_only' | 'authoritative' | 'enrichment'

type Source = {
  id: string
  provider: string
  externalTenantId: string
  priority: number
  status: SourceStatus
  syncMode: SyncMode
  lastSuccessfulSyncAt: string | null
  lastError: string | null
}

type Provider = {
  key: string
  label: string
  syncAvailable: boolean
  unavailableReason: string | null
}

type SourcePayload = {
  sources?: Source[]
  providers?: Provider[]
  active_primary_source_id?: string | null
  legacy_feishu_binding?: { provider: string; external_tenant_id: string; migration_available: boolean } | null
}

function authHeaders(withJson = false): HeadersInit {
  const token = localStorage.getItem('token')
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(withJson ? { 'Content-Type': 'application/json' } : {}),
  }
}

function statusLabel(status: SourceStatus) {
  if (status === 'active') return '已启用'
  if (status === 'draft') return '草稿'
  return '已停用'
}

export function OrganizationSourcePanel() {
  const [sources, setSources] = useState<Source[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [legacy, setLegacy] = useState<SourcePayload['legacy_feishu_binding']>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [adding, setAdding] = useState(false)
  const [provider, setProvider] = useState('feishu')
  const [externalTenantId, setExternalTenantId] = useState('')
  const [priority, setPriority] = useState('1')
  const [status, setStatus] = useState<SourceStatus>('active')
  const [syncMode, setSyncMode] = useState<SyncMode>('authoritative')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/admin/organization-sources', { headers: authHeaders() })
      const body = await response.json().catch(() => ({})) as { data?: SourcePayload; error?: string }
      if (!response.ok) throw new Error(body.error || '组织来源读取失败')
      setSources(body.data?.sources || [])
      setProviders(body.data?.providers || [])
      setLegacy(body.data?.legacy_feishu_binding || null)
    } catch (err) {
      error(err instanceof Error ? err.message : '组织来源读取失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const selectedProvider = providers.find((item) => item.key === provider)

  function chooseProvider(key: string) {
    setProvider(key)
    const available = providers.find((item) => item.key === key)?.syncAvailable === true
    if (!available) {
      setStatus('draft')
      setSyncMode('read_only')
    } else if (priority === '1') {
      setStatus('active')
      setSyncMode('authoritative')
    }
  }

  function choosePriority(value: string) {
    setPriority(value)
    const primary = value === '1'
    setSyncMode(primary ? 'authoritative' : 'enrichment')
    if (!selectedProvider?.syncAvailable) setStatus('draft')
  }

  async function bind(input: {
    provider: string
    externalTenantId: string
    priority: number
    status: SourceStatus
    syncMode: SyncMode
  }) {
    setSaving(true)
    try {
      const response = await fetch('/api/admin/organization-sources', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          provider: input.provider,
          external_tenant_id: input.externalTenantId,
          priority: input.priority,
          status: input.status,
          sync_mode: input.syncMode,
          authority_scope: input.priority === 1 && input.status === 'active'
            ? {
                departments: 'authoritative',
                department_order: 'authoritative',
                primary_department: 'authoritative',
                employment_state: 'authoritative',
                identity: 'evidence',
              }
            : { identity: 'evidence' },
        }),
      })
      const body = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(body.error || '组织来源保存失败')
      success(input.priority === 1 && input.status === 'active' ? '主组织来源已切换' : '组织来源已保存')
      setAdding(false)
      setExternalTenantId('')
      await load()
    } catch (err) {
      error(err instanceof Error ? err.message : '组织来源保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function saveNew() {
    const parsedPriority = Number(priority)
    if (!externalTenantId.trim() || !Number.isInteger(parsedPriority) || parsedPriority < 1 || parsedPriority > 100) {
      error('请填写外部组织标识和1-100的优先级。')
      return
    }
    if (status === 'active' && !selectedProvider?.syncAvailable) {
      error(selectedProvider?.unavailableReason || '该提供方尚不能启用同步。')
      return
    }
    await bind({ provider, externalTenantId, priority: parsedPriority, status, syncMode })
  }

  async function unbind(source: Source) {
    if (!await confirmAction(`解绑「${providers.find((item) => item.key === source.provider)?.label || source.provider}」组织来源？历史身份证据会保留。`, { confirmText: '解绑', danger: true })) return
    setSaving(true)
    try {
      const response = await fetch('/api/admin/organization-sources', {
        method: 'DELETE',
        headers: authHeaders(true),
        body: JSON.stringify({ source_id: source.id }),
      })
      const body = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(body.error || '组织来源解绑失败')
      success('组织来源已解绑')
      await load()
    } catch (err) {
      error(err instanceof Error ? err.message : '组织来源解绑失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-medium text-slate-900">组织来源</h3>
          <p className="mt-1 text-xs text-slate-500">来源1填充组织骨架，其他来源只补充身份证据。</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setAdding((value) => !value)}>
          <PlusIcon className="mr-1 h-4 w-4" />
          绑定来源
        </Button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2">
          <div className="text-xs font-medium text-slate-800">手工维护</div>
          <div className="mt-0.5 text-[11px] text-emerald-700">始终可用</div>
        </div>
        {providers.map((item) => (
          <div key={item.key} className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2">
            <div className="text-xs font-medium text-slate-800">{item.label}</div>
            <div className={`mt-0.5 text-[11px] ${item.syncAvailable ? 'text-emerald-700' : 'text-amber-700'}`}>
              {item.key === 'fxiaoke' ? '可配置与预览' : item.syncAvailable ? '已接入' : '未接入'}
            </div>
          </div>
        ))}
      </div>

      {adding && (
        <div className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <label className="block text-xs text-slate-500">
            提供方
            <select
              value={provider}
              onChange={(event) => chooseProvider(event.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-900"
            >
              {providers.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
          </label>
          {provider === 'fxiaoke' ? <FxiaokeSourceForm /> : <>
          {selectedProvider && !selectedProvider.syncAvailable && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {selectedProvider.unavailableReason}
            </div>
          )}
          <label className="block text-xs text-slate-500">
            外部组织租户
            <Input
              value={externalTenantId}
              onChange={(event) => setExternalTenantId(event.target.value)}
              placeholder="组织ID或租户标识"
              className="mt-1 bg-white"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs text-slate-500">
              优先级
              <Input
                type="number"
                min={1}
                max={100}
                value={priority}
                onChange={(event) => choosePriority(event.target.value)}
                className="mt-1 bg-white"
              />
            </label>
            <label className="block text-xs text-slate-500">
              状态
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as SourceStatus)}
                className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-900"
              >
                <option value="active" disabled={!selectedProvider?.syncAvailable}>已启用</option>
                <option value="draft">草稿</option>
                <option value="disabled">已停用</option>
              </select>
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>取消</Button>
            <Button type="button" size="sm" disabled={saving} onClick={() => void saveNew()}>
              {saving ? '保存中...' : '保存绑定'}
            </Button>
          </div>
          </>}
        </div>
      )}

      <div className="mt-4 space-y-2">
        {loading && <div className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-500">正在读取组织来源...</div>}
        {!loading && sources.length === 0 && !legacy && (
          <div className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500">
            尚未绑定组织来源
          </div>
        )}
        {legacy && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-amber-900">
              <Link2Icon className="h-4 w-4" />
              飞书环境变量绑定待迁移
            </div>
            <div className="mt-1 text-xs text-amber-800">{legacy.external_tenant_id}</div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 bg-white"
              disabled={saving || !providers.find((item) => item.key === 'feishu')?.syncAvailable}
              onClick={() => void bind({
                provider: 'feishu',
                externalTenantId: legacy.external_tenant_id,
                priority: 1,
                status: 'active',
                syncMode: 'authoritative',
              })}
            >
              迁移为可管理绑定
            </Button>
          </div>
        )}
        {sources.map((source) => {
          const sourceProvider = providers.find((item) => item.key === source.provider)
          return (
            <div key={source.id} className="rounded-lg border border-slate-200 px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-900">{sourceProvider?.label || source.provider}</span>
                    <Badge variant={source.status === 'active' ? 'default' : 'outline'}>{statusLabel(source.status)}</Badge>
                    {source.status === 'active' && source.priority === 1 && <Badge variant="secondary">主来源</Badge>}
                    {sourceProvider && !sourceProvider.syncAvailable && <Badge className="border-amber-200 bg-amber-50 text-amber-800">连接器未接入</Badge>}
                  </div>
                  <div className="mt-1 break-all text-xs text-slate-500">{source.externalTenantId}</div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    优先级 {source.priority} · {source.syncMode === 'authoritative' ? '权威' : source.syncMode === 'enrichment' ? '补充' : '只读'}
                    {source.lastSuccessfulSyncAt ? ` · 最近成功 ${new Date(source.lastSuccessfulSyncAt).toLocaleString('zh-CN')}` : ''}
                  </div>
                  {source.lastError && <div className="mt-1 text-xs text-rose-600">{source.lastError}</div>}
                </div>
                {source.status !== 'disabled' && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-rose-600 hover:text-rose-700"
                    disabled={saving}
                    onClick={() => void unbind(source)}
                  >
                    <UnplugIcon className="mr-1 h-4 w-4" />
                    解绑
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

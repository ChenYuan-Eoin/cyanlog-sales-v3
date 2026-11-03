'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type {
  ConfigurableProvider,
  ConnectionSummary,
  DirectoryPreview,
  ProviderCapability,
} from '@/lib/organization-connections'

type ConfigurableCapability = ProviderCapability & { key: ConfigurableProvider }

type OrganizationConnectionFormProps = {
  provider: ConfigurableCapability
  onChanged?: () => void | Promise<void>
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

function connectionLabel(connection: ConnectionSummary | null) {
  if (!connection) return '未配置'
  if (connection.state === 'disabled') return '已停用'
  if (connection.draftCheckStatus === 'failed') return '验证失败'
  if (connection.draftCheckStatus === 'preview_ready') {
    return connection.effectiveVerified ? '当前配置已验证 · 草稿预览通过' : '草稿预览通过'
  }
  if (connection.effectiveVerified) return '当前配置已验证 · 新草稿待验证'
  if (connection.state === 'failed') return '验证失败'
  if (connection.configured) return '配置已保存 · 待验证'
  return '未配置'
}

function FieldHelp({ fieldKey, text }: { fieldKey: string; text: string }) {
  return (
    <details className="text-xs text-slate-600">
      <summary className="cursor-pointer text-blue-700 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
        如何填写？
      </summary>
      <p className="mt-1 break-words leading-relaxed">{text}</p>
      {fieldKey === 'permanentCode' && (
        <figure aria-label="永久授权码位置示意" className="mt-2 rounded-md border border-slate-300 bg-slate-50 p-2 text-slate-700">
          <figcaption className="mb-2 font-medium">纷享自建应用 · 开发模式（示意）</figcaption>
          <div className="space-y-1">
            <div className="flex justify-between gap-2"><span>AppID</span><span aria-hidden="true">••••••</span></div>
            <div className="flex justify-between gap-2"><span>APPSecret</span><span aria-hidden="true">••••••</span></div>
            <div className="rounded border border-blue-500 bg-blue-50 px-1 py-1 font-medium text-blue-800">永久授权码　← 复制这一行</div>
            <div className="flex justify-between gap-2"><span>token</span><span aria-hidden="true">••••••</span></div>
            <div className="flex justify-between gap-2"><span>EncodingAESKey</span><span aria-hidden="true">••••••</span></div>
          </div>
          <p className="mt-2">此图为位置示意，不含真实凭据。</p>
        </figure>
      )}
    </details>
  )
}

const inputClass = 'mt-1 h-10 w-full min-w-0 border border-slate-400 bg-white text-slate-900 shadow-sm placeholder:text-slate-500 focus-visible:border-blue-600 focus-visible:ring-blue-500/30'

export function OrganizationConnectionForm({ provider, onChanged }: OrganizationConnectionFormProps) {
  const [connection, setConnection] = useState<ConnectionSummary | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [failure, setFailure] = useState('')
  const [message, setMessage] = useState('')
  const [preview, setPreview] = useState<DirectoryPreview | null>(null)
  const [expanded, setExpanded] = useState(false)
  const inFlight = useRef(false)

  const departmentNames = useMemo(
    () => new Map(preview?.departments.map(item => [item.id, item.name]) || []),
    [preview],
  )

  const applyConnection = useCallback((saved: ConnectionSummary | null) => {
    setConnection(saved)
    setValues(Object.fromEntries(provider.fields.map(field => [
      field.key,
      field.secret || !saved ? '' : String(saved.metadata[field.key] ?? ''),
    ])))
  }, [provider.fields])

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setFailure('')
    try {
      const response = await fetch(
        `/api/admin/organization-sources/connection?provider=${encodeURIComponent(provider.key)}`,
        { headers: authHeaders(), cache: 'no-store', signal },
      )
      const body = await response.json().catch(() => ({})) as {
        data?: { connection?: ConnectionSummary | null }
        error?: string
      }
      if (!response.ok) throw new Error(body.error || '组织连接读取失败。')
      if (!signal?.aborted) applyConnection(body.data?.connection || null)
    } catch (error) {
      if (!signal?.aborted) setFailure(error instanceof Error ? error.message : '组织连接读取失败。')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [applyConnection, provider.key])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  function edit(key: string, value: string) {
    setValues(current => ({ ...current, [key]: value }))
    setDirty(true)
    setPreview(null)
    setFailure('')
    setMessage('')
  }

  function configurationPayload() {
    return {
      ...Object.fromEntries(provider.fields
        .filter(field => !field.secret || values[field.key]?.trim())
        .map(field => [field.key, values[field.key] || ''])),
      revision: connection?.revision || null,
    }
  }

  async function save() {
    if (inFlight.current || loading) return
    inFlight.current = true
    setBusy(true)
    setFailure('')
    setMessage('')
    try {
      const response = await fetch('/api/admin/organization-sources/connection', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          action: 'save',
          provider: provider.key,
          configuration: configurationPayload(),
        }),
      })
      const body = await response.json().catch(() => ({})) as {
        data?: { connection?: ConnectionSummary }
        error?: string
      }
      if (!response.ok || !body.data?.connection) throw new Error(body.error || '配置草稿保存失败。')
      applyConnection(body.data.connection)
      setDirty(false)
      setPreview(null)
      setMessage('配置草稿已保存。下一步请验证并预览通讯录。')
      await onChanged?.()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : '配置草稿保存失败。')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  async function validateAndPreview() {
    if (inFlight.current || loading || dirty || !connection) return
    inFlight.current = true
    setBusy(true)
    setFailure('')
    setMessage('')
    setPreview(null)
    try {
      const response = await fetch('/api/admin/organization-sources/connection', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          action: 'preview',
          provider: provider.key,
          revision: connection.revision,
        }),
      })
      const body = await response.json().catch(() => ({})) as {
        data?: { connection?: ConnectionSummary; preview?: DirectoryPreview }
        error?: string
      }
      if (!response.ok || !body.data?.preview || !body.data.connection) {
        throw new Error(body.error || '通讯录验证失败。')
      }
      applyConnection(body.data.connection)
      setPreview(body.data.preview)
      setMessage('通讯录验证通过；本次仅预览，没有同步目录、启用来源或切换主来源。')
      await onChanged?.()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : '通讯录验证失败。')
      await load()
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <section aria-label={`${provider.label}连接配置`} className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
        <div>
          <h4 className="font-medium text-slate-900">{provider.label}连接</h4>
          <p className="mt-1 text-xs text-slate-500">凭据格式由该提供方适配器校验，保存、版本、状态和预览流程与其他提供方相同。</p>
        </div>
        <Badge variant={connection?.draftCheckStatus === 'failed' || connection?.state === 'failed' ? 'destructive' : 'outline'}>
          {connectionLabel(connection)}
        </Badge>
      </div>

      {loading && <p role="status" className="text-sm text-slate-500">正在读取已保存配置…</p>}
      <fieldset disabled={loading || busy} className="grid min-w-0 grid-cols-1 gap-4">
        {provider.fields.map(field => (
          <div key={field.key} className="min-w-0 space-y-1">
            <label className="block text-sm font-medium" htmlFor={`organization-connection-${provider.key}-${field.key}`}>
              {field.label}
            </label>
            <Input
              id={`organization-connection-${provider.key}-${field.key}`}
              aria-label={field.label}
              type={field.type}
              autoComplete={field.secret ? 'new-password' : 'off'}
              className={inputClass}
              placeholder={field.placeholder}
              value={values[field.key] || ''}
              onChange={event => edit(field.key, event.target.value)}
            />
            <FieldHelp fieldKey={field.key} text={field.help} />
          </div>
        ))}
      </fieldset>

      {connection && (
        <p className="text-sm text-slate-600">
          {dirty
            ? '编辑尚未保存；当前生效配置没有改变。'
            : connection.lastCheckedAt
              ? `最近验证：${new Date(connection.lastCheckedAt).toLocaleString('zh-CN')}`
              : '配置尚未验证。'}
        </p>
      )}
      {failure && <p role="alert" className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{failure}</p>}
      {!failure && connection?.lastError && <p className="text-sm text-rose-700">{connection.lastError}</p>}
      {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}

      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={loading || busy || !dirty} onClick={() => void save()}>
          {busy ? '正在处理…' : '保存配置草稿'}
        </Button>
        {provider.previewAvailable && (
          <Button
            type="button"
            variant="outline"
            disabled={loading || busy || dirty || !connection?.configured}
            onClick={() => void validateAndPreview()}
          >
            {busy ? '处理中…' : '验证并预览通讯录'}
          </Button>
        )}
      </div>
      <p className="text-xs leading-5 text-slate-500">验证只读取通讯录。启用来源、目录同步和主来源切换在后续确认批次单独执行；原组织、历史身份与手工数据保持不变。</p>

      {preview && (
        <div className="space-y-3 border-t border-slate-200 pt-3">
          <p className="font-medium">通讯录预览：可读取 {preview.departments.length} 个部门、{preview.employees.length} 位员工</p>
          {preview.warnings.map(warning => <p key={warning} className="text-sm text-amber-800">{warning}</p>)}
          <div className="max-h-64 overflow-auto rounded border p-2">
            <ul className="space-y-1 text-sm">
              {(expanded ? preview.departments : preview.departments.slice(0, 5)).map(department => (
                <li key={department.id}>{department.name} · {department.status === 'active' ? '正常' : '待核对'}</li>
              ))}
            </ul>
          </div>
          <div className="max-h-64 overflow-auto rounded border p-2">
            <ul className="space-y-1 text-sm">
              {(expanded ? preview.employees : preview.employees.slice(0, 5)).map(employee => (
                <li key={employee.id}>
                  {employee.name} · {employee.departmentIds.map(id => departmentNames.get(id) || '部门未读取').join('、') || '未指定主属部门'} · {employee.status === 'active' ? '正常' : '待核对'}
                  {employee.loginDisabled === true ? ' · 禁止登录' : ''}
                </li>
              ))}
            </ul>
          </div>
          {(preview.departments.length > 5 || preview.employees.length > 5) && (
            <Button type="button" variant="ghost" onClick={() => setExpanded(value => !value)}>
              {expanded ? '收起' : '展开更多'}
            </Button>
          )}
        </div>
      )}
    </section>
  )
}

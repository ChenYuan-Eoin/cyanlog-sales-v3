'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { connectionPresentation } from '@/lib/organization-connections/presentation'
import type {
  OrganizationConnectionProvider,
  ConnectionSummary,
  DirectoryPreview,
  ProviderCapability,
} from '@/lib/organization-connections'

type ConfigurableCapability = ProviderCapability & { key: OrganizationConnectionProvider }

type OrganizationConnectionFormProps = {
  provider: ConfigurableCapability
  canConnect: boolean
  canApply: boolean
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

function directoryStatusLabel(status: string) {
  if (status === 'active') return '启用'
  if (status === 'inactive') return '停用'
  if (status === 'deleted') return '删除'
  return '待核对'
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

export function OrganizationConnectionForm({ provider, canConnect, canApply, onChanged }: OrganizationConnectionFormProps) {
  const [connection, setConnection] = useState<ConnectionSummary | null>(null)
  const [storageMode, setStorageMode] = useState<'unified' | 'legacy_fxiaoke_read_only'>('unified')
  const [values, setValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [readFailed, setReadFailed] = useState(false)
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
    if (saved?.storageMode) setStorageMode(saved.storageMode)
    setValues(Object.fromEntries(provider.fields.map(field => [
      field.key,
      field.secret || !saved ? '' : String(saved.metadata[field.key] ?? ''),
    ])))
  }, [provider.fields])

  const load = useCallback(async (signal?: AbortSignal, preserveFailure = false) => {
    setLoading(true)
    if (!preserveFailure) setFailure('')
    try {
      const response = await fetch(
        `/api/admin/organization-sources/connection?provider=${encodeURIComponent(provider.key)}`,
        { headers: authHeaders(), cache: 'no-store', signal },
      )
      const body = await response.json().catch(() => ({})) as {
        data?: {
          connection?: ConnectionSummary | null
          storage_mode?: 'unified' | 'legacy_fxiaoke_read_only'
        }
        error?: string
      }
      if (!response.ok) throw new Error(body.error || '组织连接读取失败。')
      if (!body.data || !('connection' in body.data)) throw new Error('组织连接读取结果不完整，请重新读取。')
      if (!signal?.aborted) {
        if (body.data?.storage_mode) setStorageMode(body.data.storage_mode)
        applyConnection(body.data?.connection || null)
        setDirty(false)
        setReadFailed(false)
      }
    } catch (error) {
      if (!signal?.aborted) {
        setReadFailed(true)
        setFailure(error instanceof Error ? error.message : '组织连接读取失败。')
      }
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
    if (!canConnect || inFlight.current || loading || readFailed) return
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
    if (!canConnect || inFlight.current || loading || readFailed || dirty || !connection) return
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
        data?: { connection?: ConnectionSummary; preview?: DirectoryPreview | null }
        error?: string
      }
      if (!response.ok || !body.data?.connection) {
        throw new Error(body.error || '通讯录验证失败。')
      }
      applyConnection(body.data.connection)
      const verifiedPreview = body.data.preview ?? null
      setPreview(verifiedPreview)
      const enabled = connectionPresentation(body.data.connection).currentConfigurationEnabled
      if (!verifiedPreview) {
        setMessage(enabled ? '配置检查通过，当前目录连接已启用。' : '配置检查通过，当前配置待启用。')
      } else {
        setMessage(enabled
          ? '配置检查通过，当前目录连接已启用。可继续读取组织目录差异；本次检查没有写入组织。'
          : '配置检查通过。下一步启用或应用当前配置，再读取组织目录差异；本次检查没有写入组织。')
      }
      await onChanged?.()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : '通讯录验证失败。')
      await load(undefined, true)
      await onChanged?.()
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const legacyReadOnly = storageMode === 'legacy_fxiaoke_read_only'
  const presentation = connectionPresentation(connection)
  const { currentConfigurationEnabled } = presentation

  async function activateDirectory() {
    if (!canApply || inFlight.current || loading || readFailed || dirty || !connection || connection.draftCheckStatus !== 'preview_ready') return
    inFlight.current = true
    setBusy(true)
    setFailure('')
    setMessage('')
    try {
      const response = await fetch('/api/admin/organization-sources/connection', {
        method: 'POST', headers: authHeaders(true),
        body: JSON.stringify({ action: 'activate_directory', provider: provider.key, revision: connection.revision }),
      })
      const body = await response.json().catch(() => ({})) as { data?: { connection?: ConnectionSummary }; error?: string }
      if (!response.ok || !body.data?.connection) throw new Error(body.error || '目录连接启用失败。')
      applyConnection(body.data.connection)
      setMessage('目录连接已启用并保存。下一步读取组织目录差异，确认后整体同步部门、员工和归属。')
      await onChanged?.()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : '目录连接启用失败。')
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
          <p className="mt-1 text-xs text-slate-500">保存并检查连接配置，启用后可读取组织差异。检查结果不是实时在线状态。</p>
        </div>
        <Badge variant={connection?.draftCheckStatus === 'failed' || connection?.state === 'failed' ? 'destructive' : 'outline'}>
          {loading ? '正在读取配置' : readFailed ? '配置状态未知' : presentation.checkLabel}
        </Badge>
      </div>

      {loading && <p role="status" className="text-sm text-slate-500">正在读取已保存配置…</p>}
      {legacyReadOnly && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
          当前生产库尚未完成统一连接结构升级。现有纷享连接可继续做只读连接与通讯录检查；修改配置、启用来源和目录切源暂不开放。
        </p>
      )}
      <fieldset disabled={!canConnect || loading || readFailed || busy || legacyReadOnly} className="grid min-w-0 grid-cols-1 gap-4">
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
      {!loading && !readFailed && <div className="rounded-md bg-slate-50 p-3 text-sm" aria-label="目录连接状态">
        <p className="font-medium">{presentation.directoryLabel}</p>
        <p className="mt-1 text-xs leading-5 text-slate-600">{presentation.directoryDetail}</p>
      </div>}
      {failure && <Button type="button" variant="outline" disabled={busy || loading}
        onClick={() => { setPreview(null); setMessage(''); void load() }}>
        {dirty ? '放弃修改并重新读取配置' : '重新读取连接配置'}
      </Button>}

      <div className="flex flex-wrap gap-2">
        {canConnect && <Button type="button" disabled={loading || readFailed || busy || legacyReadOnly || !dirty} onClick={() => void save()}>
          {busy ? '正在处理…' : '保存配置草稿'}
        </Button>}
        {canConnect && provider.previewAvailable && (
          <Button
            type="button"
            variant="outline"
            disabled={loading || readFailed || busy || dirty || !connection?.configured}
            onClick={() => void validateAndPreview()}
          >
            {busy ? '处理中…' : '检查连接与读取范围'}
          </Button>
        )}
        {canApply && !legacyReadOnly && !currentConfigurationEnabled && (
          <Button type="button" disabled={loading || readFailed || busy || dirty || connection?.draftCheckStatus !== 'preview_ready'}
            onClick={() => void activateDirectory()}>
            {presentation.activationLabel}
          </Button>
        )}
      </div>
      {(canConnect || canApply) && <p className="text-xs leading-5 text-slate-500">保存配置 → 检查连接 → 启用目录连接 → 读取差异并确认整体同步。启用只保存目录读取配置，不授予企业登录、账号关联或角色权限；部门与员工在确认差异后统一应用。</p>}

      {canConnect && preview && (
        <div className="space-y-3 border-t border-slate-200 pt-3">
          <div>
            <p className="font-medium">读取范围检查：{preview.departments.length} 个部门、{preview.employees.length} 位员工</p>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              本次检查显示当前连接读到的部门、员工及归属，尚未写入组织。下一步通过同步功能生成整体差异并确认应用。
            </p>
          </div>
          <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm sm:grid-cols-3">
            <div>部门 · 启用 {preview.departments.filter(item => item.status === 'active').length} / 停用 {preview.departments.filter(item => item.status === 'inactive').length} / 待核对 {preview.departments.filter(item => !['active', 'inactive'].includes(item.status)).length}</div>
            <div>员工 · 在职 {preview.employees.filter(item => item.status === 'active').length} / 停用 {preview.employees.filter(item => item.status === 'inactive').length} / 待核对 {preview.employees.filter(item => !['active', 'inactive'].includes(item.status)).length}</div>
            <div>部门归属 {preview.employees.reduce((count, item) => count + item.departmentIds.length, 0)} 条</div>
          </div>
          {!preview.complete && (
            <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              当前快照存在未识别状态或关系缺口，不能直接生成可执行目录差异。
            </p>
          )}
          {preview.warnings.map(warning => <p key={warning} className="text-sm leading-6 text-amber-800">{warning}</p>)}
          {expanded && (
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="max-h-64 overflow-auto rounded border p-2">
                <p className="mb-2 text-xs font-medium text-slate-500">部门读取明细</p>
                <ul className="space-y-1 text-sm">
                  {preview.departments.map(department => (
                    <li key={department.id}>{department.name} · {directoryStatusLabel(department.status)}</li>
                  ))}
                </ul>
              </div>
              <div className="max-h-64 overflow-auto rounded border p-2">
                <p className="mb-2 text-xs font-medium text-slate-500">成员读取明细</p>
                <ul className="space-y-1 text-sm">
                  {preview.employees.map(employee => (
                    <li key={employee.id}>
                      {employee.name} · 主属 {employee.primaryDepartmentId ? (departmentNames.get(employee.primaryDepartmentId) || '部门未读取') : '未确定'} · 其他 {employee.departmentIds.filter(id => id !== employee.primaryDepartmentId).map(id => departmentNames.get(id) || '部门未读取').join('、') || '无'} · {directoryStatusLabel(employee.status)}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {(preview.departments.length > 0 || preview.employees.length > 0) && (
            <Button type="button" variant="ghost" onClick={() => setExpanded(value => !value)}>
              {expanded ? '收起读取明细' : '查看全部读取明细'}
            </Button>
          )}
        </div>
      )}
    </section>
  )
}

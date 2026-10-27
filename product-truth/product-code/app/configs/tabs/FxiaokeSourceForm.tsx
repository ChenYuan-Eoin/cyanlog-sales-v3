'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ConnectionSummary, DirectoryPreview } from '@/lib/fxiaoke/contracts'

const ENDPOINT = '/api/admin/organization-sources/fxiaoke'
function headers(): HeadersInit {
  const token = localStorage.getItem('token')
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
}
function stateLabel(value: string) {
  return value === '0' ? '正常' : value === '1' ? '停用' : '待核对'
}
export function FxiaokeSourceForm() {
  const [connection, setConnection] = useState<ConnectionSummary | null>(null)
  const [fields, setFields] = useState({ appId: '', expectedEa: '', apiUserId: '', appSecret: '', permanentCode: '' })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [message, setMessage] = useState('')
  const [failure, setFailure] = useState('')
  const [preview, setPreview] = useState<DirectoryPreview | null>(null)
  const [expanded, setExpanded] = useState(false)
  const inFlight = useRef(false)
  const departmentNames = useMemo(() => new Map(preview?.departments.map(item => [item.id, item.name]) || []), [preview])

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch(ENDPOINT, { headers: headers(), cache: 'no-store', signal: controller.signal })
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || '配置读取失败。')
        if (controller.signal.aborted) return
        const saved = body.data?.connection as ConnectionSummary | null
        setConnection(saved)
        if (saved) setFields({ appId: saved.appId, expectedEa: saved.expectedEa, apiUserId: saved.apiUserId, appSecret: '', permanentCode: '' })
      } catch (err) {
        if (!controller.signal.aborted) setFailure(err instanceof Error ? err.message : '配置读取失败。')
      } finally { if (!controller.signal.aborted) setLoading(false) }
    })()
    return () => controller.abort()
  }, [])

  function edit(key: keyof typeof fields, value: string) {
    setFields(current => ({ ...current, [key]: value })); setDirty(true); setPreview(null); setMessage('')
  }
  async function action(kind: 'save' | 'preview') {
    if (inFlight.current || loading) return
    inFlight.current = true; setBusy(true); setFailure(''); setMessage(''); setPreview(null)
    try {
      const response = await fetch(ENDPOINT, { method: 'POST', headers: headers(), body: JSON.stringify(kind === 'save'
        ? { action: kind, connection: { appId: fields.appId, expectedEa: fields.expectedEa, apiUserId: fields.apiUserId,
          ...(fields.appSecret.trim() ? { appSecret: fields.appSecret } : {}),
          ...(fields.permanentCode.trim() ? { permanentCode: fields.permanentCode } : {}), revision: connection?.revision || null } }
        : { action: kind, revision: connection?.revision }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || '操作失败，请重试。')
      if (kind === 'save') {
        setConnection(body.data.connection); setFields(current => ({ ...current, appSecret: '', permanentCode: '' }))
        setDirty(false); setMessage('配置已保存。请预览通讯录，核对企业及读取范围。')
      } else {
        setPreview(body.data.preview); setExpanded(false)
        setConnection(current => current ? { ...current, lastCheckStatus: 'preview_ready', lastCheckedAt: body.data.preview.checkedAt, lastError: null } : current)
      }
    } catch (err) {
      setFailure(err instanceof Error ? err.message : '操作失败，请重试。')
      if (kind === 'preview') setConnection(current => current ? { ...current, lastCheckStatus: 'failed' } : current)
    } finally { inFlight.current = false; setBusy(false) }
  }

  return <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4" aria-label="纷享销客应用接入">
    <div>
      <h4 className="font-medium text-slate-900">纷享销客自建应用</h4>
      <p className="mt-1 text-sm text-slate-600">在纷享后台的自建应用中开启开发模式，配置部门和员工读取权限。</p>
      <p className="mt-1 text-xs text-slate-500">服务地址：https://open.fxiaoke.com。其他云部署暂不支持，请勿填入该云的凭据。</p>
    </div>
    {loading && <p role="status">正在读取已保存配置…</p>}
    <fieldset disabled={loading || busy} className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">应用 ID（AppID）<Input autoComplete="off" value={fields.appId} onChange={event => edit('appId', event.target.value)} /></label>
      <label className="text-sm">企业标识（ea）<Input autoComplete="off" value={fields.expectedEa} onChange={event => edit('expectedEa', event.target.value)} /><span className="text-xs text-slate-500">纷享企业专属标识，用于核对授权是否属于目标企业。</span></label>
      <label className="text-sm">应用密钥（AppSecret）<Input type="password" autoComplete="new-password" value={fields.appSecret} placeholder={connection ? '留空保留已保存密钥' : '填写应用密钥'} onChange={event => edit('appSecret', event.target.value)} /></label>
      <label className="text-sm">永久授权码（PermanentCode）<Input type="password" autoComplete="new-password" value={fields.permanentCode} placeholder={connection ? '留空保留已保存授权码' : '填写永久授权码'} onChange={event => edit('permanentCode', event.target.value)} /></label>
      <label className="text-sm sm:col-span-2">同步执行员工 ID<Input autoComplete="off" value={fields.apiUserId} onChange={event => edit('apiUserId', event.target.value)} /><span className="text-xs text-slate-500">在纷享 CRM「人员 → 系统名 → 账号信息」中查看员工 ID。后台按此账号的权限读取通讯录，不代表其他销售登录身份。</span></label>
    </fieldset>
    {connection && <p className="text-sm text-slate-600">{dirty ? '编辑尚未保存' : connection.lastCheckStatus === 'preview_ready' ? '上次通讯录预览成功 · 尚未同步或启用主来源' : connection.lastCheckStatus === 'failed' ? '上次预览失败，请检查配置后重试' : '凭据已保存 · 尚未验证'}{connection.lastCheckedAt ? ` · ${new Date(connection.lastCheckedAt).toLocaleString('zh-CN')}` : ''}</p>}
    {failure && <p role="alert" className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{failure}</p>}
    {!failure && connection?.lastError && <p className="text-sm text-rose-700">{connection.lastError}</p>}
    {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
    <div className="flex flex-wrap gap-2">
      <Button type="button" disabled={loading || busy} onClick={() => void action('save')}>保存应用配置</Button>
      <Button type="button" variant="outline" disabled={loading || busy || dirty || !connection} onClick={() => void action('preview')}>{busy ? '处理中…' : '验证并预览通讯录'}</Button>
    </div>
    <p className="text-xs text-slate-500">更换企业或 AppID 时需重新填写两项密钥。预览仅读取通讯录；确认同步与主来源切换尚未启用，原组织及手工数据保持不变。</p>
    {preview && <div className="space-y-3 border-t pt-3">
      <p className="font-medium">企业 {preview.ea}：可读取 {preview.departments.length} 个部门、{preview.employees.length} 位员工</p>
      {preview.warnings.map(warning => <p key={warning} className="text-sm text-amber-800">{warning}</p>)}
      <div className="max-h-64 overflow-auto rounded border p-2">
        <ul className="space-y-1 text-sm">{(expanded ? preview.departments : preview.departments.slice(0, 5)).map(department => <li key={department.id}>{department.name} · {stateLabel(department.status)}</li>)}</ul>
      </div>
      <div className="max-h-64 overflow-auto rounded border p-2">
        <ul className="space-y-1 text-sm">{(expanded ? preview.employees : preview.employees.slice(0, 5)).map(employee => <li key={employee.id}>{employee.name} · {employee.departmentIds.map(id => departmentNames.get(id) || '部门未读取').join('、') || '未指定主属部门'} · {stateLabel(employee.status)}{employee.loginDisabled === true ? ' · 禁止登录' : ''}</li>)}</ul>
      </div>
      {(preview.departments.length > 5 || preview.employees.length > 5) && <Button type="button" variant="ghost" onClick={() => setExpanded(value => !value)}>{expanded ? '收起' : '展开更多'}</Button>}
    </div>}
  </section>
}

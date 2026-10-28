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
function FieldHelp({ text, showCodeLocation = false }: { text: string; showCodeLocation?: boolean }) {
  return <details className="text-xs text-slate-600">
    <summary title={text} className="cursor-pointer text-blue-700 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">如何填写？</summary>
    <p className="mt-1 break-words leading-relaxed">{text}</p>
    {showCodeLocation && <figure aria-label="永久授权码位置示意" className="mt-2 rounded-md border border-slate-300 bg-slate-50 p-2 text-slate-700">
      <figcaption className="mb-2 font-medium">纷享自建应用 · 开发模式（示意）</figcaption>
      <div className="space-y-1">
        <div className="flex justify-between gap-2"><span>AppID</span><span aria-hidden="true">••••••</span></div>
        <div className="flex justify-between gap-2"><span>APPSecret</span><span aria-hidden="true">••••••</span></div>
        <div className="rounded border border-blue-500 bg-blue-50 px-1 py-1 font-medium text-blue-800">永久授权码　← 复制这一行</div>
        <div className="flex justify-between gap-2"><span>token</span><span aria-hidden="true">••••••</span></div>
        <div className="flex justify-between gap-2"><span>EncodingAESKey</span><span aria-hidden="true">••••••</span></div>
      </div>
      <p className="mt-2">此图为位置示意，不含真实凭据。</p>
    </figure>}
  </details>
}
const inputClass = 'mt-1 h-10 w-full min-w-0 border border-slate-400 bg-white text-slate-900 shadow-sm placeholder:text-slate-500 focus-visible:border-blue-600 focus-visible:ring-blue-500/30'
export function FxiaokeSourceForm() {
  const [connection, setConnection] = useState<ConnectionSummary | null>(null)
  const [fields, setFields] = useState({ appId: '', apiUserId: '', appSecret: '', permanentCode: '' })
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
        if (saved) setFields({ appId: saved.appId, apiUserId: saved.apiUserId, appSecret: '', permanentCode: '' })
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
        ? { action: kind, connection: { appId: fields.appId, apiUserId: fields.apiUserId,
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
      <p className="mt-1 text-xs text-slate-600">首次填写 AppID、APPSecret、永久授权码和员工 ID；系统保存时自动连接纷享。已保存的密钥可留空保留。</p>
    </div>
    {loading && <p role="status">正在读取已保存配置…</p>}
    <fieldset disabled={loading || busy} className="grid min-w-0 grid-cols-1 gap-4">
      <div className="min-w-0 space-y-1"><label className="block text-sm font-medium">AppID<Input className={inputClass} placeholder="填写纷享的 AppID" autoComplete="off" value={fields.appId} onChange={event => edit('appId', event.target.value)} /></label><FieldHelp text="在纷享销客管理后台，打开对应自建应用，在开发模式中复制 AppID。" /></div>
      <div className="min-w-0 space-y-1"><label className="block text-sm font-medium">APPSecret<Input className={inputClass} type="password" autoComplete="new-password" value={fields.appSecret} placeholder={connection ? '留空保留已保存密钥' : '填写纷享的 APPSecret'} onChange={event => edit('appSecret', event.target.value)} /></label><FieldHelp text="在同一个自建应用的开发模式中复制 APPSecret；它是密钥，请勿发送到聊天。更换应用时需要重新填写。" /></div>
      <div className="min-w-0 space-y-1"><label className="block text-sm font-medium">永久授权码<Input className={inputClass} type="password" autoComplete="new-password" value={fields.permanentCode} placeholder={connection ? '留空保留已保存授权码' : '填写纷享的永久授权码'} onChange={event => edit('permanentCode', event.target.value)} /></label><FieldHelp showCodeLocation text="在纷享管理后台依次打开「应用中心管理 → 应用列表 → 对应自建应用 → 开发模式」，复制「永久授权码」一行的完整内容；它位于 APPSecret 下方、token 上方。请直接粘贴到此处，不要发送到聊天。" /></div>
      <div className="min-w-0 space-y-1"><label className="block text-sm font-medium">员工 ID<Input className={inputClass} autoComplete="off" placeholder="填写有通讯录读取权限的员工 ID" value={fields.apiUserId} onChange={event => edit('apiUserId', event.target.value)} /></label><FieldHelp text="在纷享管理后台打开「系统管理 → 组织架构管理 → 部门与员工」，搜索并点开员工，在「详细信息 → 账号信息 → 员工ID」查看。系统按该员工及应用的权限读取部门和人员；预览范围取决于实际授权。" /></div>
    </fieldset>
    {connection && <p className="text-sm text-slate-600">{dirty ? '编辑尚未保存' : connection.lastCheckStatus === 'preview_ready' ? '上次通讯录预览成功 · 尚未同步或启用主来源' : connection.lastCheckStatus === 'failed' ? '上次预览失败，请检查配置后重试' : '凭据已保存 · 尚未验证'}{connection.lastCheckedAt ? ` · ${new Date(connection.lastCheckedAt).toLocaleString('zh-CN')}` : ''}</p>}
    {failure && <p role="alert" className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{failure}</p>}
    {!failure && connection?.lastError && <p className="text-sm text-rose-700">{connection.lastError}</p>}
    {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
    <div className="flex flex-wrap gap-2">
      <Button type="button" disabled={loading || busy} onClick={() => void action('save')}>{busy ? '正在处理…' : '保存应用配置'}</Button>
      <Button type="button" variant="outline" disabled={loading || busy || dirty || !connection} onClick={() => void action('preview')}>{busy ? '处理中…' : '验证并预览通讯录'}</Button>
    </div>
    <p className="text-xs text-slate-500">更换企业或 AppID 时需重新填写两项密钥。预览仅读取通讯录；确认同步与主来源切换尚未启用，原组织及手工数据保持不变。</p>
    {preview && <div className="space-y-3 border-t pt-3">
      <p className="font-medium">通讯录预览：可读取 {preview.departments.length} 个部门、{preview.employees.length} 位员工</p>
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

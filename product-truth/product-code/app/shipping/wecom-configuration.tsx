'use client'
import { useEffect, useRef, useState } from 'react'
import type { WecomSettings, WecomMember, WecomConfigDraft } from '@/lib/shipping/wecom-settings'
import WecomBotConfiguration from './wecom-bot-configuration'
import WecomDepartmentPicker from './wecom-department-picker'
import styles from './config-drawer.module.css'
type Reply = { settings: WecomSettings; members: WecomMember[]; draft?: WecomConfigDraft | null }
async function request(body?: unknown): Promise<Reply> {
  const response = await fetch('/api/shipping/wecom', { ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' }) })
  const data = await response.json()
  if (!response.ok || !data.settings) throw new Error(data.error || '企微配置暂不可用')
  return data
}
export default function WecomConfiguration({ onMessage }: { onMessage?: (message: string) => void }) {
  const [settings, setSettings] = useState<WecomSettings | null>(null), [editor,setEditor] = useState<WecomSettings|null>(null), [members, setMembers] = useState<WecomMember[]>([])
  const [draft, setDraft] = useState<WecomConfigDraft | null>(null), [draftScope, setDraftScope] = useState<number[]>([]), [scope, setScope] = useState<number[]>([])
  const [secret, setSecret] = useState(''), [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false), [message, setMessage] = useState('')
  const [editorDraftId,setEditorDraftId]=useState<string|null>(null)
  const editorDetails=useRef<HTMLDetailsElement>(null)
  const running = useRef(false)
  function receive(data: Reply) { setSecret(''); setDirty(false); setSettings(data.settings); setEditor(data.settings); setEditorDraftId(null); setMembers(data.members || []); setScope(data.settings.allowedDepartmentIds || []); if (data.draft !== undefined) { setDraft(data.draft); setDraftScope(data.draft?.corpId===data.settings.corpId ? data.settings.allowedDepartmentIds || [] : []) } }
  useEffect(() => { let active = true; request().then(data => { if (active) receive(data) }).catch(e => { if (active) setMessage(e.message) }); return () => { active = false } }, [])
  async function act(body: unknown, success: string) {
    if (running.current) return false
    running.current = true; setBusy(true); setMessage(''); onMessage?.('')
    try { receive(await request(body)); setMessage(success); onMessage?.(success); return true }
    catch (error) { setMessage((error as Error).message); onMessage?.((error as Error).message); return false }
    finally { running.current = false; setBusy(false) }
  }
  async function prepare() {
    if (!editor) return
    if (await act({ action: 'prepare', settings: { corpId: editor.corpId, agentId: editor.agentId, orderCheckMode: editor.orderCheckMode, fallbackPhone: editor.fallbackPhone, deniedMessage: editor.deniedMessage, expectedUpdatedAt: editor.updatedAt, ...(editorDraftId ? {draftId:editorDraftId} : {}), ...(secret ? { secret } : {}) } }, '新配置已测试并保存为待启用。请选择组织范围后启用；当前连接未改变。')) { setSecret(''); setDirty(false) }
  }
  return <section className={styles.section} aria-label="下单权限中心"><h3>企业微信连接与下单权限</h3>
    <p className={styles.hint}>员工身份使用企业自建应用。更换企业先测试新连接和组织范围，启用前保留当前连接。</p>
    {settings && editor && <>
      <p>当前连接：{settings.hasSecret ? `${settings.companyName || settings.corpId} · 应用 ${settings.agentId}` : '尚未配置'}</p>
      <details ref={editorDetails} open={!editor.hasSecret}><summary>配置 / 更换企业应用</summary><fieldset disabled={busy} onChange={() => setDirty(true)}>
        <label>企业ID（CorpID）<input value={editor.corpId} onChange={e => setEditor({ ...editor, corpId: e.target.value })}/></label>
        <label>应用ID（AgentID）<input type="number" min="1" value={editor.agentId || ''} onChange={e => setEditor({ ...editor, agentId: Number(e.target.value) || null })}/></label>
        <label>应用密钥（Secret）<input type="password" autoComplete="new-password" value={secret} onChange={e => setSecret(e.target.value)} placeholder={editor.hasSecret ? '已加密保存；同一应用留空保持' : '自建应用密钥，不是机器人密钥'}/></label>
        <label>下单校验模式<select value={editor.orderCheckMode} onChange={e => setEditor({ ...editor, orderCheckMode: Number(e.target.value) as 0 | 1 })}><option value="1">仅限已授权企微员工</option><option value="0">网页开放提报（机器人仍需企微授权）</option></select></label>
        <label>预置寄件电话（可选）<input value={editor.fallbackPhone} onChange={e => setEditor({ ...editor, fallbackPhone: e.target.value })}/></label>
        <p className={styles.hint}>通讯录电话不可用时自动使用此号码，不改变员工身份。</p>
        <label>无权限提示文案<input value={editor.deniedMessage} maxLength={200} onChange={e => setEditor({ ...editor, deniedMessage: e.target.value })}/></label>
        <button type="button" onClick={() => void prepare()}>{busy ? '处理中…' : '测试并准备新配置'}</button>
      </fieldset></details>
      {draft && <section aria-label="待启用企业配置"><h4>待启用：{draft.companyName || draft.corpId}</h4><p>{draft.corpId} · 应用 {draft.agentId}（{draft.appName}）· {draft.memberCount} 位可见成员</p><p className={styles.hint}>已通过接口测试。待启用配置30分钟有效；切换企业或应用时旧会话失效，历史工单保留原归属。</p><div className={styles.actions}><button type="button" disabled={busy} onClick={()=>{setSecret('');setEditor({...settings,corpId:draft.corpId,agentId:draft.agentId,orderCheckMode:draft.orderCheckMode,fallbackPhone:draft.fallbackPhone,deniedMessage:draft.deniedMessage});setEditorDraftId(draft.id);setDirty(true);if(editorDetails.current)editorDetails.current.open=true}}>继续编辑待启用配置</button><button type="button" disabled={busy} onClick={()=>void act({action:'discard',draftId:draft.id},'待启用配置已放弃，当前连接保持不变。')}>放弃待启用配置</button></div><p>{draft.orderCheckMode===0?'全员开放：任何持有入口地址的人都可提报。':'仅限所选部门的企微员工提报。'}</p><WecomDepartmentPicker departments={draft.departments} selected={draftScope} onChange={setDraftScope} disabled={busy}/><button type="button" disabled={busy} onClick={() => void act({ action: 'activate', draftId: draft.id, departmentIds: draftScope }, '新企业配置与组织授权已启用。')}>启用此配置{draftScope.length === 0 ? '（不授权任何部门）' : ''}</button></section>}
      <section aria-label="当前企业组织授权"><h4>谁可以提报</h4><p>{members.filter(m => m.is_active && m.wecom_allowed).length} 位成员当前可提报；只包含应用可见范围内的成员。</p><button type="button" className={styles.secondary} disabled={busy || dirty || !settings.hasSecret} onClick={() => void act({ action: 'sync' }, '组织架构已同步，现有授权规则已重新核对。')}>同步企业微信组织</button>
        {dirty && <p className={styles.hint}>请先测试当前编辑内容，或刷新放弃修改，再同步当前企业。</p>}
        {settings.departments?.length > 0 ? <><p className={styles.hint}>{settings.allowedDepartmentIds === null ? '目前沿用已有人员授权；保存下方组织范围后按部门维护。' : '已按部门及其下级授权。'}</p><WecomDepartmentPicker departments={settings.departments} selected={scope} onChange={setScope} disabled={busy || dirty}/><button type="button" disabled={busy || dirty} onClick={() => void act({ action: 'scope', departmentIds: scope }, '组织授权范围已保存。移出范围的员工会话已失效。')}>保存组织授权{scope.length === 0 ? '（不授权任何部门）' : ''}</button></> : <p className={styles.hint}>同步后按组织架构选择，不需要逐个维护员工名单。</p>}
        <p className={styles.hint}>企微授权回调域名：{settings.redirectDomain || '尚未读取'}；同步时间：{settings.directorySyncedAt ? new Date(settings.directorySyncedAt).toLocaleString('zh-CN') : '尚未同步'}</p>
      </section>
    </>}
    {settings&&<WecomBotConfiguration corpId={settings.corpId} ready={settings.hasSecret&&Boolean(settings.directorySyncedAt)}/>}
    {message && <p className={styles.message} role="status">{message}</p>}
  </section>
}

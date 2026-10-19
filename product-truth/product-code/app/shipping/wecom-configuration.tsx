'use client'
import { useEffect, useRef, useState } from 'react'
import { Building2, RefreshCw, ShieldCheck } from 'lucide-react'
import type { WecomSettings, WecomMember, WecomConfigDraft } from '@/lib/shipping/wecom-settings'
import WecomBotConfiguration from './wecom-bot-configuration'
import styles from './config-drawer.module.css'
import ui from './wecom-configuration.module.css'

type Reply = { settings: WecomSettings; members: WecomMember[]; draft?: WecomConfigDraft | null }
async function request(body?: unknown): Promise<Reply> {
  const response = await fetch('/api/shipping/wecom', { ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' }) })
  const data = await response.json()
  if (!response.ok || !data.settings) throw new Error(data.error || '企业接入暂不可用，请稍后重试。')
  return data
}

export default function WecomConfiguration({ onMessage }: { onMessage?: (message: string) => void }) {
  const [settings, setSettings] = useState<WecomSettings | null>(null)
  const [editor, setEditor] = useState<WecomSettings | null>(null)
  const [members, setMembers] = useState<WecomMember[]>([])
  const [draft, setDraft] = useState<WecomConfigDraft | null>(null)
  const [secret, setSecret] = useState(''), [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false), [message, setMessage] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [editorDraftId, setEditorDraftId] = useState<string | null>(null)
  const editorDetails = useRef<HTMLDetailsElement>(null), running = useRef(false)

  function receive(data: Reply) {
    setSecret(''); setDirty(false); setSettings(data.settings); setEditor(data.settings)
    setEditorDraftId(null); setMembers(data.members || []); setConfirmed(false)
    if (data.draft !== undefined) setDraft(data.draft)
  }
  useEffect(() => {
    let active = true
    request().then(data => { if (active) receive(data) }).catch(error => { if (active) setMessage(error.message) })
    return () => { active = false }
  }, [])
  async function act(body: unknown, success: string) {
    if (running.current) return false
    running.current = true; setBusy(true); setMessage(''); onMessage?.('')
    try { receive(await request(body)); setMessage(success); onMessage?.(success); return true }
    catch (error) { setMessage((error as Error).message); onMessage?.((error as Error).message); return false }
    finally { running.current = false; setBusy(false) }
  }
  async function prepare() {
    if (!editor) return
    await act({ action: 'prepare', settings: { corpId: editor.corpId, agentId: editor.agentId, orderCheckMode: 1, fallbackPhone: editor.fallbackPhone, deniedMessage: editor.deniedMessage, expectedUpdatedAt: editor.updatedAt, ...(editorDraftId ? { draftId: editorDraftId } : {}), ...(secret ? { secret } : {}) } }, '连接测试通过，配置已准备。核对下方生效范围后启用；当前连接保持不变。')
  }
  const eligible = members.filter(member => member.is_active && member.wecom_allowed).length
  const sameEnterprise = Boolean(draft && settings?.corpId === draft.corpId)
  const historicalScope = settings?.allowedDepartmentIds === null ? '沿用已授权成员' : settings?.allowedDepartmentIds.length === 0 ? '当前未开放成员提报' : '沿用已有部门范围'
  return <section className={styles.section} aria-label="企业接入">
    <div className={styles.sectionTitle}><div><Building2 size={18}/><h3>企微自建应用</h3></div><span>员工身份认证</span></div>
    <p className={styles.hint}>用于员工登录和寄件提报。</p>
    {!settings && <p role="status">{message || '正在读取企业连接…'}</p>}
    {settings && editor && <>
      <div className={ui.connection}>
        <span className={ui.icon}><Building2 size={20}/></span>
        <div><strong>{settings.hasSecret ? settings.companyName || settings.corpId : '尚未连接企业'}</strong><p>{settings.hasSecret ? `AgentID ${settings.agentId}` : '填写 CorpID、AgentID 和应用 Secret。'}</p></div>
        <span className={ui.status}>{settings.hasSecret ? settings.directorySyncedAt ? '已保存连接' : '待核对成员范围' : '待配置'}</span>
      </div>
      <details ref={editorDetails} open={!editor.hasSecret}>
        <summary>{settings.hasSecret ? '配置 / 更换企业应用' : '连接企业应用'}</summary>
        <fieldset className={styles.formGroup} disabled={busy} onChange={() => setDirty(true)}>
          <div className={styles.twoColumns}>
            <label>企业ID（CorpID）<input autoComplete="off" value={editor.corpId} onChange={event => setEditor({ ...editor, corpId: event.target.value })}/></label>
            <label>应用ID（AgentID）<input type="number" min="1" value={editor.agentId || ''} onChange={event => setEditor({ ...editor, agentId: Number(event.target.value) || null })}/></label>
          </div>
          <label>应用密钥（Secret）<input type="password" autoComplete="new-password" value={secret} onChange={event => setSecret(event.target.value)} placeholder={editor.hasSecret ? '已加密保存；同一应用留空保持' : '填写自建应用密钥'}/></label>
          <p className={styles.hint}>访问令牌由系统自动获取，无需填写。</p>
          <details><summary>提报选项（可选）</summary><label>预置寄件电话（可选）<input type="tel" value={editor.fallbackPhone} onChange={event => setEditor({ ...editor, fallbackPhone: event.target.value })}/></label>
          <p className={styles.hint}>员工未提供电话时使用此号码。</p>
          <label>无法提报时的提示<input value={editor.deniedMessage} maxLength={200} onChange={event => setEditor({ ...editor, deniedMessage: event.target.value })}/></label></details>
          <div className={styles.actions}><button type="button" onClick={() => void prepare()}>{busy ? '处理中…' : '测试并准备配置'}</button>{dirty && <button type="button" className={styles.secondary} onClick={() => { setEditor(settings); setSecret(''); setDirty(false); setEditorDraftId(null) }}>还原本次编辑</button>}</div>
        </fieldset>
      </details>
      {draft && <section className={ui.pending} aria-label="待启用企业配置">
        <h4>待启用：{draft.companyName || draft.corpId}</h4>
        <p>{draft.appName || '企业应用'} · {draft.agentId} · 已读取 {draft.memberCount} 位有效成员</p>
        <p>{sameEnterprise ? '更新后保留现有提报范围，不新增人员授权。' : '新企业按此应用的可见范围开放员工提报；原企业登录会话失效，历史工单保留原归属。'}</p>
        <label className={styles.checkbox}><input type="checkbox" checked={confirmed} disabled={busy || dirty} onChange={event => setConfirmed(event.target.checked)}/>{sameEnterprise ? '已核对企业与应用，保留现有提报范围' : '已在企微后台核对该应用的可见范围'}</label>
        <p className={styles.hint}>待启用配置 30 分钟有效。启用时会再次核对企业资料。</p>
        <div className={styles.actions}>
          <button type="button" disabled={busy || dirty || !confirmed} onClick={() => void act({ action: 'activate', draftId: draft.id, scopeMode: sameEnterprise ? 'preserve' : 'application' }, '企业连接已启用，网页与机器人按同一成员规则核对身份。')}>启用此配置</button>
          <button type="button" className={styles.secondary} disabled={busy} onClick={() => { setSecret(''); setEditor({ ...settings, corpId: draft.corpId, agentId: draft.agentId, orderCheckMode: 1, fallbackPhone: draft.fallbackPhone, deniedMessage: draft.deniedMessage }); setEditorDraftId(draft.id); setDirty(true); setConfirmed(false); if (editorDetails.current) editorDetails.current.open = true }}>继续编辑</button>
          <button type="button" className={styles.secondary} disabled={busy} onClick={() => void act({ action: 'discard', draftId: draft.id }, '待启用配置已放弃，当前连接保持不变。')}>放弃待启用配置</button>
        </div>
      </section>}
      <details><summary>企微后台设置</summary><p className={styles.hint}>在企微后台设置应用可见范围、网页授权可信域名及所需可信 IP。</p>{settings.redirectDomain && <p className={ui.domain}>网页授权可信域名：{settings.redirectDomain}</p>}</details>
      <div className={ui.access}>
        <div className={styles.sectionTitle}><div><ShieldCheck size={17}/><h4>提报范围</h4></div><span>只读</span></div>
        <div className={ui.facts}><span>{historicalScope}</span><span>上次核对：{eligible} 位可提报成员</span></div>
        <div className={ui.sync}><small>资料核对时间：{settings.directorySyncedAt ? new Date(settings.directorySyncedAt).toLocaleString('zh-CN') : '尚未核对'}</small><button type="button" className={styles.secondary} disabled={busy || dirty || !settings.hasSecret} onClick={() => void act({ action: 'sync' }, '企业成员状态已刷新，原有提报范围保持不变。')}><RefreshCw size={14}/>刷新成员状态</button></div>
        {dirty && <p className={styles.hint}>当前有未保存编辑，请先测试配置或还原编辑，再刷新成员状态。</p>}
      </div>
    </>}
    <WecomBotConfiguration corpId={settings?.corpId || ''} ready={Boolean(settings?.hasSecret && settings.directorySyncedAt)}/>
    {settings && message && <p className={styles.message} role="status">{message}</p>}
  </section>
}

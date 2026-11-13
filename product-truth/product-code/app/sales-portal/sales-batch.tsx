'use client'

import { useMemo, useRef, useState, type ReactNode } from 'react'
import { parseShippingText, prepareBatchRecipient } from '@/lib/shipping/batch-text'
import { intakeFieldSchema, type IntakeRules } from '@/lib/shipping/intake-rules'
import { contactSchema, ownerOrderSchema } from '@/lib/shipping/validation'
import type { BatchDraftRow } from '@/lib/shipping/import-parser'
import type { Contact } from '@/lib/shipping/types'
import MyWorkorders from './my-workorders'
import styles from './sales-portal.module.css'

type Result = 'pending' | 'unknown' | 'success' | 'failed' | 'conflict'
type Row = Omit<BatchDraftRow, 'result' | 'error'> & { weight: string; preference: 'standard' | 'urgent'; result?: Result; orderNo?: string; error?: string; frozenPayload?: string }

export default function SalesBatchProposal({ sender, team, rules, accessReady, accessHint, identityControls, accessControls, connectionStatus }: {
  sender: Contact; team: string; rules: IntakeRules; accessReady: boolean; accessHint?: string
  identityControls?: ReactNode; accessControls?: ReactNode; connectionStatus?: string
}) {
  const [raw, setRaw] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [preview, setPreview] = useState(false)
  const [previewSenderKey, setPreviewSenderKey] = useState('')
  const [recordRefresh, setRecordRefresh] = useState(0)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const running = useRef(false)
  const senderReady = contactSchema.safeParse(sender).success
  const senderKey = JSON.stringify([sender, team])
  const previewCurrent = preview && previewSenderKey === senderKey

  const prepared = useMemo(() => rows.map(row => {
    const parsed = prepareBatchRecipient({ ...row, result: undefined })
    const company = intakeFieldSchema(rules.companyName, '公司名称', 120, []).safeParse(row.customerName)
    const assignedTeam = intakeFieldSchema(rules.team, '所属团队', 80, rules.teamOptions).safeParse(row.team)
    const errors = [...parsed.errors,
      ...(company.success ? [] : company.error.issues.map(issue => issue.message)),
      ...(assignedTeam.success ? [] : assignedTeam.error.issues.map(issue => issue.message))]
    const input = { sender, recipient: parsed.recipient, customerName: row.customerName?.trim() || '',
      submittedBy: { name: sender.name, phone: sender.phone, team: row.team?.trim() || '' },
      cargo: row.cargo.trim(), weight: Number(row.weight), servicePreference: row.preference,
      remark: '', source: 'manual' as const, payment: 'sender_monthly' as const }
    const submission = ownerOrderSchema.safeParse({ key: row.key, input })
    if (!submission.success) errors.push(...submission.error.issues.map(issue => issue.message))
    return { row, recipient: parsed.recipient, errors: [...new Set(errors)], payload: submission.success ? JSON.stringify(submission.data) : null }
  }), [rows, rules, sender])
  const ready = prepared.filter(({ row, errors }) => !errors.length && !row.result)
  const invalid = prepared.filter(({ errors }) => errors.length).length
  const uncertain = rows.some(row => row.result === 'unknown' || row.result === 'pending' || row.result === 'conflict')

  function parse() {
    if (running.current || rows.some(row => ['success', 'unknown', 'pending', 'conflict'].includes(row.result || ''))) {
      setMessage('请先核对当前批次的提报结果，再开始新一批。')
      return
    }
    try {
      const parsed = parseShippingText(raw).map(row => ({ ...row, team: row.team || team, weight: '1', preference: 'standard' as const }))
      setRows(parsed); setPreview(false)
      setMessage(parsed.length ? `已识别 ${parsed.length} 票，请逐票核对收件人、地址和客户。` : '没有识别出寄件地址，请补充姓名、电话与完整地址。')
    } catch (error) { setMessage(error instanceof Error ? error.message : '地址解析失败。') }
  }
  function edit(id: number, field: 'recipient' | 'phone' | 'address' | 'customerName' | 'team' | 'cargo' | 'weight' | 'preference', value: string) {
    setPreview(false)
    setRows(current => current.map(row => row.id !== id || ['pending', 'unknown', 'success', 'conflict'].includes(row.result || '')
      ? row : { ...row, [field]: value, key: row.result === 'failed' ? crypto.randomUUID() : row.key,
        result: undefined, error: undefined, frozenPayload: undefined }))
  }
  function updateResult(id: number, update: Partial<Row>) {
    setRows(current => current.map(row => row.id === id ? { ...row, ...update } : row))
  }
  async function send(id: number, payload: string): Promise<boolean> {
    updateResult(id, { result: 'pending', frozenPayload: payload, error: undefined })
    try {
      const response = await fetch('/api/shipping/owner/orders', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: payload })
      const data = await response.json()
      if (response.status === 409) { updateResult(id, { result: 'conflict', error: '原请求与当前资料不一致。请在本人记录中核对原工单，避免重复提报。' }); return false }
      if (!response.ok && [400, 401, 403, 422, 429].includes(response.status)) {
        updateResult(id, { result: 'failed', error: data.error || '本票未提交，请修改后重试。', frozenPayload: undefined }); return false
      }
      if (!response.ok || typeof data.orderNo !== 'string' || !data.orderNo || typeof data.status !== 'string') throw new Error('回执尚未确认')
      updateResult(id, { result: 'success', orderNo: data.orderNo, error: undefined, frozenPayload: undefined })
      return true
    } catch {
      updateResult(id, { result: 'unknown', error: '暂未收到明确回执，原请求已保留。请重取回执，勿重新生成本票。' })
      return false
    }
  }
  async function submit() {
    if (running.current || !previewCurrent || !accessReady || !senderReady || !ready.length) return
    running.current = true; setBusy(true); setMessage('')
    try {
      let succeeded = false
      for (const item of ready) if (item.payload) succeeded = await send(item.row.id, item.payload) || succeeded
      if (succeeded) setRecordRefresh(current => current + 1)
    } finally { running.current = false; setBusy(false); setPreview(false) }
  }
  async function retry(id: number) {
    const payload = rows.find(row => row.id === id && row.result === 'unknown')?.frozenPayload
    if (!payload || running.current) return
    running.current = true; setBusy(true)
    try { if (await send(id, payload)) setRecordRefresh(current => current + 1) } finally { running.current = false; setBusy(false) }
  }

  return <main className={styles.page}>
    <header className={styles.header}><div className={styles.brand}><span>O</span><div><strong>自助收寄</strong><small>销售多票提报</small></div></div><div className={styles.secure}>纷享身份已验证 · 顺丰连接{connectionStatus === 'connected' ? '已验证' : connectionStatus === 'failed' ? '待维护' : connectionStatus === 'unconfigured' ? '待配置' : '待验证'}</div></header>
    <div className={styles.hero}><div><p>SALES SHIPPING REQUEST</p><h1>批量发起寄件</h1><span>粘贴多位收件人，逐票核对后提交待确认工单。</span></div></div>
    {identityControls && <div className={styles.identityContainer}>{identityControls}</div>}
    <div className={styles.workspace}><div className={styles.form}>
      {accessControls && <div className={styles.accessControls}>{accessControls}</div>}
      <section className={styles.card}><h2>智能地址批量识别</h2><p className={styles.hint}>复用操作员的地址识别规则；一人一段，空行可分票，最多 200 票。不会自动发顺丰运单。</p>
        <textarea aria-label="多票地址文本" rows={7} maxLength={100000} value={raw} disabled={busy || uncertain} onChange={event => setRaw(event.target.value)} placeholder={'姓名：张三\n电话：13900000000\n地址：广东省深圳市南山区示例路88号\n\n姓名：李四\n电话：13800000000\n地址：上海市浦东新区示例路66号'}/>
        <div className={styles.batchActions}><button type="button" disabled={!raw.trim() || busy || uncertain} onClick={parse}>解析为寄件行</button>{rows.length > 0 && !uncertain && <button type="button" disabled={busy} onClick={() => { setRows([]); setRaw(''); setPreview(false); setMessage('') }}>开始新一批</button>}</div>
        {message && <p role="status">{message}</p>}{!senderReady && <p role="alert">请先补齐上方寄件地址，再提交。</p>}{!accessReady && accessHint && <p role="status">{accessHint}</p>}
      </section>
      {rows.length > 0 && <section className={styles.card}><h2>逐票核对 · {rows.length} 票</h2><p className={styles.hint}>{invalid} 票资料待修正；资料完整的票可先提交。客户公司和团队按当前提报规则填写。</p>
        <div className={styles.batchRows}>{prepared.map(({ row, recipient, errors }) => <div key={row.id}><fieldset className={styles.batchRow} disabled={busy || ['pending', 'unknown', 'success', 'conflict'].includes(row.result || '')}>
          <legend>第 {row.id} 票 {row.result === 'success' ? `· 已提报 ${row.orderNo}` : row.result === 'unknown' ? '· 回执待查' : row.result === 'conflict' ? '· 原请求冲突' : ''}</legend>
          <div className={styles.grid2}><label>收件人<input aria-label={`第${row.id}票收件人`} value={row.recipient} onChange={event => edit(row.id, 'recipient', event.target.value)}/></label><label>联系电话<input aria-label={`第${row.id}票联系电话`} value={row.phone} onChange={event => edit(row.id, 'phone', event.target.value)}/></label></div>
          <label>收件地址<textarea aria-label={`第${row.id}票收件地址`} rows={2} value={row.address} onChange={event => edit(row.id, 'address', event.target.value)}/></label>
          <div className={styles.grid2}>{rules.companyName.enabled && <label>客户公司<input aria-label={`第${row.id}票客户公司`} value={row.customerName || ''} onChange={event => edit(row.id, 'customerName', event.target.value)}/></label>}{rules.team.enabled && <label>所属团队<input aria-label={`第${row.id}票所属团队`} value={row.team || ''} onChange={event => edit(row.id, 'team', event.target.value)}/></label>}</div>
          <div className={styles.grid3}><label>托寄物<input aria-label={`第${row.id}票托寄物`} value={row.cargo} onChange={event => edit(row.id, 'cargo', event.target.value)}/></label><label>重量 kg<input aria-label={`第${row.id}票重量`} type="number" min="0.01" max="20" step="0.01" value={row.weight} onChange={event => edit(row.id, 'weight', event.target.value)}/></label><label>服务偏好<select aria-label={`第${row.id}票服务偏好`} value={row.preference} onChange={event => edit(row.id, 'preference', event.target.value)}><option value="standard">标快偏好</option><option value="urgent">特快偏好</option></select></label></div>
          <p className={styles.hint}>识别结果：{recipient.province}{recipient.city}{recipient.county}{recipient.address}</p>
          {errors.length > 0 && <p className={styles.error} role="alert">{errors.join('；')}</p>}{row.error && <p className={styles.error} role="alert">{row.error}</p>}
        </fieldset>{row.result === 'unknown' && <button type="button" disabled={busy} onClick={() => void retry(row.id)}>重取第 {row.id} 票工单回执</button>}</div>)}</div>
        {previewCurrent && ready.length > 0 && <section aria-label="多票提报预览" className={styles.batchPreview}><h3>本次将提报 {ready.length} 票</h3><p>寄件人：{sender.name} · {sender.phone} · {sender.province}{sender.city}{sender.county}{sender.address}</p><ul>{ready.map(({ row, recipient }) => <li key={row.id}>第 {row.id} 票：{recipient.name} · {recipient.phone} · {recipient.province}{recipient.city}{recipient.county}{recipient.address} · {row.customerName || '未填客户'} · {row.cargo} · {row.weight} kg</li>)}</ul><small>只创建待确认工单；操作员核对后才可能向顺丰下单。</small></section>}
        <div className={styles.batchActions}><button type="button" disabled={!ready.length || !accessReady || !senderReady || busy} onClick={() => { setPreviewSenderKey(senderKey); setPreview(true) }}>预览 {ready.length} 票</button><button type="button" disabled={!previewCurrent || !ready.length || !accessReady || !senderReady || busy} onClick={() => void submit()}>{busy ? '提报中…' : `确认提交 ${ready.length} 票`}</button></div>
      </section>}
    </div><aside className={styles.records} aria-label="提报记录"><section className={styles.summaryCard}><h2>我的提报记录</h2><MyWorkorders scope="owner" refreshKey={recordRefresh}/></section></aside></div>
  </main>
}

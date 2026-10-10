'use client'

import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowRight, Building2, CheckCircle2, ClipboardPaste, Package, Sparkles, UserRound } from 'lucide-react'
import { parseAddress } from '@/lib/shipping/address'
import { anonymousShipmentSchema } from '@/lib/shipping/validation'
import { normalizeDomesticShippingPhone } from '@/lib/shipping/phone'
import { emptyContact, type Contact, type ShipmentReceipt, type ShipmentOrderStatus } from '@/lib/shipping/types'
import styles from './sales-portal.module.css'
import EmployeeAccess, { type EmployeeProfile } from './employee-access'

const receiptLabels: Record<ShipmentOrderStatus, string> = { accepted: '工单已受理', awaiting_confirmation: '待操作员审核确认', returned: '工单已退回', confirmed: '工单已确认', ordering: '正式下单中', order_unknown: '下单结果待确认', waybill_created: '运单已生成', in_transit: '运输中', delivered: '已签收', cancelled: '运单已取消', order_failed: '下单未成功' }

export default function SalesPortal() {
  return <EmployeeAccess>{({ employee, controls, canSubmit, sessionKey }) => <SalesRequestForm key={sessionKey} employee={employee} accessControls={controls} accessReady={canSubmit}/>}</EmployeeAccess>
}
export function SalesRequestForm({ employee, accessControls, accessReady = Boolean(employee?.sender) }: { employee: EmployeeProfile | null; accessControls?: ReactNode; accessReady?: boolean }) {
  const sender = employee?.sender || emptyContact()
  const submitter = { name: sender.name, phone: sender.phone, team: employee?.team || '' }
  const [customerName, setCustomerName] = useState('')
  const [recipient, setRecipient] = useState<Contact>(emptyContact)
  const [rawAddress, setRawAddress] = useState('')
  const senderAddress = `${sender.province}${sender.city}${sender.county}${sender.address}`
  const [cargo, setCargo] = useState('合同')
  const [weight, setWeight] = useState('1')
  const [servicePreference, setServicePreference] = useState<'standard' | 'urgent'>('standard')
  const [specialRequirements, setSpecialRequirements] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const pendingSubmission = useRef<string | null>(null)
  const submissionRunning = useRef(false)
  const [receipt, setReceipt] = useState<(ShipmentReceipt & { receiptToken?: string }) | null>(null)

  function setRecipientField(key: keyof Contact, value: string) { setRecipient(current => ({ ...current, [key]: value })) }
  function recognize() {
    const result = parseAddress(rawAddress)
    setRecipient(result.contact)
    setError(result.warnings.join(' '))
    setPreview(false)
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (submissionRunning.current) return
    setError('')
    if (!accessReady || !employee?.sender) { setError('请先验证公司邮箱并保存寄件资料，已填信息会保留。'); return }
    if (!uncertain) {
      const query = new URLSearchParams(window.location.search)
      const sender = employee.sender
      const submission = anonymousShipmentSchema.safeParse({ key: crypto.randomUUID(), rawInput: rawAddress || undefined, contextToken: query.get('context') || undefined, businessCode: query.get('code') || undefined, input: { sender, recipient, cargo, weight: Number(weight), servicePreference, remark: '', source: 'manual', payment: 'sender_monthly', customerName, submittedBy: { ...submitter, name: sender.name, phone: sender.phone }, specialRequirements } })
      if (!submission.success) { setError(submission.error.issues.map(issue => issue.message).join('；')); return }
      if (!preview) { setPreview(true); return }
      pendingSubmission.current = JSON.stringify(submission.data)
    }
    if (!pendingSubmission.current) return
    submissionRunning.current = true
    setBusy(true)
    try {
      const response = await fetch('/api/shipping/public/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: pendingSubmission.current })
      const data = await response.json()
      if (!response.ok && [400, 401, 403, 422, 429].includes(response.status)) { pendingSubmission.current = null; setUncertain(false); setPreview(false); setError(data.error || '请核对工单资料'); return }
      if (!response.ok || typeof data.orderNo !== 'string' || !data.orderNo || data.orderNo.length > 80 || typeof data.status !== 'string' || !Object.hasOwn(receiptLabels, data.status) || (data.waybill != null && (typeof data.waybill !== 'string' || data.waybill.length > 80))) throw new Error('暂未确认工单提交结果，请使用原请求重取回执。')
      setReceipt(data)
      pendingSubmission.current = null; setUncertain(false)
    } catch { setUncertain(true); setError('暂未确认工单提交结果，原请求已保留。请重取工单回执，避免重复提报。') } finally { submissionRunning.current = false; setBusy(false) }
  }

  if (receipt) return <main className={styles.page}><section className={styles.successCard}><div className={styles.successIcon}><CheckCircle2 size={34}/></div><p>工单已受理</p><h1>{receiptLabels[receipt.status]}</h1><span>工单编号</span><strong>{receipt.orderNo}</strong>{receipt.waybill && <><span>承运商运单号</span><strong>{receipt.waybill}</strong></>}<small>操作员确认后才会向顺丰下单并请求揽收。如需补充资料，请提供此工单编号。</small><button onClick={() => { setReceipt(null); setRecipient(emptyContact()); setRawAddress(''); setCustomerName(''); setSpecialRequirements(''); setPreview(false) }}>继续提报一票</button></section></main>

  return <main className={styles.page}>
    <header className={styles.header}><div className={styles.brand}><span>O</span><div><strong>自助收寄</strong><small>销售寄件提报</small></div></div><div className={styles.secure}>{employee ? '公司邮箱已验证' : '匿名访问 · 验证后提报'}</div></header>
    <div className={styles.hero}><div><p>SALES SHIPPING REQUEST</p><h1>把寄件信息交给前台，<br/>剩下的流程我们来处理。</h1><span>填写客户和收件信息，提交后即可获得业务流水号。</span></div><div className={styles.steps}><span className={styles.current}>1 填写信息</span><i/><span>2 前台确认</span><i/><span>3 快递揽收</span></div></div>
    {accessControls && <div className={`${styles.form} ${styles.accessControls}`}>{accessControls}</div>}
    <form className={styles.form} onSubmit={submit} onChange={() => setPreview(false)}>
      <fieldset className={styles.fields} disabled={busy || uncertain}>
      {!accessControls && <section className={styles.card}><div className={styles.cardTitle}><UserRound size={18}/><div><h2>我的寄件资料</h2><p>已保存，操作员确认后按此地址联系上门揽收</p></div></div><p>{submitter.name} · {submitter.phone} · {submitter.team}</p><p>{senderAddress}</p></section>}
      <section className={styles.card}><div className={styles.cardTitle}><Building2 size={18}/><div><h2>客户与收件信息</h2><p>客户、收件人和城市会显示在前台待办卡片</p></div></div><label className={styles.customer}>客户名称<input required maxLength={120} value={customerName} onChange={event => setCustomerName(event.target.value)} placeholder="公司或项目客户名称"/></label><div className={styles.paste}><div><ClipboardPaste size={16}/><strong>智能地址一键粘贴</strong><span>把微信里的整段地址直接贴进来</span></div><textarea aria-label="智能地址一键粘贴" rows={3} value={rawAddress} onChange={event => setRawAddress(event.target.value)} placeholder="例如：张三 13800138000 广东省深圳市南山区科苑路15号"/><button type="button" onClick={recognize}><Sparkles size={14}/>识别并填充</button></div><div className={styles.grid2}><label>收件人<input required value={recipient.name} onChange={event => setRecipientField('name', event.target.value)}/></label><label>联系电话<input required value={recipient.phone} onChange={event => setRecipientField('phone', event.target.value)}/></label></div><div className={styles.grid3}><label>省份<input required value={recipient.province} onChange={event => setRecipientField('province', event.target.value)}/></label><label>城市<input required value={recipient.city} onChange={event => setRecipientField('city', event.target.value)}/></label><label>区县<input required value={recipient.county} onChange={event => setRecipientField('county', event.target.value)}/></label></div><label>详细地址<input required value={recipient.address} onChange={event => setRecipientField('address', event.target.value)}/></label></section>
      <section className={styles.card}><div className={styles.cardTitle}><Package size={18}/><div><h2>物品与特殊需求</h2><p>特殊要求会醒目标记给前台确认</p></div></div><div className={styles.grid3}><label>托寄物<select value={cargo} onChange={event => setCargo(event.target.value)}><option>发票</option><option>合同</option><option>样品</option><option>礼品</option><option>其他</option></select></label><label>预估重量（kg）<input type="number" min="0.01" max="20" step="0.01" value={weight} onChange={event => setWeight(event.target.value)}/></label><label>时效偏好<select value={servicePreference} onChange={event => setServicePreference(event.target.value as typeof servicePreference)}><option value="standard">标准</option><option value="urgent">加急</option></select></label></div><label>我的特殊需求（选填）<textarea rows={3} maxLength={500} value={specialRequirements} onChange={event => setSpecialRequirements(event.target.value)} placeholder="例如：周五前送达、样品易碎、上门前联系、随件附带某份资料……"/><span className={styles.counter}>{specialRequirements.length}/500</span></label></section>
      </fieldset>
      {preview && <section className={styles.card} aria-label="寄出预览"><h2>寄出预览</h2><p>寄件人：{submitter.name} · {normalizeDomesticShippingPhone(submitter.phone)} · {senderAddress}</p><p>收件人：{recipient.name} · {recipient.phone} · {recipient.province}{recipient.city}{recipient.county}{recipient.address}</p><p>{customerName} · {cargo} · {weight} kg · {servicePreference === 'urgent' ? '加急偏好' : '标准偏好'}</p>{specialRequirements && <p>{specialRequirements}</p>}<small>此步只提交工单；审核确认、正式下单和叫件由操作员完成。</small></section>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      <footer className={styles.submit}><div><CheckCircle2 size={16}/><span>提交只会进入前台待确认池，不会直接产生运费。</span></div><button disabled={busy || !accessReady}>{busy ? '提交中…' : uncertain ? '重取工单回执' : preview ? '确认提交工单' : '预览工单'}<ArrowRight size={16}/></button></footer>
    </form>
  </main>
}

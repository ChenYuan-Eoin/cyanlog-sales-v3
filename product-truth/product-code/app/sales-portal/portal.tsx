'use client'

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowRight, Building2, CheckCircle2, ClipboardPaste, Package, Sparkles, UserRound } from 'lucide-react'
import { parseAddress } from '@/lib/shipping/address'
import { DEFAULT_INTAKE_RULES, type IntakeRules } from '@/lib/shipping/intake-rules'
import { makeAnonymousShipmentSchema } from '@/lib/shipping/validation'
import { normalizeDomesticShippingPhone } from '@/lib/shipping/phone'
import { emptyContact, type Contact, type ShipmentReceipt, type ShipmentOrderStatus } from '@/lib/shipping/types'
import styles from './sales-portal.module.css'
import MyWorkorders from './my-workorders'
import EmployeeAccess, { type EmployeeProfile } from './employee-access'

import type { ShippingServiceOption } from '@/lib/shipping/sf-service-catalog'

const receiptLabels: Record<ShipmentOrderStatus, string> = { accepted: '工单已受理', awaiting_confirmation: '待操作员审核确认', returned: '工单已退回', confirmed: '工单已确认', ordering: '正式下单中', order_unknown: '下单结果待确认', waybill_created: '运单已生成', in_transit: '运输中', delivered: '已签收', cancelled: '运单已取消', order_failed: '下单未成功' }

type PortalOptions = { services: ShippingServiceOption[]; requireVerification: boolean; emailAvailable: boolean; rules?: IntakeRules }
export default function SalesPortal({ initialEmployee = null, initialOptions = null }: { initialEmployee?: EmployeeProfile | null; initialOptions?: PortalOptions | null } = {}) {
  const [lookupToken, setLookupToken] = useState('')
  useEffect(() => { const read = () => { const token = new URLSearchParams(window.location.hash.slice(1)).get('receipt') || ''; setLookupToken(/^[A-Za-z0-9_-]{40,80}$/.test(token) ? token : '') }; read(); window.addEventListener('hashchange', read); return () => window.removeEventListener('hashchange', read) }, [])
  const [options, setOptions] = useState<PortalOptions | null>(initialOptions)
  const [error, setError] = useState('')
  useEffect(() => { let active = true; fetch('/api/shipping/public/options', { cache: 'no-store' }).then(async response => { const body = await response.json(); if (!response.ok || !Array.isArray(body.services)) throw new Error(body.error || '提报设置暂不可用'); if (active) setOptions(body) }).catch(e => { if (active) setError(e.message) }); return () => { active = false } }, [])
  if (lookupToken) return <ReceiptLookup token={lookupToken}/>
  return <EmployeeAccess initialEmployee={initialEmployee} rules={options?.rules} requireVerification={options?.requireVerification ?? true} emailAvailable={options?.emailAvailable ?? false}>{({ employee, controls, canSubmit, unavailableReason, sessionKey, sender, team }) => <SalesRequestForm rules={options?.rules} key={sessionKey} employee={employee} accessControls={<>{controls}{error && <p role="alert" className={styles.error}>{error}</p>}</>} accessReady={Boolean(options && canSubmit)} accessHint={error || (!options ? '正在读取提报设置…' : unavailableReason)} draftSender={sender} draftTeam={team} services={options?.services}/>}</EmployeeAccess>
}
export function SalesRequestForm({ employee, accessControls, accessReady = Boolean(employee?.sender), draftSender, draftTeam, services, accessHint, rules = DEFAULT_INTAKE_RULES }: { employee: EmployeeProfile | null; accessControls?: ReactNode; accessReady?: boolean; accessHint?: string; rules?: IntakeRules; draftSender?: Contact; draftTeam?: string; services?: ShippingServiceOption[] }) {
  const senderContact = draftSender || employee?.sender || emptyContact()
  const sender = { ...senderContact, phone: normalizeDomesticShippingPhone(senderContact.phone) }
  const submitter = { name: sender.name, phone: sender.phone, team: draftTeam ?? employee?.team ?? '' }
  const [customerName, setCustomerName] = useState('')
  const [mobilePane, setMobilePane] = useState<'form' | 'records'>('form')
  const [recipient, setRecipient] = useState<Contact>(emptyContact)
  const [rawAddress, setRawAddress] = useState('')
  const senderAddress = `${sender.province}${sender.city}${sender.county}${sender.address}`
  const [cargo, setCargo] = useState('合同')
  const [weight, setWeight] = useState('1')
  const [serviceId, setServiceId] = useState('')
  const [servicePreference, setServicePreference] = useState<'standard' | 'urgent'>('standard')
  const [specialRequirements, setSpecialRequirements] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const pendingSubmission = useRef<string | null>(null)
  const submissionRunning = useRef(false)
  const pendingCredentials = useRef<RequestCredentials>('omit')
  const [receiptStatus, setReceiptStatus] = useState('')
  const [receipt, setReceipt] = useState<(ShipmentReceipt & { receiptToken?: string }) | null>(null)

  function setRecipientField(key: keyof Contact, value: string) { setRecipient(current => ({ ...current, [key]: value })) }
  function recognize() {
    const result = parseAddress(rawAddress)
    setRecipient(result.contact)
    setError(result.warnings.join(' '))
    setPreview(false)
  }
  const effectiveRules = employee?.wecom ? { ...rules, team: { enabled: true, required: true, minLength: 1 }, teamOptions: [] } : rules
  const draftInput = { sender, recipient, cargo, weight: Number(weight), ...(services ? { serviceId: Number(serviceId || services[0]?.id) } : { servicePreference }), remark: '', source: 'manual', payment: 'sender_monthly', customerName, submittedBy: { ...submitter, name: sender.name, phone: sender.phone }, specialRequirements }
  const draftResult = makeAnonymousShipmentSchema(effectiveRules).shape.input.safeParse(draftInput)
  const draftComplete = draftResult.success
  const fieldLabels: Record<string,string> = { 'recipient.name':'收件人', 'recipient.phone':'收件电话', 'recipient.province':'收件省份', 'recipient.city':'收件城市', 'recipient.county':'收件区县', 'recipient.address':'收件详细地址', customerName:'客户公司名称', cargo:'物品', weight:'预估重量', serviceId:'快递服务' }
  const draftProblems = draftResult.success ? [] : draftResult.error.issues.map(issue => `${fieldLabels[issue.path.join('.')] || '寄件资料'}：${issue.message}`)
  const recipientProblem = (field: keyof Contact) => !rawAddress.trim() || draftResult.success ? '' : draftResult.error.issues.filter(issue => issue.path.join('.') === `recipient.${field}`).map(issue => issue.message).join('；')
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (submissionRunning.current) return
    setError('')
    if (!accessReady) { setError('请补齐寄件资料并核对提报要求，已填信息会保留。'); return }
    if (!uncertain) {
      const query = new URLSearchParams(window.location.search)
      const submission = makeAnonymousShipmentSchema(effectiveRules).safeParse({ key: crypto.randomUUID(), rawInput: rawAddress || undefined, contextToken: query.get('context') || undefined, businessCode: query.get('code') || undefined, input: draftInput })
      if (!submission.success) { setError(submission.error.issues.map(issue => issue.message).join('；')); return }
      if (!preview) { setPreview(true); return }
      pendingSubmission.current = JSON.stringify(submission.data)
      pendingCredentials.current = employee ? 'same-origin' : 'omit'
    }
    if (!pendingSubmission.current) return
    submissionRunning.current = true
    setBusy(true)
    try {
      const response = await fetch('/api/shipping/public/orders', { credentials: pendingCredentials.current, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: pendingSubmission.current })
      const data = await response.json()
      if (!response.ok && [400, 401, 403, 422, 429].includes(response.status)) { pendingSubmission.current = null; setUncertain(false); setPreview(false); setError(data.error || '请核对工单资料'); return }
      if (!response.ok || typeof data.orderNo !== 'string' || !data.orderNo || data.orderNo.length > 80 || typeof data.status !== 'string' || !Object.hasOwn(receiptLabels, data.status) || (data.waybill != null && (typeof data.waybill !== 'string' || data.waybill.length > 80))) throw new Error('暂未确认工单提交结果，请使用原请求重取回执。')
      setReceipt(data)
      pendingSubmission.current = null; setUncertain(false)
    } catch { setUncertain(true); setError('暂未确认工单提交结果，原请求已保留。请重取工单回执，避免重复提报。') } finally { submissionRunning.current = false; setBusy(false) }
  }

  if (receipt) return <main className={styles.page}><section className={styles.successCard}><div className={styles.successIcon}><CheckCircle2 size={34}/></div><p>工单已受理</p><h1>{receiptLabels[receipt.status]}</h1><span>工单编号</span><strong>{receipt.orderNo}</strong>{receipt.waybill && <><span>承运商运单号</span><strong>{receipt.waybill}</strong></>}<small>操作员确认后才会向顺丰下单并请求揽收。如需补充资料，请提供此工单编号。</small>{receipt.receiptToken && <><button type="button" onClick={async () => { try { const response = await fetch(`/api/shipping/public/orders/${receipt.receiptToken}`, { cache: 'no-store' }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setReceipt(current => current ? { ...current, ...data } : current); setReceiptStatus('已刷新工单状态') } catch { setReceiptStatus('状态暂不可用，请稍后重试') } }}>刷新工单状态</button><button type="button" onClick={() => { void navigator.clipboard.writeText(`${window.location.origin}/sales-portal#receipt=${receipt.receiptToken}`).then(() => setReceiptStatus('查询链接已复制，请妥善保存，仅供本人使用')).catch(() => setReceiptStatus('复制失败，请重试')) }}>复制查询链接</button><p><a href={`/sales-portal#receipt=${receipt.receiptToken}`}>打开工单查询页（可收藏）</a></p><p role="status">{receiptStatus}</p></>}<button onClick={() => { setReceipt(null); setRecipient(emptyContact()); setRawAddress(''); setCustomerName(''); setSpecialRequirements(''); setPreview(false) }}>继续提报一票</button></section></main>

  return <main className={styles.page}>
    <header className={styles.header}><div className={styles.brand}><span>O</span><div><strong>自助收寄</strong><small>销售寄件提报</small></div></div><div className={styles.secure}>{employee?.wecom ? '企业微信身份已验证' : '开放提报 · 无需账号密码'}</div></header>
    <div className={styles.hero}><div><p>SALES SHIPPING REQUEST</p><h1>把寄件信息交给前台，<br/>剩下的流程我们来处理。</h1><span>填写客户和收件信息，提交后即可获得业务流水号。</span></div><div className={styles.steps}><span className={styles.current}>1 填写信息</span><i/><span>2 前台确认</span><i/><span>3 快递揽收</span></div></div>
    {employee && <nav className={styles.mobileNav} aria-label="提报与记录"><button type="button" aria-pressed={mobilePane === 'form'} onClick={() => setMobilePane('form')}>提报快递</button><button type="button" aria-pressed={mobilePane === 'records'} onClick={() => setMobilePane('records')}>我的提报记录</button></nav>}
    <div className={styles.workspace}>
    <div className={mobilePane === 'records' ? styles.mobileHidden : undefined}>
    {accessControls && <div className={`${styles.form} ${styles.accessControls}`}>{accessControls}</div>}
    <form className={styles.form} onSubmit={submit} onChange={() => setPreview(false)}>
      <fieldset className={styles.fields} disabled={busy || uncertain}>
      {!accessControls && <section className={styles.card}><div className={styles.cardTitle}><UserRound size={18}/><div><h2>我的寄件资料</h2><p>已保存，操作员确认后按此地址联系上门揽收</p></div></div><p>{submitter.name} · {submitter.phone} · {submitter.team}</p><p>{senderAddress}</p></section>}
      <section className={styles.card}><div className={styles.cardTitle}><Building2 size={18}/><div><h2>客户与收件信息</h2><p>客户、收件人和城市会显示在前台待办卡片</p></div></div>{rules.companyName.enabled && <label className={styles.customer}>客户公司名称<input required={rules.companyName.required} minLength={rules.companyName.minLength} maxLength={120} value={customerName} onChange={event => setCustomerName(event.target.value)} placeholder={`请填写公司名称，至少${rules.companyName.minLength}个字符`}/></label>}<div className={styles.paste}><div><ClipboardPaste size={16}/><strong>智能地址一键粘贴</strong><span>把微信里的整段地址直接贴进来</span></div><textarea aria-label="智能地址一键粘贴" rows={3} value={rawAddress} onChange={event => setRawAddress(event.target.value)} placeholder="例如：张三 13800138000 广东省深圳市南山区科苑路15号"/><button type="button" onClick={recognize}><Sparkles size={14}/>识别并填充</button></div><div className={styles.grid2}><label>收件人<input required value={recipient.name} aria-invalid={Boolean(recipientProblem('name'))} onChange={event => setRecipientField('name', event.target.value)}/>{recipientProblem('name') && <small className={styles.fieldError}>{recipientProblem('name')}</small>}</label><label>联系电话<input required value={recipient.phone} aria-invalid={Boolean(recipientProblem('phone'))} onChange={event => setRecipientField('phone', event.target.value)}/>{recipientProblem('phone') && <small className={styles.fieldError}>{recipientProblem('phone')}</small>}</label></div><div className={styles.grid3}><label>省份<input required value={recipient.province} aria-invalid={Boolean(recipientProblem('province'))} onChange={event => setRecipientField('province', event.target.value)}/>{recipientProblem('province') && <small className={styles.fieldError}>{recipientProblem('province')}</small>}</label><label>城市<input required value={recipient.city} aria-invalid={Boolean(recipientProblem('city'))} onChange={event => setRecipientField('city', event.target.value)}/>{recipientProblem('city') && <small className={styles.fieldError}>{recipientProblem('city')}</small>}</label><label>区县<input required value={recipient.county} aria-invalid={Boolean(recipientProblem('county'))} onChange={event => setRecipientField('county', event.target.value)}/>{recipientProblem('county') && <small className={styles.fieldError}>{recipientProblem('county')}</small>}</label></div><label>详细地址<input required value={recipient.address} aria-invalid={Boolean(recipientProblem('address'))} onChange={event => setRecipientField('address', event.target.value)}/>{recipientProblem('address') && <small className={styles.fieldError}>{recipientProblem('address')}</small>}</label></section>
      <section className={styles.card}><div className={styles.cardTitle}><Package size={18}/><div><h2>物品与特殊需求</h2><p>特殊要求会醒目标记给前台确认</p></div></div><div className={styles.grid3}><label>托寄物<select value={cargo} onChange={event => setCargo(event.target.value)}><option>发票</option><option>合同</option><option>样品</option><option>礼品</option><option>其他</option></select></label><label>预估重量（kg）<input type="number" min="0.01" max="20" step="0.01" value={weight} onChange={event => setWeight(event.target.value)}/></label><label>顺丰服务产品{services ? <select required value={serviceId || String(services[0]?.id || '')} onChange={event => setServiceId(event.target.value)}>{services.length ? services.map(item => <option key={item.id} value={item.id}>{item.name}</option>) : <option value="">暂无开放的服务，请联系操作员</option>}</select> : <select value={servicePreference} onChange={event => setServicePreference(event.target.value as typeof servicePreference)}><option value="standard">标准</option><option value="urgent">加急</option></select>}</label></div><label>我的特殊需求（选填）<textarea rows={3} maxLength={500} value={specialRequirements} onChange={event => setSpecialRequirements(event.target.value)} placeholder="例如：周五前送达、样品易碎、上门前联系、随件附带某份资料……"/><span className={styles.counter}>{specialRequirements.length}/500</span></label></section>
      </fieldset>
      {preview && <section className={styles.card} aria-label="寄出预览"><h2>寄出预览</h2><p>寄件人：{submitter.name} · {normalizeDomesticShippingPhone(submitter.phone)} · {senderAddress}</p><p>收件人：{recipient.name} · {recipient.phone} · {recipient.province}{recipient.city}{recipient.county}{recipient.address}</p><p>{customerName} · {cargo} · {weight} kg · {services?.find(item => item.id === Number(serviceId || services[0]?.id))?.name || (servicePreference === 'urgent' ? '加急偏好' : '标准偏好')}</p>{specialRequirements && <p>{specialRequirements}</p>}<small>此步只提交工单；审核确认、正式下单和叫件由操作员完成。</small></section>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {!accessReady && accessHint && <p role="status" className={styles.error}>{accessHint}</p>}{accessReady && !draftComplete && !uncertain && <p role="status" className={styles.error}>{draftResult.success ? '' : [...new Set(draftProblems)].join('；')}</p>}
      <footer className={styles.submit}><div><CheckCircle2 size={16}/><span>提交只会进入前台待确认池，不会直接产生运费。</span></div><button disabled={busy || !accessReady || (!uncertain && !draftComplete)}>{busy ? '提交中…' : uncertain ? '重取工单回执' : preview ? '确认提交工单' : '预览工单'}<ArrowRight size={16}/></button></footer>
    </form>
    </div>
    {employee && <aside aria-label="我的提报记录" className={`${styles.records} ${mobilePane === 'form' ? styles.mobileHidden : ''}`}><h2>我的提报记录</h2><MyWorkorders key={employee.id}/></aside>}
    </div>
  </main>
}

function ReceiptLookup({ token }: { token: string }) {
  const [receipt, setReceipt] = useState<ShipmentReceipt | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  async function load() { setBusy(true); setError(''); try { const response = await fetch(`/api/shipping/public/orders/${encodeURIComponent(token)}`, { cache: 'no-store' }); const data = await response.json(); if (!response.ok || !data.orderNo || !Object.hasOwn(receiptLabels, data.status)) throw new Error(data.error || '回执暂不可用'); setReceipt(data) } catch (e) { setError(e instanceof Error ? e.message : '查询失败') } finally { setBusy(false) } }
  useEffect(() => { let active = true; setReceipt(null); setError(''); setBusy(true); fetch(`/api/shipping/public/orders/${encodeURIComponent(token)}`, { cache: 'no-store' }).then(async response => { const data = await response.json(); if (!response.ok || !data.orderNo || !Object.hasOwn(receiptLabels, data.status)) throw new Error(data.error || '回执暂不可用'); if (active) setReceipt(data) }).catch(e => { if (active) setError(e.message) }).finally(() => { if (active) setBusy(false) }); return () => { active = false } }, [token])
  return <main className={styles.page}><section className={styles.successCard}><h1>工单进度</h1>{receipt && <><strong>{receipt.orderNo}</strong><p>{receiptLabels[receipt.status]}</p>{receipt.waybill && <strong>{receipt.waybill}</strong>}</>}{error && <p role="alert">{error}</p>}<button type="button" disabled={busy} onClick={() => void load()}>{busy ? '查询中…' : '刷新进度'}</button><p><a href="/sales-portal">提报新工单</a></p><small>持有本链接即可查询这一票的状态；不会显示完整姓名、地址或其他人的工单。</small></section></main>
}

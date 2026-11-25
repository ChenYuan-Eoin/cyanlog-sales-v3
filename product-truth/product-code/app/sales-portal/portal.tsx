'use client'

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowRight, Building2, CheckCircle2, ClipboardPaste, Package, Sparkles, UserRound } from 'lucide-react'
import { parseAddress } from '@/lib/shipping/address'
import { parseShippingText, prepareBatchRecipient } from '@/lib/shipping/batch-text'
import { DEFAULT_INTAKE_RULES, type IntakeRules } from '@/lib/shipping/intake-rules'
import { makeAnonymousShipmentSchema, ownerOrderSchema } from '@/lib/shipping/validation'
import { normalizeDomesticShippingPhone } from '@/lib/shipping/phone'
import { emptyContact, type Contact, type ShipmentReceipt, type ShipmentOrderStatus } from '@/lib/shipping/types'
import styles from './sales-portal.module.css'
import MyWorkorders, { type ReturnedShipment, type RestoreOwnerRecord } from './my-workorders'
import EmployeeAccess, { type EmployeeProfile, type SaveCommonSender } from './employee-access'
import SalesBatchProposal, { type BatchReviewSummary } from './sales-batch'

import type { ShippingServiceOption } from '@/lib/shipping/sf-service-catalog'

const receiptLabels: Record<ShipmentOrderStatus, string> = { accepted: '工单已受理', awaiting_confirmation: '待操作员审核确认', returned: '工单已退回', resubmitted: '已重提', confirmed: '工单已确认', ordering: '正式下单中', order_unknown: '下单结果待确认', waybill_created: '运单已生成', in_transit: '运输中', delivered: '已签收', cancelled: '运单已取消', order_failed: '下单未成功' }

type PortalOptions = { companySender?: Contact | null; services: ShippingServiceOption[]; requireVerification: boolean; emailAvailable: boolean; rules?: IntakeRules }
export function AuthenticatedReceiptRoute({ children }: { children: ReactNode }) {
  const [lookupToken, setLookupToken] = useState('')
  useEffect(() => {
    const read = () => {
      const token = new URLSearchParams(window.location.hash.slice(1)).get('receipt') || ''
      setLookupToken(/^[A-Za-z0-9_-]{40,80}$/.test(token) ? token : '')
    }
    read()
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, [])
  return lookupToken ? <ReceiptLookup token={lookupToken}/> : children
}
export default function SalesPortal({ initialEmployee = null, initialOptions = null }: { initialEmployee?: EmployeeProfile | null; initialOptions?: PortalOptions | null } = {}) {
  const [lookupToken, setLookupToken] = useState('')
  useEffect(() => { const read = () => { const token = new URLSearchParams(window.location.hash.slice(1)).get('receipt') || ''; setLookupToken(/^[A-Za-z0-9_-]{40,80}$/.test(token) ? token : '') }; read(); window.addEventListener('hashchange', read); return () => window.removeEventListener('hashchange', read) }, [])
  const [options, setOptions] = useState<PortalOptions | null>(initialOptions)
  const [error, setError] = useState('')
  useEffect(() => { let active = true; fetch('/api/shipping/public/options', { cache: 'no-store' }).then(async response => { const body = await response.json(); if (!response.ok || !Array.isArray(body.services)) throw new Error(body.error || '提报设置暂不可用'); if (active) setOptions(body) }).catch(e => { if (active) setError(e.message) }); return () => { active = false } }, [])
  if (lookupToken) return <ReceiptLookup token={lookupToken}/>
  return <EmployeeAccess companySender={options?.companySender} initialEmployee={initialEmployee} rules={options?.rules} requireVerification={options?.requireVerification ?? false} emailAvailable={options?.emailAvailable ?? false}>{({ employee, controls, identityControls, canSubmit, unavailableReason, sessionKey, sender, team }) => <SalesRequestForm rules={options?.rules} key={sessionKey} employee={employee} identityControls={identityControls} accessControls={<>{controls}{error && <p role="alert" className={styles.error}>{error}</p>}</>} accessReady={Boolean(options && canSubmit)} accessHint={error || (!options ? '正在读取提报设置…' : unavailableReason)} draftSender={sender} draftTeam={team} services={options?.services}/>}</EmployeeAccess>
}
export function FxiaokeShippingProposal({ profile, rules, services, connectionStatus, ownerPermissions }: { profile: EmployeeProfile; rules: IntakeRules; services: ShippingServiceOption[]; connectionStatus?: string; ownerPermissions?: readonly string[] }) {
  const canSaveCommonSender = ownerPermissions === undefined || ownerPermissions.includes('shipping:owner_address_write')
  return <EmployeeAccess key={profile.id} mode="fxiaoke" requireVerification initialEmployee={profile} companySender={profile.senderChoices?.company} rules={rules} canSaveCommonSender={canSaveCommonSender}>
    {({ employee, controls, identityControls, canSubmit, unavailableReason, sessionKey, sender, team, departmentId, saveCommonSender }) =>
      <SalesRequestForm key={sessionKey} mode="fxiaoke" employee={employee} draftSender={sender} draftTeam={team} departmentId={departmentId} departments={employee?.departments || []} rules={rules} services={services}
        accessReady={canSubmit} accessHint={unavailableReason} identityControls={identityControls}
        accessControls={controls} connectionStatus={connectionStatus} saveCommonSender={saveCommonSender} ownerPermissions={ownerPermissions}/>}
  </EmployeeAccess>
}

type ReturnEdit = {
  order: ReturnedShipment
  finish: RestoreOwnerRecord
  close: () => void
}
type SalesFormProps = { departmentId?: string; departments?: Array<{ id: string; name: string; path: string }>; employee: EmployeeProfile | null; accessControls?: ReactNode; identityControls?: ReactNode; accessReady?: boolean; accessHint?: string; rules?: IntakeRules; draftSender?: Contact; draftTeam?: string; services?: ShippingServiceOption[]; mode?: 'public' | 'fxiaoke'; connectionStatus?: string; editing?: ReturnEdit; saveCommonSender?: SaveCommonSender; ownerPermissions?: readonly string[] }

export function SalesRequestForm(props: SalesFormProps) {
  const { employee, accessControls, accessReady = Boolean(employee?.sender), draftSender, draftTeam, services, accessHint, rules = DEFAULT_INTAKE_RULES, mode = 'public', departments, editing } = props
  const canSubmitNew = mode !== 'fxiaoke' || props.ownerPermissions === undefined || props.ownerPermissions.includes('shipping:owner_submit')
  const canResubmit = mode === 'fxiaoke' && (props.ownerPermissions === undefined || props.ownerPermissions.includes('shipping:owner_resubmit'))
  const original = editing?.order.input
  const [selectedReturn, setSelectedReturn] = useState<{ order: ReturnedShipment; restore: RestoreOwnerRecord } | null>(null)
  const [returnedSender, setReturnedSender] = useState<Contact>(() => original?.sender || draftSender || employee?.sender || emptyContact())
  const [savingCommonSender, setSavingCommonSender] = useState(false)
  const [commonSenderFeedback, setCommonSenderFeedback] = useState<{ error: boolean; text: string } | null>(null)
  const commonSender = employee?.senderChoices?.personal
  const [returnDepartment, setReturnDepartment] = useState(() => {
    const previous = original?.submittedBy?.departmentId
    return departments?.some(item => item.id === previous) ? previous : props.departmentId
  })
  const departmentId = editing ? returnDepartment : props.departmentId
  const senderContact = editing ? returnedSender : draftSender || employee?.sender || emptyContact()
  const sender = { ...senderContact, phone: normalizeDomesticShippingPhone(senderContact.phone) }
  const team = departments?.find(item => item.id === departmentId)?.name ?? draftTeam ?? employee?.team ?? ''
  const submitter = { name: sender.name, phone: sender.phone, team }
  const [batchText, setBatchText] = useState('')
  const [batchLocked, setBatchLocked] = useState(false)
  const [batchReview, setBatchReview] = useState<BatchReviewSummary | null>(null)
  const batchCount = batchText ? parseShippingText(batchText).length : 0
  const [recordRefresh, setRecordRefresh] = useState(0)
  const [customerName, setCustomerName] = useState(original?.customerName || '')
  const [mobilePane, setMobilePane] = useState<'form' | 'records'>('form')
  const [recipient, setRecipient] = useState<Contact>(() => original?.recipient || emptyContact())
  const [rawAddress, setRawAddress] = useState('')
  const senderAddress = `${sender.province}${sender.city === sender.province ? '' : sender.city}${sender.county}${sender.address}`
  const [cargo, setCargo] = useState(original?.cargo || '合同')
  const [weight, setWeight] = useState(String(original?.weight ?? 1))
  const [serviceId, setServiceId] = useState(() => {
    if (!original) return ''
    const previous = services?.find(item => item.id === original.serviceId)
      || services?.find(item => item.preference === original.servicePreference)
    return previous ? String(previous.id) : ''
  })
  const [servicePreference, setServicePreference] = useState<'standard' | 'urgent'>(original?.servicePreference || 'standard')
  const [specialRequirements, setSpecialRequirements] = useState(original?.specialRequirements || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const submissionHintId = useId()
  const senderKey = JSON.stringify([senderContact, team, departmentId])
  const [previewSenderKey, setPreviewSenderKey] = useState('')
  const previewCurrent = preview && previewSenderKey === senderKey
  const [uncertain, setUncertain] = useState(false)
  const pendingSubmission = useRef<string | null>(null)
  const submissionRunning = useRef(false)
  const pendingCredentials = useRef<RequestCredentials>('omit')
  const [receiptStatus, setReceiptStatus] = useState('')
  const [receipt, setReceipt] = useState<(ShipmentReceipt & { receiptToken?: string }) | null>(null)

  async function saveReturnedSender() {
    if (!props.saveCommonSender || savingCommonSender) return
    setSavingCommonSender(true)
    setCommonSenderFeedback(null)
    try {
      await props.saveCommonSender(senderContact, departmentId)
      setCommonSenderFeedback({ error: false, text: '揽收地址已保存为我的常用地址，下次可以直接选用。' })
    } catch (error) {
      setCommonSenderFeedback({ error: true, text: error instanceof Error ? error.message : '保存常用地址失败。' })
    } finally {
      setSavingCommonSender(false)
    }
  }

  function setRecipientField(key: keyof Contact, value: string) { setRecipient(current => ({ ...current, [key]: value })) }
  function recognize() {
    if (batchLocked) return
    if (mode === 'fxiaoke') {
      try {
        const rows = parseShippingText(rawAddress)
        if (rows.length > 1 && editing) { setError('重提只修改原来这一票，请一次粘贴一位收件人。'); return }
        if (rows.length > 1) { setBatchText(rawAddress); setPreview(false); setError(''); return }
        if (rows.length === 1) { const parsed = prepareBatchRecipient(rows[0]); setRecipient(parsed.recipient); if (rows[0].customerName) setCustomerName(rows[0].customerName); setBatchText(''); setError(parsed.errors.join('；')); setPreview(false); return }
      } catch (error) { setError(error instanceof Error ? error.message : '地址识别失败，已填资料保留。'); return }
    }
    const result = parseAddress(rawAddress)
    setRecipient(result.contact)
    setError(result.warnings.join(' '))
    setPreview(false)
  }
  const effectiveRules = employee?.wecom || mode === 'fxiaoke' ? { ...rules, team: { enabled: true, required: true, minLength: 1 }, teamOptions: [] } : rules
  const draftInput = { sender, recipient, cargo, weight: Number(weight), ...(services ? { serviceId: Number(serviceId || services[0]?.id), servicePreference: services.find(item => item.id === Number(serviceId || services[0]?.id))?.preference || 'standard' } : { servicePreference }), remark: '', source: 'manual', payment: 'sender_monthly', customerName, submittedBy: { ...submitter, name: sender.name, phone: sender.phone, ...(departmentId ? { departmentId } : {}) }, specialRequirements }
  const draftResult = makeAnonymousShipmentSchema(effectiveRules).shape.input.safeParse(draftInput)
  const draftComplete = draftResult.success
  const fieldLabels: Record<string,string> = { 'recipient.name':'收件人', 'recipient.phone':'收件电话', 'recipient.province':'收件省份', 'recipient.city':'收件城市', 'recipient.county':'收件区县', 'recipient.address':'收件详细地址', customerName:'客户公司名称', cargo:'物品', weight:'预估重量', serviceId:'快递服务' }
  const draftProblems = draftResult.success ? [] : draftResult.error.issues.map(issue => `${fieldLabels[issue.path.join('.')] || '寄件资料'}：${issue.message}`)
  const [customerTouched, setCustomerTouched] = useState(false)
  const customerProblem = batchText || (!attempted && !customerTouched) || draftResult.success ? '' : draftResult.error.issues.filter(issue => issue.path.join('.') === 'customerName').map(issue => issue.message).join('；')
  const recipientProblem = (field: keyof Contact) => (!attempted && !rawAddress.trim()) || draftResult.success ? '' : draftResult.error.issues.filter(issue => issue.path.join('.') === `recipient.${field}`).map(issue => issue.message).join('；')
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (submissionRunning.current || savingCommonSender || batchText) return
    if (editing ? !canResubmit : !canSubmitNew) return
    setError('')
    setAttempted(true)
    if (!accessReady) { setError('请补齐寄件资料并核对提报要求，已填信息会保留。'); return }
    if (!uncertain && editing && departments?.length && !departments.some(dept => dept.id === departmentId)) {
      setError('请选择本人所属部门。')
      return
    }
    if (!uncertain) {
      const query = new URLSearchParams(window.location.search)
      const submission = makeAnonymousShipmentSchema(effectiveRules).safeParse({ key: crypto.randomUUID(), rawInput: rawAddress || undefined, contextToken: query.get('context') || undefined, businessCode: query.get('code') || undefined, input: draftInput })
      if (!submission.success) { const first = submission.error.issues[0]?.path.slice(1).join('.'); const field = formRef.current?.elements.namedItem(first) as HTMLElement | null; field?.focus(); return }
      if (!previewCurrent) { setPreviewSenderKey(senderKey); setPreview(true); return }
      if (mode === 'fxiaoke') {
        const ownerSubmission = ownerOrderSchema.safeParse({ key: submission.data.key, input: submission.data.input })
        if (!ownerSubmission.success) { setError('请核对寄件资料后重试。'); return }
        pendingSubmission.current = JSON.stringify(editing ? {
          ...ownerSubmission.data,
          expectedRevision: editing.order.revision,
          input: { ...ownerSubmission.data.input, remark: original?.remark || '', payment: original?.payment || 'sender_monthly',
            ...(original?.pickupWindow ? { pickupWindow: original.pickupWindow } : {}) },
        } : ownerSubmission.data)
      } else {
        pendingSubmission.current = JSON.stringify(submission.data)
      }
      pendingCredentials.current = mode === 'fxiaoke' || employee ? 'same-origin' : 'omit'
    }
    if (!pendingSubmission.current) return
    submissionRunning.current = true
    setBusy(true)
    try {
      const endpoint = editing ? `/api/shipping/owner/orders/${encodeURIComponent(editing.order.orderNo)}/resubmit`
        : mode === 'fxiaoke' ? '/api/shipping/owner/orders' : '/api/shipping/public/orders'
      const response = await fetch(endpoint, { credentials: pendingCredentials.current, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: pendingSubmission.current })
      const data = await response.json()
      if (!response.ok && ([400, 401, 403, 422, 429].includes(response.status) || (editing && [404, 409].includes(response.status)))) { pendingSubmission.current = null; setUncertain(false); setPreview(false); setError(data.error || '请核对工单资料'); return }
      if (!response.ok || typeof data.orderNo !== 'string' || !data.orderNo || data.orderNo.length > 80 || typeof data.status !== 'string' || !Object.hasOwn(receiptLabels, data.status) || (data.waybill != null && (typeof data.waybill !== 'string' || data.waybill.length > 80))) throw new Error('暂未确认工单提交结果，请使用原请求重取回执。')
      if (editing) {
        const originalOrderNo = editing.order.orderNo
        const revisionValid = Number.isInteger(data.revision) && data.revision > 0
        if (data.orderNo === originalOrderNo) {
          if (!revisionValid || data.revision <= editing.order.revision || data.resubmittedFrom != null) {
            throw new Error('请重取原工单回执')
          }
          editing.finish({ orderNo: data.orderNo, status: data.status, revision: data.revision,
            ...(data.revision === editing.order.revision + 1 ? { customerName } : {}) })
          return
        }
        if (data.resubmittedFrom !== originalOrderNo || !revisionValid || typeof data.createdAt !== 'string'
          || !Number.isFinite(Date.parse(data.createdAt))) throw new Error('请重取重提回执')
        editing.finish({
          orderNo: data.orderNo, status: data.status, revision: data.revision, createdAt: data.createdAt,
          nextReviewAt: typeof data.nextReviewAt === 'string' ? data.nextReviewAt : null,
          waybill: data.waybill || null, customerName, resubmittedFrom: originalOrderNo,
        })
        return
      }
      setReceipt(data); setRecordRefresh(value => value + 1)
      pendingSubmission.current = null; setUncertain(false)
    } catch { setUncertain(true); setError('暂未确认工单提交结果，原请求已保留。请重取工单回执，避免重复提报。') } finally { submissionRunning.current = false; setBusy(false) }
  }

  function returnToRecords(receipt?: Parameters<RestoreOwnerRecord>[0]) {
    setSelectedReturn(null)
    setMobilePane('records')
    selectedReturn?.restore(receipt)
  }

  if (receipt) return <main className={styles.page}><section className={styles.successCard}><div className={styles.successIcon}><CheckCircle2 size={34}/></div><p>工单已受理</p><h1>{receiptLabels[receipt.status]}</h1><span>工单编号</span><strong>{receipt.orderNo}</strong>{receipt.waybill && <><span>承运商运单号</span><strong className={styles.waybillNumber}>{receipt.waybill}</strong></>}<small>操作员确认后才会向顺丰下单并请求揽收。如需补充资料，请提供此工单编号。</small>{receipt.receiptToken && <><button type="button" onClick={async () => { try { const response = await fetch(`/api/shipping/public/orders/${receipt.receiptToken}`, { cache: 'no-store' }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setReceipt(current => current ? { ...current, ...data } : current); setReceiptStatus('已刷新工单状态') } catch { setReceiptStatus('状态暂不可用，请稍后重试') } }}>刷新工单状态</button><button type="button" onClick={() => { void navigator.clipboard.writeText(`${window.location.origin}/sales-portal#receipt=${receipt.receiptToken}`).then(() => setReceiptStatus('查询链接已复制，请妥善保存，仅供本人使用')).catch(() => setReceiptStatus('复制失败，请重试')) }}>复制查询链接</button><p><a href={`/sales-portal#receipt=${receipt.receiptToken}`}>打开工单查询页（可收藏）</a></p><p role="status">{receiptStatus}</p></>}<button onClick={() => { setReceipt(null); setRecipient(emptyContact()); setRawAddress(''); setCustomerName(''); setSpecialRequirements(''); setPreview(false); setAttempted(false); setCustomerTouched(false) }}>继续提报一票</button></section></main>

  const companyLabel = mode === 'fxiaoke' ? '单票客户公司名称' : '客户公司名称'
  const companyField = !batchText && rules.companyName.enabled && (
    <label className={styles.customer}>
      {companyLabel}
      <input name="customerName" aria-label={companyLabel} aria-describedby="customer-requirement customer-error"
        aria-invalid={Boolean(customerProblem)} onBlur={() => setCustomerTouched(true)}
        required={rules.companyName.required} minLength={rules.companyName.minLength} maxLength={120}
        value={customerName} onChange={event => setCustomerName(event.target.value)}
        placeholder={`请填写公司名称，至少${rules.companyName.minLength}个字符`}/>
      <small id="customer-requirement" className={styles.customerRequirement}>
        {rules.companyName.required ? '必填' : '选填'} · {rules.companyName.minLength > 0 ? `至少${rules.companyName.minLength}个字符，` : ''}最多120个字符（不计首尾空格）
      </small>
      <small id="customer-error" className={styles.fieldError} aria-live="polite">{customerProblem}</small>
    </label>
  )

  const isEditingReturn = Boolean(selectedReturn && canResubmit)
  const returnedEditor = selectedReturn && canResubmit && <SalesRequestForm
    key={selectedReturn.order.orderNo} {...props} accessReady={Boolean(employee)} accessControls={undefined}
    editing={{ order: selectedReturn.order, close: () => returnToRecords(), finish: returnToRecords }}
  />
  const records = !editing && <section className={styles.summaryCard}>
    <h2>提报记录</h2>
    <MyWorkorders
      onResubmit={canResubmit ? (order, restore) => setSelectedReturn({ order, restore }) : undefined}
      actionsLocked={busy || uncertain || batchLocked} scope={mode === 'fxiaoke' ? 'owner' : 'public'}
      refreshKey={recordRefresh} ownerPermissions={props.ownerPermissions}
    />
  </section>

  if (!editing && !canSubmitNew) return <>
    {returnedEditor}
    <main hidden={isEditingReturn} className={`${styles.page} ${styles.employeePage}`}>
      <header className={styles.hero}><h1>本人寄件</h1></header>
      <div className={styles.identityContainer}>
        {props.saveCommonSender && accessControls}
        {records}
      </div>
    </main>
  </>

  return <>
    {returnedEditor}
    <main hidden={isEditingReturn} className={mode === 'fxiaoke' ? `${styles.page} ${styles.employeePage}` : styles.page}>
    <header className={styles.hero}><div><h1>{editing ? '重提寄件' : '发起寄件'}</h1><p>{editing ? `原工单 ${editing.order.orderNo}` : '填好寄件资料，交给前台确认。'}</p></div><ol className={styles.steps} aria-label="寄件流程"><li className={styles.current}>1 填写信息</li><li>2 前台确认</li><li>3 快递揽收</li></ol></header>
    {!editing && <nav className={styles.mobileNav} aria-label="提报与记录"><button type="button" aria-pressed={mobilePane === 'form'} onClick={() => setMobilePane('form')}>提报快递</button><button type="button" aria-pressed={mobilePane === 'records'} onClick={() => setMobilePane('records')}>提报记录</button></nav>}
    <div className={styles.workspace}>
    {!isEditingReturn && <div className={mobilePane === 'records' ? styles.mobileHidden : undefined}>
    {accessControls && <div className={`${styles.form} ${styles.accessControls}`}>{accessControls}</div>}
    <form ref={formRef} noValidate className={styles.form} onSubmit={submit} onChange={() => setPreview(false)}>
      <fieldset className={styles.fields} disabled={busy || uncertain || savingCommonSender}>
      {editing && <section className={styles.card} aria-label="重提原单">
        <div className={styles.returnEditToolbar}><strong>{editing.order.orderNo}</strong>
          <button type="button" className={styles.secondaryButton} onClick={editing.close}>返回提报记录</button>
        </div>
        {editing.order.returnedReason
          ? <p className={styles.returnReason}>退回原因：{editing.order.returnedReason}</p>
          : <p className={styles.hint}>未记录退回原因</p>}
        <details className={styles.returnSenderDetails}><summary>寄件人 · {sender.name} · {senderAddress}</summary>
          <div className={styles.grid2}>{Object.entries({ name: '寄件人姓名', phone: '寄件联系电话', province: '寄件省份', city: '寄件城市', county: '寄件区县', address: '寄件详细地址' }).map(([field, label]) => (
            <label key={field}>{label}<input value={senderContact[field as keyof Contact]} onChange={event => { setReturnedSender(current => ({ ...current, [field]: event.target.value })); setCommonSenderFeedback(null) }}/></label>
          ))}</div>
          {(commonSender || props.saveCommonSender) && <div className={styles.addressActions}>
            {commonSender && <button type="button" className={styles.secondaryButton} onClick={() => {
              setReturnedSender(commonSender)
              setCommonSenderFeedback(null)
            }}>使用我的常用地址</button>}
            {props.saveCommonSender && <button type="button" className={styles.secondaryButton} onClick={() => void saveReturnedSender()}>
              {savingCommonSender ? '保存中…' : '保存为我的常用地址'}
            </button>}
          </div>}
          {commonSenderFeedback && <p className={commonSenderFeedback.error ? styles.error : styles.notice}
            role={commonSenderFeedback.error ? 'alert' : 'status'}>{commonSenderFeedback.text}</p>}
        </details>
        {departments && departments.length > 1 && <label>所属部门<select value={departmentId || ''} onChange={event => setReturnDepartment(event.target.value)}>
          <option value="">请选择本人所属部门</option>{departments.map(dept => <option key={dept.id} value={dept.id}>{dept.name}</option>)}
        </select></label>}
      </section>}
      {!editing && !accessControls && <section className={styles.card}><div className={styles.cardTitle}><UserRound size={18}/><div><h2>我的寄件资料</h2><p>已保存，操作员确认后按此地址联系上门揽收</p></div></div><p>{submitter.name} · {submitter.phone} · {submitter.team}</p><p>{senderAddress}</p></section>}
      <section className={styles.card}><div className={styles.cardTitle}><Building2 size={18}/><div><h2><span className={styles.sectionNumber}>02</span>客户与收件信息</h2><p>客户、收件人和城市会显示在前台待办卡片</p></div></div>
        {mode !== 'fxiaoke' && companyField}
        <div className={styles.paste}>
          <div>
            <ClipboardPaste size={16}/><strong>智能地址一键粘贴</strong>
            <span>{editing ? '粘贴原单这一票的新收件信息' : mode === 'fxiaoke'
              ? `可一次粘贴多位收件人，识别后逐票${rules.companyName.enabled ? '填写客户公司' : '核对'}`
              : '把微信里的整段地址直接贴进来'}</span>
          </div>
          <textarea aria-label="智能地址一键粘贴" rows={3} disabled={batchLocked} value={rawAddress}
            onChange={event => setRawAddress(event.target.value)} placeholder="例如：张三 13800138000 广东省深圳市南山区科苑路15号"/>
          <button type="button" disabled={batchLocked} onClick={recognize}><Sparkles size={14}/>识别并填充</button>
        </div>
        {mode === 'fxiaoke' && companyField}
        {!batchText && <><div className={styles.grid2}><label>收件人<input name="recipient.name" required value={recipient.name} aria-invalid={Boolean(recipientProblem('name'))} onChange={event => setRecipientField('name', event.target.value)}/>{recipientProblem('name') && <small className={styles.fieldError}>{recipientProblem('name')}</small>}</label><label>联系电话<input name="recipient.phone" required value={recipient.phone} aria-invalid={Boolean(recipientProblem('phone'))} onChange={event => setRecipientField('phone', event.target.value)}/>{recipientProblem('phone') && <small className={styles.fieldError}>{recipientProblem('phone')}</small>}</label></div><div className={styles.grid3}><label>省份<input name="recipient.province" required value={recipient.province} aria-invalid={Boolean(recipientProblem('province'))} onChange={event => setRecipientField('province', event.target.value)}/>{recipientProblem('province') && <small className={styles.fieldError}>{recipientProblem('province')}</small>}</label><label>城市<input name="recipient.city" required value={recipient.city} aria-invalid={Boolean(recipientProblem('city'))} onChange={event => setRecipientField('city', event.target.value)}/>{recipientProblem('city') && <small className={styles.fieldError}>{recipientProblem('city')}</small>}</label><label>区县<input name="recipient.county" required value={recipient.county} aria-invalid={Boolean(recipientProblem('county'))} onChange={event => setRecipientField('county', event.target.value)}/>{recipientProblem('county') && <small className={styles.fieldError}>{recipientProblem('county')}</small>}</label></div><label>详细地址<input name="recipient.address" required value={recipient.address} aria-invalid={Boolean(recipientProblem('address'))} onChange={event => setRecipientField('address', event.target.value)}/>{recipientProblem('address') && <small className={styles.fieldError}>{recipientProblem('address')}</small>}</label></>} {batchText && <p role="status">已识别 {batchCount} 票，请在下方逐票填写物品、重量、服务和特殊需求。</p>}</section>
      {!batchText && <section className={styles.card}><div className={styles.cardTitle}><Package size={18}/><div><h2><span className={styles.sectionNumber}>03</span>物品与特殊需求</h2><p>特殊要求会醒目标记给前台确认</p></div></div><div className={styles.grid3}><label>托寄物<select value={cargo} onChange={event => setCargo(event.target.value)}>{!['发票','合同','样品','礼品','其他'].includes(cargo) && <option>{cargo}</option>}<option>发票</option><option>合同</option><option>样品</option><option>礼品</option><option>其他</option></select></label><label>预估重量（kg）<input name="weight" type="number" min="0.01" max="20" step="0.01" value={weight} onChange={event => setWeight(event.target.value)}/></label><label>顺丰服务产品{services ? <select required value={serviceId || String(services[0]?.id || '')} onChange={event => setServiceId(event.target.value)}>{services.length ? services.map(item => <option key={item.id} value={item.id}>{item.name}</option>) : <option value="">暂无开放的服务，请联系操作员</option>}</select> : <select value={servicePreference} onChange={event => setServicePreference(event.target.value as typeof servicePreference)}><option value="standard">标准</option><option value="urgent">加急</option></select>}</label></div><label>我的特殊需求（选填）<textarea rows={3} maxLength={500} value={specialRequirements} onChange={event => setSpecialRequirements(event.target.value)} placeholder="例如：周五前送达、样品易碎、上门前联系、随件附带某份资料……"/><span className={styles.counter}>{specialRequirements.length}/500</span></label></section>}
      </fieldset>
      {!batchText && previewCurrent && <section className={styles.card} aria-label="寄出预览"><h2>寄出预览</h2><p>寄件人：{submitter.name} · {normalizeDomesticShippingPhone(submitter.phone)} · {senderAddress}</p><p>收件人：{recipient.name} · {recipient.phone} · {recipient.province}{recipient.city}{recipient.county}{recipient.address}</p><p>{customerName} · {cargo} · {weight} kg · {services?.find(item => item.id === Number(serviceId || services[0]?.id))?.name || (servicePreference === 'urgent' ? '加急偏好' : '标准偏好')}</p>{specialRequirements && <p>{specialRequirements}</p>}<small>{editing ? '确认重提后会生成新的待审核工单，原记录保留。' : '这是预览，工单尚未提交。核对后请再次点击“确认提交工单”；正式下单和叫件由操作员完成。'}</small></section>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {!accessReady && accessHint && <p role="status" className={styles.error}>{accessHint}</p>}{!batchText && attempted && accessReady && !draftComplete && !uncertain && <p role="status" className={styles.error}>{draftResult.success ? '' : [...new Set(draftProblems)].join('；')}</p>}
      {!batchText && <footer className={styles.submit} aria-label="寄件提报操作"><div className={styles.submitGuidance}><strong>{busy ? '正在提交' : uncertain ? '提交结果待确认' : previewCurrent ? '第 2 步：确认提交' : '第 1 步：预览工单'}</strong><span id={submissionHintId} role="status" aria-live="polite" aria-atomic="true">{busy ? '正在提交，请勿重复操作。' : uncertain ? '请重取原工单回执，避免重复提报。' : previewCurrent ? (editing ? '请核对预览后确认重提。' : '尚未提交。请核对预览，再次点击“确认提交工单”。') : '共 2 步：先预览，再次点击同一按钮确认提交。修改资料后需重新预览。'}</span><small>提交只会进入前台待确认池，不会直接产生运费。</small></div><button aria-describedby={submissionHintId} disabled={busy || savingCommonSender || !accessReady}>{busy ? '提交中…' : uncertain ? '重取工单回执' : previewCurrent ? (editing ? '确认重提' : '确认提交工单') : '预览工单'}<ArrowRight size={16}/></button></footer>}
    </form>
    {batchText && <SalesBatchProposal key={batchText} embedded initialText={batchText} sender={sender} team={draftTeam || employee?.team || ''} departmentId={departmentId} departments={departments} rules={rules} services={services} accessReady={accessReady} accessHint={accessHint}
      onSuccess={()=>setRecordRefresh(value=>value+1)} onLockedChange={setBatchLocked} onReviewChange={setBatchReview} onClear={()=>{setBatchText('');setBatchLocked(false);setRawAddress('');setPreview(false);setBatchReview(null)}}/>}
    </div>}
    <aside aria-label="提报记录" className={`${styles.records} ${mobilePane === 'form' ? styles.mobileHidden : ''}`}><section className={styles.summaryCard} aria-label="本次寄件摘要"><h2>本次寄件</h2><dl><div><dt>寄件人</dt><dd>{sender.name || '待填写'} · {sender.phone}</dd><dd>{senderAddress || '地址待填写'}</dd></div><div><dt>收件人</dt><dd>{batchText ? String(batchCount) + ' 位收件人（逐票核对）' : recipient.name || '待填写'}{!batchText && recipient.phone && ` · ${recipient.phone}`}</dd><dd>{batchText ? String(batchReview?.complete || 0) + ' 票资料完整 · ' + String(batchReview?.invalid || 0) + ' 票待补充' : `${recipient.province}${recipient.city === recipient.province ? '' : recipient.city}${recipient.county}${recipient.address}` || '收件地址待填写'}</dd></div><div><dt>物品与服务</dt><dd>{batchText ? '物品与服务按票核对' : <>{cargo} · {weight || '—'} kg · {services?.find(item => item.id === Number(serviceId || services[0]?.id))?.name || (servicePreference === 'urgent' ? '加急' : '标准')}</>}</dd></div></dl></section>{records}</aside>
    </div>
  </main></>
}

function ReceiptLookup({ token }: { token: string }) {
  const [receipt, setReceipt] = useState<ShipmentReceipt | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  async function load() { setBusy(true); setError(''); try { const response = await fetch(`/api/shipping/public/orders/${encodeURIComponent(token)}`, { cache: 'no-store' }); const data = await response.json(); if (!response.ok || !data.orderNo || !Object.hasOwn(receiptLabels, data.status)) throw new Error(data.error || '回执暂不可用'); setReceipt(data) } catch (e) { setError(e instanceof Error ? e.message : '查询失败') } finally { setBusy(false) } }
  useEffect(() => { let active = true; setReceipt(null); setError(''); setBusy(true); fetch(`/api/shipping/public/orders/${encodeURIComponent(token)}`, { cache: 'no-store' }).then(async response => { const data = await response.json(); if (!response.ok || !data.orderNo || !Object.hasOwn(receiptLabels, data.status)) throw new Error(data.error || '回执暂不可用'); if (active) setReceipt(data) }).catch(e => { if (active) setError(e.message) }).finally(() => { if (active) setBusy(false) }); return () => { active = false } }, [token])
  return <main className={styles.page}><section className={styles.successCard}><h1>工单进度</h1>{receipt && <><strong>{receipt.orderNo}</strong><p>{receiptLabels[receipt.status]}</p>{receipt.waybill && <strong className={styles.waybillNumber}>{receipt.waybill}</strong>}</>}{error && <p role="alert">{error}</p>}<button type="button" disabled={busy} onClick={() => void load()}>{busy ? '查询中…' : '刷新进度'}</button><p><a href="/sales-portal">提报新工单</a></p><small>登录后可凭本链接查询这一票的状态；页面不会显示完整姓名、地址或其他人的工单。</small></section></main>
}

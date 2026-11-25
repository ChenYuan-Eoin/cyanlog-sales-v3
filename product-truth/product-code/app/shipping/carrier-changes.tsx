'use client'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { CarrierChangeDetail, CarrierChangeReceipt } from '@/lib/shipping/owner-carrier-change'
import { parseAddress } from '@/lib/shipping/address'
import { emptyContact, type Contact } from '@/lib/shipping/types'
import { contactSchema } from '@/lib/shipping/validation'
import ContactFields from './contact-fields'
import { CarrierChangeHistory, ContactLine, hasReceipt } from './carrier-change-history'
import styles from './carrier-changes.module.css'

type Action = CarrierChangeReceipt['action']
type Instruction = { key: string; action: 'modify_recipient'; recipient: Contact } | { key: string; action: 'return_to_sender' }
export type CarrierChangesProps = {
  endpoint: string
  orderNo: string
  disabled?: boolean
  allowActions?: boolean
  showUnavailable?: boolean
  refreshKey?: number | string
  onPendingChange?: (pending: boolean) => void
}
const labels = { modify_recipient: '转寄 / 改派', return_to_sender: '取消' } as const
const addressFields = ['province', 'city', 'county', 'address'] as const

export function CarrierChanges(props: CarrierChangesProps) {
  return <OrderChanges key={props.endpoint} {...props} />
}

function OrderChanges({ endpoint, orderNo, disabled = false, allowActions = true, showUnavailable = allowActions, refreshKey, onPendingChange }: CarrierChangesProps) {
  const [detail, setDetail] = useState<CarrierChangeDetail | null>(null)
  const [action, setAction] = useState<Action | null>(null)
  const [recipient, setRecipient] = useState<Contact>(emptyContact)
  const [paste, setPaste] = useState('')
  const [parsedPaste, setParsedPaste] = useState('')
  const [parseNote, setParseNote] = useState('')
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [reading, setReading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const frozen = useRef<Instruction | null>(null)
  const inFlight = useRef(false)
  const pastePending = Boolean(paste.trim()) && paste !== parsedPaste
  const fieldsDisabled = disabled || busy || uncertain || Boolean(frozen.current)

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      setReading(true)
      try {
        const response = await fetch(endpoint, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
        if (controller.signal.aborted) return
        if ([401, 403, 404].includes(response.status)) { setDetail(null); setError(''); return }
        const data: CarrierChangeDetail = await response.json()
        if (!response.ok || data.orderNo !== orderNo || !Array.isArray(data.actions) || (data.latest != null && !hasReceipt(data.latest))) throw Error()
        if (controller.signal.aborted) return
        setDetail(data)
        setError('')
        setUncertain(false)
        setAction(current => current && data.actions.includes(current) ? current : null)
        if (data.latest && !['rejected', 'not_sent'].includes(data.latest.status)) frozen.current = null
      } catch {
        if (!controller.signal.aborted) {
          setDetail(previous => previous ? { ...previous, actions: [] } : null)
          setError('暂时无法读取顺丰指令记录，请重新查询。')
        }
      } finally {
        if (!controller.signal.aborted) setReading(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [endpoint, orderNo, refreshKey, reload])

  function parseRecipient() {
    const parsed = parseAddress(paste)
    setRecipient(parsed.contact)
    setParsedPaste(paste)
    setParseNote(parsed.warnings.join(' ') || '已填入新收件资料，请核对后提交。')
    setError('')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!allowActions || !action || !detail?.actions.includes(action) || disabled || reading || uncertain || inFlight.current) return
    if (!frozen.current) {
      if (action === 'modify_recipient') {
        if (pastePending) { setError('请先识别并填写粘贴的地址，再核对收件资料。'); return }
        const parsed = contactSchema.safeParse(recipient)
        if (!parsed.success) { setError(parsed.error.issues[0].message); return }
        if (addressFields.every(field => parsed.data[field] === detail.currentRecipient?.[field])) {
          setError('转寄需要填写与原收件地址不同的新地址。')
          return
        }
        frozen.current = { key: crypto.randomUUID(), action, recipient: parsed.data }
      } else frozen.current = { key: crypto.randomUUID(), action }
    }
    inFlight.current = true
    setBusy(true)
    setError('')
    onPendingChange?.(true)
    try {
      const response = await fetch(endpoint, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(frozen.current) })
      const result = await response.json()
      if (!response.ok) {
        if (response.status >= 500) throw Error()
        frozen.current = null
        if (response.status !== 400 && response.status !== 422) {
          setAction(null)
          setDetail({ ...detail, actions: [] })
        }
        setError(result.error || '顺丰指令暂不可提交，请核对收件资料和单据状态。')
        return
      }
      if (!hasReceipt(result) || result.action !== action) throw Error()
      frozen.current = null
      setDetail({ ...detail, actions: [], latest: result })
      setAction(null)
    } catch {
      setUncertain(true)
      setError('提交结果尚未确认，请先查询这张运单的指令记录。')
    } finally {
      inFlight.current = false
      setBusy(false)
      onPendingChange?.(false)
    }
  }

  const actions = !allowActions || !detail ? [] : (['return_to_sender', 'modify_recipient'] as const).filter(item =>
    detail.actions.includes(item) && (item === 'modify_recipient' ? detail.currentRecipient : detail.returnDestination))
  const unavailable = showUnavailable && detail && !detail.latest && !actions.length && !error && !reading
  if (!error && !detail?.latest && !actions.length && !unavailable) return null
  return <div className={styles.panel}>
    {detail?.latest && <CarrierChangeHistory receipt={detail.latest} />}
    {error && <p role="alert">{error}</p>}
    {unavailable && <p role="status">{detail.unavailableReason === 'intercept_disabled'
      ? '当前运单使用的顺丰连接尚未在寄件配置中启用在途转寄与退回，请联系寄件配置管理员。'
      : '当前运单暂不能转寄或退回，请重新查询，核对顺丰运输状态。'}</p>}
    <div className={styles.actions}>
      {(error || detail?.latest || unavailable) && <button type="button" disabled={reading || busy || disabled} onClick={() => setReload(value => value + 1)}>查询处理结果</button>}
      {!action && actions.map(item => <button key={item} type="button" data-carrier-action={item} disabled={disabled || reading} onClick={() => {
        frozen.current = null
        setRecipient(detail?.currentRecipient || emptyContact())
        setPaste('')
        setParsedPaste('')
        setParseNote('')
        setError('')
        setAction(item)
      }}>{labels[item]}</button>)}
    </div>
    {action && actions.includes(action) && detail && <form className={styles.form} aria-label={action === 'modify_recipient' ? '转寄或改派快件收件地址' : '申请退回至原寄件人'} onSubmit={submit}>
      {action === 'modify_recipient'
        ? <>
          <label className={styles.pasteField}>粘贴新收件地址
            <textarea rows={3} maxLength={2000} value={paste} disabled={fieldsDisabled} onChange={event => {
              setPaste(event.target.value)
              setParseNote('')
            }} placeholder="姓名、电话、省市区及详细地址" />
          </label>
          <button type="button" disabled={fieldsDisabled || !pastePending} onClick={parseRecipient}>识别并填写</button>
          {parseNote && <p role="status">{parseNote}</p>}
          <ContactFields title="新收件人" mark="收" value={recipient} onChange={setRecipient} disabled={fieldsDisabled} />
        </>
        : detail.returnDestination && <p>快件已揽收，取消将向顺丰申请退回原寄件人。<br /><ContactLine contact={detail.returnDestination} /></p>}
      <button type="submit" disabled={busy || reading || disabled || uncertain}>{busy ? '正在提交…' : action === 'modify_recipient' ? '确认提交转寄 / 改派' : '确认取消并申请退回'}</button>
      <button type="button" disabled={busy || uncertain} onClick={() => { frozen.current = null; setAction(null); setError('') }}>返回记录</button>
    </form>}
  </div>
}

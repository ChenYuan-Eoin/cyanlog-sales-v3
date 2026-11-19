'use client'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { CarrierChangeDetail, CarrierChangeReceipt } from '@/lib/shipping/owner-carrier-change'
import { emptyContact, type Contact } from '@/lib/shipping/types'
import { contactSchema } from '@/lib/shipping/validation'
import ContactFields from '../shipping/contact-fields'
import { CarrierChangeHistory, ContactLine, hasReceipt } from '../shipping/carrier-change-history'

type Action = CarrierChangeReceipt['action']
type Instruction = { key: string; action: 'modify_recipient'; recipient: Contact } | { key: string; action: 'return_to_sender' }
type Props = { orderNo: string; disabled?: boolean; onPendingChange?: (pending: boolean) => void }
const labels = { modify_recipient: '修改', return_to_sender: '退回' } as const
export function OwnerCarrierChanges(props: Props) {
  return <OrderChanges key={props.orderNo} {...props} />
}

function OrderChanges({ orderNo, disabled = false, onPendingChange }: Props) {
  const endpoint = '/api/shipping/owner/orders/' + encodeURIComponent(orderNo) + '/carrier-changes'
  const [detail, setDetail] = useState<CarrierChangeDetail | null>(null)
  const [action, setAction] = useState<Action | null>(null)
  const [recipient, setRecipient] = useState<Contact>(emptyContact)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [reading, setReading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const frozen = useRef<Instruction | null>(null)
  const inFlight = useRef(false)

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
  }, [endpoint, orderNo, reload])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!action || !detail?.actions.includes(action) || disabled || reading || uncertain || inFlight.current) return
    if (!frozen.current) {
      if (action === 'modify_recipient') {
        const parsed = contactSchema.safeParse(recipient)
        if (!parsed.success) { setError(parsed.error.issues[0].message); return }
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
        setAction(null)
        setDetail({ ...detail, actions: [] })
        setError(result.error || '顺丰指令暂不可提交，请重新查询单据状态。')
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

  const actions = detail?.actions.filter(item => item === 'modify_recipient' ? detail.currentRecipient : item === 'return_to_sender' && detail.returnDestination) ?? []
  if (!error && !detail?.latest && !actions.length) return null
  return <div>
    {detail?.latest && <CarrierChangeHistory receipt={detail.latest} />}
    {error && <p role="alert">{error}</p>}
    {(error || detail?.latest) && <button type="button" disabled={reading || busy || disabled} onClick={() => setReload(value => value + 1)}>查询处理结果</button>}
    {!action && actions.map(item => <button key={item} type="button" disabled={disabled || reading} onClick={() => {
      frozen.current = null
      setRecipient(detail!.currentRecipient || emptyContact())
      setError('')
      setAction(item)
    }}>{labels[item]}</button>)}
    {action && actions.includes(action) && detail && <form aria-label={action === 'modify_recipient' ? '修改快件收件地址' : '退回快件至原寄件人'} onSubmit={submit}>
      {action === 'modify_recipient'
        ? <ContactFields title="新收件人" mark="收" value={recipient} onChange={setRecipient} disabled={disabled || busy || Boolean(frozen.current)} />
        : detail.returnDestination && <p>将这张快件退回原寄件人<br /><ContactLine contact={detail.returnDestination} /></p>}
      <button type="submit" disabled={busy || reading || disabled || uncertain}>{busy ? '正在提交…' : '确认提交' + labels[action]}</button>
      <button type="button" disabled={busy || uncertain} onClick={() => { frozen.current = null; setAction(null); setError('') }}>返回记录</button>
    </form>}
  </div>
}

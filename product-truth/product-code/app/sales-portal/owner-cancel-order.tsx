'use client'
import { useRef, useState } from 'react'
import type { ShipmentReceipt } from '@/lib/shipping/types'

export function OwnerCancelOrder({ order, onCancelled, disabled = false }: { order: ShipmentReceipt; onCancelled: () => void; disabled?: boolean }) {
  const [open,setOpen] = useState(false), [busy,setBusy] = useState(false), [message,setMessage] = useState('')
  const inFlight = useRef(false)
  if (['cancelled','delivered'].includes(order.status)) return null
  if (order.cancellationState && order.cancellationState !== 'not_sent') return <small>{order.cancellationState === 'rejected' ? '承运商已拒绝取消，请联系操作员核对。' : '已请求取消，结果待核实。'}</small>
  if (order.status === 'in_transit') return <small>已揽收，不能直接取消。</small>
  if (['order_unknown','ordering'].includes(order.status)) return <small>下单结果待核实，暂不能取消。</small>
  if (order.canCancel === false) return <small>原单状态需要核实，暂不能取消。</small>
  if (!['accepted','awaiting_confirmation','returned','confirmed','order_failed','waybill_created'].includes(order.status)) return null
  async function submit() {
    if (inFlight.current || disabled) return
    inFlight.current = true; setBusy(true); setMessage('')
    try {
      const response = await fetch('/api/shipping/owner/orders/'+encodeURIComponent(order.orderNo)+'/cancel',{method:'POST',credentials:'same-origin',cache:'no-store'})
      const result = await response.json()
      if (!response.ok || result.status !== 'cancelled') throw Error(result.error || '取消结果待核实，请刷新提报记录。')
      setOpen(false); onCancelled()
    } catch(error) { setMessage(error instanceof TypeError ? '未取得取消结果，请刷新提报记录核实。' : error instanceof Error ? error.message : '请刷新后核实取消结果。'); setOpen(false) }
    finally { inFlight.current = false; setBusy(false) }
  }
  return <div>{message && <small role="status">{message}</small>}{open ? <div role="group" aria-label="取消寄件确认">
    <span>{order.status === 'waybill_created' ? '确认向顺丰取消这张未揽收的运单？' : '确认取消这张提报？'}</span>
    <button type="button" disabled={busy || disabled} onClick={() => void submit()}>{busy ? '正在取消…' : '确认取消'}</button>
    <button type="button" disabled={busy || disabled} onClick={() => setOpen(false)}>保留寄件</button>
  </div> : <button type="button" disabled={disabled} onClick={() => setOpen(true)}>取消</button>}</div>
}

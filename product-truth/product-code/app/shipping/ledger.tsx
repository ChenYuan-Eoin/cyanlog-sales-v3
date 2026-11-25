"use client"
import { useCallback, useEffect, useState } from 'react'
import type { ShipmentOrder, ShipmentOrderStatus } from '@/lib/shipping/types'
import styles from './workspace.module.css'

const labels: Record<ShipmentOrderStatus, string> = { accepted: '已受理', awaiting_confirmation: '待核对', returned: '已退回', resubmitted: '已重提', confirmed: '已确认', ordering: '下单中', order_unknown: '结果待确认', waybill_created: '运单已生成', in_transit: '运输中', delivered: '已签收', cancelled: '已作废', order_failed: '下单失败' }

async function request<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || '操作失败，请稍后重试。')
  return data as T
}

export default function ShipmentLedger({ queueOnly, onTrack }: { queueOnly: boolean; onTrack: (waybill: string) => void }) {
  const [records, setRecords] = useState<ShipmentOrder[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState(''), [busy, setBusy] = useState('')
  const [salesRef, setSalesRef] = useState(''), [customerRef, setCustomerRef] = useState(''), [contact, setContact] = useState(''), [status, setStatus] = useState<ShipmentOrderStatus | ''>(queueOnly ? 'awaiting_confirmation' : '')
  const load = useCallback(async () => {
    setLoading(true); setError('')
    const query = new URLSearchParams({ limit: '50' }); if (salesRef) query.set('salesRef', salesRef); if (customerRef) query.set('customerRef', customerRef); if (contact) query.set('contact', contact); if (status) query.set('status', status)
    try { setRecords((await request<{ records: ShipmentOrder[] }>(`/api/shipping/ledger?${query}`)).records) } catch (e) { setError((e as Error).message) } finally { setLoading(false) }
  }, [salesRef, customerRef, contact, status])
  useEffect(() => { void load() }, [load])
  async function act(order: ShipmentOrder, action: 'confirm' | 'return' | 'reconcile' | 'assign') {
    const reason = action === 'return' ? window.prompt('请输入退回原因')?.trim() : undefined
    if (action === 'return' && !reason) return
    const salesRef = action === 'assign' ? window.prompt('请输入销售标识', order.relation.salesRef || '')?.trim() : undefined
    if (action === 'assign' && !salesRef) return
    const customerRef = action === 'assign' ? window.prompt('请输入客户标识（可留空）', order.relation.customerRef || '')?.trim() : undefined
    setBusy(order.id); setError('')
    try { await request(`/api/shipping/ledger/${order.id}/${action}`, action === 'return' ? { reason } : action === 'assign' ? { salesRef, customerRef: customerRef || undefined } : {}); await load() } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }
  return <section className={`${styles.panel} ${styles.ledgerPanel}`} aria-label={queueOnly ? '业务待核对' : '收寄件台账'}>
    <div className={styles.panelTitle}><h2>{queueOnly ? '业务待核对' : '收寄件台账'}</h2><span>{records.length} 条</span></div>
    <div className={styles.panelBody}>
      <form className={styles.filters} onSubmit={e => { e.preventDefault(); void load() }}>
        <input aria-label="销售筛选" placeholder="销售标识" value={salesRef} onChange={e => setSalesRef(e.target.value)} />
        <input aria-label="客户筛选" placeholder="客户标识" value={customerRef} onChange={e => setCustomerRef(e.target.value)} />
        <input aria-label="联系人筛选" placeholder="寄件人或收件人" value={contact} onChange={e => setContact(e.target.value)} />
        {!queueOnly && <select aria-label="状态筛选" value={status} onChange={e => setStatus(e.target.value as ShipmentOrderStatus | '')}><option value="">全部状态</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}
        <button className={styles.primary}>查询</button>
      </form>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {loading ? <p className={styles.subtle}>正在读取寄件单…</p> : !records.length ? <div className={styles.empty}><h3>{queueOnly ? '当前没有待核对寄件单' : '没有符合条件的收寄件记录'}</h3></div> : <div className={styles.ledgerList}>{records.map(order => <article key={order.id} className={styles.ledgerRow}>
        <div><strong>{order.orderNo}</strong><small>{new Date(order.createdAt).toLocaleString('zh-CN')} · {labels[order.status]}</small></div>
        <div><span>销售：{order.relation.salesRef || '待分配'}</span><span>客户：{order.relation.customerRef || '未关联'}</span></div>
        <div><span>寄：{order.input.sender.name} · {order.input.sender.phone}</span><span>收：{order.input.recipient.name} · {order.input.recipient.phone}</span></div>
        <div className={styles.ledgerActions}>{order.waybill && <button type="button" className={styles.textButton} onClick={() => onTrack(order.waybill!)}>查物流</button>}{order.status === 'order_unknown' && <button type="button" className={styles.primary} disabled={busy === order.id} onClick={() => void act(order, 'reconcile')}>{busy === order.id ? '查回中…' : '查回结果'}</button>}{['accepted','awaiting_confirmation','returned'].includes(order.status) && <button type="button" className={styles.textButton} disabled={busy === order.id} onClick={() => void act(order, 'assign')}>{order.relation.assignmentStatus === 'assigned' ? '调整归属' : '分配销售/客户'}</button>}{order.status === 'awaiting_confirmation' && <><button type="button" className={styles.secondary} disabled={busy === order.id} onClick={() => void act(order, 'return')}>退回</button><button type="button" className={styles.primary} disabled={busy === order.id} onClick={() => void act(order, 'confirm')}>{busy === order.id ? '处理中…' : '确认并下单'}</button></>}</div>
      </article>)}</div>}
    </div>
  </section>
}

'use client'
import { useCallback, useEffect, useId, useRef, useState, type Ref } from 'react'
import { ChevronDown } from 'lucide-react'
import type { ShipmentReceipt, ShippingInput } from '@/lib/shipping/types'
import { OwnerCancelOrder } from './owner-cancel-order'
import { OwnerCarrierChanges } from './owner-carrier-changes'
import styles from './sales-portal.module.css'
const labels: Record<string, string> = { awaiting_confirmation: '待审核', returned: '已退回，请联系操作员补充资料', confirmed: '已确认', ordering: '下单中', order_unknown: '下单结果待确认', waybill_created: '运单已生成', in_transit: '运输中', delivered: '已签收', cancelled: '已取消', order_failed: '下单未成功', accepted: '已受理' }
const dateFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric' })
const timeFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
export type ReturnedShipment = { orderNo: string; revision: number; input: ShippingInput; returnedReason?: string | null }
export type RestoreOwnerRecord = (receipt?: Pick<ShipmentReceipt, 'orderNo' | 'revision' | 'status' | 'customerName'>) => void

function OwnerReceipt({ order, expanded, toggleRef, onToggle, onResubmit, onCancelled, onCancelPending, onCarrierPending, locked, listLocked, opening }: {
  order: ShipmentReceipt
  expanded: boolean
  toggleRef?: Ref<HTMLButtonElement>
  onToggle: () => void
  onResubmit?: () => void
  onCancelled: () => void
  onCancelPending: (pending: boolean) => void
  onCarrierPending: (pending: boolean) => void
  locked: boolean
  listLocked: boolean
  opening: boolean
}) {
  const detailId = useId()
  const customer = order.customerName || '未填客户'
  const status = order.status === 'returned' ? '前台已退回' : labels[order.status] || '处理中'
  const reason = order.status === 'returned' ? order.returnedReason?.trim() : undefined
  const changes = Math.max(0, (order.revision ?? 1) - 1)

  return <li className={styles.ownerReceipt}>
    <button type="button" ref={toggleRef} className={styles.receiptToggle} aria-expanded={expanded} disabled={listLocked}
      aria-controls={expanded ? detailId : undefined} onClick={onToggle}>
      <span className={styles.receiptLine}>
        <time dateTime={order.createdAt ?? undefined}>{order.createdAt ? timeFormat.format(new Date(order.createdAt)) : '—'}</time>
        <span className={styles.receiptCustomer}>{customer}</span>
        <span>{status}</span>
        <ChevronDown size={14} aria-hidden="true" className={expanded ? styles.chevronOpen : undefined} />
      </span>
      {changes > 0 && <span className={styles.changeCount}>第 {changes} 次更改</span>}
      {reason && !expanded && <span className={styles.reasonPreview}>退回原因：{reason}</span>}
    </button>
    {expanded && <div id={detailId} className={styles.receiptDetails}>
      <div>提报单号：<strong>{order.orderNo}</strong></div>
      {order.waybill && <div>顺丰运单号：<strong className={styles.waybillNumber}>{order.waybill}</strong></div>}
      {reason && <p className={styles.returnReason}>退回原因：{reason}</p>}
      {order.status === 'returned' && !reason && <p className={styles.hint}>未记录退回原因</p>}
      {order.status === 'returned' && !order.waybill && (!order.cancellationState || order.cancellationState === 'not_sent') && onResubmit && (
        <button type="button" title="修改原单后重新提报" disabled={locked} onClick={onResubmit}>{opening ? '正在读取原单…' : '修改'}</button>
      )}
      {order.waybill && ['waybill_created', 'in_transit', 'delivered'].includes(order.status) && (
        <OwnerCarrierChanges orderNo={order.orderNo} disabled={locked} onPendingChange={onCarrierPending} />
      )}
      <OwnerCancelOrder order={order} disabled={locked} onPendingChange={onCancelPending} onCancelled={onCancelled} />
    </div>}
  </li>
}
export default function MyWorkorders({ scope = 'public', refreshKey = 0, onResubmit, actionsLocked = false }: {
  scope?: 'public' | 'owner'; refreshKey?: number; onResubmit?: (original: ReturnedShipment, restore: RestoreOwnerRecord) => void; actionsLocked?: boolean
}) {
  const opening = useRef<AbortController | null>(null)
  const [openingOrder, setOpeningOrder] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [changingCarrier, setChangingCarrier] = useState(false)
  const activeToggle = useRef<HTMLButtonElement>(null)
  const pages = useRef(new Map<string, number>())
  useEffect(() => () => { opening.current?.abort() }, [scope])
  async function openReturnedOrder(order: ShipmentReceipt) {
    if (scope !== 'owner' || !onResubmit || actionsLocked || opening.current || cancelling || changingCarrier) return
    const controller = new AbortController()
    opening.current = controller
    setOpeningOrder(order.orderNo)
    setError('')
    try {
      const response = await fetch(`/api/shipping/owner/orders/${encodeURIComponent(order.orderNo)}/resubmit`, {
        cache: 'no-store', credentials: 'same-origin', signal: controller.signal,
      })
      const original = await response.json()
      if (!response.ok) throw new Error(original.error || '原提报暂不可读取，请刷新记录。')
      if (original.orderNo !== order.orderNo || !original.input?.recipient || !Number.isInteger(original.revision)) {
        throw new Error('原提报资料不完整，请刷新记录。')
      }
      if (!controller.signal.aborted) onResubmit({ ...original, returnedReason: original.returnedReason || order.returnedReason }, receipt => {
        if (receipt?.orderNo === order.orderNo) {
          setOrders(current => current?.map(item => item.orderNo === order.orderNo ? { ...item, ...receipt } : item) ?? null)
        }
        void load(pages.current.get(order.orderNo) ?? 0, order.orderNo)
        requestAnimationFrame(() => {
          activeToggle.current?.focus({ preventScroll: true })
          activeToggle.current?.scrollIntoView?.({ block: 'nearest' })
        })
      })
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '读取原提报失败')
    } finally {
      opening.current = null
      if (!controller.signal.aborted) setOpeningOrder('')
    }
  }
  const [orders, setOrders] = useState<ShipmentReceipt[] | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState('')
  const [nextPage, setNextPage] = useState<number | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [openRecord, setOpenRecord] = useState<string | null>(null)
  const [expandedHeight, setExpandedHeight] = useState(720)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const load = useCallback(async (page = 0, refreshOrder?: string) => {
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/shipping/${scope === 'owner' ? 'owner' : 'public'}/orders?page=${page}`, { cache: 'no-store', credentials: scope === 'owner' ? 'same-origin' : 'omit' })
      const data = await response.json()
      if (!response.ok || !Array.isArray(data.orders)) throw new Error(data.error || '读取失败')
      if (refreshOrder) {
        const latest = data.orders.find((item: ShipmentReceipt) => item.orderNo === refreshOrder)
        if (latest) setOrders(current => current?.map(item => item.orderNo === refreshOrder ? latest : item) ?? null)
        return
      }
      if (page === 0) pages.current.clear()
      for (const item of data.orders) pages.current.set(item.orderNo, page)
      setOrders(current => page === 0 ? data.orders : [...new Map([...(current || []), ...data.orders].map(order => [order.orderNo, order])).values()])
      setNextPage(Number.isSafeInteger(data.nextPage) && data.nextPage > page ? data.nextPage : null)
      if (page === 0) { setExpanded(false); setOpenRecord(null) }
    } catch (e) { setError(e instanceof Error ? e.message : '读取失败') } finally { setBusy(false) }
  }, [scope])
  useEffect(() => { void load() }, [load, refreshKey])
  const visibleOrders = expanded ? orders || [] : (orders || []).slice(0, 5)
  const groups = new Map<string, ShipmentReceipt[]>()
  for (const order of visibleOrders) {
    const date = order.createdAt ? dateFormat.format(new Date(order.createdAt)) : '日期未知'
    groups.set(date, [...(groups.get(date) || []), order])
  }
  const canExpand = (orders?.length || 0) > 5 || nextPage !== null
  const actionPending = Boolean(openingOrder) || cancelling || changingCarrier
  return <div>
    <p className={styles.hint}>{scope === 'owner' ? '仅显示本人的提报记录' : '全部快递 · 按提报日期分组'}</p>
    {scope === 'owner' && <p className={styles.hint}>审核下单后显示运单号。</p>}
    <div className={styles.recordToolbar}>
      <button type="button" disabled={busy || actionPending} onClick={() => void load()}>{busy ? '正在读取…' : '刷新提报记录'}</button>
      {canExpand && <button type="button" aria-expanded={expanded} aria-controls={listId} disabled={actionPending} onClick={() => { if (!expanded) setExpandedHeight(Math.max(720, (listRef.current?.getBoundingClientRect().height || 0) + 160)); setExpanded(current => !current) }}>{expanded ? '收起 · 最近5条' : '查看更早记录'}</button>}
    </div>
    {error && <p role="alert">{error}</p>}
    {orders && <>
      {orders.length === 0 && <p>尚无提报记录</p>}
      <div ref={listRef} id={listId} role="region" aria-label="按日期分组的提报记录" tabIndex={expanded ? 0 : undefined} style={expanded ? { maxHeight: expandedHeight } : undefined} className={`${styles.recordGroups} ${expanded ? styles.recordGroupsExpanded : ''}`}>
      {[...groups].map(([date, dayOrders]) => <section className={styles.recordGroup} key={date} aria-label={date}>
        <h3>{date}</h3>
        <ul>{dayOrders.map(order => scope === 'owner' ? <OwnerReceipt key={order.orderNo} order={order}
          toggleRef={openRecord === order.orderNo ? activeToggle : undefined}
          expanded={openRecord === order.orderNo} onToggle={() => setOpenRecord(current => current === order.orderNo ? null : order.orderNo)}
          onResubmit={onResubmit ? () => void openReturnedOrder(order) : undefined}
          onCancelled={() => setOrders(current => current?.map(item => item.orderNo === order.orderNo ? { ...item, status: 'cancelled' } : item) ?? null)}
          onCancelPending={setCancelling} onCarrierPending={setChangingCarrier}
          locked={actionsLocked || busy || actionPending} listLocked={actionPending} opening={openingOrder === order.orderNo}
        /> : <li key={order.orderNo}>
        <div className={styles.recordMeta}>{order.createdAt && <time dateTime={order.createdAt}>{timeFormat.format(new Date(order.createdAt))}</time>}<span>{labels[order.status] || '处理中'}</span></div>
        <span className={styles.recordCustomer} title={order.customerName || '未填客户'}>{order.customerName || '未填客户'}</span>
        <strong>{order.orderNo}</strong>
        {order.waybill && <span>顺丰运单号：<strong className={styles.waybillNumber}>{order.waybill}</strong></span>}
      </li>)}</ul></section>)}
      </div>
      {expanded && nextPage !== null && <button type="button" disabled={busy || actionPending} onClick={() => void load(nextPage)}>加载更多快递</button>}
      {orders.length > 0 && <p className={styles.hint}>{!expanded && canExpand ? `最近 ${visibleOrders.length} 条` : `已显示 ${visibleOrders.length} 条${nextPage === null ? '，已加载全部记录' : ''}`}</p>}
    </>}
  </div>
}

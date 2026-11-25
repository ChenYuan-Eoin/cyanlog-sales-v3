'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, RefreshCw } from 'lucide-react'
import type { ShipmentReceipt, ShippingInput } from '@/lib/shipping/types'
import { OwnerCancelOrder } from './owner-cancel-order'
import { OwnerCarrierChanges } from './owner-carrier-changes'
import styles from './sales-portal.module.css'

const labels: Record<string, string> = {
  accepted: '已受理', awaiting_confirmation: '待审核', returned: '前台已退回', resubmitted: '已重提', confirmed: '已确认',
  ordering: '下单中', order_unknown: '结果待确认', waybill_created: '待揽收', in_transit: '运输中',
  delivered: '已签收', cancelled: '已取消', order_failed: '下单未成功',
}
const dateFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric' })
const timeFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const dateTimeFormat = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})
type Stage = 'processing' | 'waiting' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'returned' | 'cancelled'
type Filter = 'all' | 'waiting' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'returned'
export type ReturnedShipment = { orderNo: string; revision: number; input: ShippingInput; returnedReason?: string | null }
type ResubmittedReceipt = ShipmentReceipt & { resubmittedFrom: string }
export type RestoreOwnerRecord = (receipt?: Pick<ShipmentReceipt, 'orderNo' | 'revision' | 'status' | 'customerName'> | ResubmittedReceipt) => void

function stageOf(order: ShipmentReceipt): Stage {
  if (order.status === 'returned') return 'returned'
  if (order.status === 'cancelled') return 'cancelled'
  if (order.status === 'delivered') return 'delivered'
  if (order.status === 'waybill_created') return 'waiting'
  if (order.status === 'in_transit') return order.trackingStatus === 'out_for_delivery' ? 'out_for_delivery' : 'in_transit'
  return 'processing'
}

function stageLabel(order: ShipmentReceipt, stage: Stage) {
  if (stage === 'out_for_delivery') return '派送中'
  return labels[order.status] || '处理中'
}

function statusBadgeClass(stage: Stage) {
  return stage === 'waiting' ? styles.badgeWait
    : stage === 'in_transit' ? styles.badgeTransit
      : stage === 'out_for_delivery' ? styles.badgeDeliver
        : stage === 'delivered' ? styles.badgeSigned
          : stage === 'returned' ? styles.badgeReturned
            : stage === 'cancelled' ? styles.badgeCancelled
              : styles.badgeNeutral
}

async function copyValue(value: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // Fall through to the local copy path when browser clipboard permission is unavailable.
  }
  try {
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(textarea)
    return copied
  } catch {
    return false
  }
}

function CopyControl({ value, label, onCopy }: { value: string; label: string; onCopy: (value: string, label: string) => void }) {
  return <button type="button" className={styles.copyControl} aria-label={`复制${label}`} title={`复制${label}`} onClick={() => onCopy(value, label)}>
    <Copy size={13} aria-hidden="true" />
  </button>
}

function ReceiptCard({ order, scope, locked, opening, onResubmit, onCancelled, onCancelPending, onCarrierPending }: {
  order: ShipmentReceipt
  scope: 'public' | 'owner'
  locked: boolean
  opening: boolean
  onResubmit?: () => void
  onCancelled: () => void
  onCancelPending: (pending: boolean) => void
  onCarrierPending: (pending: boolean) => void
}) {
  const [copyFeedback, setCopyFeedback] = useState('')
  const stage = stageOf(order)
  const customer = order.customerName || '未填客户'
  const reason = scope === 'owner' && order.status === 'returned' ? order.returnedReason?.trim() : undefined
  const changes = Math.max(0, (order.revision ?? 1) - 1)
  async function copy(value: string, label: string) {
    const copied = await copyValue(value)
    setCopyFeedback(copied ? `已复制${label}` : `复制失败，请手动选择${label}`)
  }

  return <li className={styles.ownerReceipt} aria-label={`提报 ${order.orderNo}`}>
    <div className={styles.receiptHeader}>
      <div className={styles.receiptTitleGroup}>
        <time dateTime={order.createdAt ?? undefined}>{order.createdAt ? timeFormat.format(new Date(order.createdAt)) : '—'}</time>
        <strong title={customer}>{customer}</strong>
        {changes > 0 && <span className={styles.changeCount}>第 {changes} 次更改</span>}
      </div>
      <span className={`${styles.receiptBadge} ${statusBadgeClass(stage)}`}>{stageLabel(order, stage)}</span>
    </div>

    <div className={styles.trackingBar}>
      <span>顺丰单号</span>
      {order.waybill
        ? <span className={styles.trackingNumberGroup}><strong className={styles.trackingNumber} title={order.waybill}>{order.waybill}</strong><CopyControl value={order.waybill} label="顺丰单号" onCopy={(value, label) => void copy(value, label)} /></span>
        : <span className={styles.mutedText}>{order.status === 'resubmitted' ? '此记录未出运单' : '待审核下单后生成'}</span>}
    </div>
    {copyFeedback && <span className={styles.copyFeedback} role="status">{copyFeedback}</span>}

    {stage === 'waiting' && <p className={styles.stateInfo}>尚未揽收，如需更改地址请先取消后重新提报。</p>}
    {stage === 'out_for_delivery' && <p className={styles.stateInfo}>快件已派件出仓，取消 / 转寄 / 退回通道已关闭。</p>}
    {stage === 'delivered' && <div className={styles.signedBox}>
      <strong>{order.deliveredAt ? `签收时间：${dateTimeFormat.format(new Date(order.deliveredAt))}` : '订单已签收'}</strong>
      <span>订单已妥投，修改 / 取消 / 转寄通道已关闭</span>
    </div>}
    {scope === 'owner' && stage === 'returned' && <div className={styles.returnBox}>
      <strong>退回原因：</strong>{reason || '未记录退回原因'}
    </div>}
    {stage === 'cancelled' && <p className={styles.stateInfo}>订单已于揽收前取消，运单已作废。</p>}

    {scope === 'owner' && stage === 'waiting' && <div className={styles.receiptActionBar}>
      <span>揽收前：可取消</span>
      <div className={styles.receiptActions}><OwnerCancelOrder order={order} label="取消寄件" disabled={locked} onPendingChange={onCancelPending} onCancelled={onCancelled} /></div>
    </div>}
    {scope === 'owner' && stage === 'in_transit' && order.waybill && <div className={styles.receiptActionBar}>
      <span>已揽收且未派件出仓，可发起拦截</span>
      <div className={styles.carrierActions}>
        <OwnerCarrierChanges orderNo={order.orderNo} disabled={locked} onPendingChange={onCarrierPending} />
      </div>
    </div>}
    {scope === 'owner' && stage === 'returned' && (
      <div className={styles.receiptActionBar}>
        <span>审核未通过</span>
        {!order.waybill && (!order.cancellationState || order.cancellationState === 'not_sent') && onResubmit && <button type="button" className={styles.primaryAction} title="修改原单后重新提报" disabled={locked} onClick={onResubmit}>{opening ? '正在读取原单…' : '修改并重提'}</button>}
      </div>
    )}
  </li>
}

export default function MyWorkorders({ scope = 'public', refreshKey = 0, onResubmit, actionsLocked = false }: {
  scope?: 'public' | 'owner'; refreshKey?: number; onResubmit?: (original: ReturnedShipment, restore: RestoreOwnerRecord) => void; actionsLocked?: boolean
}) {
  const opening = useRef<AbortController | null>(null)
  const reading = useRef<AbortController | null>(null)
  const receipts = useRef<ShipmentReceipt[]>([])
  const lastPage = useRef(0)
  const view = useRef<{ filter: Filter; limit: number }>({ filter: 'all', limit: 5 })
  const [openingOrder, setOpeningOrder] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [changingCarrier, setChangingCarrier] = useState(false)
  const [orders, setOrders] = useState<ShipmentReceipt[] | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [statusFailures, setStatusFailures] = useState<Set<string>>(new Set())
  const [nextPage, setNextPage] = useState<number | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [displayLimit, setDisplayLimit] = useState(5)
  const actionPending = Boolean(openingOrder) || cancelling || changingCarrier
  useEffect(() => () => { opening.current?.abort(); reading.current?.abort() }, [scope])

  const refreshCarrierStatuses = useCallback(async (items: ShipmentReceipt[], signal: AbortSignal) => {
    const failed = new Set<string>()
    if (scope !== 'owner') return failed
    const active = items.filter(order => (order.status === 'waybill_created' || order.status === 'in_transit')
      && typeof order.waybill === 'string' && /^(?:SF)?\d{10,15}$/.test(order.waybill))
    for (const order of active) {
      if (signal.aborted) return failed
      try {
        const response = await fetch(`/api/shipping/owner/orders/${encodeURIComponent(order.orderNo)}/tracking`, {
          method: 'POST', credentials: 'same-origin', cache: 'no-store', signal,
        })
        const result = await response.json()
        if (!response.ok || result.verified !== true || result.waybill !== order.waybill) failed.add(order.orderNo)
      } catch { failed.add(order.orderNo) }
    }
    return failed
  }, [scope])

  const load = useCallback(async (page = 0, refreshOrder?: string) => {
    reading.current?.abort()
    const controller = new AbortController()
    reading.current = controller
    setBusy(true); setError('')
    try {
      async function readPage(index: number): Promise<{ orders: ShipmentReceipt[]; nextPage: number | null }> {
        const response = await fetch(`/api/shipping/${scope === 'owner' ? 'owner' : 'public'}/orders?page=${index}`, {
          cache: 'no-store', credentials: scope === 'owner' ? 'same-origin' : 'omit', signal: controller.signal,
        })
        const data = await response.json()
        if (!response.ok || !Array.isArray(data.orders)) throw new Error(data.error || '读取失败')
        return { orders: data.orders, nextPage: Number.isSafeInteger(data.nextPage) && data.nextPage > index ? data.nextPage : null }
      }
      const pages = new Map<number, Awaited<ReturnType<typeof readPage>>>()
      const end = page === 0 && scope === 'owner' ? lastPage.current : page
      for (let index = scope === 'owner' ? 0 : page; index <= end; index++) pages.set(index, await readPage(index))
      const mergePages = () => [...new Map([...(scope !== 'owner' && page > 0 ? receipts.current : []), ...[...pages.values()].flatMap(data => data.orders)]
        .map(order => [order.orderNo, order])).values()]
      let merged = mergePages()
      const candidates = merged.filter(order => view.current.filter === 'all' || stageOf(order) === view.current.filter).slice(0, view.current.limit)
      const failed = await refreshCarrierStatuses(candidates, controller.signal)
      if (scope === 'owner' && candidates.some(order => ['waybill_created', 'in_transit'].includes(order.status) && /^(?:SF)?\d{10,15}$/.test(order.waybill || ''))) {
        for (const index of pages.keys()) {
          try { pages.set(index, await readPage(index)) }
          catch { candidates.forEach(order => { if (order.waybill && ['waybill_created', 'in_transit'].includes(order.status)) failed.add(order.orderNo) }) }
        }
        merged = mergePages()
      }
      if (controller.signal.aborted) return
      const checked = new Set(candidates.map(order => order.orderNo))
      for (const order of merged.filter(order => view.current.filter === 'all' || stageOf(order) === view.current.filter).slice(0, view.current.limit)) {
        if (!checked.has(order.orderNo) && ['waybill_created', 'in_transit'].includes(order.status) && /^(?:SF)?\d{10,15}$/.test(order.waybill || '')) failed.add(order.orderNo)
      }
      setStatusFailures(failed)
      if (refreshOrder) {
        const latest = merged.find(item => item.orderNo === refreshOrder)
        if (latest) {
          receipts.current = receipts.current.map(item => item.orderNo === refreshOrder ? latest : item)
          setOrders(current => current?.map(item => item.orderNo === refreshOrder ? latest : item) ?? null)
        }
        return
      }
      receipts.current = merged
      setOrders(merged)
      lastPage.current = end
      setNextPage(pages.get(end)?.nextPage ?? null)
      if (scope !== 'owner' && page === 0) setDisplayLimit(5)
    } catch (e) {
      if (!controller.signal.aborted) {
        setError(e instanceof Error ? e.message : '读取失败')
        setStatusFailures(new Set(receipts.current.filter(order => ['waybill_created', 'in_transit'].includes(order.status)).map(order => order.orderNo)))
      }
    } finally {
      if (reading.current === controller) { reading.current = null; setBusy(false) }
    }
  }, [refreshCarrierStatuses, scope])
  useEffect(() => { void load() }, [load, refreshKey])
  useEffect(() => {
    if (scope !== 'owner') return
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible' && !busy && !actionPending) void load() }
    const interval = window.setInterval(refreshWhenVisible, 120_000)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', refreshWhenVisible) }
  }, [actionPending, busy, load, scope])

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
        if (receipt && 'resubmittedFrom' in receipt && receipt.resubmittedFrom === order.orderNo) {
          const limit = view.current.filter === 'all' ? view.current.limit + 1 : 5
          view.current = { filter: 'all', limit }
          setFilter('all')
          setDisplayLimit(limit)
          const updated = receipts.current
            .filter(item => item.orderNo !== receipt.orderNo)
            .map(item => item.orderNo === order.orderNo ? { ...item, status: 'resubmitted' as const, canCancel: false } : item)
          updated.push(receipt)
          updated.sort((first, second) => (Date.parse(second.createdAt || '') || 0) - (Date.parse(first.createdAt || '') || 0))
          receipts.current = updated
          setOrders(updated)
          void load()
          return
        }
        if (receipt?.orderNo === order.orderNo) {
          setOrders(current => current?.map(item => item.orderNo === order.orderNo ? { ...item, ...receipt } : item) ?? null)
        }
        void load(0, order.orderNo)
      })
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '读取原提报失败')
    } finally {
      opening.current = null
      if (!controller.signal.aborted) setOpeningOrder('')
    }
  }

  const filters: Array<{ key: Filter; label: string }> = [
    { key: 'all', label: '全部' }, { key: 'waiting', label: '待揽收' }, { key: 'in_transit', label: '运输中' },
    { key: 'out_for_delivery', label: '派送中' }, { key: 'delivered', label: '已签收' }, { key: 'returned', label: '已退回' },
  ]
  const loaded = orders || []
  const filtered = filter === 'all' ? loaded : loaded.filter(order => stageOf(order) === filter)
  const visible = filtered.slice(0, displayLimit)
  const groups = new Map<string, ShipmentReceipt[]>()
  for (const order of visible) {
    const date = order.createdAt ? dateFormat.format(new Date(order.createdAt)) : '日期未知'
    groups.set(date, [...(groups.get(date) || []), order])
  }
  const canShowMore = visible.length < filtered.length || nextPage !== null

  async function showMore() {
    view.current.limit = displayLimit + 5
    setDisplayLimit(view.current.limit)
    if (visible.length < filtered.length) { if (scope === 'owner') await load() }
    else if (nextPage !== null) await load(nextPage)
  }

  return <div className={styles.recordPanel}>
    <div className={styles.recordToolbar}>
      <div className={styles.recordFilters} role="group" aria-label="按状态筛选提报记录">
        {filters.map(item => {
          const count = item.key === 'all' ? loaded.length : loaded.filter(order => stageOf(order) === item.key).length
          return <button key={item.key} type="button" aria-pressed={filter === item.key} disabled={actionPending && filter !== item.key}
            onClick={() => { view.current = { filter: item.key, limit: 5 }; setFilter(item.key); setDisplayLimit(5); if (scope === 'owner') void load() }}>{item.label}{item.key === 'all' ? ` (${count})` : ''}</button>
        })}
      </div>
      <button type="button" className={styles.refreshRecords} aria-label="刷新提报记录" disabled={busy || actionPending} onClick={() => void load()}>
        <RefreshCw size={14} className={busy ? styles.spinning : undefined} aria-hidden="true" /><span>{busy ? '正在刷新' : '刷新'}</span>
      </button>
    </div>
    {error && <p role="alert">{error}</p>}
    {statusFailures.size > 0 && <p role="status" className={styles.stateInfo}>部分运单最新状态尚未核实，相关物流操作已暂停，请刷新核对。</p>}
    {orders && <>
      {loaded.length === 0 && <p className={styles.emptyRecords}>尚无提报记录</p>}
      {loaded.length > 0 && filtered.length === 0 && <p className={styles.emptyRecords}>当前状态下没有提报记录</p>}
      <div role="region" aria-label="按日期分组的提报记录" className={styles.recordGroups}>
        {[...groups].map(([date, dayOrders]) => <section className={styles.recordGroup} key={date} aria-label={date}>
          <h3>{date}</h3>
          <ul>{dayOrders.map(order => <ReceiptCard key={order.orderNo} order={order} scope={scope}
            locked={actionsLocked || busy || actionPending || statusFailures.has(order.orderNo)} opening={openingOrder === order.orderNo}
            onResubmit={onResubmit ? () => void openReturnedOrder(order) : undefined}
            onCancelled={() => setOrders(current => current?.map(item => item.orderNo === order.orderNo ? { ...item, status: 'cancelled' } : item) ?? null)}
            onCancelPending={setCancelling} onCarrierPending={setChangingCarrier} />)}</ul>
        </section>)}
      </div>
      {canShowMore && <button type="button" className={styles.loadMore} disabled={busy || actionPending} onClick={() => void showMore()}>{busy ? '正在读取…' : '显示更多记录'}</button>}
      {loaded.length > 0 && <p className={styles.recordFooter}>已显示 {visible.length} 条{nextPage === null && visible.length === filtered.length ? '，已加载全部记录' : ''}</p>}
    </>}
  </div>
}

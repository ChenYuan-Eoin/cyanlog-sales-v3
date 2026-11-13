'use client'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ShipmentReceipt } from '@/lib/shipping/types'
import styles from './sales-portal.module.css'
const labels: Record<string, string> = { awaiting_confirmation: '待审核', returned: '已退回，请联系操作员补充资料', confirmed: '已确认', ordering: '下单中', order_unknown: '下单结果待确认', waybill_created: '运单已生成', in_transit: '运输中', delivered: '已签收', cancelled: '已取消', order_failed: '下单未成功', accepted: '已受理' }
const dateFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric' })
const timeFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
export default function MyWorkorders({ scope = 'public', refreshKey = 0 }: { scope?: 'public' | 'owner'; refreshKey?: number }) {
  const [orders, setOrders] = useState<ShipmentReceipt[] | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState('')
  const [nextPage, setNextPage] = useState<number | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [expandedHeight, setExpandedHeight] = useState(720)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const load = useCallback(async (page = 0) => {
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/shipping/${scope === 'owner' ? 'owner' : 'public'}/orders?page=${page}`, { cache: 'no-store', credentials: scope === 'owner' ? 'same-origin' : 'omit' })
      const data = await response.json()
      if (!response.ok || !Array.isArray(data.orders)) throw new Error(data.error || '读取失败')
      setOrders(current => page === 0 ? data.orders : [...new Map([...(current || []), ...data.orders].map(order => [order.orderNo, order])).values()])
      setNextPage(Number.isSafeInteger(data.nextPage) && data.nextPage > page ? data.nextPage : null)
      if (page === 0) setExpanded(false)
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
  return <section className={styles.card}>
    <p className={styles.hint}>{scope === 'owner' ? '仅我的提报 · 按提报日期分组' : '全部快递 · 按提报日期分组'}</p>
    <div className={styles.recordToolbar}>
      <button type="button" disabled={busy} onClick={() => void load()}>{busy ? '正在读取…' : '刷新提报记录'}</button>
      {canExpand && <button type="button" aria-expanded={expanded} aria-controls={listId} onClick={() => { if (!expanded) setExpandedHeight(Math.max(720, (listRef.current?.getBoundingClientRect().height || 0) + 160)); setExpanded(current => !current) }}>{expanded ? '收起 · 最近5条' : '查看更早记录'}</button>}
    </div>
    {error && <p role="alert">{error}</p>}
    {orders && <>
      {orders.length === 0 && <p>尚无提报记录</p>}
      <div ref={listRef} id={listId} role="region" aria-label="按日期分组的提报记录" tabIndex={expanded ? 0 : undefined} style={expanded ? { maxHeight: expandedHeight } : undefined} className={`${styles.recordGroups} ${expanded ? styles.recordGroupsExpanded : ''}`}>
      {[...groups].map(([date, dayOrders]) => <section className={styles.recordGroup} key={date} aria-label={date}>
        <h3>{date}</h3>
        <ul>{dayOrders.map(order => <li key={order.orderNo}>
        <div className={styles.recordMeta}>{order.createdAt && <time dateTime={order.createdAt}>{timeFormat.format(new Date(order.createdAt))}</time>}<span>{labels[order.status] || '处理中'}</span></div>
        <span className={styles.recordCustomer} title={order.customerName || '未填客户'}>{order.customerName || '未填客户'}</span>
        <strong>{order.orderNo}</strong>
        {order.waybill && <span>顺丰运单号：<strong className={styles.waybillNumber}>{order.waybill}</strong></span>}
      </li>)}</ul></section>)}
      </div>
      {expanded && nextPage !== null && <button type="button" disabled={busy} onClick={() => void load(nextPage)}>加载更多快递</button>}
      {orders.length > 0 && <p className={styles.hint}>{!expanded && canExpand ? `最近 ${visibleOrders.length} 条` : `已显示 ${visibleOrders.length} 条${nextPage === null ? '，已加载全部记录' : ''}`}</p>}
    </>}
  </section>
}

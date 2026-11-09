'use client'
import { useCallback, useEffect, useState } from 'react'
import type { ShipmentReceipt } from '@/lib/shipping/types'
import styles from './sales-portal.module.css'
const labels: Record<string, string> = { awaiting_confirmation: '待审核', returned: '已退回，请联系操作员补充资料', confirmed: '已确认', ordering: '下单中', order_unknown: '下单结果待确认', waybill_created: '运单已生成', in_transit: '运输中', delivered: '已签收', cancelled: '已取消', order_failed: '下单未成功', accepted: '已受理' }
export default function MyWorkorders() {
  const [orders, setOrders] = useState<ShipmentReceipt[] | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState('')
  const [nextPage, setNextPage] = useState<number | null>(null)
  const load = useCallback(async (page = 0) => {
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/shipping/public/orders?page=${page}`, { cache: 'no-store', credentials: 'omit' })
      const data = await response.json()
      if (!response.ok || !Array.isArray(data.orders)) throw new Error(data.error || '读取失败')
      setOrders(current => page === 0 ? data.orders : [...new Map([...(current || []), ...data.orders].map(order => [order.orderNo, order])).values()])
      setNextPage(Number.isSafeInteger(data.nextPage) && data.nextPage > page ? data.nextPage : null)
    } catch (e) { setError(e instanceof Error ? e.message : '读取失败') } finally { setBusy(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  return <section className={styles.card}>
    <p>全部快递，按提报时间从新到旧排列。</p>
    <button type="button" disabled={busy} onClick={() => void load()}>{busy ? '正在读取…' : '刷新提报记录'}</button>
    {error && <p role="alert">{error}</p>}
    {orders && <>
      {orders.length === 0 && <p>尚无提报记录</p>}
      <ul>{orders.map(order => <li key={order.orderNo}>
        <strong>{order.orderNo}</strong><span>{labels[order.status] || '处理中'}</span>
        {order.createdAt && <time dateTime={order.createdAt}>{new Date(order.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</time>}
        {order.waybill && <span>顺丰运单号：{order.waybill}</span>}
      </li>)}</ul>
      {nextPage !== null && <button type="button" disabled={busy} onClick={() => void load(nextPage)}>加载更多快递</button>}
      {orders.length > 0 && <p>已显示 {orders.length} 条{nextPage === null ? '，已加载全部记录' : ''}</p>}
    </>}
  </section>
}

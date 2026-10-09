'use client'
import { useState } from 'react'
import type { ShipmentReceipt } from '@/lib/shipping/types'
import styles from './sales-portal.module.css'
const labels: Record<string, string> = { awaiting_confirmation: '待审核', returned: '已退回，请联系操作员补充资料', confirmed: '已确认', ordering: '下单中', order_unknown: '下单结果待确认', waybill_created: '运单已生成', in_transit: '运输中', delivered: '已签收', cancelled: '已取消', order_failed: '下单未成功', accepted: '已受理' }
export default function MyWorkorders() {
  const [orders, setOrders] = useState<ShipmentReceipt[] | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function load() {
    setBusy(true); setError('')
    try { const response = await fetch('/api/shipping/public/orders', { cache: 'no-store' }); const data = await response.json(); if (!response.ok) throw new Error(data.error || '读取失败'); setOrders(data.orders) }
    catch (e) { setError(e instanceof Error ? e.message : '读取失败') } finally { setBusy(false) }
  }
  return <section className={styles.card}><button type="button" disabled={busy} onClick={load}>{busy ? '正在读取…' : orders ? '刷新我的工单' : '查看我的工单'}</button>{error && <p role="alert">{error}</p>}{orders && <><p>最近 50 张工单；正式下单后在这里查看运单号。</p>{orders.length === 0 && <p>尚未提交工单</p>}<ul>{orders.map(order => <li key={order.orderNo}><strong>{order.orderNo}</strong> · {labels[order.status] || '处理中'}{order.waybill && <span> · 顺丰运单号：{order.waybill}</span>}</li>)}</ul></>}</section>
}

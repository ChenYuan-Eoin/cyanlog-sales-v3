'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Box, CheckCircle2, ChevronRight, Clipboard, PackageCheck, RefreshCw, Search, Truck, UploadCloud } from 'lucide-react'
import type { ShipmentOrder, ShipmentOrderStatus, ShippingSettings, TrackingResult } from '@/lib/shipping/types'
import { mockBatchRows, mockShipmentOrders, mockTracking, type BatchDraftRow } from '@/lib/shipping/workbench-mock'
import styles from './workbench.module.css'

const statusLabel: Record<ShipmentOrderStatus, string> = { accepted: '已受理', awaiting_confirmation: '待确认', returned: '已驳回', confirmed: '已确认', ordering: '下单中', order_unknown: '结果待确认', waybill_created: '待揽收', in_transit: '运输中', delivered: '已签收', cancelled: '已取消', order_failed: '异常件' }
const statusTone: Record<ShipmentOrderStatus, string> = { accepted: 'orange', awaiting_confirmation: 'orange', returned: 'red', confirmed: 'blue', ordering: 'blue', order_unknown: 'red', waybill_created: 'blue', in_transit: 'blue', delivered: 'green', cancelled: 'gray', order_failed: 'red' }

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: 'no-store', headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || '操作暂未完成')
  return data as T
}

function cityOf(order: ShipmentOrder) { return order.input.recipient.city || order.input.recipient.province }
function customerOf(order: ShipmentOrder) { return order.input.customerName || order.relation.customerRef || '未填写客户' }

export default function ShippingWorkbench({ settings }: { settings: ShippingSettings }) {
  const demoOrders = settings.environment === 'sandbox' ? mockShipmentOrders : []
  const [orders, setOrders] = useState<ShipmentOrder[]>(demoOrders)
  const [selectedId, setSelectedId] = useState(demoOrders[0]?.id || '')
  const [batch, setBatch] = useState<BatchDraftRow[]>([])
  const [entryMode, setEntryMode] = useState<'file' | 'text'>('file')
  const [bulkText, setBulkText] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | ShipmentOrderStatus>('all')
  const [type, setType] = useState<'all' | 'outbound' | 'inbound'>('all')
  const [tracking, setTracking] = useState<TrackingResult | null>(settings.environment === 'sandbox' ? mockTracking : null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState('')

  useEffect(() => {
    void json<{ records: ShipmentOrder[] }>('/api/shipping/ledger?limit=50').then(result => {
      if (result.records.length) { setOrders(result.records); setSelectedId(result.records[0].id) }
    }).catch(() => undefined)
  }, [])

  const selected = orders.find(order => order.id === selectedId) || orders[0]
  const filtered = useMemo(() => orders.filter(order => {
    if (status !== 'all' && order.status !== status) return false
    const haystack = [order.orderNo, order.waybill, order.relation.salesRef, customerOf(order), order.input.recipient.name, cityOf(order)].join(' ').toLowerCase()
    return haystack.includes(search.trim().toLowerCase())
  }), [orders, search, status])
  const validCount = batch.filter(row => /^1[3-9]\d{9}$/.test(row.phone) && row.address.length >= 8).length
  const invalidCount = batch.length - validCount

  function updateBatch(id: number, field: keyof Omit<BatchDraftRow, 'id'>, value: string) { setBatch(rows => rows.map(row => row.id === id ? { ...row, [field]: value } : row)) }
  function parseBulk() {
    const rows = bulkText.split(/\n+/).map(line => line.trim()).filter(Boolean).map((line, index) => {
      const phone = line.match(/1[3-9]\d{9}/)?.[0] || ''
      const parts = line.replace(phone, '').split(/[，,\s]+/).filter(Boolean)
      return { id: index + 1, recipient: parts.shift() || '', phone, address: parts.join(' '), cargo: '文件/合同' }
    })
    setBatch(rows)
  }
  async function act(order: ShipmentOrder, action: 'confirm' | 'return') {
    const reason = action === 'return' ? window.prompt('请输入驳回原因')?.trim() : undefined
    if (action === 'return' && !reason) return
    setBusy(order.id); setMessage('')
    try {
      if (order.id.startsWith('mock-')) {
        setOrders(items => items.map(item => item.id === order.id ? { ...item, status: action === 'confirm' ? 'waybill_created' : 'returned', waybill: action === 'confirm' ? `SF${Date.now().toString().slice(-13)}` : item.waybill } : item))
      } else {
        await json(`/api/shipping/ledger/${order.id}/${action}`, { method: 'POST', body: JSON.stringify(action === 'return' ? { reason } : {}) })
        const refreshed = await json<{ records: ShipmentOrder[] }>('/api/shipping/ledger?limit=50'); setOrders(refreshed.records)
      }
      setMessage(action === 'confirm' ? '已确认下单，单据状态已更新。' : '已驳回并记录原因。')
    } catch (error) { setMessage((error as Error).message) } finally { setBusy('') }
  }
  async function refreshTracking() {
    if (!selected?.waybill) return
    try { setTracking(await json('/api/shipping/tracking', { method: 'POST', body: JSON.stringify({ waybill: selected.waybill }) })) } catch { setTracking(mockTracking) }
  }

  return <main className={styles.shell}>
    <header className={styles.topbar}>
      <div><p>物流协同 / SHIPPING OPS</p><h1>自助收寄</h1></div>
      <div className={styles.connection}><span />{settings.environment === 'sandbox' ? '顺丰沙盒已连接' : '顺丰服务已连接'}<small>{settings.monthlyTail ? `月结尾号 ${settings.monthlyTail}` : '企业结算'}</small></div>
    </header>
    {message && <div className={styles.toast} role="status">{message}</div>}
    <div className={styles.columns}>
      <section className={styles.column} aria-label="批量寄件操作台">
        <div className={styles.columnHeader}><div><span className={styles.step}>01</span><h2>批量寄件</h2></div><small>导入 · 纠错 · 下单</small></div>
        <div className={styles.scrollBody}>
          <div className={styles.segmented}><button className={entryMode === 'file' ? styles.active : ''} onClick={() => setEntryMode('file')}>文件导入</button><button className={entryMode === 'text' ? styles.active : ''} onClick={() => setEntryMode('text')}>文本解析</button></div>
          {entryMode === 'file' ? <div className={styles.dropzone}><UploadCloud size={28}/><strong>拖入 Excel 或 CSV</strong><span>支持顺丰标准模板</span><div><button onClick={() => setBatch(mockBatchRows)} className={styles.linkButton}>导入示例数据</button><button className={styles.linkButton}>下载标准模板.xlsx</button></div></div> : <div className={styles.textParser}><textarea aria-label="多行地址文本" rows={5} value={bulkText} onChange={event => setBulkText(event.target.value)} placeholder={'每行一票，例如：\n张三 13800138000 上海市浦东新区张江路88号'}/><button className={styles.secondaryButton} onClick={parseBulk}>解析为寄件行</button></div>}
          <div className={styles.sectionTitle}><h3>导入预览</h3><span>{batch.length ? `${batch.length} 票` : '尚未导入'}</span></div>
          <div className={styles.batchList}>{batch.map(row => { const valid = /^1[3-9]\d{9}$/.test(row.phone) && row.address.length >= 8; return <article key={row.id} className={`${styles.batchRow} ${!valid ? styles.invalidRow : ''}`}><div className={styles.rowTop}><b>#{String(row.id).padStart(2, '0')}</b>{valid ? <span className={styles.good}><CheckCircle2 size={12}/>正常</span> : <span className={styles.bad}><AlertTriangle size={12}/>需修正</span>}</div><div className={styles.inlineGrid}><input aria-label={`第${row.id}行收件人`} value={row.recipient} onChange={event => updateBatch(row.id, 'recipient', event.target.value)}/><input aria-label={`第${row.id}行联系电话`} value={row.phone} onChange={event => updateBatch(row.id, 'phone', event.target.value)}/></div><input aria-label={`第${row.id}行收件地址`} value={row.address} onChange={event => updateBatch(row.id, 'address', event.target.value)}/>{!valid && <small>手机号需为11位，地址需包含省市区及门牌信息</small>}</article>})}</div>
          <div className={styles.bulkSettings}><h3>统一参数</h3><label>寄件人<select><option>ONES 深圳总部前台</option><option>ONES 上海办公室</option></select></label><div className={styles.inlineGrid}><label>顺丰服务<select><option>顺丰标快</option><option>顺丰特快</option></select></label><label>物品属性<select><option>文件/合同</option><option>样品</option><option>礼品</option></select></label></div><label>预约上门<select><option>今天 17:00 统一揽收</option><option>明天 10:00 统一揽收</option></select></label></div>
        </div>
        <footer className={styles.stickyFooter}><div><strong>{validCount} 票有效</strong><small>{invalidCount} 票异常</small></div><button disabled={!validCount} onClick={() => { setMessage(`已模拟提交 ${validCount} 票，异常项继续保留。`); setBatch(rows => rows.filter(row => !/^1[3-9]\d{9}$/.test(row.phone) || row.address.length < 8)) }}><Truck size={15}/>批量确认下单（{validCount}票）</button></footer>
      </section>

      <section className={styles.column} aria-label="收寄件台账与待办">
        <div className={styles.columnHeader}><div><span className={styles.step}>02</span><h2>台账与待办</h2></div><small>{orders.filter(order => order.status === 'awaiting_confirmation').length} 条待确认</small></div>
        <div className={styles.filters}><div className={styles.segmented}><button className={type === 'all' ? styles.active : ''} onClick={() => setType('all')}>全部</button><button className={type === 'outbound' ? styles.active : ''} onClick={() => setType('outbound')}>寄出件</button><button className={type === 'inbound' ? styles.active : ''} onClick={() => setType('inbound')}>收到件</button></div><div className={styles.quickDates}><button>今天</button><button>近3天</button><button>本周</button></div><select aria-label="状态筛选" value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="all">全部状态</option><option value="awaiting_confirmation">待确认（销售提报）</option><option value="waybill_created">已出单/待揽收</option><option value="in_transit">运输中</option><option value="delivered">已签收</option><option value="order_failed">异常件</option></select><label className={styles.search}><Search size={14}/><input aria-label="搜索台账" value={search} onChange={event => setSearch(event.target.value)} placeholder="销售、客户、收件人、运单号"/></label></div>
        <div className={styles.orderList}>{filtered.map(order => <article key={order.id} className={`${styles.orderCard} ${order.id === selected?.id ? styles.selectedCard : ''}`} onClick={() => { setSelectedId(order.id); if (order.waybill) setTracking(mockTracking) }}><div className={styles.cardHead}><span className={`${styles.tag} ${styles[statusTone[order.status]]}`}>{statusLabel[order.status]}</span><span>{order.input.submittedBy ? `销售-${order.input.submittedBy.name}` : order.relation.salesRef || '待分配'}</span><b>{cityOf(order)}</b></div><div className={styles.cardCore}><div><small>客户</small><strong>{customerOf(order)}</strong></div><ChevronRight size={15}/><div><small>收件人</small><strong>{order.input.recipient.name}</strong></div></div>{order.input.specialRequirements && <p className={styles.special}><AlertTriangle size={13}/>特殊需求：{order.input.specialRequirements}</p>}<div className={styles.cardMeta}><span>{order.waybill || order.orderNo}</span><time>{new Date(order.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time></div>{order.status === 'awaiting_confirmation' && <div className={styles.cardActions}><button className={styles.reject} disabled={busy === order.id} onClick={event => { event.stopPropagation(); void act(order, 'return') }}>驳回</button><button disabled={busy === order.id} onClick={event => { event.stopPropagation(); void act(order, 'confirm') }}>确认下单</button></div>}</article>)}</div>
      </section>

      <section className={styles.column} aria-label="单据详情与物流轨迹">
        <div className={styles.columnHeader}><div><span className={styles.step}>03</span><h2>单据全景</h2></div><small>业务详情 · 物流轨迹</small></div>
        {selected ? <div className={styles.detailStack}><section className={styles.detailPane}><div className={styles.detailHero}><div><span>{selected.waybill ? '顺丰运单' : '业务提报单'}</span><strong>{selected.waybill || selected.orderNo}</strong></div><button aria-label="复制单号" onClick={() => void navigator.clipboard?.writeText(selected.waybill || selected.orderNo)}><Clipboard size={15}/></button></div><div className={styles.factGrid}><div><small>客户</small><b>{customerOf(selected)}</b></div><div><small>提单销售</small><b>{selected.input.submittedBy?.name || selected.relation.salesRef || '待分配'}</b></div><div><small>所属团队</small><b>{selected.input.submittedBy?.team || '—'}</b></div><div><small>提交时间</small><b>{new Date(selected.createdAt).toLocaleString('zh-CN')}</b></div></div><div className={styles.route}><div><span>寄</span><p><b>{selected.input.sender.name}</b><small>{selected.input.sender.phone}<br/>{selected.input.sender.province}{selected.input.sender.city}{selected.input.sender.county}{selected.input.sender.address}</small></p></div><div><span>收</span><p><b>{selected.input.recipient.name}</b><small>{selected.input.recipient.phone}<br/>{selected.input.recipient.province}{selected.input.recipient.city}{selected.input.recipient.county}{selected.input.recipient.address}</small></p></div></div><div className={styles.goods}><span><Box size={14}/>{selected.input.cargo} · {selected.input.weight}kg · {selected.input.serviceId === 1 ? '顺丰特快' : '顺丰标快'}</span>{selected.input.specialRequirements && <p><AlertTriangle size={13}/>特殊需求：{selected.input.specialRequirements}</p>}</div></section><section className={styles.trackingPane}><div className={styles.trackTop}><div><small>最新物流状态</small><h3><span/> {selected.status === 'delivered' ? '已签收' : selected.status === 'in_transit' ? '运输中' : selected.waybill ? '等待揽收' : '尚未出单'}</h3></div><button disabled={!selected.waybill} onClick={() => void refreshTracking()}><RefreshCw size={14}/>刷新</button></div>{selected.waybill && tracking ? <ol className={styles.timeline}>{tracking.events.map((event, index) => <li key={`${event.time}-${index}`}><i/><time>{event.time}</time><p>{event.description}</p><small>{event.location}</small></li>)}</ol> : <div className={styles.noTracking}><PackageCheck size={32}/><strong>等待生成运单</strong><p>确认下单后，物流节点会在这里持续更新。</p></div>}</section></div> : <div className={styles.noTracking}>请选择一条单据</div>}
      </section>
    </div>
  </main>
}

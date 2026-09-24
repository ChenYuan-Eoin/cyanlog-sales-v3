'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Box, CheckCircle2, ChevronRight, Clipboard, PackageCheck, RefreshCw, Search, Settings, Truck, UploadCloud } from 'lucide-react'
import type { ShipmentOrder, ShipmentOrderStatus, ShippingSettings, TrackingResult } from '@/lib/shipping/types'
import { batchRowErrors, buildShippingTemplate, parseShippingFile, type BatchDraftRow } from '@/lib/shipping/import-parser'
import { parseAddress } from '@/lib/shipping/address'
import ShippingConfigDrawer from './config-drawer'
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
  const [orders, setOrders] = useState<ShipmentOrder[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [batch, setBatch] = useState<BatchDraftRow[]>([])
  const [entryMode, setEntryMode] = useState<'file' | 'text'>('file')
  const [bulkText, setBulkText] = useState('')
  const [batchBusy, setBatchBusy] = useState(false)
  const [connectionId, setConnectionId] = useState(settings.connectionId || '')
  const [serviceId, setServiceId] = useState(String(settings.services[0]?.id || ''))
  const [billingAccountId, setBillingAccountId] = useState(settings.defaultBillingAccountId || '')
  const [uniformCargo, setUniformCargo] = useState('文件/合同')
  const [pickupWindow, setPickupWindow] = useState('今天 17:00 统一揽收')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | ShipmentOrderStatus>('all')
  const [type, setType] = useState<'all' | 'outbound' | 'inbound'>('all')
  const [tracking, setTracking] = useState<TrackingResult | null>(null)
  const [manualWaybill, setManualWaybill] = useState('')
  const [phoneSuffix, setPhoneSuffix] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState('')
  const [configOpen, setConfigOpen] = useState(false)

  useEffect(() => {
    void json<{ records: ShipmentOrder[] }>('/api/shipping/ledger?limit=50').then(result => {
      if (result.records.length) { setOrders(result.records); setSelectedId(result.records[0].id) }
    }).catch(() => undefined)
  }, [])

  const selected = orders.find(order => order.id === selectedId) || orders[0]
  const filtered = useMemo(() => orders.filter(order => {
    if (type !== 'all' && (order.direction || 'outbound') !== type) return false
    if (status !== 'all' && order.status !== status) return false
    const haystack = [order.orderNo, order.waybill, order.relation.salesRef, customerOf(order), order.input.recipient.name, cityOf(order)].join(' ').toLowerCase()
    return haystack.includes(search.trim().toLowerCase())
  }), [orders, search, status, type])
  const validCount = batch.filter(row => batchRowErrors(row).length === 0 && row.result !== 'success').length
  const successCount = batch.filter(row => row.result === 'success').length
  const invalidCount = batch.filter(row => batchRowErrors(row).length > 0).length
  const selectedConnection = settings.carrierConnections?.find(connection => connection.id === connectionId)
  const selectedServices = selectedConnection?.services || settings.services
  const availableAccounts = (settings.billingAccounts || []).filter(account => account.connectionId === connectionId && account.status === 'active')
  const selectedAccount = availableAccounts.find(account => account.id === billingAccountId)
  const canSubmitCurrent = settings.carrierConnections?.length
    ? Boolean(selectedConnection?.status === 'connected' && availableAccounts.some(account => account.id === billingAccountId) && selectedServices.some(service => String(service.id) === serviceId) && settings.sender.name && (selectedConnection.environment !== 'production' || selectedConnection.orderCapability === 'verified'))
    : settings.canSubmit

  function updateBatch(id: number, field: keyof Omit<BatchDraftRow, 'id'>, value: string) { setBatch(rows => rows.map(row => row.id === id ? { ...row, [field]: value } : row)) }
  function changeConnection(nextId: string) {
    setConnectionId(nextId)
    const target = settings.carrierConnections?.find(connection => connection.id === nextId)
    setServiceId(String(target?.services[0]?.id || ''))
    const accounts = (settings.billingAccounts || []).filter(account => account.connectionId === nextId && account.status === 'active')
    setBillingAccountId(accounts.find(account => account.isDefault)?.id || accounts[0]?.id || '')
  }
  function parseBulk() {
    const rows = bulkText.split(/\n+/).map(line => line.trim()).filter(Boolean).map((line, index) => {
      const phone = line.match(/1[3-9]\d{9}/)?.[0] || ''
      const parts = line.replace(phone, '').split(/[，,\s]+/).filter(Boolean)
      return { id: index + 1, key: crypto.randomUUID(), recipient: parts.shift() || '', phone, address: parts.join(' '), cargo: uniformCargo }
    })
    setBatch(rows)
  }
  async function importFile(file?: File) {
    if (!file) return
    setMessage('')
    try { setBatch(await parseShippingFile(file)) } catch (error) { setMessage((error as Error).message) }
  }
  async function downloadTemplate() {
    const blob = await buildShippingTemplate(), url = URL.createObjectURL(blob), link = document.createElement('a')
    link.href = url; link.download = '寄件标准导入模板.xlsx'; link.click(); URL.revokeObjectURL(url)
  }
  async function executeBatch() {
    if (!canSubmitCurrent) { setMessage('当前连接、月结账号、寄件服务或寄件人资料未就绪，暂不能下单。'); return }
    const candidates = batch.filter(row => batchRowErrors(row).length === 0 && row.result !== 'success')
    if (!candidates.length) return
    setBatchBusy(true); setMessage('')
    let succeeded = 0
    for (const row of candidates) {
      setBatch(items => items.map(item => item.id === row.id ? { ...item, result: 'pending', error: undefined } : item))
      const recipient = parseAddress(`${row.recipient} ${row.phone} ${row.address}`).contact
      try {
        const receipt = await json<{ waybill: string | null }>('/api/shipping/owner/orders', { method: 'POST', body: JSON.stringify({ key: row.key, confirmed: true, connectionId: connectionId || undefined, billingAccountId: billingAccountId || undefined, input: { sender: settings.sender, recipient, cargo: uniformCargo, weight: 1, serviceId: Number(serviceId), remark: '', source: 'manual', payment: 'sender_monthly', pickupWindow } }) })
        succeeded += 1
        setBatch(items => items.map(item => item.id === row.id ? { ...item, result: 'success', waybill: receipt.waybill || undefined, error: undefined } : item))
      } catch (error) {
        setBatch(items => items.map(item => item.id === row.id ? { ...item, result: 'failed', error: (error as Error).message } : item))
      }
    }
    setBatchBusy(false); setMessage(`本次完成 ${succeeded} 票；失败和异常行已保留，可修正后使用原请求继续。`)
  }
  async function act(order: ShipmentOrder, action: 'confirm' | 'return') {
    const reason = action === 'return' ? window.prompt('请输入驳回原因')?.trim() : undefined
    if (action === 'return' && !reason) return
    setBusy(order.id); setMessage('')
    try {
      await json(`/api/shipping/ledger/${order.id}/${action}`, { method: 'POST', body: JSON.stringify(action === 'return' ? { reason } : { connectionId: connectionId || undefined, billingAccountId: billingAccountId || undefined, serviceId: Number(serviceId) || undefined }) })
      const refreshed = await json<{ records: ShipmentOrder[] }>('/api/shipping/ledger?limit=50'); setOrders(refreshed.records)
      setMessage(action === 'confirm' ? '已确认下单，单据状态已更新。' : '已驳回并记录原因。')
    } catch (error) { setMessage((error as Error).message) } finally { setBusy('') }
  }
  async function refreshTracking(number = manualWaybill || selected?.waybill || '') {
    if (!number) return
    try { setTracking(await json('/api/shipping/tracking', { method: 'POST', body: JSON.stringify({ waybill: number, ...(phoneSuffix ? { phoneSuffix } : {}) }) })); setManualWaybill(number) } catch (error) { setMessage((error as Error).message); setTracking(null) }
  }
  async function cancelSelected() {
    if (!selected || selected.status !== 'waybill_created') return
    setBusy(selected.id)
    try { await json(`/api/shipping/ledger/${selected.id}/cancel`, { method: 'POST', body: '{}' }); setOrders(items => items.map(item => item.id === selected.id ? { ...item, status: 'cancelled' } : item)); setMessage('顺丰运单已取消。') } catch (error) { setMessage((error as Error).message) } finally { setBusy('') }
  }

  if (settings.canOperate === false) return <main className={styles.shell}>
    <header className={styles.topbar}><div><p>LOGISTICS ADMINISTRATION</p><h1>寄件配置</h1></div><div className={styles.topbarActions}><button className={styles.configButton} onClick={() => setConfigOpen(true)}><Settings size={14}/>打开寄件配置</button></div></header>
    <section className={styles.configOnly}><Settings size={26}/><h2>你有寄件连接管理权限</h2><p>账号未获授权办理日常寄件。你可以在这里维护快递连接、月结账号与默认寄件资料。</p><button onClick={() => setConfigOpen(true)}>管理寄件配置</button></section>
    <ShippingConfigDrawer open={configOpen} onClose={() => setConfigOpen(false)} />
  </main>

  return <main className={styles.shell}>
    <header className={styles.topbar}>
      <div><p>物流协同 / SHIPPING OPS</p><h1>自助收寄</h1></div>
      <div className={styles.topbarActions}>{settings.canManageConnections && <button className={styles.configButton} onClick={() => setConfigOpen(true)}><Settings size={14}/>寄件配置</button>}<div className={styles.connection}><span />{selectedConnection ? `顺丰${selectedConnection.environment === 'sandbox' ? '沙盒' : '生产'}` : '未配置快递连接'}<small>{selectedAccount ? `${selectedAccount.displayName} · 尾号 ${selectedAccount.tail}` : '连接或月结账号待选择'}</small></div></div>
    </header>
    {message && <div className={styles.toast} role="status">{message}</div>}
    <div className={styles.columns}>
      <section className={styles.column} aria-label="批量寄件操作台">
        <div className={styles.columnHeader}><div><span className={styles.step}>01</span><h2>批量寄件</h2></div><small>导入 · 纠错 · 下单</small></div>
        <div className={styles.scrollBody}>
          <div className={styles.segmented}><button className={entryMode === 'file' ? styles.active : ''} onClick={() => setEntryMode('file')}>文件导入</button><button className={entryMode === 'text' ? styles.active : ''} onClick={() => setEntryMode('text')}>文本解析</button></div>
          {entryMode === 'file' ? <div className={styles.dropzone}><UploadCloud size={28}/><strong>选择 Excel 或 CSV</strong><span>支持 .xlsx / .csv，最多200票</span><input id="shipping-batch-file" className={styles.fileInput} type="file" accept=".xlsx,.csv" onChange={event => void importFile(event.target.files?.[0])}/><label htmlFor="shipping-batch-file" className={styles.fileButton}>选择文件</label><button className={styles.linkButton} onClick={() => void downloadTemplate()}>下载标准模板.xlsx</button></div> : <div className={styles.textParser}><textarea aria-label="多行地址文本" rows={5} value={bulkText} onChange={event => setBulkText(event.target.value)} placeholder={'每行一票，例如：\n张三 13800138000 上海市浦东新区张江路88号'}/><button className={styles.secondaryButton} onClick={parseBulk}>解析为寄件行</button></div>}
          <div className={styles.sectionTitle}><h3>导入预览</h3><span>{batch.length ? `${batch.length} 票` : '尚未导入'}</span></div>
          <div className={styles.batchList}>{batch.map(row => { const errors = batchRowErrors(row), valid = errors.length === 0; return <article key={row.id} className={`${styles.batchRow} ${!valid || row.result === 'failed' ? styles.invalidRow : ''}`}><div className={styles.rowTop}><b>#{String(row.id).padStart(2, '0')}</b>{row.result === 'success' ? <span className={styles.good}><CheckCircle2 size={12}/>{row.waybill || '已下单'}</span> : row.result === 'pending' ? <span className={styles.good}>提交中</span> : valid ? <span className={styles.good}><CheckCircle2 size={12}/>正常</span> : <span className={styles.bad}><AlertTriangle size={12}/>需修正</span>}</div><div className={styles.inlineGrid}><input aria-label={`第${row.id}行收件人`} disabled={batchBusy || row.result === 'success'} value={row.recipient} onChange={event => updateBatch(row.id, 'recipient', event.target.value)}/><input aria-label={`第${row.id}行联系电话`} disabled={batchBusy || row.result === 'success'} value={row.phone} onChange={event => updateBatch(row.id, 'phone', event.target.value)}/></div><input aria-label={`第${row.id}行收件地址`} disabled={batchBusy || row.result === 'success'} value={row.address} onChange={event => updateBatch(row.id, 'address', event.target.value)}/>{errors.length > 0 && <small>{errors.join('；')}</small>}{row.error && <small>{row.error}</small>}</article>})}</div>
          <div className={styles.bulkSettings}><h3>统一参数</h3><label>承运商连接<select value={connectionId} onChange={event => changeConnection(event.target.value)}>{(settings.carrierConnections || []).map(connection => <option key={connection.id} value={connection.id} disabled={connection.status !== 'connected'}>顺丰 · {connection.environment === 'sandbox' ? '沙盒' : '生产'} · {connection.status === 'connected' ? '已连接' : '待验证'}</option>)}</select></label><label>寄件人<select disabled><option>{settings.sender.name || '请先配置公司默认寄件人'}</option></select></label><label>月结账号<select value={billingAccountId} onChange={event => setBillingAccountId(event.target.value)}>{availableAccounts.map(account => <option key={account.id} value={account.id}>{account.displayName} · 尾号 {account.tail}{account.isDefault ? ' · 默认' : ''}</option>)}</select></label><div className={styles.inlineGrid}><label>寄件服务<select value={serviceId} onChange={event => setServiceId(event.target.value)}>{selectedServices.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label><label>物品属性<select value={uniformCargo} onChange={event => setUniformCargo(event.target.value)}><option>文件/合同</option><option>样品</option><option>礼品</option></select></label></div><label>预约上门<select value={pickupWindow} onChange={event => setPickupWindow(event.target.value)}><option>今天 17:00 统一揽收</option><option>明天 10:00 统一揽收</option></select></label></div>
        </div>
        <footer className={styles.stickyFooter}><div><strong>{validCount} 票待下单</strong><small>{successCount ? `${successCount} 票成功 · ` : ''}{invalidCount} 票异常</small></div><button disabled={!validCount || batchBusy || !canSubmitCurrent} onClick={() => void executeBatch()}><Truck size={15}/>{batchBusy ? '批量处理中…' : `批量确认下单（${validCount}票）`}</button></footer>
      </section>

      <section className={styles.column} aria-label="收寄件台账与待办">
        <div className={styles.columnHeader}><div><span className={styles.step}>02</span><h2>台账与待办</h2></div><small>{orders.filter(order => order.status === 'awaiting_confirmation').length} 条待确认</small></div>
        <div className={styles.filters}><div className={styles.segmented}><button className={type === 'all' ? styles.active : ''} onClick={() => setType('all')}>全部</button><button className={type === 'outbound' ? styles.active : ''} onClick={() => setType('outbound')}>寄出件</button><button className={type === 'inbound' ? styles.active : ''} onClick={() => setType('inbound')}>收到件</button></div><div className={styles.quickDates}><button>今天</button><button>近3天</button><button>本周</button></div><select aria-label="状态筛选" value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="all">全部状态</option><option value="awaiting_confirmation">待确认（销售提报）</option><option value="waybill_created">已出单/待揽收</option><option value="in_transit">运输中</option><option value="delivered">已签收</option><option value="order_failed">异常件</option></select><label className={styles.search}><Search size={14}/><input aria-label="搜索台账" value={search} onChange={event => setSearch(event.target.value)} placeholder="销售、客户、收件人、运单号"/></label></div>
        <div className={styles.orderList}>{filtered.map(order => <article key={order.id} className={`${styles.orderCard} ${order.id === selected?.id ? styles.selectedCard : ''}`} onClick={() => { setSelectedId(order.id); setManualWaybill(order.waybill || ''); setTracking(null) }}><div className={styles.cardHead}><span className={`${styles.tag} ${styles[statusTone[order.status]]}`}>{statusLabel[order.status]}</span><span>{order.input.submittedBy ? `销售-${order.input.submittedBy.name}` : order.relation.salesRef || '待分配'}</span><b>{cityOf(order)}</b></div><div className={styles.cardCore}><div><small>客户</small><strong>{customerOf(order)}</strong></div><ChevronRight size={15}/><div><small>收件人</small><strong>{order.input.recipient.name}</strong></div></div>{order.input.specialRequirements && <p className={styles.special}><AlertTriangle size={13}/>特殊需求：{order.input.specialRequirements}</p>}<div className={styles.cardMeta}><span>{order.waybill || order.orderNo}</span><time>{new Date(order.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time></div>{order.status === 'awaiting_confirmation' && <div className={styles.cardActions}><button className={styles.reject} disabled={busy === order.id} onClick={event => { event.stopPropagation(); void act(order, 'return') }}>驳回</button><button disabled={busy === order.id} onClick={event => { event.stopPropagation(); void act(order, 'confirm') }}>确认下单</button></div>}</article>)}</div>
      </section>

      <section className={styles.column} aria-label="单据详情与物流轨迹">
        <div className={styles.columnHeader}><div><span className={styles.step}>03</span><h2>单据全景</h2></div><small>业务详情 · 物流轨迹</small></div>
        {selected ? (
          <div className={styles.detailStack}>
            <section className={styles.detailPane}>
              <div className={styles.detailHero}>
                <div><span>{selected.waybill ? '承运商运单' : '业务提报单'}</span><strong>{selected.waybill || selected.orderNo}</strong></div>
                <div className={styles.detailActions}>
                  <button aria-label="复制单号" onClick={() => void navigator.clipboard?.writeText(selected.waybill || selected.orderNo)}><Clipboard size={15}/></button>
                  {selected.status === 'waybill_created' && <button className={styles.cancelButton} disabled={busy === selected.id} onClick={() => void cancelSelected()}>取消运单</button>}
                </div>
              </div>
              <div className={styles.factGrid}>
                <div><small>客户</small><b>{customerOf(selected)}</b></div>
                <div><small>提单销售</small><b>{selected.input.submittedBy?.name || selected.relation.salesRef || '待分配'}</b></div>
                <div><small>所属团队</small><b>{selected.input.submittedBy?.team || '—'}</b></div>
                <div><small>提交时间</small><b>{new Date(selected.createdAt).toLocaleString('zh-CN')}</b></div>
              </div>
              <div className={styles.route}>
                <div><span>寄</span><p><b>{selected.input.sender.name}</b><small>{selected.input.sender.phone}<br/>{selected.input.sender.province}{selected.input.sender.city}{selected.input.sender.county}{selected.input.sender.address}</small></p></div>
                <div><span>收</span><p><b>{selected.input.recipient.name}</b><small>{selected.input.recipient.phone}<br/>{selected.input.recipient.province}{selected.input.recipient.city}{selected.input.recipient.county}{selected.input.recipient.address}</small></p></div>
              </div>
              <div className={styles.goods}>
                <span><Box size={14}/>{selected.input.cargo} · {selected.input.weight}kg · {selected.input.serviceName || (selected.input.servicePreference === 'urgent' ? '加急偏好' : '标准偏好')}</span>
                {selected.input.specialRequirements && <p><AlertTriangle size={13}/>{selected.input.specialRequirements}</p>}
              </div>
            </section>
            <section className={styles.trackingPane}>
              <form className={styles.manualTrack} onSubmit={event => { event.preventDefault(); void refreshTracking(manualWaybill) }}>
                <input aria-label="备用查询运单号" value={manualWaybill} onChange={event => setManualWaybill(event.target.value.toUpperCase())} placeholder="临时查询其他顺丰运单"/>
                <input aria-label="查询手机号后四位" value={phoneSuffix} onChange={event => setPhoneSuffix(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="手机后四位"/>
                <button disabled={!manualWaybill}><Search size={14}/>查询</button>
              </form>
              <div className={styles.trackTop}>
                <div>
                  <small>最新物流状态</small>
                  <h3><span/> {selected.status === 'delivered' ? '已签收' : selected.status === 'in_transit' ? '运输中' : selected.waybill ? '等待揽收' : '尚未出单'}</h3>
                  <p className={styles.courier}>{tracking?.courier ? [tracking.courier.name, tracking.courier.employeeId, tracking.courier.phone].filter(Boolean).join(' · ') : '当前轨迹未提供快递员姓名、工号或电话'}</p>
                </div>
                <button disabled={!selected.waybill} onClick={() => void refreshTracking(selected.waybill || '')}><RefreshCw size={14}/>刷新</button>
              </div>
              {tracking ? (
                <ol className={styles.timeline}>{tracking.events.map((event, index) => <li key={`${event.time}-${index}`}><i/><time>{event.time}</time><p>{event.description}</p><small>{event.location}</small></li>)}</ol>
              ) : (
                <div className={styles.noTracking}><PackageCheck size={32}/><strong>等待查询物流</strong><p>输入运单号查询，其他人的运单可能需要手机号后四位。</p></div>
              )}
            </section>
          </div>
        ) : (
          <div className={styles.noTracking}><PackageCheck size={32}/><strong>暂无收寄记录</strong><p>本人或业务提报的真实单据会显示在这里。</p></div>
        )}
      </section>
    </div>
    {settings.canManageConnections && <ShippingConfigDrawer open={configOpen} onClose={() => setConfigOpen(false)} />}
  </main>
}

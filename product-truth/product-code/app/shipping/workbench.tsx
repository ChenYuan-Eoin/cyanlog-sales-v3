'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Box, CheckCircle2, ChevronRight, Clipboard, PackageCheck, RefreshCw, Search, Truck, UploadCloud } from 'lucide-react'
import type { ShipmentOrder, ShipmentOrderStatus, ShippingSettings, TrackingResult } from '@/lib/shipping/types'
import { buildShippingTemplate, parseShippingFile, type BatchDraftRow } from '@/lib/shipping/import-parser'
import { parseShippingText, prepareBatchRecipient } from '@/lib/shipping/batch-text'
import { shippingWorkbenchRequest, ShippingWorkbenchRequestError, isDefinitiveShippingRejection, type ShippingSimulation } from '@/lib/shipping/workbench-client'
import styles from './workbench.module.css'

const statusLabel: Record<ShipmentOrderStatus, string> = { accepted: '已受理', awaiting_confirmation: '待确认', returned: '已驳回', confirmed: '已确认', ordering: '下单中', order_unknown: '结果待确认', waybill_created: '待揽收', in_transit: '运输中', delivered: '已签收', cancelled: '已取消', order_failed: '异常件' }
const statusTone: Record<ShipmentOrderStatus, string> = { accepted: 'orange', awaiting_confirmation: 'orange', returned: 'red', confirmed: 'blue', ordering: 'blue', order_unknown: 'red', waybill_created: 'blue', in_transit: 'blue', delivered: 'green', cancelled: 'gray', order_failed: 'red' }
type BatchRow = Omit<BatchDraftRow, 'result'> & { result?: 'pending' | 'unknown' | 'success' | 'failed'; orderId?: string; needsNewRequestOnRetry?: boolean }
type SubmissionResult = { id?: string; orderId?: string; status?: ShipmentOrderStatus; waybill?: string | null }
const maySubmitRow = (row: BatchRow) => !row.result || row.result === 'failed'

function cityOf(order: ShipmentOrder) { return order.input.recipient.city || order.input.recipient.province }
function customerOf(order: ShipmentOrder) { return order.input.customerName || order.relation.customerRef || '未填写客户' }

function withTrackingStatus(order: ShipmentOrder, result: TrackingResult): ShipmentOrder {
  if (result.source === 'sandbox_mock' || order.waybill !== result.waybill || !result.shipmentStatus) return order
  // A delayed response must not reopen a collected or terminal shipment.
  if (order.status !== 'waybill_created' && order.status !== 'in_transit') return order
  const next = result.shipmentStatus
  if (next !== 'in_transit' && next !== 'delivered' && next !== 'cancelled') return order
  return next === order.status ? order : { ...order, status: next }
}

export default function ShippingWorkbench({ settings, simulation }: { settings: ShippingSettings; simulation?: ShippingSimulation }) {
  const request = simulation ? simulation.request : shippingWorkbenchRequest
  const isSimulation = Boolean(simulation)
  const [orders, setOrders] = useState<ShipmentOrder[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [batch, setBatch] = useState<BatchRow[]>([])
  const [entryMode, setEntryMode] = useState<'file' | 'text'>('text')
  const [bulkText, setBulkText] = useState(simulation?.sampleText || '')
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
  const [pendingProductionReviewId, setPendingProductionReviewId] = useState('')
  const [ledgerLoading, setLedgerLoading] = useState(true)
  const [trackingBusy, setTrackingBusy] = useState(false)
  const trackingRequest = useRef(0)
  const reconciliationRequests = useRef(new Set<string>())
  const batchRunning = useRef(false)
  const [dateRange, setDateRange] = useState<'all' | 'today' | 'three-days' | 'week'>('all')

  useEffect(() => {
    let active = true
    void request<{ records: ShipmentOrder[] }>('/api/shipping/ledger?limit=50').then(async result => {
      if (!active) return
      setOrders(result.records)
      const first = result.records[0]
      if (first) { setSelectedId(first.id); setManualWaybill(first.waybill || '') }
      if (isSimulation && first?.waybill) {
        const result = await request<TrackingResult>('/api/shipping/tracking', { method: 'POST', body: JSON.stringify({ waybill: first.waybill }) })
        if (active && trackingRequest.current === 0) setTracking(result)
      }
    }).catch(error => { if (active) setMessage(`收寄件台账读取失败：${(error as Error).message}`) })
      .finally(() => { if (active) setLedgerLoading(false) })
    return () => { active = false }
  }, [request, isSimulation])

  const selected = orders.find(order => order.id === selectedId) || orders[0]
  const filtered = useMemo(() => orders.filter(order => {
    if (type !== 'all' && (order.direction || 'outbound') !== type) return false
    if (status !== 'all' && order.status !== status) return false
    if (dateRange !== 'all') {
      const start = new Date(); start.setHours(0, 0, 0, 0)
      if (dateRange === 'three-days') start.setDate(start.getDate() - 2)
      if (dateRange === 'week') start.setDate(start.getDate() - (start.getDay() + 6) % 7)
      if (new Date(order.createdAt).getTime() < start.getTime()) return false
    }
    const haystack = [order.orderNo, order.waybill, order.relation.salesRef, customerOf(order), order.input.recipient.name, cityOf(order)].join(' ').toLowerCase()
    return haystack.includes(search.trim().toLowerCase())
  }), [orders, search, status, type, dateRange])
  const preparedRows = useMemo(() => batch.map(row => ({ row, ...prepareBatchRecipient({ ...row, result: undefined }) })), [batch])
  const validCount = preparedRows.filter(({ row, errors }) => !errors.length && maySubmitRow(row)).length
  const successCount = batch.filter(row => row.result === 'success').length
  const uncertainCount = batch.filter(row => row.result === 'unknown' || row.result === 'pending').length
  const inputLocked = batchBusy || uncertainCount > 0
  const invalidCount = preparedRows.filter(({ errors }) => errors.length > 0).length
  const selectedConnection = settings.carrierConnections?.find(connection => connection.id === connectionId)
  const selectedServices = selectedConnection?.services || settings.services
  const availableAccounts = (settings.billingAccounts || []).filter(account => account.connectionId === connectionId && account.status === 'active')
  const selectedAccount = availableAccounts.find(account => account.id === billingAccountId)
  const canSubmitCurrent = settings.carrierConnections?.length
    ? Boolean(selectedConnection?.status === 'connected' && availableAccounts.some(account => account.id === billingAccountId) && selectedServices.some(service => String(service.id) === serviceId) && settings.sender.name && (selectedConnection.environment !== 'production' || selectedConnection.orderCapability !== 'unavailable'))
    : settings.canSubmit
  const productionOrderUnverified = selectedConnection?.environment === 'production' && selectedConnection.orderCapability === 'not_tested'

  function successfulSubmission(result: SubmissionResult): result is SubmissionResult & { status: 'waybill_created'; waybill: string } {
    return result.status === 'waybill_created' && typeof result.waybill === 'string'
      && (isSimulation ? /^DEMO-\d{6}$/.test(result.waybill) : /^(?:SF)?\d{10,15}$/.test(result.waybill))
  }
  function definiteRejection(error: unknown) {
    return isDefinitiveShippingRejection(error) || (isSimulation && error instanceof Error && !(error instanceof ShippingWorkbenchRequestError))
  }
  function applySubmission(order: ShipmentOrder, result: SubmissionResult): ShipmentOrder {
    if (['cancelled', 'delivered', 'in_transit'].includes(order.status)) return order
    if (successfulSubmission(result)) return { ...order, status: 'waybill_created', waybill: result.waybill }
    if (successfulSubmission(order)) return order
    return { ...order, status: result.status === 'ordering' ? 'ordering' : result.status === 'order_failed' ? 'order_failed' : 'order_unknown', waybill: null }
  }
  function updateBatch(id: number, field: 'recipient' | 'phone' | 'address', value: string) { setBatch(rows => rows.map(row => row.id === id && maySubmitRow(row) && !batchBusy ? { ...row, [field]: value } : row)) }
  function changeConnection(nextId: string) {
    setConnectionId(nextId)
    const target = settings.carrierConnections?.find(connection => connection.id === nextId)
    setServiceId(String(target?.services[0]?.id || ''))
    const accounts = (settings.billingAccounts || []).filter(account => account.connectionId === nextId && account.status === 'active')
    setBillingAccountId(accounts.find(account => account.isDefault)?.id || accounts[0]?.id || '')
  }
  function parseBulk() {
    if (inputLocked) return
    setMessage('')
    try { setBatch(parseShippingText(bulkText, uniformCargo)) }
    catch (error) { setMessage((error as Error).message) }
  }
  async function importFile(file?: File) {
    if (!file || inputLocked) return
    setMessage('')
    try {
      const imported = await parseShippingFile(file)
      // A file read started before submission must not replace unresolved rows.
      setBatch(rows => rows.some(row => row.result === 'pending' || row.result === 'unknown') ? rows : imported)
    } catch (error) { setMessage((error as Error).message) }
  }
  async function downloadTemplate() {
    const blob = await buildShippingTemplate(), url = URL.createObjectURL(blob), link = document.createElement('a')
    link.href = url; link.download = '寄件标准导入模板.xlsx'; link.click(); URL.revokeObjectURL(url)
  }
  async function executeBatch() {
    if (batchRunning.current) return
    if (productionOrderUnverified) { setMessage('首票Production订单尚未实测。请先从台账选择一票，在右侧核对完整收寄资料后逐票确认。'); return }
    if (!canSubmitCurrent) { setMessage('当前连接、月结账号、寄件服务或寄件人资料未就绪，暂不能下单。'); return }
    const candidates = preparedRows.filter(({ row, errors }) => !errors.length && maySubmitRow(row))
    if (!candidates.length) return
    batchRunning.current = true
    setBatchBusy(true); setMessage('')
    let succeeded = 0, uncertain = 0, failed = 0
    const successfulWaybills: string[] = []
    const affectedOrderIds: string[] = []
    for (const { row, recipient } of candidates) {
      try {
        // Only a new user click after a definitive carrier rejection may start
        // a new request. Validation retries and uncertain outcomes keep the key.
        const requestKey = row.needsNewRequestOnRetry ? globalThis.crypto.randomUUID() : row.key
        setBatch(items => items.map(item => item.id === row.id ? { ...item, key: requestKey, orderId: row.needsNewRequestOnRetry ? undefined : item.orderId, needsNewRequestOnRetry: false, result: 'pending', error: undefined } : item))
        const receipt = await request<SubmissionResult>('/api/shipping/owner/orders', { method: 'POST', body: JSON.stringify({ key: requestKey, confirmed: true, connectionId: connectionId || undefined, billingAccountId: billingAccountId || undefined, input: { sender: settings.sender, recipient, cargo: uniformCargo, weight: 1, serviceId: Number(serviceId), remark: '', source: 'manual', payment: 'sender_monthly', pickupWindow } }) })
        const orderId = receipt.orderId || receipt.id
        if (orderId) affectedOrderIds.push(orderId)
        if (successfulSubmission(receipt)) {
          succeeded += 1; successfulWaybills.push(receipt.waybill)
          setBatch(items => items.map(item => item.id === row.id ? { ...item, orderId, result: 'success', waybill: receipt.waybill, error: undefined } : item))
        } else {
          uncertain += 1
          setBatch(items => items.map(item => item.id === row.id ? { ...item, orderId, result: 'unknown', waybill: undefined, error: orderId ? '下单结果待确认，请查回原单，勿重复下单。' : '服务端未返回单据编号，请从台账查回，勿重复下单。' } : item))
        }
      } catch (error) {
        if (definiteRejection(error)) {
          failed += 1
          const needsNewRequestOnRetry = error instanceof ShippingWorkbenchRequestError && error.requestStage === 'provider_rejected'
          setBatch(items => items.map(item => item.id === row.id ? { ...item, result: 'failed', needsNewRequestOnRetry, error: (error as Error).message } : item))
        } else {
          uncertain += 1
          setBatch(items => items.map(item => item.id === row.id ? { ...item, result: 'unknown', error: '请求结果不明，已保留原请求编号。请从台账查回原单，勿重新解析或重复下单。' } : item))
        }
      }
    }
    let ledgerRefreshError = ''
    if (candidates.length) {
      try {
        const ledger = await request<{ records: ShipmentOrder[] }>('/api/shipping/ledger?limit=50')
        setOrders(ledger.records)
        const newOrder = ledger.records.find(order => affectedOrderIds.includes(order.id) || (order.waybill && successfulWaybills.includes(order.waybill)))
        if (newOrder) { setSelectedId(newOrder.id); setManualWaybill(newOrder.waybill || ''); setTracking(null); trackingRequest.current += 1 }
      } catch (error) { ledgerRefreshError = `台账刷新失败：${(error as Error).message}` }
    }
    batchRunning.current = false
    setBatchBusy(false); setMessage(`${isSimulation ? '模拟结果' : '本次结果'}：成功 ${succeeded} 票；待确认 ${uncertain} 票；失败 ${failed} 票。${uncertain ? '待确认行已锁定，请查回原单，勿重新解析或重复下单。' : '已保留失败行和原请求编号。'}${ledgerRefreshError ? ` ${ledgerRefreshError}` : ''}`)
  }
  async function reconcileOrder(orderId: string) {
    if (!orderId || reconciliationRequests.current.has(orderId) || batchBusy) return
    reconciliationRequests.current.add(orderId); setBusy(orderId); setMessage('')
    try {
      const result = await request<SubmissionResult>(`/api/shipping/ledger/${encodeURIComponent(orderId)}/reconcile`, { method: 'POST', body: '{}' })
      if ((result.id && result.id !== orderId) || (result.orderId && result.orderId !== orderId)) throw new Error('查回结果的单据编号不一致，已保留原单。')
      const successful = successfulSubmission(result)
      setBatch(rows => rows.map(row => row.orderId === orderId ? { ...row, result: successful ? 'success' : 'unknown', waybill: successful ? result.waybill : undefined, error: successful ? undefined : '查回结果仍待确认，请稍后继续查回原单，勿重复下单。' } : row))
      setOrders(rows => rows.map(order => order.id === orderId ? applySubmission(order, result) : order))
      let refreshError = ''
      try {
        const refreshed = await request<{ records: ShipmentOrder[] }>('/api/shipping/ledger?limit=50')
        setOrders(refreshed.records.map(order => order.id === orderId ? applySubmission(order, result) : order))
      } catch (error) { refreshError = ` 台账刷新失败：${(error as Error).message}` }
      setSelectedId(orderId)
      if (successful) { setManualWaybill(result.waybill); setTracking(null); trackingRequest.current += 1 }
      setMessage(`${successful ? `${isSimulation ? '模拟' : ''}已查回运单 ${result.waybill}。` : '查回结果仍待确认，请稍后继续查回原单，勿重复下单。'}${refreshError}`)
    } catch (error) { setMessage(`查回失败：${(error as Error).message} 原单已保留，请稍后继续查回。`) }
    finally { reconciliationRequests.current.delete(orderId); setBusy('') }
  }
  async function act(order: ShipmentOrder, action: 'confirm' | 'return', productionReviewed = false) {
    if (action === 'confirm' && productionOrderUnverified && !productionReviewed) {
      setSelectedId(order.id); setManualWaybill(order.waybill || ''); setTracking(null); setPendingProductionReviewId(order.id); setMessage('该首票已载入右侧详情，请核对完整寄收地址、服务和月结账号。')
      return
    }
    const reason = action === 'return' ? window.prompt('请输入驳回原因')?.trim() : undefined
    if (action === 'return' && !reason) return
    if (action === 'confirm') setPendingProductionReviewId('')
    setBusy(order.id); setMessage('')
    try {
      const result = await request<SubmissionResult>(`/api/shipping/ledger/${order.id}/${action}`, { method: 'POST', body: JSON.stringify(action === 'return' ? { reason } : { connectionId: connectionId || undefined, billingAccountId: billingAccountId || undefined, serviceId: Number(serviceId) || undefined }) })
      if (action === 'confirm') setOrders(rows => rows.map(item => item.id === order.id ? applySubmission(item, result) : item))
      let refreshError = ''
      try {
        const refreshed = await request<{ records: ShipmentOrder[] }>('/api/shipping/ledger?limit=50')
        setOrders(refreshed.records.map(item => action === 'confirm' && item.id === order.id ? applySubmission(item, result) : item))
      } catch (error) { refreshError = ` 台账刷新失败：${(error as Error).message}` }
      setMessage((action === 'confirm' ? successfulSubmission(result) ? `${isSimulation ? '模拟' : '已'}确认下单，运单 ${result.waybill}。` : '下单结果待确认，请查回原单，勿重复下单。' : '已驳回并记录原因。') + refreshError)
    } catch (error) {
      if (action === 'confirm' && !definiteRejection(error)) {
        const pending: SubmissionResult = { status: 'order_unknown', waybill: null }
        setOrders(rows => rows.map(item => item.id === order.id ? applySubmission(item, pending) : item))
        try {
          const refreshed = await request<{ records: ShipmentOrder[] }>('/api/shipping/ledger?limit=50')
          setOrders(refreshed.records.map(item => item.id === order.id ? applySubmission(item, pending) : item))
        } catch { /* The original order remains available for reconciliation. */ }
        setMessage('下单结果待确认，请查回原单，勿重复下单。')
      } else setMessage((error as Error).message)
    } finally { setBusy('') }
  }
  async function refreshTracking(number = manualWaybill || selected?.waybill || '') {
    if (!number) return
    const currentRequest = ++trackingRequest.current
    setTrackingBusy(true); setMessage('')
    try {
      const result = await request<TrackingResult>('/api/shipping/tracking', { method: 'POST', body: JSON.stringify({ waybill: number, ...(phoneSuffix ? { phoneSuffix } : {}) }) })
      if (currentRequest === trackingRequest.current) {
        setTracking(result); setManualWaybill(number)
        if (result.shipmentStatus) setOrders(items => items.map(order => withTrackingStatus(order, result)))
      }
    } catch (error) {
      if (currentRequest === trackingRequest.current) { setMessage((error as Error).message); setTracking(null) }
    } finally { if (currentRequest === trackingRequest.current) setTrackingBusy(false) }
  }
  async function cancelSelected() {
    if (!selected || selected.status !== 'waybill_created') return
    setBusy(selected.id)
    try { await request(`/api/shipping/ledger/${selected.id}/cancel`, { method: 'POST', body: '{}' }); setOrders(items => items.map(item => item.id === selected.id ? { ...item, status: 'cancelled' } : item)); setTracking(null); trackingRequest.current += 1; setTrackingBusy(false); setMessage(isSimulation ? '模拟运单已取消，没有操作真实运单。' : '顺丰运单已取消。') } catch (error) { setMessage((error as Error).message) } finally { setBusy('') }
  }

  return <main className={styles.shell}>
    <header className={styles.topbar}>
      <div><p>物流协同 / SHIPPING OPS</p><h1>自助收寄</h1></div>
      <div className={styles.topbarActions}>
        {simulation ? <><button className={styles.configButton} disabled={inputLocked || !!busy} onClick={simulation.onReset}>重置演示</button><a className={styles.configButton} href="/shipping">返回真实工作台</a></> : <><a className={styles.configButton} href="/shipping/demo">模拟体验</a><a className={styles.configButton} href="/sales-portal">销售寄件提报</a></>}
        <div className={styles.connection}><span />{isSimulation ? '模拟体验' : selectedConnection ? `顺丰${selectedConnection.environment === 'sandbox' ? '沙盒' : '生产'}` : '未配置快递连接'}<small>{selectedAccount ? `${selectedAccount.displayName} · 尾号 ${selectedAccount.tail}` : '连接或月结账号待选择'}</small></div>
      </div>
    </header>
    {simulation && <div className={styles.simulationNotice} role="note"><strong>模拟体验</strong> 地址、单号和轨迹均为示例，仅在当前页面演示，不向顺丰下单、不产生费用。<span>先解析左侧4条地址 → 修正手机号 → 模拟下单 → 查看台账、轨迹与取消；中栏还有待确认的销售提报。</span></div>}

    {message && <div className={styles.toast} role="status">{message}</div>}
    {productionOrderUnverified && <div className={styles.notice} role="status">Production只读连接已通过，但下单权限尚未实测。请先从台账选择一票，在右侧核对完整资料并单票确认；本次首票实测前，批量下单保持禁用。</div>}
    <div className={styles.columns}>
      <section className={styles.column} aria-label="批量寄件操作台">
        <div className={styles.columnHeader}><div><span className={styles.step}>01</span><h2>批量寄件</h2></div><small>粘贴 · 纠错 · 下单</small></div>
        <div className={styles.scrollBody}>
          <div className={styles.segmented} role="group" aria-label="地址录入方式"><button aria-pressed={entryMode === 'text'} className={entryMode === 'text' ? styles.active : ''} disabled={inputLocked} onClick={() => setEntryMode('text')}>文本解析</button><button aria-pressed={entryMode === 'file'} className={entryMode === 'file' ? styles.active : ''} disabled={inputLocked} onClick={() => setEntryMode('file')}>文件导入</button></div>
          {entryMode === 'file' ? <div className={styles.dropzone}><UploadCloud size={28}/><strong>选择 Excel 或 CSV</strong><span>支持 .xlsx / .csv，最多200票</span><input id="shipping-batch-file" className={styles.fileInput} type="file" accept=".xlsx,.csv" disabled={inputLocked} onChange={event => void importFile(event.target.files?.[0])}/><label htmlFor="shipping-batch-file" className={styles.fileButton}>选择文件</label><button className={styles.linkButton} onClick={() => void downloadTemplate()}>下载标准模板.xlsx</button></div> : <div className={styles.textParser}><p>支持多位收件人；同一人的姓名、电话和地址可分行，空行有助于分票。解析后请核对每票资料。</p><textarea aria-label="多行地址文本" rows={6} maxLength={100000} disabled={inputLocked} value={bulkText} onChange={event => setBulkText(event.target.value)} placeholder={'姓名：示例甲\n电话：13800000000\n地址：广东省深圳市南山区示例路88号\n\n示例乙 13900000000 上海市浦东新区示例路66号'}/><div className={styles.parserActions}><button className={styles.secondaryButton} disabled={!bulkText.trim() || inputLocked} onClick={parseBulk}>解析为寄件行</button>{simulation && <button className={styles.linkButton} disabled={inputLocked} onClick={() => setBulkText(simulation.sampleText)}>重填示例地址</button>}</div></div>}
          <div className={styles.sectionTitle}><h3>{entryMode === 'text' ? '解析预览' : '导入预览'}</h3><span>{batch.length ? `${batch.length} 票` : entryMode === 'text' ? '等待解析地址' : '尚未导入'}</span></div>
          {invalidCount > 0 && <p className={styles.batchValidationSummary} role="status">{invalidCount} 票需修正；仅 {validCount} 票有效资料可提交。</p>}
          <div className={styles.batchList}>{preparedRows.map(({ row, errors, fieldErrors }) => {
            const valid = errors.length === 0
            return <article key={row.id} className={`${styles.batchRow} ${!valid || row.result === 'failed' ? styles.invalidRow : ''}`}>
              <div className={styles.rowTop}>
                <b>#{String(row.id).padStart(2, '0')}</b>
                {row.result === 'success' ? <span className={styles.good}><CheckCircle2 size={12}/>{row.waybill}</span>
                  : row.result === 'unknown' ? <span className={styles.bad}>结果待确认</span>
                  : row.result === 'pending' ? <span className={styles.good}>提交中</span>
                  : valid ? <span className={styles.good}><CheckCircle2 size={12}/>正常</span>
                  : <span className={styles.bad}><AlertTriangle size={12}/>需修正</span>}
              </div>
              <div className={styles.batchFields}>{([
                { field: 'recipient', label: '收件人', placeholder: '请补充收件人姓名' },
                { field: 'phone', label: '联系电话', placeholder: '请输入11位收件人手机号' },
                { field: 'address', label: '收件地址', placeholder: '请补充省市区、街道和门牌号' },
              ] as const).map(({ field, label, placeholder }) => {
                const inputId = `shipping-batch-${row.id}-${field}`
                const problems = fieldErrors[field]
                const errorId = `${inputId}-error`
                return <label key={field} htmlFor={inputId} className={`${styles.batchField} ${field === 'address' ? styles.batchAddress : ''}`}>
                  <span>{label}</span>
                  <input id={inputId} aria-label={`第${row.id}行${label}`} aria-invalid={problems.length > 0} aria-describedby={problems.length ? errorId : undefined}
                    type={field === 'phone' ? 'tel' : 'text'} placeholder={placeholder} disabled={batchBusy || !maySubmitRow(row)}
                    value={row[field]} onChange={event => updateBatch(row.id, field, event.target.value)}/>
                  {problems.length > 0 && <small id={errorId} className={styles.fieldError}>{problems.join('；')}</small>}
                </label>
              })}</div>
              {row.originalText && <details className={styles.originalText}><summary>查看原文</summary><pre aria-label={`第${row.id}票原文`}>{row.originalText}</pre></details>}
              {row.error && <small>{row.error}</small>}
              {row.result === 'unknown' && row.orderId && <button className={styles.secondaryButton} aria-label={`查回第${row.id}行下单结果`} disabled={batchBusy || busy === row.orderId} onClick={() => void reconcileOrder(row.orderId!)}>{busy === row.orderId ? '查回中…' : '查回下单结果'}</button>}
            </article>
          })}</div>
          <div className={styles.bulkSettings}><h3>统一参数</h3><label>承运商连接<select value={connectionId} onChange={event => changeConnection(event.target.value)}>{(settings.carrierConnections || []).map(connection => <option key={connection.id} value={connection.id} disabled={connection.status !== 'connected'}>顺丰 · {connection.environment === 'sandbox' ? '沙盒' : '生产'} · {connection.status === 'connected' ? '已连接' : '待验证'}</option>)}</select></label><label>寄件人<select disabled><option>{settings.sender.name || '请先配置公司默认寄件人'}</option></select></label><label>月结账号<select value={billingAccountId} onChange={event => setBillingAccountId(event.target.value)}>{availableAccounts.map(account => <option key={account.id} value={account.id}>{account.displayName} · 尾号 {account.tail}{account.isDefault ? ' · 默认' : ''}</option>)}</select></label><div className={styles.inlineGrid}><label>寄件服务<select value={serviceId} onChange={event => setServiceId(event.target.value)}>{selectedServices.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label><label>物品属性<select value={uniformCargo} onChange={event => setUniformCargo(event.target.value)}><option>文件/合同</option><option>样品</option><option>礼品</option></select></label></div><label>预约上门<select value={pickupWindow} onChange={event => setPickupWindow(event.target.value)}><option>今天 17:00 统一揽收</option><option>明天 10:00 统一揽收</option></select></label></div>
        </div>
        <footer className={styles.stickyFooter}><div><strong>{validCount} 票待下单</strong><small>{successCount ? `${successCount} 票成功 · ` : ''}{uncertainCount ? `${uncertainCount} 票待确认 · ` : ''}{invalidCount} 票异常</small></div><button disabled={!validCount || batchBusy || !canSubmitCurrent || productionOrderUnverified} onClick={() => void executeBatch()}><Truck size={15}/>{batchBusy ? '批量处理中…' : `${isSimulation ? '模拟批量下单' : '批量确认下单'}（${validCount}票）`}</button></footer>
      </section>

      <section className={styles.column} aria-label="收寄件台账与待办">
        <div className={styles.columnHeader}><div><span className={styles.step}>02</span><h2>台账与待办</h2></div><small>{orders.filter(order => order.status === 'awaiting_confirmation').length} 条待确认</small></div>
        <div className={styles.filters}><div className={styles.segmented}><button className={type === 'all' ? styles.active : ''} onClick={() => setType('all')}>全部</button><button className={type === 'outbound' ? styles.active : ''} onClick={() => setType('outbound')}>寄出件</button><button className={type === 'inbound' ? styles.active : ''} onClick={() => setType('inbound')}>收到件</button></div><div className={styles.quickDates}>{([{ value: 'all', label: '全部日期' }, { value: 'today', label: '今天' }, { value: 'three-days', label: '近3天' }, { value: 'week', label: '本周' }] as const).map(item => <button key={item.value} aria-pressed={dateRange === item.value} onClick={() => setDateRange(item.value)}>{item.label}</button>)}</div><select aria-label="状态筛选" value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="all">全部状态</option><option value="awaiting_confirmation">待确认（销售提报）</option><option value="order_unknown">下单结果待确认</option><option value="ordering">下单中</option><option value="waybill_created">已出单/待揽收</option><option value="in_transit">运输中</option><option value="delivered">已签收</option><option value="order_failed">异常件</option></select><label className={styles.search}><Search size={14}/><input aria-label="搜索台账" value={search} onChange={event => setSearch(event.target.value)} placeholder="销售、客户、收件人、运单号"/></label></div>
        <div className={styles.orderList}>{ledgerLoading ? <p className={styles.listHint}>正在读取台账…</p> : !filtered.length && <p className={styles.listHint}>暂无匹配单据</p>}{filtered.map(order => <article key={order.id} className={`${styles.orderCard} ${order.id === selected?.id ? styles.selectedCard : ''}`} onClick={() => { setSelectedId(order.id); setManualWaybill(order.waybill || ''); setTracking(null); trackingRequest.current += 1; setTrackingBusy(false) }}><div className={styles.cardHead}><span className={`${styles.tag} ${styles[statusTone[order.status]]}`}>{statusLabel[order.status]}</span><span>{order.input.submittedBy ? `销售-${order.input.submittedBy.name}` : order.relation.salesRef || '待分配'}</span><b>{cityOf(order)}</b></div><div className={styles.cardCore}><div><small>客户</small><strong>{customerOf(order)}</strong></div><ChevronRight size={15}/><div><small>收件人</small><strong>{order.input.recipient.name}</strong></div></div>{order.input.specialRequirements && <p className={styles.special}><AlertTriangle size={13}/>特殊需求：{order.input.specialRequirements}</p>}<div className={styles.cardMeta}><span>{order.waybill || order.orderNo}</span><time>{new Date(order.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time></div>{order.status === 'awaiting_confirmation' && <div className={styles.cardActions}><button className={styles.reject} disabled={busy === order.id} onClick={event => { event.stopPropagation(); void act(order, 'return') }}>驳回</button><button disabled={busy === order.id} onClick={event => { event.stopPropagation(); void act(order, 'confirm') }}>{isSimulation ? '模拟确认下单' : '确认下单'}</button></div>}</article>)}</div>
      </section>

      <section className={styles.column} aria-label="单据详情与物流轨迹">
        <div className={styles.columnHeader}><div><span className={styles.step}>03</span><h2>单据全景</h2></div><small>业务详情 · 物流轨迹</small></div>
        <form className={styles.manualTrack} aria-label="物流轨迹查询" onSubmit={event => { event.preventDefault(); void refreshTracking(manualWaybill) }}>
          <input aria-label="备用查询运单号" value={manualWaybill} onChange={event => setManualWaybill(event.target.value.toUpperCase())} placeholder="输入顺丰运单号查询" />
          <input aria-label="查询手机号后四位" value={phoneSuffix} onChange={event => setPhoneSuffix(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="手机后四位" />
          <button type="submit" disabled={!manualWaybill || trackingBusy}><Search size={14}/>{trackingBusy ? '查询中…' : '查询轨迹'}</button>
        </form>
        {tracking?.source === 'sandbox_mock' && <p className={styles.trackingNotice} role="note">顺丰沙盒返回的是模拟轨迹，不用于判断实际揽收、签收或取消状态。</p>}
        {selected ? (
          <div className={styles.detailStack}>
            <section className={styles.detailPane}>
              <div className={styles.detailHero}>
                <div><span>{isSimulation ? '模拟单号' : selected.waybill ? '承运商运单' : '业务提报单'}</span><strong>{selected.waybill || selected.orderNo}</strong></div>
                <div className={styles.detailActions}>
                  <button aria-label="复制单号" onClick={() => void navigator.clipboard?.writeText(selected.waybill || selected.orderNo)}><Clipboard size={15}/></button>
                  {(selected.status === 'order_unknown' || selected.status === 'ordering') && <button className={styles.secondaryButton} aria-label="查回所选单据下单结果" disabled={batchBusy || busy === selected.id} onClick={() => void reconcileOrder(selected.id)}>{busy === selected.id ? '查回中…' : '查回下单结果'}</button>}{selected.status === 'waybill_created' && <button className={styles.cancelButton} disabled={busy === selected.id} onClick={() => void cancelSelected()}>{isSimulation ? '模拟取消运单' : '取消运单'}</button>}
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
            {pendingProductionReviewId === selected.id && <section className={styles.productionReview} role="group" aria-label="首票Production订单复核">
              <h3>首票Production订单复核</h3>
              <p><b>寄件人</b><br/>{settings.sender.name} · {settings.sender.phone}<br/>{settings.sender.province}{settings.sender.city}{settings.sender.county}{settings.sender.address}</p>
              <p><b>收件人</b><br/>{selected.input.recipient.name} · {selected.input.recipient.phone}<br/>{selected.input.recipient.province}{selected.input.recipient.city}{selected.input.recipient.county}{selected.input.recipient.address}</p>
              <p>{customerOf(selected)} · {selected.input.cargo} · {selected.input.weight}kg · {selectedServices.find(service => String(service.id) === serviceId)?.name || selected.input.serviceName || '服务待选'} · {selectedAccount ? `${selectedAccount.displayName} · 尾号 ${selectedAccount.tail}` : '月结账号待选'}</p>
              <small>确认将立即向顺丰Production提交此票并按月结结算；页面没有实时报价，运费以顺丰实际结算为准。请确认已核对收寄信息及费用安排。</small>
              <div className={styles.reviewActions}>
                <button className={styles.secondaryButton} disabled={busy === selected.id} onClick={() => setPendingProductionReviewId('')}>返回</button>
                <button className={styles.reviewConfirm} disabled={busy === selected.id || !canSubmitCurrent} onClick={() => void act(selected, 'confirm', true)}>{busy === selected.id ? '提交中…' : '确认首票Production下单'}</button>
              </div>
            </section>}
            <section className={styles.trackingPane}>
              <div className={styles.trackTop}>
                <div>
                  <small>最新物流状态</small>
                  <h3><span/> {selected.status === 'cancelled' ? '已取消' : selected.status === 'delivered' ? '已签收' : selected.status === 'in_transit' ? '运输中' : selected.status === 'order_unknown' || selected.status === 'ordering' ? '下单结果待确认' : selected.waybill ? '等待揽收' : '尚未出单'}</h3>
                  <p className={styles.courier}>{tracking?.courier ? [tracking.courier.name, tracking.courier.employeeId, tracking.courier.phone].filter(Boolean).join(' · ') : '当前轨迹未提供快递员姓名、工号或电话'}</p>
                </div>
                <button disabled={!selected.waybill || trackingBusy} onClick={() => void refreshTracking(selected.waybill || '')}><RefreshCw size={14}/>刷新</button>
              </div>
              {tracking ? (
                <ol className={styles.timeline}>{tracking.events.map((event, index) => <li key={`${event.time}-${index}`}><i/><time>{event.time}</time><p>{event.description}</p><small>{event.location}</small></li>)}</ol>
              ) : (
                <div className={styles.noTracking}><PackageCheck size={32}/><strong>等待查询物流</strong><p>输入运单号查询，其他人的运单可能需要手机号后四位。</p></div>
              )}
            </section>
          </div>
        ) : (
          <div className={`${styles.noTracking} ${styles.emptyTracking}`}>
            <PackageCheck size={32}/>
            <strong>{tracking ? `顺丰运单 ${tracking.waybill}` : '暂无收寄记录'}</strong>
            <p>{tracking ? '物流轨迹查询结果' : '可直接输入顺丰运单号查询；本人或业务提报的真实单据也会显示在这里。'}</p>
            {tracking && (tracking.events.length ? <ol className={styles.timeline}>{tracking.events.map((event, index) => <li key={`${event.time}-${index}`}><i/><time>{event.time}</time><p>{event.description}</p><small>{event.location}</small></li>)}</ol> : <p>暂无物流轨迹，运单可能尚未揽收。</p>)}
          </div>
        )}
      </section>
    </div>
  </main>
}

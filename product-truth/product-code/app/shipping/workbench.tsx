'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Box, CheckCircle2, ChevronRight, Clipboard, PackageCheck, RefreshCw, Search, Truck, UploadCloud } from 'lucide-react'
import type { Contact, ShippingPayment, ShipmentOrder, ShipmentOrderStatus, ShippingInput, ShippingSettings, TrackingResult } from '@/lib/shipping/types'
import { buildShippingTemplate, parseShippingFile, type BatchDraftRow } from '@/lib/shipping/import-parser'
import { parseShippingText, prepareBatchRecipient } from '@/lib/shipping/batch-text'
import { shippingWorkbenchRequest, ShippingWorkbenchRequestError, isDefinitiveShippingRejection, type ShippingSimulation } from '@/lib/shipping/workbench-client'
import { contactSchema } from '@/lib/shipping/validation'
import { parseAddress } from '@/lib/shipping/address'
import { DEFAULT_INTAKE_RULES, intakeFieldSchema } from '@/lib/shipping/intake-rules'
import styles from './workbench.module.css'

const statusLabel: Record<ShipmentOrderStatus, string> = { accepted: '已受理', awaiting_confirmation: '待审核', returned: '工单已退回', confirmed: '已确认', ordering: '下单中', order_unknown: '结果待确认', waybill_created: '待揽收', in_transit: '运输中', delivered: '已签收', cancelled: '已取消', order_failed: '异常件' }
const statusTone: Record<ShipmentOrderStatus, string> = { accepted: 'orange', awaiting_confirmation: 'orange', returned: 'red', confirmed: 'blue', ordering: 'blue', order_unknown: 'red', waybill_created: 'blue', in_transit: 'blue', delivered: 'green', cancelled: 'gray', order_failed: 'red' }
type IntakeInput = Omit<ShippingInput, 'sender'> & { sender?: ShippingInput['sender'] }
type BatchRow = Omit<BatchDraftRow, 'result'> & { result?: 'pending' | 'unknown' | 'success' | 'failed'; orderId?: string; orderNo?: string; intakeInput?: IntakeInput }
type SubmissionResult = { id?: string; orderId?: string; orderNo?: string; status?: ShipmentOrderStatus; waybill?: string | null }
const maySubmitRow = (row: BatchRow) => !row.result || row.result === 'failed'

function cityOf(order: ShipmentOrder) { return order.input.recipient.city || order.input.recipient.province }
function customerOf(order: ShipmentOrder) { return order.input.customerName || order.relation.customerRef || '未填写客户' }

function senderForReview(order: ShipmentOrder, companySender: Contact): { contact: Contact | null; source: string } {
  const saved = contactSchema.safeParse(order.input.sender)
  if (saved.success) return { contact: saved.data, source: order.intakeSource === 'anonymous_web' ? '销售本人寄件资料' : '工单寄件资料' }
  const missing = Object.values(order.input.sender || {}).every(value => typeof value === 'string' && !value.trim())
  if (order.intakeSource === 'owner_web' && missing) {
    const fallback = contactSchema.safeParse(companySender)
    if (fallback.success) return { contact: fallback.data, source: '公司默认寄件资料' }
  }
  return { contact: null, source: order.intakeSource === 'owner_web' && missing ? '公司寄件资料待补齐' : '工单寄件资料待补齐' }
}

function withTrackingStatus(order: ShipmentOrder, result: TrackingResult): ShipmentOrder {
  if (result.source === 'sandbox_mock' || order.waybill !== result.waybill || !result.shipmentStatus) return order
  // A delayed response must not reopen a collected or terminal shipment.
  if (order.status !== 'waybill_created' && order.status !== 'in_transit') return order
  const next = result.shipmentStatus
  if (next !== 'in_transit' && next !== 'delivered' && next !== 'cancelled') return order
  return next === order.status ? order : { ...order, status: next }
}

export default function ShippingWorkbench({ settings: initialSettings, simulation }: { settings: ShippingSettings; simulation?: ShippingSimulation }) {
  const [settings, setSettings] = useState(initialSettings)
  useEffect(() => { setSettings(initialSettings) }, [initialSettings])
  const request = simulation ? simulation.request : shippingWorkbenchRequest
  const isSimulation = Boolean(simulation)
  const [orders, setOrders] = useState<ShipmentOrder[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [batch, setBatch] = useState<BatchRow[]>([])
  const [entryMode, setEntryMode] = useState<'file' | 'text'>('text')
  const [bulkText, setBulkText] = useState(simulation?.sampleText || '')
  const [batchBusy, setBatchBusy] = useState(false)
  const [templateBusy, setTemplateBusy] = useState(false)
  const [connectionId, setConnectionId] = useState(settings.connectionId || '')
  const [serviceId, setServiceId] = useState('')
  const [billingAccountId, setBillingAccountId] = useState(settings.defaultBillingAccountId || '')
  const [payment, setPayment] = useState<ShippingPayment>('sender_monthly')
  const [senderOverride, setSenderOverride] = useState<Contact | null>(null)
  const [senderText, setSenderText] = useState('')
  const [editingSender, setEditingSender] = useState(!contactSchema.safeParse(settings.sender).success)
  const senderSection = useRef<HTMLDivElement>(null)
  const senderTextInput = useRef<HTMLTextAreaElement>(null)
  const [returnDraft, setReturnDraft] = useState<{ orderId: string; reason: string; error: string } | null>(null)
  const returnRunning = useRef(false)
  const batchSender = senderOverride || settings.sender
  const senderValidation = contactSchema.safeParse(batchSender)
  const senderReady = senderValidation.success
  const senderLabels: Record<string, string> = { name: '寄件人姓名', phone: '寄件电话', province: '省份', city: '城市', county: '区县', address: '揽收详细地址' }
  const senderProblems = senderValidation.success ? [] : [...new Set(senderValidation.error.issues.map(issue => senderLabels[String(issue.path[0])] || '寄方资料'))]
  function showSenderFields() { setEditingSender(true); senderSection.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }); senderTextInput.current?.focus({ preventScroll: true }) }
  const rules = settings.intakeRules || DEFAULT_INTAKE_RULES
  const [uniformCargo, setUniformCargo] = useState('文件/合同')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | ShipmentOrderStatus>('all')
  const [type, setType] = useState<'all' | 'outbound' | 'inbound'>('all')
  const [tracking, setTracking] = useState<TrackingResult | null>(null)
  const [manualWaybill, setManualWaybill] = useState('')
  const [phoneSuffix, setPhoneSuffix] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState('')
  const [reviewIds, setReviewIds] = useState<string[]>([])
  const [confirmationBusy, setConfirmationBusy] = useState(false)
  const confirmationRunning = useRef(false)
  const [ledgerLoading, setLedgerLoading] = useState(true)
  const [trackingBusy, setTrackingBusy] = useState(false)
  const [trackingTarget, setTrackingTarget] = useState('')
  const [trackingError, setTrackingError] = useState('')
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

  const selected = trackingTarget ? orders.find(order => order.waybill === trackingTarget) : orders.find(order => order.id === selectedId) || orders[0]
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
  const preparedRows = useMemo(() => batch.map(row => {
    const prepared = prepareBatchRecipient({ ...row, result: undefined })
    const company = intakeFieldSchema(rules.companyName, '公司名称', 120).safeParse(row.customerName)
    const team = intakeFieldSchema(rules.team, '所属团队', 80, rules.teamOptions).safeParse(row.team)
    const metadataErrors = { customerName: company.success ? [] : company.error.issues.map(issue => issue.message), team: team.success ? [] : team.error.issues.map(issue => issue.message) }
    return { row, ...prepared, errors: [...prepared.errors, ...metadataErrors.customerName, ...metadataErrors.team], metadataErrors }
  }), [batch, rules])
  const validCount = preparedRows.filter(({ row, errors }) => !errors.length && maySubmitRow(row)).length
  const successCount = batch.filter(row => row.result === 'success').length
  const uncertainCount = batch.filter(row => row.result === 'unknown' || row.result === 'pending').length
  const inputLocked = batchBusy || confirmationBusy || uncertainCount > 0
  const invalidCount = preparedRows.filter(({ errors }) => errors.length > 0).length
  const selectedConnection = settings.carrierConnections?.find(connection => connection.id === connectionId)
  const selectedServices = selectedConnection?.services || settings.services
  const availableAccounts = (settings.billingAccounts || []).filter(account => account.connectionId === connectionId && account.environment === (selectedConnection?.environment || settings.environment) && account.status === 'active')
  const selectedAccount = availableAccounts.find(account => account.id === billingAccountId)
  const canSubmitCurrent = settings.carrierConnections?.length
    ? Boolean(selectedConnection?.status === 'connected' && (payment !== 'sender_monthly' || availableAccounts.some(account => account.id === billingAccountId)) && selectedServices.length > 0 && (!serviceId || selectedServices.some(service => String(service.id) === serviceId)) && (selectedConnection.environment !== 'production' || selectedConnection.orderCapability !== 'unavailable'))
    : settings.canSubmit
  const reviewedOrders = filtered.filter(order => reviewIds.includes(order.id) && order.status === 'awaiting_confirmation')
  const reviewedSendersReady = reviewedOrders.every(order => senderForReview(order, settings.sender).contact !== null)
  const productionOrderUnverified = selectedConnection?.environment === 'production' && selectedConnection.orderCapability === 'not_tested'

  async function copySelectedNumber() {
    if (!selected) return
    const number = selected.waybill || selected.orderNo
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(number)
      setMessage(`已复制单号：${number}`)
    } catch {
      setMessage(`复制未成功，请选中单号后手动复制：${number}`)
    }
  }

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
  async function reopenFailed(order: ShipmentOrder) {
    if (busy || confirmationBusy || batchBusy) return
    setBusy(order.id)
    try {
      await request(`/api/shipping/ledger/${order.id}/reopen`, { method: 'POST' })
      setOrders(current => current.map(item => item.id === order.id ? { ...item, status: 'awaiting_confirmation' } : item))
      setReviewIds([order.id]); setStatus('all')
      setMessage('原工单已回到待核对，尚未向承运商发单。请先处理失败原因，再核对确认。')
    } catch (error) { setMessage(`恢复核对失败：${(error as Error).message}`) }
    finally { setBusy('') }
  }
  function updateBatch(id: number, field: 'recipient' | 'phone' | 'address' | 'customerName' | 'team', value: string) { setBatch(rows => rows.map(row => row.id === id && maySubmitRow(row) && !batchBusy ? { ...row, [field]: value } : row)) }
  function removeDraft(id: number) {
    if (inputLocked) return
    setBatch(rows => rows.filter(row => row.id !== id || !maySubmitRow(row)))
  }
  function confirmReplacement() {
    return !batch.length || window.confirm('重新解析或导入将替换当前列表，手工修改和移除结果不会保留。是否继续？')
  }
  async function refreshConfiguration() {
    if (busy || confirmationBusy || batchBusy) return
    setBusy('configuration'); setMessage('')
    try {
      const result = await request<{ settings: ShippingSettings }>('/api/shipping/settings?workspace=1')
      setSettings(current => ({ ...current, ...result.settings })); setConnectionId(result.settings.connectionId || ''); setBillingAccountId(result.settings.defaultBillingAccountId || ''); setServiceId(''); setReviewIds([])
      setMessage('寄件配置已刷新，草稿保留；请重新核对下单参数。')
    } catch (error) { setMessage((error as Error).message) } finally { setBusy('') }
  }
  function changeConnection(nextId: string) {
    setConnectionId(nextId)
    setServiceId('')
    const accounts = (settings.billingAccounts || []).filter(account => account.connectionId === nextId && account.status === 'active')
    setBillingAccountId(accounts.find(account => account.isDefault)?.id || accounts[0]?.id || '')
  }
  function parseBulk() {
    if (inputLocked || !confirmReplacement()) return
    setMessage('')
    try { setBatch(parseShippingText(bulkText, uniformCargo)) }
    catch (error) { setMessage((error as Error).message) }
  }
  async function importFile(file?: File) {
    if (!file || inputLocked || !confirmReplacement()) return
    setMessage('')
    try {
      const imported = await parseShippingFile(file)
      // A file read started before submission must not replace unresolved rows.
      setBatch(rows => rows.some(row => row.result === 'pending' || row.result === 'unknown') ? rows : imported)
    } catch (error) { setMessage((error as Error).message) }
  }
  async function downloadTemplate() {
    if (templateBusy) return
    setTemplateBusy(true); setMessage('')
    let url: string | undefined
    try {
      const blob = await buildShippingTemplate()
      url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url; link.download = '寄件标准导入模板.xlsx'; link.click()
      setMessage('模板已生成，请在浏览器下载列表中查看。')
    } catch (error) {
      setMessage(`模板下载未完成：${error instanceof Error ? error.message : '生成失败'}。请重试，或使用文本解析录入。`)
    } finally {
      if (url) { const downloadUrl = url; window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000) }
      setTemplateBusy(false)
    }
  }
  async function executeBatch(retrieveRowId?: number) {
    if (batchRunning.current || confirmationRunning.current) return
    if (!retrieveRowId && (!senderReady || settings.intakeRulesWarning)) { setMessage(settings.intakeRulesWarning || '请先补齐顶部本批寄方资料，再提交工单。'); return }
    const candidates = preparedRows.filter(({ row, errors }) => (retrieveRowId ? row.id === retrieveRowId && row.result === 'unknown' : !errors.length && maySubmitRow(row)))
    if (!candidates.length) return
    batchRunning.current = true
    setBatchBusy(true); setMessage('')
    let succeeded = 0, uncertain = 0, failed = 0
    const affectedOrderIds: string[] = []
    for (const { row, recipient } of candidates) {
      // Intake retries replay the same content and key. No carrier operation occurs here.
      const input: IntakeInput = row.intakeInput || { sender: batchSender, customerName: rules.companyName.enabled ? (row.customerName || '').trim() : '', submittedBy: { name: batchSender.name, phone: batchSender.phone, team: rules.team.enabled ? (row.team || '').trim() : '' }, recipient, cargo: row.cargo || uniformCargo, weight: 1, remark: '', source: 'manual', payment: 'sender_monthly' }
      setBatch(items => items.map(item => item.id === row.id ? { ...item, intakeInput: input, result: 'pending', error: undefined } : item))
      try {
        const receipt = await request<SubmissionResult>('/api/shipping/owner/orders', { method: 'POST', body: JSON.stringify({ key: row.key, input }) })
        const orderId = receipt.orderId || receipt.id
        if (orderId && receipt.orderNo && receipt.status && receipt.status in statusLabel) {
          succeeded += 1; affectedOrderIds.push(orderId)
          setBatch(items => items.map(item => item.id === row.id ? { ...item, orderId, orderNo: receipt.orderNo, result: 'success', error: undefined } : item))
        } else {
          uncertain += 1
          setBatch(items => items.map(item => item.id === row.id ? { ...item, result: 'unknown', error: '工单回执不完整，请用原请求重取回执。此步骤不会向顺丰下单。' } : item))
        }
      } catch (error) {
        if (definiteRejection(error)) {
          failed += 1
          setBatch(items => items.map(item => item.id === row.id ? { ...item, result: 'failed', intakeInput: undefined, error: (error as Error).message } : item))
        } else {
          uncertain += 1
          setBatch(items => items.map(item => item.id === row.id ? { ...item, result: 'unknown', error: '工单回执未收到，原请求已保留。请重取回执；不会触发顺丰下单。' } : item))
        }
      }
    }
    let ledgerRefreshError = ''
    try {
      const ledger = await request<{ records: ShipmentOrder[] }>('/api/shipping/ledger?limit=50')
      setOrders(ledger.records)
      const newOrder = ledger.records.find(order => affectedOrderIds.includes(order.id))
      if (newOrder) { setTrackingTarget(''); setTrackingError(''); setSelectedId(newOrder.id); setManualWaybill(newOrder.waybill || ''); setTracking(null); trackingRequest.current += 1 }
    } catch (error) { ledgerRefreshError = ` 台账刷新失败：${(error as Error).message}` }
    batchRunning.current = false
    setBatchBusy(false); setMessage(`工单提报：已提报 ${succeeded} 票；回执待确认 ${uncertain} 票；失败 ${failed} 票。请在中栏核对工单后正式下单。${ledgerRefreshError}`)
  }
  async function reconcileOrder(orderId: string) {
    if (!orderId || reconciliationRequests.current.has(orderId) || batchBusy || confirmationRunning.current) return
    reconciliationRequests.current.add(orderId); setBusy(orderId); setMessage('')
    try {
      const result = await request<SubmissionResult>(`/api/shipping/ledger/${encodeURIComponent(orderId)}/reconcile`, { method: 'POST', body: '{}' })
      if ((result.id && result.id !== orderId) || (result.orderId && result.orderId !== orderId)) throw new Error('查回结果的单据编号不一致，已保留原单。')
      const successful = successfulSubmission(result)
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
  function toggleReview(order: ShipmentOrder) {
    if (confirmationRunning.current || order.status !== 'awaiting_confirmation') return
    setReviewIds(ids => ids.includes(order.id) ? ids.filter(id => id !== order.id) : [...ids, order.id])
  }
  async function confirmReviewed() {
    if (confirmationRunning.current || batchRunning.current || !reviewedOrders.length || !canSubmitCurrent || !reviewedSendersReady) return
    if (productionOrderUnverified && reviewedOrders.length !== 1) { setMessage('生产下单权限尚未实测，请先核对并确认一票工单。'); return }
    confirmationRunning.current = true; setConfirmationBusy(true); setMessage('')
    let succeeded = 0, uncertain = 0, failed = 0
    const results = new Map<string, SubmissionResult>()
    const errors: string[] = []
    for (const order of reviewedOrders) {
      setBusy(order.id)
      try {
        const result = await request<SubmissionResult>(`/api/shipping/ledger/${encodeURIComponent(order.id)}/confirm`, { method: 'POST', body: JSON.stringify({ connectionId: connectionId || undefined, payment, billingAccountId: payment === 'sender_monthly' ? billingAccountId || undefined : undefined, serviceId: Number(serviceId) || undefined }) })
        if ((result.id && result.id !== order.id) || (result.orderId && result.orderId !== order.id)) throw new ShippingWorkbenchRequestError('下单回执工单编号不一致，请查回原单。', 200, 'client_invalid_response')
        results.set(order.id, result)
        if (successfulSubmission(result)) succeeded += 1
        else if (result.status === 'order_failed') failed += 1
        else uncertain += 1
      } catch (error) {
        if (definiteRejection(error)) {
          failed += 1; errors.push(`${order.orderNo}：${(error as Error).message}`)
          if (error instanceof ShippingWorkbenchRequestError && error.requestStage === 'provider_not_sent') {
            results.set(order.id, { status: 'order_failed', waybill: null })
            setOrders(rows => rows.map(item => item.id === order.id ? { ...item, status: 'order_failed', failure: { message: error.message, at: new Date().toISOString() } } : item))
          }
        }
        else { uncertain += 1; results.set(order.id, { status: 'order_unknown', waybill: null }) }
      }
      setOrders(rows => rows.map(item => results.has(item.id) ? applySubmission(item, results.get(item.id)!) : item))
    }
    let refreshError = ''
    try {
      const refreshed = await request<{ records: ShipmentOrder[] }>('/api/shipping/ledger?limit=50')
      setOrders(refreshed.records.map(item => results.has(item.id) ? applySubmission(item, results.get(item.id)!) : item))
    } catch (error) { refreshError = ` 台账刷新失败：${(error as Error).message}` }
    setReviewIds(ids => ids.filter(id => !results.has(id)))
    const first = reviewedOrders.find(order => results.has(order.id))
    if (first) { setTrackingTarget(''); setTrackingError(''); setSelectedId(first.id); setManualWaybill(results.get(first.id)?.waybill || ''); setTracking(null); trackingRequest.current += 1 }
    confirmationRunning.current = false; setConfirmationBusy(false); setBusy('')
    setMessage(`${isSimulation ? '模拟' : '正式'}下单：成功 ${succeeded} 票；结果待确认 ${uncertain} 票；失败 ${failed} 票。${uncertain ? '下单结果待确认，请查回原单，勿重复下单。' : ''}${errors.join('；')}${refreshError}`)
  }
  function beginReturn(order: ShipmentOrder) {
    const issues: string[] = []
    if (!senderForReview(order, settings.sender).contact) issues.push('请补齐本票实际寄件人姓名、联系电话和完整揽收地址')
    if (!contactSchema.safeParse(order.input.recipient).success) issues.push('请补齐收件人姓名、联系电话和完整收件地址')
    const company = intakeFieldSchema(rules.companyName, '公司名称', 120).safeParse(order.input.customerName)
    const team = intakeFieldSchema(order.identityVerified ? { enabled: true, required: true, minLength: 1 } : rules.team, '所属团队', 80, order.identityVerified ? [] : rules.teamOptions).safeParse(order.input.submittedBy?.team)
    if (!company.success) issues.push(...company.error.issues.map(issue => issue.message))
    if (!team.success) issues.push(...team.error.issues.map(issue => issue.message))
    setReturnDraft({ orderId: order.id, reason: issues.length ? issues.join('；') : '请核对收寄资料，补充说明后重新提报。', error: '' })
  }
  async function returnOrder(order: ShipmentOrder) {
    if (busy || confirmationRunning.current || returnRunning.current || returnDraft?.orderId !== order.id) return
    const reason = returnDraft.reason.trim()
    if (reason.length < 2 || reason.length > 300) { setReturnDraft(current => current && { ...current, error: '退回原因需填写2至300个字符。' }); return }
    returnRunning.current = true
    setBusy(order.id); setMessage('')
    try {
      await request(`/api/shipping/ledger/${encodeURIComponent(order.id)}/return`, { method: 'POST', body: JSON.stringify({ reason }) })
      setOrders(rows => rows.map(item => item.id === order.id ? { ...item, status: 'returned' } : item))
      setReviewIds(ids => ids.filter(id => id !== order.id))
      setReturnDraft(null)
      setMessage('工单已退回并记录原因，未向顺丰下单。')
    } catch (error) {
      const errorMessage = `退回未完成：${(error as Error).message}`
      setReturnDraft(current => current && { ...current, error: errorMessage }); setMessage(errorMessage)
    } finally { returnRunning.current = false; setBusy('') }
  }
  async function refreshTracking(number = manualWaybill || selected?.waybill || '') {
    number = number.trim().toUpperCase()
    if (!number) return
    setTrackingTarget(number); setTrackingError('')
    setTracking(current => current?.waybill === number ? current : null)
    const currentRequest = ++trackingRequest.current
    setTrackingBusy(true); setMessage('')
    try {
      const result = await request<TrackingResult>('/api/shipping/tracking', { method: 'POST', body: JSON.stringify({ waybill: number, ...(phoneSuffix ? { phoneSuffix } : {}) }) })
      if (currentRequest === trackingRequest.current) {
        setTracking(result); setManualWaybill(number)
        if (result.shipmentStatus) setOrders(items => items.map(order => withTrackingStatus(order, result)))
      }
    } catch (error) {
      if (currentRequest === trackingRequest.current) { setMessage((error as Error).message); setTrackingError((error as Error).message) }
    } finally { if (currentRequest === trackingRequest.current) setTrackingBusy(false) }
  }
  async function cancelSelected() {
    if (!selected || selected.status !== 'waybill_created' || confirmationRunning.current || busy) return
    setBusy(selected.id)
    try { await request(`/api/shipping/ledger/${selected.id}/cancel`, { method: 'POST', body: '{}' }); setOrders(items => items.map(item => item.id === selected.id ? { ...item, status: 'cancelled' } : item)); setTracking(null); trackingRequest.current += 1; setTrackingBusy(false); setMessage(isSimulation ? '模拟运单已取消，没有操作真实运单。' : '顺丰运单已取消。') } catch (error) { setMessage((error as Error).message) } finally { setBusy('') }
  }

  return <main className={styles.shell}>
    <header className={styles.topbar}>
      <div><p>物流协同 / SHIPPING OPS</p><h1>自助收寄</h1></div>
      <div className={styles.topbarActions}>
        {simulation ? <><button className={styles.configButton} disabled={inputLocked || !!busy} onClick={simulation.onReset}>重置演示</button><a className={styles.configButton} href="/shipping">返回真实工作台</a></> : <><a className={styles.configButton} href="/sales-portal">销售寄件提报</a><button className={styles.configButton} disabled={!!busy || confirmationBusy || batchBusy} onClick={() => void refreshConfiguration()}>刷新寄件配置</button></>}
        <div className={styles.connection}><span />{isSimulation ? '模拟体验' : selectedConnection ? `顺丰${selectedConnection.environment === 'sandbox' ? '沙盒' : '生产'}` : settings.configurationWarning ? '配置暂不可用' : '未配置快递连接'}<small>{payment === 'sender_cash' ? '寄方现结' : payment === 'recipient' ? '收方到付' : selectedAccount ? `${selectedAccount.displayName} · 尾号 ${selectedAccount.tail}` : '月结账号待选择'}</small></div>
      </div>
    </header>
    {simulation && <div className={styles.simulationNotice} role="note"><strong>模拟体验</strong> 地址、单号和轨迹均为示例，仅在当前页面演示，不向顺丰下单、不产生费用。<span>左栏解析并提交工单 → 中栏核对并模拟确认下单 → 右栏查看运单、轨迹与取消。销售匿名提报直接进入中栏。</span></div>}

    {settings.configurationWarning && <div className={styles.notice} role="status">{settings.configurationWarning}</div>}
    {settings.defaultsWarning && <div className={styles.notice} role="status">{settings.defaultsWarning}</div>}
    {message && <div className={styles.toast} role="status">{message}</div>}
    {productionOrderUnverified && <div className={styles.notice} role="status">生产连接已验证，下单权限尚未实测。可正常提报工单；请先在中栏核对并确认一票，之后再批量正式下单。</div>}
    <div className={styles.columns}>
      <section className={styles.column} aria-label="批量寄件操作台">
        <div className={styles.columnHeader}><div><span className={styles.step}>01</span><h2>批量提报工单</h2></div><small>操作员录入 · 纠错 · 提报</small></div>
        <div className={styles.scrollBody}>
          <div className={styles.bulkSettings} ref={senderSection}><h3>从哪里寄出</h3><p>{senderOverride ? '本批临时寄方' : '公司默认寄方'}：{batchSender.name} · {batchSender.phone}<br/>{batchSender.province}{batchSender.city === batchSender.province ? '' : batchSender.city}{batchSender.county}{batchSender.address}</p><button type="button" className={styles.linkButton} aria-expanded={editingSender} onClick={() => setEditingSender(value => !value)}>{editingSender ? '收起寄方编辑' : '本批更换寄方'}</button><div hidden={!editingSender}><p className={styles.intakeHint}>修改仅用于本批新工单，不覆盖公司默认资料。</p>
            {settings.intakeRulesWarning && <p role="alert" className={styles.fieldError}>{settings.intakeRulesWarning}</p>}
            <label>粘贴寄方信息<textarea ref={senderTextInput} aria-label="本批寄方信息文本" rows={3} value={senderText} disabled={inputLocked} onChange={event => setSenderText(event.target.value)} placeholder="粘贴寄件人姓名、联系电话和完整揽收地址"/></label>
            <button className={styles.secondaryButton} disabled={inputLocked || !senderText.trim()} onClick={() => { const parsed = parseAddress(senderText); if (!contactSchema.safeParse(parsed.contact).success) { setMessage('未识别出完整寄方，原资料已保留。' + parsed.warnings.join('；')); return } setSenderOverride(parsed.contact); setMessage(parsed.warnings.join('；') || '已更新本批寄方，请核对。') }}>解析本批寄方</button>
            <div className={styles.batchFields}>{([{ field: 'name', label: '寄件人' }, { field: 'phone', label: '寄件电话' }, { field: 'province', label: '寄件省份' }, { field: 'city', label: '寄件城市' }, { field: 'county', label: '寄件区县' }, { field: 'address', label: '揽收详细地址' }] as const).map(({ field, label }) => <label key={field} className={styles.batchField}><span>{label} *</span><input aria-label={`本批${label}`} value={batchSender[field]} disabled={inputLocked} onChange={event => setSenderOverride({ ...batchSender, [field]: event.target.value })}/></label>)}</div>
            {!senderReady && <p role="status" className={styles.fieldError}>请补齐寄件人姓名、联系电话和完整揽收地址，才能提交工单。</p>}
            {senderOverride && <button className={styles.linkButton} disabled={inputLocked} onClick={() => setSenderOverride(null)}>使用公司默认寄方</button>}
            </div><label>新录入物品属性<select value={uniformCargo} disabled={inputLocked} onChange={event => setUniformCargo(event.target.value)}><option>文件/合同</option><option>样品</option><option>礼品</option></select></label></div>
          <div className={styles.segmented} role="group" aria-label="地址录入方式"><button aria-pressed={entryMode === 'text'} className={entryMode === 'text' ? styles.active : ''} disabled={inputLocked} onClick={() => setEntryMode('text')}>文本解析</button><button aria-pressed={entryMode === 'file'} className={entryMode === 'file' ? styles.active : ''} disabled={inputLocked} onClick={() => setEntryMode('file')}>文件导入</button></div>
          {entryMode === 'file' ? <div className={styles.dropzone}><UploadCloud size={28}/><strong>选择 Excel 或 CSV</strong><span>支持 .xlsx / .csv，最多200票</span><input id="shipping-batch-file" className={styles.fileInput} type="file" accept=".xlsx,.csv" disabled={inputLocked} onChange={event => void importFile(event.target.files?.[0])}/><label htmlFor="shipping-batch-file" className={styles.fileButton}>选择文件</label><button className={styles.linkButton} disabled={templateBusy} onClick={() => void downloadTemplate()}>{templateBusy ? '正在生成模板…' : '下载标准模板.xlsx'}</button></div> : <div className={styles.textParser}><p>支持多位收件人；同一人的姓名、电话和地址可分行，空行有助于分票。解析后请核对每票资料。</p><textarea aria-label="多行地址文本" rows={6} maxLength={100000} disabled={inputLocked} value={bulkText} onChange={event => setBulkText(event.target.value)} placeholder={'姓名：示例甲\n电话：13800000000\n地址：广东省深圳市南山区示例路88号\n\n示例乙 13900000000 上海市浦东新区示例路66号'}/><div className={styles.parserActions}><button className={styles.secondaryButton} disabled={!bulkText.trim() || inputLocked} onClick={parseBulk}>解析为寄件行</button>{simulation && <button className={styles.linkButton} disabled={inputLocked} onClick={() => setBulkText(simulation.sampleText)}>重填示例地址</button>}</div></div>}
          <div className={styles.sectionTitle}><h3>{entryMode === 'text' ? '解析预览' : '导入预览'}</h3><span>{batch.length ? `${batch.length} 票` : entryMode === 'text' ? '等待解析地址' : '尚未导入'}</span></div>
          {invalidCount > 0 && <p className={styles.batchValidationSummary} role="status">{invalidCount} 票需修正；仅 {validCount} 票有效资料可提交。</p>}
          <div className={styles.batchList}>{preparedRows.map(({ row, errors, fieldErrors, metadataErrors }) => {
            const valid = errors.length === 0
            return <article key={row.id} className={`${styles.batchRow} ${!valid || row.result === 'failed' ? styles.invalidRow : ''}`}>
              <div className={styles.rowTop}>
                <b>#{String(row.id).padStart(2, '0')}</b>
                {maySubmitRow(row) && <button type="button" className={styles.linkButton} disabled={inputLocked} aria-label={`移除第${row.id}票草稿`} onClick={() => removeDraft(row.id)}>移除这票</button>}
                {row.result === 'success' ? <span className={styles.good}><CheckCircle2 size={12}/>已提报 · {row.orderNo}</span>
                  : row.result === 'unknown' ? <span className={styles.bad}>回执待确认</span>
                  : row.result === 'pending' ? <span className={styles.good}>提交中</span>
                  : valid ? <span className={styles.good}><CheckCircle2 size={12}/>{senderReady ? '可提交' : '收件资料完整 · 待补寄方'}</span>
                  : <span className={styles.bad}><AlertTriangle size={12}/>需修正</span>}
              </div>
              <div className={styles.batchFields}>{([
                { field: 'recipient', label: '收件人', placeholder: '请补充收件人姓名' },
                { field: 'phone', label: '联系电话', placeholder: '手机号或带区号的固话' },
                { field: 'address', label: '收件地址', placeholder: '请补充省市区、街道和门牌号' },
              ] as const).map(({ field, label, placeholder }) => {
                const inputId = `shipping-batch-${row.id}-${field}`
                const problems = fieldErrors[field]
                const errorId = `${inputId}-error`
                return <label key={field} htmlFor={inputId} className={`${styles.batchField} ${field === 'address' ? styles.batchAddress : ''}`}>
                  <span>{label}</span>
                  <input id={inputId} aria-label={`第${row.id}行${label}`} aria-invalid={problems.length > 0} aria-describedby={problems.length ? errorId : undefined}
                    type={field === 'phone' ? 'tel' : 'text'} placeholder={placeholder} disabled={batchBusy || confirmationBusy || !maySubmitRow(row)}
                    value={row[field]} onChange={event => updateBatch(row.id, field, event.target.value)}/>
                  {problems.length > 0 && <small id={errorId} className={styles.fieldError}>{problems.join('；')}</small>}
                </label>
              })}
              {([{ field: 'customerName', label: '公司名称', rule: rules.companyName }, { field: 'team', label: '所属团队', rule: rules.team }] as const).filter(item => item.rule.enabled).map(({ field, label, rule }) => <label key={field} className={styles.batchField}>
                <span>{label}{rule.required ? ' *' : '（选填）'}</span>
                {field === 'team' && rules.teamOptions.length ? <select aria-label={`第${row.id}行${label}`} value={row.team || ''} disabled={inputLocked || !maySubmitRow(row)} onChange={event => updateBatch(row.id, field, event.target.value)}><option value="">请选择所属团队</option>{rules.teamOptions.map(team => <option key={team}>{team}</option>)}</select> : <input aria-label={`第${row.id}行${label}`} value={row[field] || ''} maxLength={field === 'team' ? 80 : 120} required={rule.required} aria-invalid={metadataErrors[field].length > 0} disabled={inputLocked || !maySubmitRow(row)} placeholder={rule.minLength ? `至少${rule.minLength}个字符` : label} onChange={event => updateBatch(row.id, field, event.target.value)}/>}
                {metadataErrors[field].length > 0 && <small className={styles.fieldError}>{metadataErrors[field].join('；')}</small>}
              </label>)}</div>
              {row.originalText && <details className={styles.originalText}><summary>查看原文</summary><pre aria-label={`第${row.id}票原文`}>{row.originalText}</pre></details>}
              {row.error && <small>{row.error}</small>}
              {row.result === 'unknown' && <button className={styles.secondaryButton} aria-label={`重取第${row.id}行工单回执`} disabled={batchBusy} onClick={() => void executeBatch(row.id)}>重取工单回执</button>}
            </article>
          })}</div>

        </div>
        <footer className={styles.stickyFooter}><div><strong>{validCount} 票收件资料完整</strong><small>{successCount ? `${successCount} 票已提报 · ` : ''}{uncertainCount ? `${uncertainCount} 票回执待确认 · ` : ''}{invalidCount} 票需修正</small>{batch.some(maySubmitRow) && !senderReady && <div className={styles.submitBlocker} role="status">请补齐或修正寄方：{senderProblems.join('、')}。<button type="button" className={styles.linkButton} onClick={showSenderFields}>去补齐寄方</button></div>}{settings.intakeRulesWarning && <p role="alert" className={styles.submitBlocker}>{settings.intakeRulesWarning}</p>}</div><button disabled={!validCount || !senderReady || Boolean(settings.intakeRulesWarning) || batchBusy || confirmationBusy} onClick={() => void executeBatch()}><Clipboard size={15}/>{batchBusy ? '提报中…' : `提交工单（${validCount}票）`}</button></footer>
      </section>

      <section className={styles.column} aria-label="收寄件台账与待办">
        <div className={styles.columnHeader}><div><span className={styles.step}>02</span><h2>工单审核与下单</h2></div><small>{orders.filter(order => order.status === 'awaiting_confirmation').length} 条待审核</small></div>
        <div className={styles.filters}>
          <div className={styles.segmented}><button className={type === 'all' ? styles.active : ''} onClick={() => setType('all')}>全部</button><button className={type === 'outbound' ? styles.active : ''} onClick={() => setType('outbound')}>寄出件</button><button className={type === 'inbound' ? styles.active : ''} onClick={() => setType('inbound')}>收到件</button></div>
          <div className={styles.quickDates}>{([{ value: 'all', label: '全部日期' }, { value: 'today', label: '今天' }, { value: 'three-days', label: '近3天' }, { value: 'week', label: '本周' }] as const).map(item => <button key={item.value} aria-pressed={dateRange === item.value} onClick={() => setDateRange(item.value)}>{item.label}</button>)}</div>
          <select aria-label="状态筛选" value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="all">全部状态</option><option value="awaiting_confirmation">待审核工单</option><option value="returned">已退回工单</option><option value="order_unknown">下单结果待确认</option><option value="ordering">下单中</option><option value="waybill_created">已出单/待揽收</option><option value="in_transit">运输中</option><option value="delivered">已签收</option><option value="order_failed">异常件</option></select>
          <label className={styles.search}><Search size={14}/><input aria-label="搜索台账" value={search} onChange={event => setSearch(event.target.value)} placeholder="销售、客户、收件人、工单号、运单号"/></label>
        </div>
        <div className={styles.orderList}>
          {reviewedOrders.length > 0 && <section className={styles.bulkSettings} aria-label="正式下单参数">
            <h3>所选 {reviewedOrders.length} 票的正式下单参数</h3>
            <label>承运商连接<select disabled={confirmationBusy} value={connectionId} onChange={event => changeConnection(event.target.value)}>{!settings.carrierConnections?.length && <option value="">顺丰 · 生产 · 待配置接口</option>}{(settings.carrierConnections || []).map(connection => <option key={connection.id} value={connection.id}>顺丰 · {connection.environment === 'sandbox' ? '沙盒' : '生产'} · {connection.status === 'connected' ? '已连接' : '待验证'}</option>)}</select></label>
            <label>本批付款方式<select disabled={confirmationBusy} value={payment} onChange={event => { setPayment(event.target.value as ShippingPayment); setReviewIds([]) }}><option value="sender_monthly">公司月结</option><option value="sender_cash">寄方现结</option><option value="recipient">收方到付</option></select></label>
            {payment === 'sender_monthly' && <label>月结账号<select disabled={confirmationBusy} value={billingAccountId} onChange={event => setBillingAccountId(event.target.value)}>{!availableAccounts.length && <option value="">当前承运商环境暂无月结账号</option>}{availableAccounts.map(account => <option key={account.id} value={account.id}>{account.displayName} · 尾号 {account.tail}{account.isDefault ? ' · 默认' : ''}</option>)}</select></label>}
            <label>寄件服务<select disabled={confirmationBusy} value={serviceId} onChange={event => { setServiceId(event.target.value); setReviewIds([]) }}><option value="">按每票工单所选产品</option>{selectedServices.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
            <p className={styles.intakeHint}>请逐票核对下方完整收寄资料。确认后才向顺丰提交订单并请求揽收；实际寄件人按各工单保存的资料使用。</p>
            <p className={styles.intakeHint}>付款方式：{payment === 'sender_monthly' ? '公司月结' : payment === 'sender_cash' ? '寄方现结' : '收方到付'}。运费以顺丰实际结算为准。{productionOrderUnverified ? '生产首票需单独确认。' : ''}</p>
            {!canSubmitCurrent && <p className={styles.bad}>{payment === 'sender_monthly' ? '连接、月结账号或寄件服务未就绪，请在配置中心处理后正式下单。' : '快递连接或寄件服务未就绪，请在配置中心处理后正式下单。'}</p>}
          </section>}
          {ledgerLoading ? <p className={styles.listHint}>正在读取台账…</p> : !filtered.length && <p className={styles.listHint}>暂无匹配单据</p>}
          {filtered.map(order => {
            const senderReview = senderForReview(order, settings.sender)
            return <article key={order.id} className={`${styles.orderCard} ${order.id === selected?.id ? styles.selectedCard : ''}`}>
            <button type="button" className={styles.orderSelect} aria-label={`查看单据 ${order.waybill || order.orderNo}`} aria-pressed={order.id === selected?.id} onClick={() => { setTrackingTarget(''); setTrackingError(''); setSelectedId(order.id); setManualWaybill(order.waybill || ''); setTracking(null); trackingRequest.current += 1; setTrackingBusy(false) }}>
            <div className={styles.cardHead}><span className={`${styles.tag} ${styles[statusTone[order.status]]}`}>{statusLabel[order.status]}</span><span>{order.input.submittedBy ? `销售-${order.input.submittedBy.name}` : order.intakeSource === 'owner_web' ? '操作员提报' : order.relation.salesRef || '待分配'}</span><b>{cityOf(order)}</b></div>
            <div className={styles.cardCore}><div><small>客户</small><strong>{customerOf(order)}</strong></div><ChevronRight size={15}/><div><small>收件人</small><strong>{order.input.recipient.name}</strong></div></div>
            {order.input.specialRequirements && <p className={styles.special}><AlertTriangle size={13}/>特殊需求：{order.input.specialRequirements}</p>}
            <div className={styles.cardMeta}><span>{order.waybill || order.orderNo}</span><time>{new Date(order.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time></div>
            </button>
            {order.status === 'awaiting_confirmation' && <>
              <div className={styles.cardActions} onClick={event => event.stopPropagation()}>
                <label className={styles.reviewSelection}><input type="checkbox" aria-label={`核对并选择工单 ${order.orderNo}`} disabled={confirmationBusy || !!busy} checked={reviewIds.includes(order.id)} onChange={() => toggleReview(order)}/>核对工单</label>
                <button className={styles.reject} disabled={confirmationBusy || !!busy} onClick={() => beginReturn(order)}>退回工单</button>
              </div>
              {returnDraft?.orderId === order.id && <form className={styles.returnForm} aria-label={`退回工单 ${order.orderNo}`} onClick={event => event.stopPropagation()} onSubmit={event => { event.preventDefault(); void returnOrder(order) }}>
                <label>退回原因<textarea aria-label="退回原因" value={returnDraft.reason} minLength={2} maxLength={300} required disabled={!!busy} onChange={event => setReturnDraft({ orderId: order.id, reason: event.target.value, error: '' })}/></label>
                <small>已按当前缺项预填，可修改。确认后将退回给提报人补充。</small>
                {returnDraft.reason.trim().length < 2 && <p role="alert">请填写至少2个字符的退回原因。</p>}
                {returnDraft.error && <p role="alert">{returnDraft.error}</p>}
                <div><button type="submit" className={styles.reject} disabled={!!busy || returnDraft.reason.trim().length < 2 || returnDraft.reason.trim().length > 300}>{busy === order.id ? '退回中…' : '确认退回'}</button><button type="button" className={styles.secondaryButton} disabled={!!busy} onClick={() => setReturnDraft(null)}>取消</button></div>
              </form>}
              {reviewIds.includes(order.id) && <section className={styles.workorderReview} aria-label={`工单 ${order.orderNo} 收寄预览`}>
                <h3>正式下单前核对</h3>
                {senderReview.contact ? <p><b>实际寄件人（{senderReview.source}）</b><br/>{senderReview.contact.name} · {senderReview.contact.phone}<br/>{senderReview.contact.province}{senderReview.contact.city}{senderReview.contact.county}{senderReview.contact.address}</p> : <p className={styles.bad} role="alert">{senderReview.source === '公司寄件资料待补齐' ? <>此工单缺少寄件人、联系电话或揽收地址。请在<a href="/configs?tab=shipping">配置中心</a>补齐后重新核对工单。</> : '工单寄件资料不完整。请退回工单，由提报人补齐实际寄件资料后重新提报。'}</p>}
                <p><b>收件人</b><br/>{order.input.recipient.name} · {order.input.recipient.phone}<br/>{order.input.recipient.province}{order.input.recipient.city}{order.input.recipient.county}{order.input.recipient.address}</p>
                <p><b>物品</b> {order.input.cargo} · {order.input.weight}kg<br/>服务产品：{order.input.serviceName || (order.input.servicePreference === 'urgent' ? '加急偏好' : '标准偏好')}<br/>提报身份：{order.intakeSource === 'anonymous_web' ? order.identityVerified ? '身份已验证' : '匿名自报，待核对' : '操作员录入'}{order.input.remark && <><br/>备注：{order.input.remark}</>}</p>
                {order.input.submittedBy && <p>提报销售：{order.input.submittedBy.name} · {order.input.submittedBy.phone} · {order.input.submittedBy.team || '未填写团队'}</p>}
              </section>}
            </>}
          </article>})}
        </div>
        <footer className={styles.stickyFooter}><div><strong>已选 {reviewedOrders.length} 票工单</strong><small>核对后确认才通知顺丰</small></div><button disabled={!reviewedOrders.length || confirmationBusy || batchBusy || !!busy || !canSubmitCurrent || !reviewedSendersReady || (productionOrderUnverified && reviewedOrders.length !== 1)} onClick={() => void confirmReviewed()}><Truck size={15}/>{confirmationBusy ? '正式下单中…' : `${isSimulation ? '模拟确认并下单' : '批量确认并下单'}（${reviewedOrders.length}票）`}</button></footer>
      </section>

      <section className={styles.column} aria-label="单据详情与物流轨迹">
        <div className={styles.columnHeader}><div><span className={styles.step}>03</span><h2>单据全景</h2></div><small>业务详情 · 物流轨迹</small></div>
        <form className={styles.manualTrack} aria-label="物流轨迹查询" onSubmit={event => { event.preventDefault(); void refreshTracking(manualWaybill) }}>
          <input aria-label="备用查询运单号" value={manualWaybill} onChange={event => setManualWaybill(event.target.value.toUpperCase())} placeholder="输入顺丰运单号查询" />
          <input aria-label="查询手机号后四位" value={phoneSuffix} onChange={event => setPhoneSuffix(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="手机后四位" />
          <button type="submit" disabled={!manualWaybill || trackingBusy}><Search size={14}/>{trackingBusy ? '查询中…' : '查询轨迹'}</button>
        </form>
        {trackingError && <p role="alert" className={styles.trackingNotice}>运单 {trackingTarget} 查询未成功：{trackingError}{tracking ? ' 上次查询结果保留，尚未更新。' : ''}</p>}
        {tracking?.source === 'sandbox_mock' && <p className={styles.trackingNotice} role="note">顺丰沙盒返回的是模拟轨迹，不用于判断实际揽收、签收或取消状态。</p>}
        {selected ? (
          <div className={styles.detailStack}>
            <section className={styles.detailPane}>
              <div className={styles.detailHero}>
                <div><span>{isSimulation ? '模拟单号' : selected.waybill ? '承运商运单' : '业务提报单'}</span><strong>{selected.waybill || selected.orderNo}</strong></div>
                <div className={styles.detailActions}>
                  <button aria-label="复制单号" onClick={() => void copySelectedNumber()}><Clipboard size={15} aria-hidden="true"/>复制单号</button>
                  {(selected.status === 'order_unknown' || selected.status === 'ordering') && <button className={styles.secondaryButton} aria-label="查回所选单据下单结果" disabled={batchBusy || confirmationBusy || !!busy} onClick={() => void reconcileOrder(selected.id)}>{busy === selected.id ? '查回中…' : '查回下单结果'}</button>}{selected.status === 'waybill_created' && <button className={styles.cancelButton} disabled={confirmationBusy || !!busy} onClick={() => void cancelSelected()}>{isSimulation ? '模拟取消运单' : '取消运单'}</button>}
                </div>
              </div>
              {(selected.status === 'order_failed' || selected.status === 'order_unknown' || (selected.status === 'awaiting_confirmation' && selected.failure)) && <section className={styles.workorderReview} aria-label="下单异常处理">
                <h3>{selected.status === 'order_failed' ? '本次下单未成功' : selected.status === 'order_unknown' ? '下单结果待确认' : '重新核对原工单'}</h3>
                <p role="alert">{selected.failure?.message || (selected.status === 'order_failed' ? '上次下单已被拒绝，历史版本未保存具体原因。' : '尚未确认是否生成运单，请先查回原请求，勿重复下单。')}</p>
                {selected.failure?.at && <small>发生时间：{new Date(selected.failure.at).toLocaleString('zh-CN')}</small>}
                {selected.status === 'order_failed' && <><p>重新核对只恢复本工单的审核状态；核对并确认后才再次向承运商发单。</p><button type="button" disabled={batchBusy || confirmationBusy || !!busy} onClick={() => void reopenFailed(selected)}>{busy === selected.id ? '恢复中…' : '重新核对原工单'}</button></>}
              </section>}
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
          <div className={trackingTarget || tracking ? styles.externalTracking : `${styles.noTracking} ${styles.emptyTracking}`}>
            {!trackingTarget && !tracking && <PackageCheck size={32}/>}
            <strong>{trackingTarget || tracking ? `顺丰运单 ${trackingTarget || tracking?.waybill}` : '暂无收寄记录'}</strong>
            <p>{trackingBusy ? '正在查询这票运单…' : trackingError ? '请按上方提示处理后重新查询。此运单未关联当前台账工单。' : tracking ? `物流轨迹查询结果 · 更新于 ${new Date(tracking.queriedAt).toLocaleString('zh-CN')}` : '可直接输入顺丰运单号查询；本人或业务提报的真实单据也会显示在这里。'}</p>
            {tracking && (tracking.events.length ? <ol className={styles.timeline}>{tracking.events.map((event, index) => <li key={`${event.time}-${index}`}><i/><time>{event.time}</time><p>{event.description}</p><small>{event.location}</small></li>)}</ol> : <p>暂无物流轨迹，运单可能尚未揽收。</p>)}
          </div>
        )}
      </section>
    </div>
  </main>
}

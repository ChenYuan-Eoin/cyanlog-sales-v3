'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Box, CheckCircle2, ChevronRight, Clipboard, PackageCheck, RefreshCw, Search, SlidersHorizontal, Truck, UploadCloud } from 'lucide-react'
import type { Contact, ShippingPayment, ShipmentOrder, ShipmentOrderStatus, ShippingInput, ShippingSettings, TrackingResult } from '@/lib/shipping/types'
import { buildShippingTemplate, parseShippingFile, type BatchDraftRow } from '@/lib/shipping/import-parser'
import { parseShippingText, prepareBatchRecipient } from '@/lib/shipping/batch-text'
import { shippingWorkbenchRequest, ShippingWorkbenchRequestError, isDefinitiveShippingRejection, type ShippingSimulation } from '@/lib/shipping/workbench-client'
import { contactSchema } from '@/lib/shipping/validation'
import { parseAddress } from '@/lib/shipping/address'
import { normalizeTrackingTime } from '@/lib/shipping/tracking-status'
import { DEFAULT_INTAKE_RULES, intakeFieldSchema } from '@/lib/shipping/intake-rules'
import { OperatorCarrierChangeHistory } from './carrier-change-history'
import styles from './workbench.module.css'

const statusLabel: Record<ShipmentOrderStatus, string> = { accepted: '已受理', awaiting_confirmation: '待审核', returned: '工单已退回', resubmitted: '已重提', confirmed: '已确认', ordering: '下单中', order_unknown: '结果待确认', waybill_created: '待揽收', in_transit: '运输中', delivered: '已签收', cancelled: '已取消', order_failed: '异常件' }
const statusTone: Record<ShipmentOrderStatus, string> = { accepted: 'orange', awaiting_confirmation: 'orange', returned: 'red', resubmitted: 'gray', confirmed: 'blue', ordering: 'blue', order_unknown: 'red', waybill_created: 'blue', in_transit: 'blue', delivered: 'green', cancelled: 'gray', order_failed: 'red' }
type IntakeInput = Omit<ShippingInput, 'sender'> & { sender?: ShippingInput['sender'] }
type BatchRow = Omit<BatchDraftRow, 'result'> & { result?: 'pending' | 'unknown' | 'success' | 'failed'; orderId?: string; orderNo?: string; intakeInput?: IntakeInput }
type SubmissionResult = { id?: string; orderId?: string; orderNo?: string; status?: ShipmentOrderStatus; waybill?: string | null }
const maySubmitRow = (row: BatchRow) => !row.result || row.result === 'failed'

function cityOf(order: ShipmentOrder) { return order.input.recipient.city || order.input.recipient.province }
function customerOf(order: ShipmentOrder) { return order.input.customerName || order.relation.customerRef || '未填写客户' }
type ServiceOverride = { serviceId: number; revision: number; source: '本票选择' | '批量应用' }
function serviceForReview(order: ShipmentOrder, override: ServiceOverride | undefined, services: ShippingSettings['services']) {
  const current = override?.revision === (order.revision || 1) ? override : undefined
  const id = current?.serviceId ?? order.input.serviceId
  return id !== undefined
    ? services.find(service => service.id === id) || null
    : services.find(service => (service.preference || 'standard') === (order.input.servicePreference || 'standard')) || null
}

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

const sfWaybillPattern = /^(?:SF)?\d{10,15}$/
const ledgerUrl = '/api/shipping/ledger?limit=50'
const needsTracking = (order: ShipmentOrder) => order.status === 'waybill_created' || order.status === 'in_transit'
const statusForDisplay = (order: ShipmentOrder) => order.status === 'in_transit' && order.trackingStatus === 'out_for_delivery' ? '派送中' : statusLabel[order.status]

function verifiedTrackingStatus(result: TrackingResult, waybill: string) {
  if (result.source !== 'carrier' || result.waybill !== waybill || !result.shipmentStatus || !Array.isArray(result.events)) return null
  const events = result.events.map(event => ({ status: event.status, time: normalizeTrackingTime(event.time) }))
  if (!events.length || events.some(event => !event.time)) return null
  const latest = events.sort((a, b) => (b.time || '').localeCompare(a.time || ''))[0]
  if (!latest.status || latest.status === 'unknown') return null
  // Any carrier evidence beyond pickup makes the operation unsafe, even if a
  // later response reports an older status or a conflicting event.
  if (result.shipmentStatus === 'waybill_created' && events.some(event => event.status !== 'waybill_created')) return null
  return result.shipmentStatus
}

export default function ShippingWorkbench({ settings: initialSettings, simulation }: { settings: ShippingSettings; simulation?: ShippingSimulation }) {
  const [settings, setSettings] = useState(initialSettings)
  useEffect(() => { setSettings(initialSettings) }, [initialSettings])
  const request = simulation ? simulation.request : shippingWorkbenchRequest
  const isSimulation = Boolean(simulation)
  const [orders, setOrders] = useState<ShipmentOrder[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null)
  const [orderParamsExpanded, setOrderParamsExpanded] = useState(false)
  const [intakeOpen, setIntakeOpen] = useState(false)
  const [batch, setBatch] = useState<BatchRow[]>([])
  const [entryMode, setEntryMode] = useState<'file' | 'text'>('text')
  const [bulkText, setBulkText] = useState(simulation?.sampleText || '')
  const [batchBusy, setBatchBusy] = useState(false)
  const [templateBusy, setTemplateBusy] = useState(false)
  const [connectionId, setConnectionId] = useState(settings.connectionId || '')
  const [batchServiceId, setBatchServiceId] = useState('')
  const [serviceOverrides, setServiceOverrides] = useState<Record<string, ServiceOverride>>({})
  const submittedServices = useRef(new Map<string, { id: number; name: string }>())
  const [billingAccountId, setBillingAccountId] = useState(settings.defaultBillingAccountId || '')
  const [payment, setPayment] = useState<ShippingPayment>('sender_monthly')
  const [senderOverride, setSenderOverride] = useState<Contact | null>(null)
  const [senderText, setSenderText] = useState('')
  const [editingSender, setEditingSender] = useState(!contactSchema.safeParse(settings.sender).success)
  const senderSection = useRef<HTMLDivElement>(null)
  const senderTextInput = useRef<HTMLTextAreaElement>(null)
  const expandedReviewSection = useRef<HTMLElement | null>(null)
  const [returnDraft, setReturnDraft] = useState<{ orderId: string; reason: string; error: string } | null>(null)
  const [amendmentDraft, setAmendmentDraft] = useState<{
    orderId: string
    recipientName: string
    recipientPhone: string
    province: string
    city: string
    county: string
    address: string
    cargo: string
    weight: string
    remark: string
    reason: string
    error: string
  } | null>(null)
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
  const [trackingChecks, setTrackingChecks] = useState<ReadonlyMap<string, TrackingResult | null>>(new Map())
  const [trackingRefresh, setTrackingRefresh] = useState(0)
  const trackingRequest = useRef(0)
  const reconciliationRequests = useRef(new Set<string>())
  const batchRunning = useRef(false)
  const [dateRange, setDateRange] = useState<'all' | 'today' | 'three-days' | 'week'>('all')

  useEffect(() => {
    let active = true
    void request<{ records: ShipmentOrder[] }>(ledgerUrl).then(async result => {
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

  const activeWaybills = [...new Set(orders.filter(order => needsTracking(order) && sfWaybillPattern.test(order.waybill || '')).map(order => order.waybill!))].sort().join(',')
  useEffect(() => {
    if (!activeWaybills || isSimulation || settings.guest) return
    const controller = new AbortController()
    const numbers = activeWaybills.split(',')
    const outcomes = new Map<string, TrackingResult | null>()
    setTrackingChecks(current => new Map([...current].filter(([number]) => !numbers.includes(number))))

    async function synchronize() {
      for (let index = 0; index < numbers.length && !controller.signal.aborted; index += 4) {
        await Promise.all(numbers.slice(index, index + 4).map(async number => {
          try {
            const result = await request<TrackingResult>('/api/shipping/tracking', {
              method: 'POST', body: JSON.stringify({ waybill: number }), signal: controller.signal,
            })
            outcomes.set(number, verifiedTrackingStatus(result, number) ? result : null)
          } catch { outcomes.set(number, null) }
        }))
      }
      if (controller.signal.aborted) return
      if ([...outcomes.values()].some(Boolean)) {
        try {
          const { records } = await request<{ records: ShipmentOrder[] }>(ledgerUrl, { signal: controller.signal })
          if (controller.signal.aborted) return
          const latest = new Map(records.map(order => [order.id, order]))
          for (const order of records) {
            if (!order.waybill) continue
            const checked = outcomes.get(order.waybill)
            if (checked && checked.shipmentStatus !== order.status && needsTracking(order)) outcomes.set(order.waybill, null)
          }
          setOrders(current => current.map(order => {
            const fresh = latest.get(order.id)
            if (!fresh || !order.waybill || fresh.waybill !== order.waybill || !outcomes.has(order.waybill) || !needsTracking(order)) return order
            const status = order.status === 'in_transit' && fresh.status === 'waybill_created' ? order.status : fresh.status
            return { ...order, status, trackingEvents: fresh.trackingEvents, trackingStatus: fresh.trackingStatus, trackingUpdatedAt: fresh.trackingUpdatedAt }
          }))
          const readWaybills = new Set(records.map(order => order.waybill))
          for (const number of numbers) if (!readWaybills.has(number)) outcomes.set(number, null)
        } catch {
          if (controller.signal.aborted) return
          for (const number of numbers) outcomes.set(number, null)
        }
      }
      setTrackingChecks(current => new Map([...current, ...outcomes]))
    }
    void synchronize()
    return () => controller.abort()
  }, [activeWaybills, isSimulation, request, settings.guest, trackingRefresh])

  useEffect(() => {
    if (!activeWaybills || isSimulation || settings.guest) return
    function refreshWhenVisible() {
      if (document.visibilityState === 'visible' && !busy && !batchBusy && !confirmationBusy && !trackingBusy) setTrackingRefresh(value => value + 1)
    }
    const interval = window.setInterval(refreshWhenVisible, 120_000)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', refreshWhenVisible) }
  }, [activeWaybills, batchBusy, busy, confirmationBusy, isSimulation, settings.guest, trackingBusy])

  const selected = trackingTarget ? orders.find(order => order.waybill === trackingTarget) : orders.find(order => order.id === selectedId) || orders[0]
  function trackingFor(order: ShipmentOrder) {
    if (!order.waybill) return null
    if (tracking?.waybill === order.waybill) return tracking
    return trackingChecks.get(order.waybill) || null
  }
  function trackingNotice(order: ShipmentOrder) {
    if (isSimulation || !needsTracking(order) || !order.waybill) return ''
    if (trackingChecks.get(order.waybill) === null) return '顺丰最新状态尚未核实'
    if (!trackingChecks.has(order.waybill) && sfWaybillPattern.test(order.waybill)) return '正在核实顺丰物流状态'
    return trackingChecks.has(order.waybill) ? '' : '顺丰最新状态尚未核实'
  }
  const selectedTracking = selected ? trackingFor(selected) : tracking
  const trackingEvents = selectedTracking?.events.length ? selectedTracking.events : selected?.trackingEvents || []
  const canCancelSelected = selected?.status === 'waybill_created' && (isSimulation || Boolean(selected.waybill && trackingChecks.get(selected.waybill)?.shipmentStatus === 'waybill_created'))
  function orderHasDispatch(order: ShipmentOrder) {
    return Boolean(order.waybill) || ['ordering', 'order_unknown', 'waybill_created', 'in_transit', 'delivered', 'cancelled'].includes(order.status)
  }
  function chooseOrder(order: ShipmentOrder) {
    setTrackingTarget('')
    setTrackingError('')
    setSelectedId(order.id)
    setManualWaybill(order.waybill || '')
    setTracking(null)
    trackingRequest.current += 1
    setTrackingBusy(false)
  }
  function toggleOrderExpansion(order: ShipmentOrder) {
    chooseOrder(order)
    setExpandedOrderId(current => current === order.id ? null : order.id)
  }
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
    ? Boolean(selectedConnection?.status === 'connected' && (payment !== 'sender_monthly' || availableAccounts.some(account => account.id === billingAccountId)) && selectedServices.length > 0 && (selectedConnection.environment !== 'production' || selectedConnection.orderCapability !== 'unavailable'))
    : settings.canSubmit
  const reviewedOrders = filtered.filter(order => reviewIds.includes(order.id) && order.status === 'awaiting_confirmation')
  const expandedReviewOrder = expandedOrderId ? filtered.find(order => order.id === expandedOrderId) : null
  const expandedSingleReview = Boolean(expandedReviewOrder && !orderHasDispatch(expandedReviewOrder))
  const reviewedSendersReady = reviewedOrders.every(order => senderForReview(order, settings.sender).contact !== null)
  const reviewedServicesReady = reviewedOrders.every(order => serviceForReview(order, serviceOverrides[order.id], selectedServices) !== null)
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
      && (isSimulation ? /^DEMO-\d{6}$/.test(result.waybill) : sfWaybillPattern.test(result.waybill))
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
  function acceptServiceReadback(records: ShipmentOrder[], results: Map<string, SubmissionResult>) {
    for (const order of records) {
      const result = results.get(order.id)
      if (result && successfulSubmission(result)
        && ['waybill_created', 'in_transit', 'delivered', 'cancelled'].includes(order.status)
        && order.waybill === result.waybill
        && Number.isInteger(order.input.serviceId) && Number(order.input.serviceId) > 0) {
        submittedServices.current.delete(order.id)
      }
    }
  }
  function actualServiceLabel(order: ShipmentOrder) {
    const requested = submittedServices.current.get(order.id)
    if (requested) return `产品待回读（本次请求：${requested.name}）`
    return order.input.serviceName || (order.input.serviceId ? `产品编号 ${order.input.serviceId}（名称待回读）` : order.input.servicePreference === 'urgent' ? '加急偏好' : '标准偏好')
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
      setSettings(current => ({ ...current, ...result.settings })); setConnectionId(result.settings.connectionId || ''); setBillingAccountId(result.settings.defaultBillingAccountId || ''); setBatchServiceId(''); setServiceOverrides({}); setReviewIds([])
      setMessage('寄件配置已刷新，草稿保留；请重新核对下单参数。')
    } catch (error) { setMessage((error as Error).message) } finally { setBusy('') }
  }
  function changeConnection(nextId: string) {
    setConnectionId(nextId)
    setBatchServiceId('')
    setServiceOverrides({})
    setReviewIds([])
    setMessage('快递连接已切换，请重新核对各票产品与下单参数。')
    const accounts = (settings.billingAccounts || []).filter(account => account.connectionId === nextId && account.status === 'active')
    setBillingAccountId(accounts.find(account => account.isDefault)?.id || accounts[0]?.id || '')
  }
  useEffect(() => {
    if (!expandedOrderId) return
    const frame = window.requestAnimationFrame(() => {
      expandedReviewSection.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [expandedOrderId, selected?.status])
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
      const ledger = await request<{ records: ShipmentOrder[] }>(ledgerUrl)
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
        const refreshed = await request<{ records: ShipmentOrder[] }>(ledgerUrl)
        acceptServiceReadback(refreshed.records, new Map([[orderId, result]]))
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
  function applyBatchService() {
    if (confirmationRunning.current || batchRunning.current || !reviewedOrders.length) return
    const service = batchServiceId ? selectedServices.find(item => String(item.id) === batchServiceId) : null
    if (batchServiceId && !service) return
    setServiceOverrides(current => {
      const next = { ...current }
      for (const order of reviewedOrders) {
        if (service) next[order.id] = { serviceId: service.id, revision: order.revision || 1, source: '批量应用' }
        else delete next[order.id]
      }
      return next
    })
    setMessage(service ? `已将${service.name}应用到已选 ${reviewedOrders.length} 票，请逐票核对。` : `已恢复已选 ${reviewedOrders.length} 票的原产品，请逐票核对。`)
  }
  async function confirmReviewed() {
    if (confirmationRunning.current || batchRunning.current || !reviewedOrders.length || !canSubmitCurrent || !reviewedSendersReady || !reviewedServicesReady) return
    if (productionOrderUnverified && reviewedOrders.length !== 1) { setMessage('生产下单权限尚未实测，请先核对并确认一票工单。'); return }
    const plan: Array<{ order: ShipmentOrder; service: ShippingSettings['services'][number] }> = []
    for (const order of reviewedOrders) {
      const service = serviceForReview(order, serviceOverrides[order.id], selectedServices)
      if (!service) return
      plan.push({ order, service })
    }
    const selection = { connectionId: connectionId || undefined, payment, billingAccountId: payment === 'sender_monthly' ? billingAccountId || undefined : undefined }
    confirmationRunning.current = true; setConfirmationBusy(true); setMessage('')
    let succeeded = 0, uncertain = 0, failed = 0
    const results = new Map<string, SubmissionResult>()
    const errors: string[] = []
    for (const { order, service } of plan) {
      setBusy(order.id)
      submittedServices.current.set(order.id, { id: service.id, name: service.name })
      try {
        const result = await request<SubmissionResult>(`/api/shipping/ledger/${encodeURIComponent(order.id)}/confirm`, { method: 'POST', body: JSON.stringify({ ...selection, serviceId: service.id }) })
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
      const refreshed = await request<{ records: ShipmentOrder[] }>(ledgerUrl)
      acceptServiceReadback(refreshed.records, results)
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
  function beginAmendment(order: ShipmentOrder) {
    if (!['awaiting_confirmation', 'returned'].includes(order.status) || order.waybill) return
    setAmendmentDraft({
      orderId: order.id,
      recipientName: order.input.recipient.name,
      recipientPhone: order.input.recipient.phone,
      province: order.input.recipient.province,
      city: order.input.recipient.city,
      county: order.input.recipient.county,
      address: order.input.recipient.address,
      cargo: order.input.cargo,
      weight: String(order.input.weight),
      remark: order.input.remark,
      reason: '',
      error: '',
    })
  }
  async function amendOrder(order: ShipmentOrder) {
    if (!amendmentDraft || amendmentDraft.orderId !== order.id || busy) return
    const weight = Number(amendmentDraft.weight)
    const nextInput: ShippingInput = {
      ...order.input,
      recipient: {
        name: amendmentDraft.recipientName.trim(),
        phone: amendmentDraft.recipientPhone.trim(),
        province: amendmentDraft.province.trim(),
        city: amendmentDraft.city.trim(),
        county: amendmentDraft.county.trim(),
        address: amendmentDraft.address.trim(),
      },
      cargo: amendmentDraft.cargo.trim(),
      weight,
      remark: amendmentDraft.remark.trim(),
    }
    if (!contactSchema.safeParse(nextInput.recipient).success) {
      setAmendmentDraft(current => current && { ...current, error: '请补齐收件人姓名、有效电话、省市区和详细地址。' })
      return
    }
    if (!Number.isFinite(weight) || weight <= 0 || weight > 20) {
      setAmendmentDraft(current => current && { ...current, error: '重量必须大于 0 且不超过 20kg。' })
      return
    }
    if (amendmentDraft.reason.trim().length < 2) {
      setAmendmentDraft(current => current && { ...current, error: '请填写至少2个字符的修改原因。' })
      return
    }
    setBusy(order.id); setMessage('')
    try {
      const updated = await request<ShipmentOrder>(`/api/shipping/ledger/${encodeURIComponent(order.id)}/amend`, {
        method: 'POST',
        body: JSON.stringify({
          expected_revision: order.revision || 1,
          input: nextInput,
          reason: amendmentDraft.reason.trim(),
        }),
      })
      setOrders(rows => rows.map(item => item.id === order.id ? updated : item))
      setSelectedId(order.id)
      setReviewIds(ids => ids.filter(id => id !== order.id))
      setAmendmentDraft(null)
      setMessage('工单已保存为新版本并回到待核对；尚未向承运商发单。')
    } catch (error) {
      const errorMessage = `工单修改未完成：${(error as Error).message}`
      setAmendmentDraft(current => current && { ...current, error: errorMessage })
      setMessage(errorMessage)
    } finally { setBusy('') }
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
        const normalizedResult = { ...result, events: Array.isArray(result.events) ? result.events : [] }
        setTracking(normalizedResult); setManualWaybill(number)
        const verified = !isSimulation && verifiedTrackingStatus(normalizedResult, number)
        if (isSimulation || verified) setOrders(items => items.map(order => withTrackingStatus(order, normalizedResult)))
        if (!isSimulation) setTrackingChecks(current => new Map(current).set(number, verified ? normalizedResult : null))
      }
    } catch (error) {
      if (currentRequest === trackingRequest.current) {
        setMessage((error as Error).message); setTrackingError((error as Error).message)
        if (!isSimulation) setTrackingChecks(current => new Map(current).set(number, null))
      }
    } finally { if (currentRequest === trackingRequest.current) setTrackingBusy(false) }
  }

  async function cancelSelected() {
    if (!selected || !canCancelSelected || trackingBusy || confirmationRunning.current || busy) return
    setBusy(selected.id)
    try { await request(`/api/shipping/ledger/${selected.id}/cancel`, { method: 'POST', body: '{}' }); setOrders(items => items.map(item => item.id === selected.id ? { ...item, status: 'cancelled' } : item)); setTracking(null); trackingRequest.current += 1; setTrackingBusy(false); setMessage(isSimulation ? '模拟运单已取消，没有操作真实运单。' : '顺丰运单已取消。') } catch (error) { setMessage((error as Error).message) } finally { setBusy('') }
  }

  return <main className={styles.shell}>
    <header className={styles.topbar}>
      <div><p>物流协同 / SHIPPING OPS</p><h1>自助收寄</h1></div>
      <div className={styles.topbarActions}>
        <button type="button" className={`${styles.configButton} ${styles.intakeToggle}`} aria-expanded={intakeOpen} aria-controls="shipping-intake-column" onClick={() => setIntakeOpen(open => !open)}>{intakeOpen ? '收起寄件录入' : '寄件录入'}</button>
        {simulation ? <><button className={styles.configButton} disabled={inputLocked || !!busy} onClick={simulation.onReset}>重置演示</button><a className={styles.configButton} href="/shipping">返回真实工作台</a></> : <button className={styles.configButton} disabled={!!busy || confirmationBusy || batchBusy} onClick={() => void refreshConfiguration()}>刷新寄件配置</button>}
        <div className={styles.connection}><span />{isSimulation ? '模拟体验' : selectedConnection ? `顺丰${selectedConnection.environment === 'sandbox' ? '沙盒' : '生产'}` : settings.configurationWarning ? '配置暂不可用' : '未配置快递连接'}<small>{payment === 'sender_cash' ? '寄方现结' : payment === 'recipient' ? '收方到付' : selectedAccount ? `${selectedAccount.displayName} · 尾号 ${selectedAccount.tail}` : '月结账号待选择'}</small></div>
      </div>
    </header>
    {simulation && <div className={styles.simulationNotice} role="note"><strong>模拟体验</strong> 地址、单号和轨迹均为示例，仅在当前页面演示，不向顺丰下单、不产生费用。<span>左栏解析并提交工单 → 中栏核对并模拟确认下单 → 右栏查看运单、轨迹与取消。销售匿名提报直接进入中栏。</span></div>}

    {settings.configurationWarning && <div className={styles.notice} role="status">{settings.configurationWarning}</div>}
    {settings.defaultsWarning && <div className={styles.notice} role="status">{settings.defaultsWarning}</div>}
    {message && <div className={styles.toast} role="status">{message}</div>}
    {productionOrderUnverified && <div className={styles.notice} role="status">生产连接已验证，下单权限尚未实测。可正常提报工单；请先在中栏核对并确认一票，之后再批量正式下单。</div>}
    <div className={styles.columns}>
      <section id="shipping-intake-column" className={`${styles.column} ${styles.intakeColumn}`} data-mobile-open={intakeOpen} aria-label="批量寄件操作台">
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

      <section className={`${styles.column} ${styles.orderColumn}`} aria-label="收寄件台账与待办">
        <div className={styles.columnHeader}><div><span className={styles.step}>02</span><h2>工单审核与下单</h2></div><small>{orders.filter(order => order.status === 'awaiting_confirmation').length} 条待审核</small>{!isSimulation && activeWaybills && <button type="button" className={styles.secondaryButton} onClick={() => setTrackingRefresh(value => value + 1)}>同步物流状态</button>}</div>
        <div className={styles.filters}>
          <div className={styles.segmented}><button className={type === 'all' ? styles.active : ''} onClick={() => setType('all')}>全部</button><button className={type === 'outbound' ? styles.active : ''} onClick={() => setType('outbound')}>寄出件</button><button className={type === 'inbound' ? styles.active : ''} onClick={() => setType('inbound')}>收到件</button></div>
          <div className={styles.quickDates}>{([{ value: 'all', label: '全部日期' }, { value: 'today', label: '今天' }, { value: 'three-days', label: '近3天' }, { value: 'week', label: '本周' }] as const).map(item => <button key={item.value} aria-pressed={dateRange === item.value} onClick={() => setDateRange(item.value)}>{item.label}</button>)}</div>
          <select aria-label="状态筛选" value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="all">全部状态</option><option value="awaiting_confirmation">待审核工单</option><option value="returned">已退回工单</option><option value="order_unknown">下单结果待确认</option><option value="ordering">下单中</option><option value="waybill_created">已出单/待揽收</option><option value="in_transit">运输中</option><option value="delivered">已签收</option><option value="order_failed">异常件</option></select>
          <label className={styles.search}><Search size={14}/><input aria-label="搜索台账" value={search} onChange={event => setSearch(event.target.value)} placeholder="提报人、客户、收件人、工单号、运单号"/></label>
        </div>
        <div className={styles.orderList}>
          {reviewedOrders.length > 0 && <section className={styles.bulkSettings} aria-label="逐票下单产品核对">
            <h3>本次下单产品</h3>
            <ul>{reviewedOrders.map(order => {
              const service = serviceForReview(order, serviceOverrides[order.id], selectedServices)
              const override = serviceOverrides[order.id]
              return <li key={order.id}><span>{order.orderNo}</span> · <strong>{service?.name || '产品不可用，请重新选择'}</strong> · {override?.revision === (order.revision || 1) ? override.source : '工单原选'}</li>
            })}</ul>
            {!reviewedServicesReady && <p role="alert" className={styles.bad}>存在不可用的寄件产品，请逐票重新选择后再确认。</p>}
          </section>}
          {reviewedOrders.length > 0 && !expandedSingleReview && <section className={`${styles.bulkSettings} ${styles.orderParameterPanel}`} aria-label="正式下单参数">
            <div className={styles.parameterHead}>
              <div><h3>正式下单参数</h3><small>已选 {reviewedOrders.length} 票 · 默认取自当前寄件配置</small></div>
              <button type="button" className={styles.parameterToggle} aria-label={orderParamsExpanded ? '收起参数' : '调整参数'} title={orderParamsExpanded ? '收起参数' : '调整参数'} aria-expanded={orderParamsExpanded} onClick={() => setOrderParamsExpanded(value => !value)}><SlidersHorizontal size={13}/></button>
            </div>
            <div className={styles.parameterSummary} role="group" aria-label="正式下单参数摘要">
              <div><small>连接</small><b>{selectedConnection ? `顺丰 · ${selectedConnection.environment === 'sandbox' ? '沙盒' : '生产'} · ${selectedConnection.status === 'connected' ? '已连接' : '待验证'}` : '顺丰 · 待配置接口'}</b></div>
              <div><small>付款</small><b>{payment === 'sender_monthly' ? '公司月结' : payment === 'sender_cash' ? '寄方现结' : '收方到付'}</b></div>
              <div><small>月结账号</small><b>{payment === 'sender_monthly' ? (selectedAccount ? `${selectedAccount.displayName} · 尾号 ${selectedAccount.tail}` : '尚未配置') : '无需月结账号'}</b></div>
              <div><small>服务产品</small><b>逐票核对，以本次下单产品清单为准</b></div>
            </div>
            <div className={styles.parameterGrid} hidden={!orderParamsExpanded}>
              <label>承运商连接<select disabled={confirmationBusy} value={connectionId} onChange={event => changeConnection(event.target.value)}>{!settings.carrierConnections?.length && <option value="">顺丰 · 生产 · 待配置接口</option>}{(settings.carrierConnections || []).map(connection => <option key={connection.id} value={connection.id}>顺丰 · {connection.environment === 'sandbox' ? '沙盒' : '生产'} · {connection.status === 'connected' ? '已连接' : '待验证'}</option>)}</select></label>
              <label>本批付款方式<select disabled={confirmationBusy} value={payment} onChange={event => setPayment(event.target.value as ShippingPayment)}><option value="sender_monthly">公司月结</option><option value="sender_cash">寄方现结</option><option value="recipient">收方到付</option></select></label>
              {payment === 'sender_monthly' && <label>月结账号<select disabled={confirmationBusy} value={billingAccountId} onChange={event => setBillingAccountId(event.target.value)}>{!availableAccounts.length && <option value="">当前承运商环境暂无月结账号</option>}{availableAccounts.map(account => <option key={account.id} value={account.id}>{account.displayName} · 尾号 {account.tail}{account.isDefault ? ' · 默认' : ''}</option>)}</select></label>}
              <label>寄件服务<select disabled={confirmationBusy} value={batchServiceId} onChange={event => setBatchServiceId(event.target.value)}><option value="">恢复各票原产品</option>{selectedServices.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
              <button type="button" className={styles.secondaryButton} disabled={confirmationBusy || !reviewedOrders.length || Boolean(batchServiceId && !selectedServices.some(service => String(service.id) === batchServiceId))} onClick={applyBatchService}>应用到已选工单</button>
              <small>选择后需点击应用，才会修改当前已选工单。</small>
            </div>
            <p className={styles.intakeHint}>确认后才向承运商发单；实际寄件人按各工单保存资料使用。{productionOrderUnverified ? '生产首票需单独确认。' : ''}</p>
            {!canSubmitCurrent && <p className={styles.bad}>{payment === 'sender_monthly' ? '连接、月结账号或寄件服务未就绪，请在配置中心处理后正式下单。' : '快递连接或寄件服务未就绪，请在配置中心处理后正式下单。'}</p>}
          </section>}
          {ledgerLoading ? <p className={styles.listHint}>正在读取台账…</p> : !filtered.length && <p className={styles.listHint}>暂无匹配单据</p>}
          {filtered.map(order => {
            const orderTracking = trackingFor(order)
            const orderEvents = orderTracking?.events.length ? orderTracking.events : order.trackingEvents || []
            const orderTrackingNotice = trackingNotice(order)
            const senderReview = senderForReview(order, settings.sender)
            const reviewService = serviceForReview(order, serviceOverrides[order.id], selectedServices)
            return <article key={order.id} className={`${styles.orderCard} ${order.id === selected?.id ? styles.selectedCard : ''}`}>
            <div
              className={styles.orderSelect}
              role="button"
              tabIndex={0}
              aria-label={`查看单据 ${order.waybill || order.orderNo}`}
              aria-pressed={order.id === selected?.id}
              onClick={() => chooseOrder(order)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  chooseOrder(order)
                }
              }}
            >
            <div className={styles.cardHead}><span className={`${styles.tag} ${styles[statusTone[order.status]]}`}>{statusForDisplay(order)}</span><span>{order.input.submittedBy ? `提报人：${order.input.submittedBy.name}` : order.intakeSource === 'owner_web' ? '登录用户提报' : order.relation.salesRef || '待分配'}</span><b>{cityOf(order)}</b></div>
            {orderTrackingNotice && <small className={styles.listHint}>{orderTrackingNotice}</small>}
            <div className={styles.cardCore}>
              <div><small>客户</small><strong>{customerOf(order)}</strong></div>
              <div>
                <small>收件人</small>
                <div className={styles.recipientHeading}>
                  <button
                    type="button"
                    className={`${styles.cardToggle} ${expandedOrderId === order.id ? styles.cardToggleExpanded : ''}`}
                    aria-expanded={expandedOrderId === order.id}
                    aria-label={`${expandedOrderId === order.id ? '收起' : '展开'}${orderHasDispatch(order) ? '递送信息' : '工单'} ${order.waybill || order.orderNo}`}
                    title={`${expandedOrderId === order.id ? '收起' : '展开'}${orderHasDispatch(order) ? '递送信息' : '工单'}`}
                    onClick={event => {
                      event.stopPropagation()
                      toggleOrderExpansion(order)
                    }}
                  >
                    <ChevronRight size={15}/>
                  </button>
                  <strong>{order.input.recipient.name}</strong>
                </div>
              </div>
            </div>
            {order.input.specialRequirements && <p className={styles.special}><AlertTriangle size={13}/>特殊需求：{order.input.specialRequirements}</p>}
            <div className={styles.cardMeta}><span>{order.waybill || order.orderNo}</span><time>{new Date(order.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time></div>
            </div>
            {order.status === 'awaiting_confirmation' && <>
              <div className={styles.cardActions} onClick={event => event.stopPropagation()}>
                <label className={styles.reviewSelection}><input type="checkbox" aria-label={`核对并选择工单 ${order.orderNo}`} disabled={confirmationBusy || !!busy} checked={reviewIds.includes(order.id)} onChange={() => toggleReview(order)}/>核对工单</label>
                <button className={styles.secondaryButton} disabled={confirmationBusy || !!busy} onClick={() => beginAmendment(order)}>修改工单</button>
                <button className={styles.reject} disabled={confirmationBusy || !!busy} onClick={() => beginReturn(order)}>退回工单</button>
              </div>
              {returnDraft?.orderId === order.id && <form className={styles.returnForm} aria-label={`退回工单 ${order.orderNo}`} onClick={event => event.stopPropagation()} onSubmit={event => { event.preventDefault(); void returnOrder(order) }}>
                <label>退回原因<textarea aria-label="退回原因" value={returnDraft.reason} minLength={2} maxLength={300} required disabled={!!busy} onChange={event => setReturnDraft({ orderId: order.id, reason: event.target.value, error: '' })}/></label>
                <small>已按当前缺项预填，可修改。确认后将退回给提报人补充。</small>
                {returnDraft.reason.trim().length < 2 && <p role="alert">请填写至少2个字符的退回原因。</p>}
                {returnDraft.error && <p role="alert">{returnDraft.error}</p>}
                <div className={styles.formActions}><button type="submit" className={styles.reject} disabled={!!busy || returnDraft.reason.trim().length < 2 || returnDraft.reason.trim().length > 300}>{busy === order.id ? '退回中…' : '确认退回'}</button><button type="button" className={styles.secondaryButton} disabled={!!busy} onClick={() => setReturnDraft(null)}>取消</button></div>
              </form>}
              {expandedOrderId === order.id && !orderHasDispatch(order) && <section ref={expandedReviewSection} className={styles.workorderReview} aria-label={`工单 ${order.orderNo} 收寄预览`}>
                <div className={styles.reviewHeading}><h3>服务与时效核对</h3><span>确认前可修改</span></div>
                <div className={styles.reviewKeyFacts}>
                  <div><small>收件人</small><strong>{order.input.recipient.name}</strong><span>{order.input.recipient.phone}</span></div>
                  <div><small>服务与物品</small><strong>{reviewService?.name || '产品不可用，请重新选择'}</strong><span>{order.input.cargo} · {order.input.weight}kg</span></div>
                </div>
                {expandedOrderId === order.id && <div className={styles.inlineCheckout}>
                  <div className={styles.inlineServiceChoices} role="radiogroup" aria-label={`工单 ${order.orderNo} 快递服务`}>
                    <span>快递服务</span>
                    {selectedServices.map(service => <button key={service.id} type="button" role="radio" aria-checked={reviewService?.id === service.id} className={reviewService?.id === service.id ? styles.serviceSelected : ''} disabled={confirmationBusy} onClick={() => setServiceOverrides(current => ({ ...current, [order.id]: { serviceId: service.id, revision: order.revision || 1, source: '本票选择' } }))}>{service.name}<small>{service.preference === 'urgent' ? '加急' : '标准'}</small></button>)}
                    {!selectedServices.length && <small>当前连接暂无可用服务</small>}
                  </div>
                  <small>服务仅修改本票；以下连接、付款和月结账号用于本批。</small>
                  <div className={styles.inlineCheckoutGrid}>
                    <label><span>本批连接</span><select aria-label={`工单 ${order.orderNo} 承运商连接`} disabled={confirmationBusy} value={connectionId} onChange={event => changeConnection(event.target.value)}>{!settings.carrierConnections?.length && <option value="">顺丰 · 待配置接口</option>}{(settings.carrierConnections || []).map(connection => <option key={connection.id} value={connection.id}>顺丰 · {connection.environment === 'sandbox' ? '沙盒' : '生产'} · {connection.status === 'connected' ? '已连接' : '待验证'}</option>)}</select></label>
                    <label><span>本批付款</span><select aria-label={`工单 ${order.orderNo} 付款方式`} disabled={confirmationBusy} value={payment} onChange={event => setPayment(event.target.value as ShippingPayment)}><option value="sender_monthly">公司月结</option><option value="sender_cash">寄方现结</option><option value="recipient">收方到付</option></select></label>
                    <label><span>本批月结账号</span><select aria-label={`工单 ${order.orderNo} 月结账号`} disabled={confirmationBusy || payment !== 'sender_monthly'} value={payment === 'sender_monthly' ? billingAccountId : ''} onChange={event => setBillingAccountId(event.target.value)}>{payment !== 'sender_monthly' ? <option value="">无需月结账号</option> : !availableAccounts.length ? <option value="">暂无月结账号</option> : availableAccounts.map(account => <option key={account.id} value={account.id}>{account.displayName} · 尾号 {account.tail}{account.isDefault ? ' · 默认' : ''}</option>)}</select></label>
                    <div className={styles.inlineCheckoutStatus}><span>当前</span><b>{canSubmitCurrent ? '参数可用' : '需补全配置'}</b><small>{order.input.recipient.province}{order.input.recipient.city}{order.input.recipient.county}</small></div>
                  </div>
                </div>}
                {!senderReview.contact && <p className={styles.bad} role="alert">{senderReview.source === '公司寄件资料待补齐' ? <>此工单缺少寄件人、联系电话或揽收地址。请在<a href="/configs?tab=shipping">配置中心</a>补齐后重新核对工单。</> : '工单寄件资料不完整。请退回工单，由提报人补齐实际寄件资料后重新提报。'}</p>}
                <details className={styles.reviewDetails}><summary>收寄地址与寄件人</summary>{senderReview.contact ? <p><b>实际寄件人（{senderReview.source}）</b><br/>{senderReview.contact.name} · {senderReview.contact.phone}<br/>{senderReview.contact.province}{senderReview.contact.city}{senderReview.contact.county}{senderReview.contact.address}</p> : null}<p><b>收件地址</b><br/>{order.input.recipient.province}{order.input.recipient.city}{order.input.recipient.county}{order.input.recipient.address}</p></details>
                <details className={styles.reviewDetails}><summary>身份与备注</summary><p>提报身份：{order.intakeSource === 'anonymous_web' ? order.identityVerified ? '身份已验证' : '匿名自报，待核对' : order.intakeSource === 'owner_web' ? '登录用户提报' : order.intakeSource === 'crm' ? 'CRM 提报' : '企微机器人提报'}{order.input.remark && <><br/>备注：{order.input.remark}</>}</p>{order.input.submittedBy && <p>提报人：{order.input.submittedBy.name} · {order.input.submittedBy.phone} · {order.input.submittedBy.team || '未填写团队'}</p>}</details>
              </section>}
            </>}
            {expandedOrderId === order.id && orderHasDispatch(order) && (
              <section className={styles.deliveryExpansion} aria-label={`工单 ${order.orderNo} 递送信息`}>
                <div className={styles.reviewHeading}><h3>递送信息</h3><span>{statusForDisplay(order)}</span></div>
                <div className={styles.reviewKeyFacts}>
                  <div><small>运单号</small><strong>{order.waybill || '结果待确认'}</strong><span>{order.waybill ? '承运商单据' : '先查回原单'}</span></div>
                  <div><small>收件人</small><strong>{order.input.recipient.name}</strong><span>{cityOf(order)}</span></div>
                  <div><small>最近物流事件</small><strong>{order.trackingUpdatedAt ? new Date(order.trackingUpdatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '暂无记录'}</strong><span>{orderEvents.length ? `${orderEvents.length} 个节点` : orderTrackingNotice}</span></div>
                </div>
                {!isSimulation && !settings.guest && order.intakeSource === 'owner_web' && order.waybill &&
                  <OperatorCarrierChangeHistory key={order.id} orderId={order.id} />}
                {orderEvents.length > 0 ? <ol className={styles.compactTimeline}>{orderEvents.slice(0, 3).map((event, index) => <li key={`${event.time}-${index}`}><time>{event.time}</time><span>{event.description}</span><small>{event.location}</small></li>)}</ol> : <p className={styles.intakeHint}>{order.waybill ? (trackingBusy && trackingTarget === order.waybill ? '正在查询这票运单…' : orderTrackingNotice || '暂无物流轨迹。') : '尚未生成运单，不能展示递送轨迹。'}</p>}
                {order.waybill && <button type="button" className={styles.secondaryButton} disabled={trackingBusy} onClick={() => void refreshTracking(order.waybill || '')}>{trackingBusy ? '刷新中…' : '刷新递送信息'}</button>}
              </section>
            )}
            {order.status === 'returned' && (
              <div className={styles.cardActions} onClick={event => event.stopPropagation()}>
                <button className={styles.secondaryButton} disabled={!!busy} onClick={() => beginAmendment(order)}>修改工单</button>
              </div>
            )}
            {['awaiting_confirmation', 'returned'].includes(order.status) && amendmentDraft?.orderId === order.id && (
              <form
                className={styles.returnForm}
                aria-label={`修改工单 ${order.orderNo}`}
                onClick={event => event.stopPropagation()}
                onSubmit={event => { event.preventDefault(); void amendOrder(order) }}
              >
                <div className={styles.batchFields}>
                  <label>收件人<input aria-label="修改收件人" value={amendmentDraft.recipientName} maxLength={60} required onChange={event => setAmendmentDraft(current => current && { ...current, recipientName: event.target.value, error: '' })}/></label>
                  <label>联系电话<input aria-label="修改收件电话" type="tel" value={amendmentDraft.recipientPhone} maxLength={30} required onChange={event => setAmendmentDraft(current => current && { ...current, recipientPhone: event.target.value, error: '' })}/></label>
                  <label>省份<input aria-label="修改省份" value={amendmentDraft.province} maxLength={30} required onChange={event => setAmendmentDraft(current => current && { ...current, province: event.target.value, error: '' })}/></label>
                  <label>城市<input aria-label="修改城市" value={amendmentDraft.city} maxLength={30} required onChange={event => setAmendmentDraft(current => current && { ...current, city: event.target.value, error: '' })}/></label>
                  <label>区县<input aria-label="修改区县" value={amendmentDraft.county} maxLength={30} required onChange={event => setAmendmentDraft(current => current && { ...current, county: event.target.value, error: '' })}/></label>
                  <label>详细地址<input aria-label="修改详细地址" value={amendmentDraft.address} maxLength={200} required onChange={event => setAmendmentDraft(current => current && { ...current, address: event.target.value, error: '' })}/></label>
                  <label>物品<input aria-label="修改物品" value={amendmentDraft.cargo} maxLength={60} required onChange={event => setAmendmentDraft(current => current && { ...current, cargo: event.target.value, error: '' })}/></label>
                  <label>重量 kg<input aria-label="修改重量" type="number" min="0.01" max="20" step="0.01" value={amendmentDraft.weight} required onChange={event => setAmendmentDraft(current => current && { ...current, weight: event.target.value, error: '' })}/></label>
                </div>
                <label>备注<textarea aria-label="修改备注" value={amendmentDraft.remark} maxLength={100} onChange={event => setAmendmentDraft(current => current && { ...current, remark: event.target.value, error: '' })}/></label>
                <label>修改原因<textarea aria-label="修改原因" value={amendmentDraft.reason} minLength={2} maxLength={300} required onChange={event => setAmendmentDraft(current => current && { ...current, reason: event.target.value, error: '' })}/></label>
                <small>保存后版本加一、保留原提交人和身份快照，并重新进入待核对；不会自动通知顺丰。</small>
                {amendmentDraft.error && <p role="alert">{amendmentDraft.error}</p>}
                <div className={styles.formActions}>
                  <button type="submit" className={styles.primary} disabled={!!busy}>{busy === order.id ? '保存中…' : '保存为新版本'}</button>
                  <button type="button" className={styles.secondaryButton} disabled={!!busy} onClick={() => setAmendmentDraft(null)}>取消</button>
                </div>
              </form>
            )}
          </article>})}
        </div>
        <footer className={styles.stickyFooter}><div><strong>已选 {reviewedOrders.length} 票工单</strong><small>核对后确认才通知顺丰</small></div><button disabled={!reviewedOrders.length || confirmationBusy || batchBusy || !!busy || !canSubmitCurrent || !reviewedSendersReady || !reviewedServicesReady || (productionOrderUnverified && reviewedOrders.length !== 1)} onClick={() => void confirmReviewed()}><Truck size={15}/>{confirmationBusy ? '正式下单中…' : `${isSimulation ? '模拟确认并下单' : '批量确认并下单'}（${reviewedOrders.length}票）`}</button></footer>
      </section>

      <section className={`${styles.column} ${styles.detailColumn}`} aria-label="单据详情与物流轨迹">
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
                  {(selected.status === 'order_unknown' || selected.status === 'ordering') && <button className={styles.secondaryButton} aria-label="查回所选单据下单结果" disabled={batchBusy || confirmationBusy || !!busy} onClick={() => void reconcileOrder(selected.id)}>{busy === selected.id ? '查回中…' : '查回下单结果'}</button>}{selected.status === 'waybill_created' && <button className={styles.cancelButton} disabled={!canCancelSelected || trackingBusy || confirmationBusy || !!busy} onClick={() => void cancelSelected()}>{isSimulation ? '模拟取消运单' : '取消运单'}</button>}
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
                <div><small>提报人</small><b>{selected.input.submittedBy?.name || selected.relation.salesRef || '待分配'}</b></div>
                <div><small>所属团队</small><b>{selected.input.submittedBy?.team || '—'}</b></div>
                <div><small>提交时间</small><b>{new Date(selected.createdAt).toLocaleString('zh-CN')}</b></div>
              </div>
              <div className={styles.route}>
                <div><span>寄</span><p><b>{selected.input.sender.name}</b><small>{selected.input.sender.phone}<br/>{selected.input.sender.province}{selected.input.sender.city}{selected.input.sender.county}{selected.input.sender.address}</small></p></div>
                <div><span>收</span><p><b>{selected.input.recipient.name}</b><small>{selected.input.recipient.phone}<br/>{selected.input.recipient.province}{selected.input.recipient.city}{selected.input.recipient.county}{selected.input.recipient.address}</small></p></div>
              </div>
              <div className={styles.goods}>
                <span><Box size={14}/>{selected.input.cargo} · {selected.input.weight}kg · {actualServiceLabel(selected)}</span>
                {selected.input.specialRequirements && <p><AlertTriangle size={13}/>{selected.input.specialRequirements}</p>}
              </div>
            </section>
            <section className={styles.trackingPane}>
              <div className={styles.trackTop}>
                <div>
                  <small>台账物流状态</small>
                  <h3><span/> {selected.status === 'cancelled' ? '已取消' : selected.status === 'delivered' ? '已签收' : selected.status === 'in_transit' ? statusForDisplay(selected) : selected.status === 'order_unknown' || selected.status === 'ordering' ? '下单结果待确认' : selected.waybill ? '等待揽收' : '尚未出单'}</h3>
                  <p className={styles.courier}>{selectedTracking?.courier ? [selectedTracking.courier.name, selectedTracking.courier.employeeId, selectedTracking.courier.phone].filter(Boolean).join(' · ') : '当前轨迹未提供快递员姓名、工号或电话'}</p>
                </div>
                <button disabled={!selected.waybill || trackingBusy} onClick={() => void refreshTracking(selected.waybill || '')}><RefreshCw size={14}/>刷新</button>
              </div>
              {trackingEvents.length > 0 ? (
                <ol className={styles.timeline}>{trackingEvents.map((event, index) => <li key={`${event.time}-${index}`}><i/><time>{event.time}</time><p>{event.description}</p><small>{event.location}</small></li>)}</ol>
              ) : (
                <div className={styles.noTracking}><PackageCheck size={32}/><strong>{trackingNotice(selected) || '暂无物流轨迹'}</strong><p>输入运单号查询，其他人的运单可能需要手机号后四位。</p></div>
              )}
            </section>
          </div>
        ) : (
          <div className={trackingTarget || tracking ? styles.externalTracking : `${styles.noTracking} ${styles.emptyTracking}`}>
            {!trackingTarget && !tracking && <PackageCheck size={32}/>}
            <strong>{trackingTarget || tracking ? `顺丰运单 ${trackingTarget || tracking?.waybill}` : '暂无收寄记录'}</strong>
            <p>{trackingBusy ? '正在查询这票运单…' : trackingError ? '请按上方提示处理后重新查询。此运单未关联当前台账工单。' : tracking ? `物流轨迹查询结果 · 更新于 ${new Date(tracking.queriedAt).toLocaleString('zh-CN')}` : '可直接输入顺丰运单号查询；本人或业务提报的真实单据也会显示在这里。'}</p>
            {tracking && (trackingEvents.length ? <ol className={styles.timeline}>{trackingEvents.map((event, index) => <li key={`${event.time}-${index}`}><i/><time>{event.time}</time><p>{event.description}</p><small>{event.location}</small></li>)}</ol> : <p>暂无物流轨迹，运单可能尚未揽收。</p>)}
          </div>
        )}
      </section>
    </div>
  </main>
}

import { createHmac, timingSafeEqual } from 'node:crypto'
import { ShippingError } from './config'
import { getHistoricalCarrierAdapter } from './carrier-adapter'
import { getOrganizationShipmentProviderSnapshot, listEmployeeShipmentReceipts } from './collaboration'
import type { WecomBotRow } from './wecom-bot-settings'
import type { WecomProfile } from './wecom-session'
import type { ShipmentOrderStatus } from './types'

const timestampWindowSeconds = 5 * 60
const orderNumberPattern = /SO-\d{8}-[A-F0-9]{8}/i
const waybillPattern = /(?:SF)?\d{10,20}/i

const statusLabels: Record<ShipmentOrderStatus, string> = {
  accepted: '已受理',
  awaiting_confirmation: '待操作员审核',
  returned: '已退回',
  confirmed: '已确认待下单',
  ordering: '下单处理中',
  order_unknown: '下单结果待确认',
  waybill_created: '已出号，待揽收',
  in_transit: '运输中',
  delivered: '已签收',
  cancelled: '已取消',
  order_failed: '下单失败',
}

export function signWecomBotRuntimeRequest(secret: string, timestamp: string, body: string) {
  if (!secret || !timestamp || !body) throw new ShippingError(401, '机器人运行请求无效。')
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('base64url')
}

export function verifyWecomBotRuntimeRequest(input: {
  secret: string
  timestamp: string | null
  signature: string | null
  body: string
  now?: number
}) {
  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000)
  const timestamp = Number(input.timestamp)
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > timestampWindowSeconds) {
    throw new ShippingError(401, '机器人运行请求已过期。')
  }
  if (!input.signature || !/^[A-Za-z0-9_-]{40,60}$/.test(input.signature)) {
    throw new ShippingError(401, '机器人运行请求签名无效。')
  }
  const expected = Buffer.from(signWecomBotRuntimeRequest(input.secret, String(timestamp), input.body))
  const actual = Buffer.from(input.signature)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new ShippingError(401, '机器人运行请求签名无效。')
  }
}

function formatOrder(order: Awaited<ReturnType<typeof listEmployeeShipmentReceipts>>[number]) {
  const waybill = order.waybill ? `\n运单号：${order.waybill}` : ''
  return `工单号：${order.orderNo}\n状态：${statusLabels[order.status] || order.status}${waybill}`
}

function normalizeCommand(text: string) {
  return text.trim().replace(/^@\S+\s+/, '')
}

async function ownReceipts(bot: WecomBotRow, employee: WecomProfile) {
  const receipts = await listEmployeeShipmentReceipts(bot.org_id, employee.id)
  if (!receipts.length) throw new ShippingError(404, '还没有查到您的寄件工单。')
  return receipts
}

async function queryTracking(bot: WecomBotRow, waybill: string) {
  const snapshot = await getOrganizationShipmentProviderSnapshot(bot.org_id, waybill)
  if (!snapshot) throw new ShippingError(403, '该运单不属于当前组织或平台没有它的寄件记录。')
  if (!snapshot.carrier_connection_id) throw new ShippingError(409, '该运单没有可用的承运商查询配置，请联系管理员。')
  const carrier = await getHistoricalCarrierAdapter(snapshot.provider_key).connect({
    orgId: bot.org_id,
    connectionId: snapshot.carrier_connection_id,
    billingAccountId: snapshot.billing_account_id || undefined,
    expectedEnvironment: snapshot.connection_environment || undefined,
    allowHistorical: true,
    requireOrderCapability: false,
  })
  const result = await carrier.track(waybill)
  const events = result.events.slice(0, 5)
  if (!events.length) return `运单号：${waybill}\n暂未查询到物流轨迹，请稍后再试。`
  return [
    `运单号：${waybill}`,
    `当前轨迹：${result.events[0]?.status ? statusLabels[result.events[0].status as ShipmentOrderStatus] || result.events[0].status : '已查询'}`,
    ...events.map(event => `${event.time || '时间待更新'} ${event.location || ''} ${event.description || ''}`.trim()),
  ].join('\n')
}

export async function handleWecomBotQuery(text: string, bot: WecomBotRow, employee: WecomProfile): Promise<string | null> {
  const command = normalizeCommand(text)
  const orderNo = command.match(orderNumberPattern)?.[0]?.toUpperCase()
  const asksTracking = /轨迹|物流|运单|到哪/.test(command)
  const waybill = asksTracking ? command.match(waybillPattern)?.[0]?.toUpperCase() : undefined
  const asksRecent = /^(?:(?:查询|查看)(?:我的)?(?:最近的?)?|我的(?:最近的?)?|最近的?)?(?:工单|订单|寄件)(?:记录|列表)?$/.test(command.replace(/[：:\s]/g, ''))

  if (!orderNo && !waybill && !asksRecent) return null
  const receipts = await ownReceipts(bot, employee)
  if (asksRecent) {
    return ['您最近的寄件工单：', ...receipts.slice(0, 5).map((order, index) => `${index + 1}. ${formatOrder(order)}`)].join('\n')
  }
  if (orderNo) {
    const order = receipts.find(item => item.orderNo.toUpperCase() === orderNo)
    if (!order) throw new ShippingError(403, '没有查到您名下的这个工单，请核对工单号。')
    return formatOrder(order)
  }
  const order = receipts.find(item => item.waybill?.toUpperCase() === waybill)
  if (!order) throw new ShippingError(403, '没有查到您名下的这个运单，请核对运单号。')
  return queryTracking(bot, waybill!)
}

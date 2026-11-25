// Explicit demo adapter: browser memory only. No fetch, provider call or persistence.
import type { Contact, ShipmentOrder, ShipmentOrderStatus, ShippingInput, ShippingSettings, TrackingResult } from './types'
import type { ShippingWorkbenchRequest } from './workbench-client'
import { orderSelectionSchema, shipmentLedgerQuerySchema } from './validation'

export const shippingExampleText = [
  '演示张三 13800000001 广东省深圳市南山区示例路88号A座',
  '演示李四 13900000002 上海市浦东新区示例路66号B座',
  '姓名：演示王五 电话：13600000003 地址：北京市朝阳区示例街18号',
  '演示赵六 1380000000 浙江省杭州市余杭区示例街9号',
].join('\n')

const sender: Contact = { name: '示例公司前台', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '演示园区示例楼1号' }
const services = [
  { id: 2, name: '示例标准寄件', preference: 'standard' as const },
  { id: 1, name: '示例特快寄件', preference: 'urgent' as const },
]
export const shippingSimulationSettings: ShippingSettings = {
  intakeRules: { companyName: { enabled: false, required: false, minLength: 0 }, team: { enabled: false, required: false, minLength: 0 }, teamOptions: [] },
  environment: 'sandbox', ready: true, canSubmit: true, reason: '', monthlyTail: '0000', sender,
  services, connectionId: 'demo-connection', defaultBillingAccountId: 'demo-account',
  carrierConnections: [{ id: 'demo-connection', carrier: 'sf', environment: 'sandbox', status: 'connected', orderCapability: 'verified', services }],
  billingAccounts: [{ id: 'demo-account', connectionId: 'demo-connection', environment: 'sandbox', displayName: '示例月结账号', tail: '0000', isDefault: true, status: 'active' }],
}

function seedOrders(now: number): ShipmentOrder[] {
  const examples: Array<[ShipmentOrderStatus, Contact, string]> = [
    ['in_transit', { name: '演示李四', phone: '13900000002', province: '上海市', city: '上海市', county: '浦东新区', address: '示例路66号B座' }, '演示客户·上海'],
    ['awaiting_confirmation', { name: '演示王五', phone: '13600000003', province: '北京市', city: '北京市', county: '朝阳区', address: '示例街18号' }, '演示客户·北京'],
    ['waybill_created', { name: '演示张三', phone: '13800000001', province: '广东省', city: '深圳市', county: '南山区', address: '示例路88号A座' }, '演示客户·深圳'],
    ['delivered', { name: '演示赵六', phone: '13700000004', province: '浙江省', city: '杭州市', county: '余杭区', address: '示例街9号' }, '演示客户·杭州'],
  ]
  return examples.map(([status, recipient, customerName], index) => ({
    id: `demo-order-${index + 1}`, orderNo: `DEMO-REQ-${index + 1}`, status,
    intakeSource: 'anonymous_web', confirmationPolicy: 'scheduled_review',
    relation: { salesRef: '示例销售', customerRef: customerName, assignmentStatus: 'assigned' },
    input: { sender: index === 1 ? { ...sender, name: '示例销售', phone: '13800000009', address: '销售寄件处示例楼9号' } : sender, recipient, customerName, cargo: index % 2 ? '样品' : '文件/合同', weight: 1, serviceId: 2, serviceName: services[0].name, remark: '', source: 'manual', payment: 'sender_monthly', specialRequirements: index === 1 ? '示例需求：文件请用防水袋包装，上门前联系前台。' : '' },
    waybill: status === 'awaiting_confirmation' ? null : `DEMO-${String(index + 1).padStart(6, '0')}`,
    nextReviewAt: null, createdAt: new Date(now - index * 86400000).toISOString(), direction: index === 3 ? 'inbound' : 'outbound',
  }))
}

export function createShippingSimulation(now = Date.now()): ShippingWorkbenchRequest {
  let sequence = 4
  const records = seedOrders(now)
  const createdByKey = new Map<string, string>()

  function tracking(waybill: string): TrackingResult {
    const order = records.find(item => item.waybill === waybill)
    if (!waybill.startsWith('DEMO-') || !order) throw new Error('模拟体验仅支持查询本页 DEMO- 示例单号。')
    const descriptions = order.status === 'cancelled' ? ['模拟：取消已确认']
      : order.status === 'delivered' ? ['模拟：收件人已签收', '模拟：快件正在派送', '模拟：快件运输中', '模拟：已揽收']
      : order.status === 'in_transit' ? ['模拟：快件运输中', '模拟：已到达中转场', '模拟：已揽收']
      : ['模拟：已生成示例运单，等待揽收']
    return { waybill, queriedAt: new Date().toISOString(), source: 'simulation', shipmentStatus: order.status, events: descriptions.map((description, index) => ({ time: new Date(now - index * 3600000).toISOString(), location: index ? sender.city : order.input.recipient.city, description })) }
  }

  function dispatch(url: string, init?: RequestInit): unknown {
    const method = init?.method || 'GET'
    if (method === 'GET' && url.startsWith('/api/shipping/ledger?')) {
      const query = shipmentLedgerQuerySchema.parse(Object.fromEntries(new URLSearchParams(url.split('?')[1])))
      const from = query.submittedFrom ? Date.parse(query.submittedFrom) : -Infinity
      const before = query.submittedBefore ? Date.parse(query.submittedBefore) : Infinity
      const matching = records.filter(order => {
        const submitted = Date.parse(order.createdAt)
        return submitted >= from && submitted < before
      }).sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
      const page = query.page ?? 0
      const start = page * query.limit
      return {
        records: matching.slice(start, start + query.limit),
        nextPage: matching.length > start + query.limit && page < 1000 ? page + 1 : null,
      }
    }
    if (method !== 'POST') throw new Error('模拟体验不支持此操作。')
    const body = JSON.parse(String(init?.body || '{}')) as { key?: string; input?: ShippingInput; waybill?: string; reason?: string; payment?: unknown; serviceId?: unknown }
    if (url === '/api/shipping/owner/orders') {
      if (!body.key || !body.input?.recipient?.name) throw new Error('请先完成示例收件资料。')
      const previous = createdByKey.get(body.key)
      if (previous) {
        const existing = records.find(order => order.id === previous)
        if (!existing) throw new Error('未找到原示例单据。')
        return { orderId: existing.id, orderNo: existing.orderNo, status: existing.status, waybill: existing.waybill }
      }
      sequence += 1
      const orderId = `demo-order-${sequence}`
      records.unshift({ id: orderId, orderNo: `DEMO-REQ-${sequence}`, status: 'awaiting_confirmation', intakeSource: 'owner_web', confirmationPolicy: 'scheduled_review', input: { ...body.input, sender: body.input.sender || shippingSimulationSettings.sender }, relation: { salesRef: '示例销售', customerRef: null, assignmentStatus: 'assigned' }, waybill: null, nextReviewAt: null, createdAt: new Date().toISOString(), direction: 'outbound' })
      createdByKey.set(body.key, orderId)
      return { orderId, orderNo: `DEMO-REQ-${sequence}`, status: 'awaiting_confirmation', waybill: null }
    }
    if (url === '/api/shipping/tracking') return tracking(body.waybill || '')
    const action = url.match(/^\/api\/shipping\/ledger\/(demo-order-\d+)\/(confirm|return|cancel|reconcile)$/)
    const order = action && records.find(item => item.id === action[1])
    if (!action || !order) throw new Error('未找到可操作的示例单据。')
    if (action[2] === 'reconcile') return { orderId: order.id, orderNo: order.orderNo, status: order.status, waybill: order.waybill }
    if (action[2] === 'cancel') {
      if (order.status !== 'waybill_created') throw new Error('示例订单已揽收，不能取消。')
      order.status = 'cancelled'
    } else {
      if (order.status !== 'awaiting_confirmation') throw new Error('示例单据已处理，请刷新后查看。')
      if (action[2] === 'return') {
        if (!body.reason?.trim()) throw new Error('请填写退回工单原因。')
        order.status = 'returned'
      } else {
        const payment = orderSelectionSchema.shape.payment.parse(body.payment)
        const serviceId = orderSelectionSchema.shape.serviceId.parse(body.serviceId) ?? order.input.serviceId
        const service = serviceId !== undefined
          ? shippingSimulationSettings.services.find(item => item.id === serviceId)
          : shippingSimulationSettings.services.find(item => (item.preference || 'standard') === (order.input.servicePreference || 'standard'))
        if (!service) throw new Error('请选择已配置的示例服务产品。')
        order.input = { ...order.input, payment: payment || order.input.payment || 'sender_monthly', serviceId: service.id, serviceName: service.name }
        order.status = 'waybill_created'
        order.waybill = `DEMO-${String(++sequence).padStart(6, '0')}`
      }
    }
    return { orderId: order.id, orderNo: order.orderNo, status: order.status, waybill: order.waybill }
  }

  return async <T>(url: string, init?: RequestInit) => structuredClone(dispatch(url, init)) as T
}

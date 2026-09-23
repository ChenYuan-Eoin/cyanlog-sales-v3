import type { ShipmentOrder, TrackingResult } from './types'
import type { BatchDraftRow } from './import-parser'

const sender = { name: 'ONES 深圳前台', phone: '0755-86521234', province: '广东省', city: '深圳市', county: '南山区', address: '科技园科苑路15号' }

export const mockShipmentOrders: ShipmentOrder[] = [
  ['mock-1', 'REQ-20260923-001', 'awaiting_confirmation', '华东建筑设计院', '张三', '13800138001', '上海市', '浦东新区', '张江路88号', '销售-李娜', '合同正本，请使用文件袋并在17点后上门。', null],
  ['mock-2', 'SF-20260923-002', 'waybill_created', '远景能源', '王敏', '13900139002', '北京市', '朝阳区', '望京东路6号', '销售-陈宇', '', 'SF7444706754522'],
  ['mock-3', 'SF-20260922-018', 'in_transit', '星河科技', '周航', '13700137003', '杭州市', '余杭区', '文一西路969号', '销售-张三', '样品易碎，请轻拿轻放。', 'SF1234567890123'],
  ['mock-4', 'SF-20260921-011', 'delivered', '金蝶软件', '赵倩', '13600136004', '深圳市', '南山区', '高新南十二路2号', '销售-李娜', '', 'SF9876543210123'],
  ['mock-5', 'REQ-20260923-006', 'awaiting_confirmation', '瑞丰医药', '刘凯', '13500135005', '广州市', '天河区', '珠江新城华夏路8号', '销售-孙琪', '冷链资料随货，请外包装注明项目名称。', null],
  ['mock-6', 'SF-20260920-004', 'order_failed', '华南理工大学', '杨老师', '13300133006', '广州市', '番禺区', '大学城外环东路382号', '销售-陈宇', '', null],
  ['mock-7', 'SF-20260919-021', 'returned', '北辰咨询', '何琳', '13200132007', '成都市', '武侯区', '天府大道北段1480号', '销售-张三', '收件人周五不在，请下周一寄出。', null],
].map(([id, orderNo, status, customerName, name, phone, city, county, address, salesRef, specialRequirements, waybill], index) => ({
  id: String(id), orderNo: String(orderNo), intakeSource: 'anonymous_web' as const, confirmationPolicy: 'scheduled_review' as const,
  status: status as ShipmentOrder['status'], relation: { salesRef: String(salesRef), customerRef: String(customerName), assignmentStatus: 'assigned' as const },
  input: { sender, recipient: { name: String(name), phone: String(phone), province: city === '上海市' || city === '北京市' ? String(city) : city === '杭州市' ? '浙江省' : city === '成都市' ? '四川省' : '广东省', city: String(city), county: String(county), address: String(address) }, cargo: index % 2 ? '样品' : '文件/合同', weight: index % 2 ? 2 : 1, serviceId: index % 3 === 0 ? 1 : 2, remark: '', source: 'manual' as const, payment: 'sender_monthly' as const, customerName: String(customerName), submittedBy: { name: String(salesRef).replace('销售-', ''), phone: `1380000000${index}`, team: index % 2 ? '华南销售部' : '大客户部' }, specialRequirements: String(specialRequirements) },
  waybill: waybill ? String(waybill) : null, nextReviewAt: status === 'awaiting_confirmation' ? '2026-09-23T09:00:00.000Z' : null, createdAt: new Date(Date.UTC(2026, 8, 23 - index, 1 + index, 20)).toISOString(), direction: index === 3 ? 'inbound' as const : 'outbound' as const,
}))

export const mockTracking: TrackingResult = {
  waybill: 'SF1234567890123', queriedAt: '2026-09-23T03:30:00.000Z', events: [
    { time: '2026-09-23 10:18:00', location: '杭州市余杭区', description: '正在派送中，请保持电话畅通' },
    { time: '2026-09-23 07:42:00', location: '杭州余杭中转场', description: '快件已到达杭州余杭中转场' },
    { time: '2026-09-22 22:16:00', location: '深圳总集散中心', description: '快件已发往杭州余杭中转场' },
    { time: '2026-09-22 18:35:00', location: '深圳市南山区', description: '顺丰速运已收取快件' },
    { time: '2026-09-22 17:58:00', location: '深圳市南山区', description: '电子运单已创建，等待揽收' },
  ],
}

export const mockBatchRows: BatchDraftRow[] = [
  { id: 1, key: '10000000-0000-4000-8000-000000000001', recipient: '林晓雨', phone: '13800138011', address: '广东省深圳市南山区粤海街道科苑路8号', cargo: '合同' },
  { id: 2, key: '10000000-0000-4000-8000-000000000002', recipient: '高文博', phone: '13900139012', address: '上海市浦东新区张江镇祖冲之路887号', cargo: '样品' },
  { id: 3, key: '10000000-0000-4000-8000-000000000003', recipient: '董洁', phone: '1360013601', address: '北京市朝阳区望京街道阜通东大街6号', cargo: '发票' },
  { id: 4, key: '10000000-0000-4000-8000-000000000004', recipient: '沈嘉宁', phone: '13500135014', address: '浙江省杭州市余杭区仓前街道文一西路969号', cargo: '合同' },
  { id: 5, key: '10000000-0000-4000-8000-000000000005', recipient: '余海峰', phone: '13700137015', address: '四川省成都市武侯区天府大道北段1480号', cargo: '礼品' },
]

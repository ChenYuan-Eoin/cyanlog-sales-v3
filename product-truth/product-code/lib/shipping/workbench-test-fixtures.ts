import type { ShipmentOrder } from './types'

const sender = { name: 'ONES 深圳前台', phone: '0755-86521234', province: '广东省', city: '深圳市', county: '南山区', address: '科技园科苑路15号' }

export const workbenchOrdersForTest: ShipmentOrder[] = [
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

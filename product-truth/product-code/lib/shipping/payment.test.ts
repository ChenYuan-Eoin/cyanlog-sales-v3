import { describe, expect, it } from 'vitest'
import { buildSfOrder } from './sf-client'
import { shippingConfig } from './config'
import type { ShippingInput } from './types'
const contact = { name: '测试', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '测试路100号' }
const input: ShippingInput = { sender: contact, recipient: contact, cargo: '文件', weight: 1, serviceId: 2, remark: '', source: 'manual' }
describe('per-shipment payment choice', () => {
  it.each(['sender_cash', 'recipient'] as const)('does not send company monthly credentials for %s', payment => {
    const order = buildSfOrder('test', { ...input, payment }, 'company-card')
    expect(order).not.toHaveProperty('monthlyCard')
    expect(order.payMethod).toBe(payment === 'recipient' ? 2 : 1)
  })
  it('requires a monthly card only for monthly payment', () => {
    expect(() => buildSfOrder('test', { ...input, payment: 'sender_monthly' }, '')).toThrow('月结付款尚未配置')
    expect(buildSfOrder('test', { ...input, payment: 'sender_monthly' }, 'company-card').monthlyCard).toBe('company-card')
  })
  it('keeps existing uncertain legacy monthly requests unchanged', () => {
    expect(buildSfOrder('test', input, 'legacy-card')).toMatchObject({ payMethod: 1, monthlyCard: 'legacy-card' })
  })
  it('does not make a monthly binding a requirement for query connectivity', () => {
    expect(shippingConfig({ SF_ENVIRONMENT: 'production', SF_PARTNER_ID: 'test', SF_CHECK_WORD: 'secret', SF_SERVICES_JSON: '[{"id":2,"name":"顺丰标快"}]' }).publicSettings).toMatchObject({ ready: true, canSubmit: false })
  })
})

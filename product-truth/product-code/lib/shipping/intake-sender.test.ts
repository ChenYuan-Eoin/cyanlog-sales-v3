// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { anonymousShipmentSchema } from './validation'
const sender = { name: '示例销售', phone: '13800000001', province: '广东省', city: '深圳市', county: '南山区', address: '示例寄件路8号' }
const input = { sender, recipient: { ...sender, name: '示例收件人', phone: '13900000002', address: '示例收件路9号' }, cargo: '文件', weight: 1, servicePreference: 'standard', remark: '', source: 'manual', customerName: '示例客户', submittedBy: { name: sender.name, phone: sender.phone, team: '示例团队' } }
const request = { key: '43a0b4bb-cf88-4593-9fc9-85b3a9d0d1b0', input }

describe('anonymous sales sender business snapshot', () => {
  it('requires the actual sender and keeps both sides of the work order', () => {
    const valid = anonymousShipmentSchema.parse(request)
    expect(valid.input.sender).toEqual(sender)
    expect(valid.input.recipient.name).toBe('示例收件人')
    const missing = anonymousShipmentSchema.safeParse({ ...request, input: { ...input, sender: undefined } })
    expect(missing.success).toBe(false)
    if (!missing.success) expect(missing.error.issues.some(issue => issue.path.join('.') === 'input.sender')).toBe(true)
  })
  it.each(['name', 'phone'] as const)('rejects a sender %s different from the submitted personal profile', field => {
    const result = anonymousShipmentSchema.safeParse({ ...request, input: { ...input, sender: { ...sender, [field]: field === 'name' ? '另一示例人员' : '13900000002' } } })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.some(issue => issue.path.join('.') === `input.sender.${field}`)).toBe(true)
  })
  it('accepts a requested service code but never a client-selected organization or service label', () => {
    expect(anonymousShipmentSchema.safeParse({ ...request, orgId: 'other-organization' }).success).toBe(false)
    expect(anonymousShipmentSchema.safeParse({ ...request, input: { ...input, serviceId: 2 } }).success).toBe(true)
    expect(anonymousShipmentSchema.safeParse({ ...request, input: { ...input, serviceName: 'forged' } }).success).toBe(false)
  })
})

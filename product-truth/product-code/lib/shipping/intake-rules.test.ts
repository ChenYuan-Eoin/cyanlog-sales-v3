import { describe, it, expect } from 'vitest'
import { DEFAULT_INTAKE_RULES, intakeFieldSchema, intakeRulesSchema, effectiveShippingDepartmentIds, toggleShippingDepartmentSubtree } from './intake-rules'
import { makeAnonymousShipmentSchema } from './validation'
const contact = { name: '测试甲', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '示例路88号' }
const request = { key: '11111111-1111-4111-8111-111111111111', input: { sender: contact, recipient: contact, cargo: '合同', weight: 1, source: 'manual', remark: '', submittedBy: { name: contact.name, phone: contact.phone, team: '' }, customerName: '' } }
describe('configurable intake fields', () => {
  it('keeps required four-character company and required team defaults', () => { expect(makeAnonymousShipmentSchema().safeParse(request).success).toBe(false) })
  it('allows optional or hidden fields on the actual intake schema', () => {
    const rules = { ...DEFAULT_INTAKE_RULES, companyName: { enabled: false, required: false, minLength: 4 }, team: { enabled: true, required: false, minLength: 1 } }
    expect(makeAnonymousShipmentSchema(rules).parse(request).input.customerName).toBe('')
  })
  it('applies minimum length to populated optional company fields', () => { expect(intakeFieldSchema({ enabled: true, required: false, minLength: 4 }, '公司名称', 120).safeParse('甲乙丙').success).toBe(false) })
  it('rejects forged team names when the organization has a configured list', () => {
    expect(intakeFieldSchema(DEFAULT_INTAKE_RULES.team, '所属团队', 80, ['华南组']).safeParse('其他组').success).toBe(false)
    expect(intakeFieldSchema(DEFAULT_INTAKE_RULES.team, '所属团队', 80, ['华南组']).parse(' 华南组 ')).toBe('华南组')
  })
  it('rejects impossible hidden-required configuration', () => { expect(intakeRulesSchema.safeParse({ ...DEFAULT_INTAKE_RULES, companyName: { enabled: false, required: true, minLength: 4 } }).success).toBe(false) })
})

const departmentTree = [
  { id: 'root', parentId: null }, { id: 'sales', parentId: 'root' },
  { id: 'north', parentId: 'sales' }, { id: 'south', parentId: 'sales' },
  { id: 'finance', parentId: 'root' }, { id: 'other', parentId: null },
]
describe('department subtree selection', () => {
  it('selects the whole subtree while storing only its root', () => {
    const roots = toggleShippingDepartmentSubtree(departmentTree, ['other'], 'sales', true)
    expect(roots).toEqual(['sales', 'other'])
    expect([...effectiveShippingDepartmentIds(departmentTree, roots)]).toEqual(['sales', 'north', 'south', 'other'])
  })
  it('removes inherited coverage when a child is unchecked without dropping siblings', () => {
    const roots = toggleShippingDepartmentSubtree(departmentTree, ['root', 'other'], 'north', false)
    expect(new Set(effectiveShippingDepartmentIds(departmentTree, roots))).toEqual(new Set(['south', 'finance', 'other']))
    expect(roots).not.toContain('root')
    expect(roots).not.toContain('sales')
  })
})

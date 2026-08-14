// REQ: F027-F036
// PURPOSE: 配置对象 zod 校验测试
import { describe, expect, it } from 'vitest'
import { fieldDictionarySchema, priceMatrixRowSchema, productCatalogAttributesSchema, businessParamSchema, productVersionSchema, approvalRuleSchema } from './validation'

describe('字段字典（F029）', () => {
  it('接受合法对外字段', () => {
    const r = fieldDictionarySchema.safeParse({
      field_key: 'grand_total',
      business_name: '含税总价',
      source: 'computed',
      transform_rule: 'formula',
      output_classification: 'financial',
      is_external: true,
      data_type: 'number',
    })
    expect(r.success).toBe(true)
  })

  it('拒绝：内部字段被标记对外输出', () => {
    const r = fieldDictionarySchema.safeParse({
      field_key: 'internal_cost',
      business_name: '内部成本',
      source: 'config',
      transform_rule: 'direct',
      output_classification: 'financial',
      is_external: true,
    })
    expect(r.success).toBe(false)
  })

  it('接受：隐藏字段 output_classification=internal 且 is_external=false', () => {
    const r = fieldDictionarySchema.safeParse({
      field_key: 'margin_rate',
      business_name: '毛利率',
      source: 'computed',
      transform_rule: 'formula',
      output_classification: 'internal',
      is_external: false,
    })
    expect(r.success).toBe(true)
  })
})

describe('产品目录属性（F027）', () => {
  it('跟随类必须声明跟随对象', () => {
    const r = productCatalogAttributesSchema.safeParse({
      category: 'FOLLOW_PRODUCT',
      standalone: false,
      follows: [],
    })
    expect(r.success).toBe(false)
  })

  it('接受合法基座', () => {
    const r = productCatalogAttributesSchema.safeParse({
      category: 'BASE',
      standalone: true,
      follows: [],
      version_codes: ['STD_V6', 'PRO_V6', 'ENT_V6'],
    })
    expect(r.success).toBe(true)
  })
})

describe('多维价盘（F028）', () => {
  it('接受合法档位', () => {
    const r = priceMatrixRowSchema.safeParse({
      product_id: '00000000-0000-4000-8000-000000000001',
      version_code: 'ENT_V6',
      deployment: 'PUBLIC_CLOUD',
      auth_mode: 'SUB_YEAR',
      term_months: 12,
      qty_from: 1,
      qty_to: 10,
      unit_price: 1500,
      list_price: 15000,
    })
    expect(r.success).toBe(true)
  })

  it('拒绝 qty_to <= qty_from', () => {
    const r = priceMatrixRowSchema.safeParse({
      product_id: '00000000-0000-4000-8000-000000000001',
      version_code: 'ENT_V6',
      deployment: 'PUBLIC_CLOUD',
      auth_mode: 'SUB_YEAR',
      qty_from: 10,
      qty_to: 10,
      unit_price: 1500,
      list_price: 15000,
    })
    expect(r.success).toBe(false)
  })
})

describe('版本能力矩阵（F027）', () => {
  it('企业版支持高可用/信创/买断', () => {
    const r = productVersionSchema.safeParse({
      version_code: 'ENT_V6',
      name: '企业版 V6',
      deployments: ['PUBLIC_CLOUD', 'PRIVATE', 'HA'],
      auth_modes: ['SUB_YEAR', 'SUB_3YEAR', 'ONETIME'],
      capabilities: { ha: true, xinchuang: true, onetime: true },
    })
    expect(r.success).toBe(true)
  })
})

describe('业务参数（F032）', () => {
  it('参数 key 必须大写字母+下划线', () => {
    expect(businessParamSchema.safeParse({ param_key: 'PRIVATE_MIN_SUB', name: '私有部署订阅起售', value: 50000, category: 'pricing' }).success).toBe(true)
    expect(businessParamSchema.safeParse({ param_key: 'private_min', name: 'x', value: 1, category: 'pricing' }).success).toBe(false)
  })
})


describe('审批规则（F033）', () => {
  it('条件为比较器组合，链必须存在', () => {
    const r = approvalRuleSchema.safeParse({
      code: 'R1',
      scene: 'QUOTE_DISCOUNT',
      condition: { discount: { gte: 50, lt: 100 } },
      chain_id: '00000000-0000-4000-8000-000000000002',
      priority: 10,
    })
    expect(r.success).toBe(true)
  })
})

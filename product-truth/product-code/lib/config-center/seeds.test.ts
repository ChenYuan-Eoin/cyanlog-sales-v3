// REQ: F027-F036
// PURPOSE: 出厂种子数据必须通过对应 zod 校验；隐藏字段永不对外
import { describe, expect, it } from 'vitest'
import { ALL_SEEDS } from './seeds'
import {
  productVersionSchema,
  businessParamSchema,
  fieldDictionarySchema,
  numberingRuleSchema,
  approvalChainSchema,
  approvalRuleSchema,
  clauseMappingSchema,
  outputTemplateSchema,
} from './validation'

const SCHEMAS: Record<keyof typeof ALL_SEEDS, unknown> = {
  'product-versions': productVersionSchema,
  'business-params': businessParamSchema,
  'field-dictionary': fieldDictionarySchema,
  'numbering-rules': numberingRuleSchema,
  'approval-chains': approvalChainSchema,
  'approval-rules': approvalRuleSchema,
  'clause-mappings': clauseMappingSchema,
  'output-templates': outputTemplateSchema,
}

describe('出厂种子数据', () => {
  for (const [domain, rows] of Object.entries(ALL_SEEDS)) {
    it(`${domain} 全部通过校验 (${rows.length} 条)`, () => {
      const schema = SCHEMAS[domain as keyof typeof ALL_SEEDS] as {
        safeParse: (v: unknown) => { success: boolean; error?: { issues: Array<{ message: string }> } }
      }
      for (const row of rows) {
        const r = schema.safeParse(row)
        if (!r.success) {
          throw new Error(`${domain} 种子校验失败: ${JSON.stringify(row)} => ${r.error?.issues.map((i) => i.message).join('; ')}`)
        }
      }
      expect(true).toBe(true)
    })
  }

  it('字段字典种子：隐藏字段（成本/底价/毛利/审批）永不对外', () => {
    const hidden = ALL_SEEDS['field-dictionary'].filter((f) => f.output_classification === 'internal')
    expect(hidden.length).toBeGreaterThanOrEqual(5)
    for (const f of hidden) {
      expect(f.is_external).toBe(false)
    }
    const external = ALL_SEEDS['field-dictionary'].filter((f) => f.is_external)
    expect(external.some((f) => f.output_classification === 'internal')).toBe(false)
  })

  it('业务参数种子：默认值=现行业务值（门槛/维保/赠送/税率/有效期/保护日）', () => {
    const byKey = Object.fromEntries(ALL_SEEDS['business-params'].map((p) => [p.param_key, p]))
    expect(byKey.PRIVATE_MIN_SUB.value).toBe(50000)
    expect(byKey.MAINT_RATE.value).toBe(0.2)
    expect(byKey.GIFT_A_DAYS.value).toBe(5)
    expect(byKey.TAX_SOFTWARE.value).toBe(0.13)
    expect(byKey.QUOTE_VALID_DAYS.value).toBe(15)
    expect(byKey.LEGACY_PROTECT_DATE.value).toBe('2021-02-01')
  })
})

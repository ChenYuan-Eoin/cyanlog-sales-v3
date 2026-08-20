// REQ: F038
// PURPOSE: 多维价盘导入校验测试（含 Project 234 行价盘数学一致性证据）
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { parsePriceTableDump, validatePriceRows, type PriceImportRow } from './price-import'

const DUMP_PATH = resolve(__dirname, './__fixtures__/price-table-dump.txt')

describe('validatePriceRows', () => {
  it('拒绝：累计价与上档累计+边际×档差不符', () => {
    const rows: PriceImportRow[] = [
      { product_code: 'P', version_code: 'ENT_V6', deployment: 'PUBLIC_CLOUD', auth_mode: 'SUB_YEAR', term_months: 12, currency: 'CNY', qty_from: 1, qty_to: 10, unit_price: 1000, list_price: 10000, sort_order: 0 },
      { product_code: 'P', version_code: 'ENT_V6', deployment: 'PUBLIC_CLOUD', auth_mode: 'SUB_YEAR', term_months: 12, currency: 'CNY', qty_from: 11, qty_to: 15, unit_price: 1000, list_price: 99999, sort_order: 1 },
    ]
    const result = validatePriceRows(rows)
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.field === 'list_price')).toBe(true)
  })

  it('接受：累计 = 上档累计 + 边际 × 档差', () => {
    const rows: PriceImportRow[] = [
      { product_code: 'P', version_code: 'ENT_V6', deployment: 'PUBLIC_CLOUD', auth_mode: 'SUB_YEAR', term_months: 12, currency: 'CNY', qty_from: 1, qty_to: 10, unit_price: 1500, list_price: 15000, sort_order: 0 },
      { product_code: 'P', version_code: 'ENT_V6', deployment: 'PUBLIC_CLOUD', auth_mode: 'SUB_YEAR', term_months: 12, currency: 'CNY', qty_from: 11, qty_to: 15, unit_price: 1500, list_price: 22500, sort_order: 1 },
    ]
    const result = validatePriceRows(rows)
    expect(result.ok).toBe(true)
    expect(result.checked).toBe(2)
  })

  it('拒绝：无价档（请联系我们）出现在组中间', () => {
    const rows: PriceImportRow[] = [
      { product_code: 'P', version_code: 'ENT_V6', deployment: 'PUBLIC_CLOUD', auth_mode: 'SUB_YEAR', term_months: 12, currency: 'CNY', qty_from: 1, qty_to: 10, unit_price: 1000, list_price: 10000, sort_order: 0 },
      { product_code: 'P', version_code: 'ENT_V6', deployment: 'PUBLIC_CLOUD', auth_mode: 'SUB_YEAR', term_months: 12, currency: 'CNY', qty_from: 10001, qty_to: null, unit_price: null, list_price: null, sort_order: 1 },
      { product_code: 'P', version_code: 'ENT_V6', deployment: 'PUBLIC_CLOUD', auth_mode: 'SUB_YEAR', term_months: 12, currency: 'CNY', qty_from: 20001, qty_to: null, unit_price: 900, list_price: 9999999, sort_order: 2 },
    ]
    const result = validatePriceRows(rows)
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.message.includes('无价档之后'))).toBe(true)
  })

  it('拒绝：两口径只给一个', () => {
    const rows: PriceImportRow[] = [
      { product_code: 'P', version_code: 'ENT_V6', deployment: 'PUBLIC_CLOUD', auth_mode: 'SUB_YEAR', term_months: 12, currency: 'CNY', qty_from: 1, qty_to: 10, unit_price: 1000, list_price: null, sort_order: 0 },
    ]
    const result = validatePriceRows(rows)
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => i.message.includes('必须同时给出'))).toBe(true)
  })
})

describe('parsePriceTableDump 产品线参数化（WP10 H4/H5）', () => {
  it('不传 productCode → 抛错（不再默认 PROJECT）', () => {
    expect(() => parsePriceTableDump('A1=x | B1=y', '')).toThrow(/productCode/)
    expect(() => parsePriceTableDump('A1=x | B1=y', '   ')).toThrow(/productCode/)
  })

  it('自定义布局：其他产品线用不同版本列', () => {
    const text = [
      'A1=私有部署 | B1=按年订阅版 | C1=10 | D1=1 - 10 | E1=12 | P1=10000 | Q1=1000',
    ].join('\n')
    const rows = parsePriceTableDump(text, 'CUSTOM_PRODUCT', {
      deployMap: { 私有部署: 'PRIVATE' },
      authMap: { 按年订阅版: 'SUB_YEAR' },
      versions: [['CUST_V1', 'P', 'Q']],
    })
    expect(rows.length).toBe(1)
    expect(rows[0].product_code).toBe('CUSTOM_PRODUCT')
    expect(rows[0].version_code).toBe('CUST_V1')
    expect(rows[0].deployment).toBe('PRIVATE')
  })
})

describe('Project 价盘 234 行数学一致性（阶段 0 硬门证据）', () => {
  it.skipIf(!existsSync(DUMP_PATH))('解析 dump 并全量校验累计关系 0 失败', () => {
    const text = readFileSync(DUMP_PATH, 'utf-8')
    const rows = parsePriceTableDump(text, 'PROJECT')
    expect(rows.length).toBeGreaterThan(500)
    const result = validatePriceRows(rows)
    // 打印证据
    console.log(`[EVIDENCE] parsed=${rows.length} rows, checked=${result.checked} cumulative relations, issues=${result.issues.length}`)
    if (result.issues.length > 0) {
      console.log(result.issues.slice(0, 5))
    }
    expect(result.ok).toBe(true)
    expect(result.checked).toBeGreaterThan(500)
  })
})

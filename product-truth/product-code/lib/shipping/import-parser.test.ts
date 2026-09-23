import { describe, expect, it } from 'vitest'
import { batchRowErrors, buildShippingTemplate, parseCsv, parseXlsx } from './import-parser'

describe('shipping batch import', () => {
  it('parses quoted CSV columns by header aliases', () => {
    const rows = parseCsv('收件人,联系电话,收件地址,物品\n张三,13800138000,"广东省深圳市南山区科苑路8号",合同')
    expect(rows[0]).toMatchObject({ recipient: '张三', phone: '13800138000', address: '广东省深圳市南山区科苑路8号', cargo: '合同' })
    expect(batchRowErrors(rows[0])).toEqual([])
  })
  it('creates a standard xlsx template that can be parsed again', async () => {
    const blob = await buildShippingTemplate()
    expect(blob.type).toContain('spreadsheetml')
    expect(await parseXlsx(await blob.arrayBuffer())).toEqual([])
  })
  it('reports row errors without discarding editable data', () => {
    const row = parseCsv('姓名,手机,地址\n董洁,1360013601,科技路1号')[0]
    expect(batchRowErrors(row)).toEqual(['手机号需为11位', '地址需包含省市区及门牌'])
  })
})

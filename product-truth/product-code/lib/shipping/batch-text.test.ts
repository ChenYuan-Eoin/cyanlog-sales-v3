import { describe, expect, it } from 'vitest'
import { parseShippingText, prepareBatchRecipient, SHIPPING_TEXT_MAX_LENGTH } from './batch-text'
import { contactSchema } from './validation'

describe('shipping text intake', () => {
  it.each([
    ['林示例 13800000001 广东省深圳市南山区科苑路8号', '林示例', '13800000001', '广东省深圳市南山区科苑路8号'],
    ['13800000002,唐演示,浙江省杭州市西湖区文三路90号', '唐演示', '13800000002', '浙江省杭州市西湖区文三路90号'],
    ['上海市浦东新区张杨路500号，赵模拟，13800000003', '赵模拟', '13800000003', '上海市浦东新区张杨路500号'],
    ['姓名：吴样例，电话：13800000004，地址：北京市海淀区中关村大街1号', '吴样例', '13800000004', '北京市海淀区中关村大街1号'],
    ['收件人姓名 陈演示 手机号码 13800000005 收件地址 四川省成都市武侯区人民南路18号', '陈演示', '13800000005', '四川省成都市武侯区人民南路18号'],
    ['林示例13800000001广东省深圳市南山区科苑路8号', '林示例', '13800000001', '广东省深圳市南山区科苑路8号'],
    ['收件人：林示例 13800000001 地址：广东省深圳市南山区科苑路8号', '林示例', '13800000001', '广东省深圳市南山区科苑路8号'],
    ['地址：广东省深圳市南山区科苑路8号，姓名：林示例，联系电话：+86 138 0000 0001', '林示例', '13800000001', '广东省深圳市南山区科苑路8号'],
    ['安徽省黄山市屯溪区迎宾路8号 黄山 13800000001', '黄山', '13800000001', '安徽省黄山市屯溪区迎宾路8号'],
  ])('extracts an editable recipient from %s', (text, recipient, phone, address) => {
    const rows = parseShippingText(text, '合同')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 1, recipient, phone, address, cargo: '合同' })
    const prepared = prepareBatchRecipient(rows[0])
    expect(prepared.errors).toEqual([])
    expect(contactSchema.safeParse(prepared.recipient).success).toBe(true)
  })

  it('groups labelled multiline records and recognises repeated labels as a new recipient', () => {
    const rows = parseShippingText('姓名：林示例\n手机：13800000001\n地址：广东省深圳市南山区科苑路8号\n姓名：唐演示\n手机：13800000002\n地址：浙江省杭州市西湖区文三路90号')
    expect(rows).toHaveLength(2)
    expect(rows.map(row => row.recipient)).toEqual(['林示例', '唐演示'])
    expect(rows.every(row => prepareBatchRecipient(row).errors.length === 0)).toBe(true)
  })

  it('leaves omitted administrative regions for correction instead of inventing them', () => {
    const [row] = parseShippingText('林示例 13800000001 深圳市南山区科苑路8号')
    expect(row.address).toBe('深圳市南山区科苑路8号')
    const result = prepareBatchRecipient(row)
    expect(result.recipient.province).toBe('')
    expect(result.errors.join('')).toContain('完整省市区')
  })

  it('retains malformed phone numbers and blocks them before submitting', () => {
    const [row] = parseShippingText('林示例 1380000000 广东省深圳市南山区科苑路8号')
    expect(row.phone).toBe('1380000000')
    expect(row.address).toBe('广东省深圳市南山区科苑路8号')
    expect(prepareBatchRecipient(row).errors).toContain('手机号需为11位')
    const [labelled] = parseShippingText('姓名：林示例 手机：12345 地址：广东省深圳市南山区科苑路8号')
    expect(labelled.phone).toBe('12345')
    expect(labelled.address).toBe('广东省深圳市南山区科苑路8号')
    expect(prepareBatchRecipient(labelled).errors).toContain('手机号需为11位')
  })

  it('preserves both numbers and requires a correction when a recipient is ambiguous', () => {
    const [row] = parseShippingText('林示例 13800000001 13800000002 广东省深圳市南山区科苑路8号')
    expect(row.phone).toBe('13800000001 / 13800000002')
    expect(prepareBatchRecipient(row).errors.join('')).toContain('多个电话号码')
  })

  it('requires missing fields and street details even when a province name is present', () => {
    const [row] = parseShippingText('13800000001 广东省科苑路8号')
    expect(prepareBatchRecipient(row).errors).toEqual(expect.arrayContaining(['缺少收件人', '地址需包含完整省市区，请补充后重新确认']))
    const [noDoor] = parseShippingText('林示例 13800000001 广东省深圳市南山区科技大道附近')
    expect(prepareBatchRecipient(noDoor).errors).toContain('请补充街道和门牌号')
  })

  it('uses the structured name and phone without reinterpreting a name containing 收件人', () => {
    const [row] = parseShippingText('沙盒测试收件人 13800000001 广东省深圳市南山区科苑路8号')
    expect(prepareBatchRecipient(row).recipient).toMatchObject({ name: '沙盒测试收件人', phone: '13800000001', province: '广东省', city: '深圳市', county: '南山区', address: '科苑路8号' })
  })

  it('accepts 200 rows with unique UUIDs and rejects row 201 without silently truncating', () => {
    const line = '林示例 13800000001 广东省深圳市南山区科苑路8号'
    const rows = parseShippingText(Array.from({ length: 200 }, () => line).join('\n'))
    expect(rows).toHaveLength(200)
    expect(new Set(rows.map(row => row.key)).size).toBe(200)
    expect(rows.every(row => /^[0-9a-f-]{36}$/.test(row.key))).toBe(true)
    expect(() => parseShippingText(Array.from({ length: 201 }, () => line).join('\n'))).toThrow('最多解析 200 票')
  })

  it('rejects excessively long input and prevents the address parser limit from silently truncating a shipment', () => {
    expect(() => parseShippingText('x'.repeat(SHIPPING_TEXT_MAX_LENGTH + 1))).toThrow('文本不能超过')
    const [row] = parseShippingText(`林示例 13800000001 广东省深圳市南山区科苑路8号${'东'.repeat(2000)}`)
    expect(prepareBatchRecipient(row).errors).toContain('详细地址不能超过200字')
  })

  it('ignores blank lines and gives an empty input no synthetic recipient', () => {
    expect(parseShippingText(' \n\r\n ')).toEqual([])
  })
})

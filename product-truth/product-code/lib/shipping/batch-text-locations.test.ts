import { describe, expect, it } from 'vitest'
import { parseShippingText, prepareBatchRecipient } from './batch-text'
import { contactSchema, ownerOrderSchema } from './validation'

const examples = [
  {
    label: '北京办公室与顿号',
    text: '北京办公室：路凯超、13292048418、北京市朝阳区小营北路53号中源科技大厦3号楼',
    customerName: '北京办公室', recipient: '路凯超', phone: '13292048418',
    province: '北京市', city: '北京市', county: '朝阳区', address: '小营北路53号中源科技大厦3号楼',
  },
  {
    label: '部队与军东新村',
    text: '部队：无锡市滨湖区山水东路军东新村，谢老师，15961854826',
    customerName: '部队', recipient: '谢老师', phone: '15961854826',
    province: '江苏省', city: '无锡市', county: '滨湖区', address: '山水东路军东新村',
  },
]

describe('real shipping locations without invented house numbers', () => {
  it.each(examples)('$label: preserves all supplied fields in one usable row', sample => {
    const rows = parseShippingText(sample.text)
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row).toMatchObject({ customerName: sample.customerName, recipient: sample.recipient, phone: sample.phone, originalText: sample.text })
    const prepared = prepareBatchRecipient(row)
    expect(prepared.recipient).toEqual({ name: sample.recipient, phone: sample.phone, province: sample.province, city: sample.city, county: sample.county, address: sample.address })
    expect(prepared.fieldErrors).toEqual({ recipient: [], phone: [], address: [] })
    expect(contactSchema.safeParse(prepared.recipient).success).toBe(true)
    // The actual pending-order API payload accepts the same contact; no carrier call is made.
    expect(ownerOrderSchema.safeParse({ key: row.key, input: { recipient: prepared.recipient, customerName: row.customerName, cargo: '文件/合同' } }).success).toBe(true)
  })

  it.each(['\n', '\n\n'])('keeps the two original records separate with %j between them', separator => {
    const rows = parseShippingText(examples.map(sample => sample.text).join(separator))
    expect(rows).toHaveLength(2)
    expect(rows.map(row => row.originalText)).toEqual(examples.map(sample => sample.text))
    expect(rows.map(row => row.customerName)).toEqual(['北京办公室', '部队'])
    expect(rows.every(row => prepareBatchRecipient(row).errors.length === 0)).toBe(true)
  })

  it('keeps each new organization heading with its own recipient without blank lines', () => {
    const rows = parseShippingText('北京办公室：林示例、13800000001、北京市海淀区中关村大街1号\n上海办事处：李示例、13800000002、上海市浦东新区张杨路500号')
    expect(rows).toHaveLength(2)
    expect(rows.map(row => row.customerName)).toEqual(['北京办公室', '上海办事处'])
    expect(rows.map(row => row.recipient)).toEqual(['林示例', '李示例'])
    expect(rows[0].originalText).not.toContain('上海办事处')
  })

  it.each([
    ['无锡市滨湖区山水东路军东新村', '江苏省', '无锡市', '滨湖区', '山水东路军东新村'],
    ['江苏省无锡市滨湖区军东新村', '江苏省', '无锡市', '滨湖区', '军东新村'],
    ['浙江省杭州市西湖区龙井村', '浙江省', '杭州市', '西湖区', '龙井村'],
    ['浙江省杭州市西湖区东村', '浙江省', '杭州市', '西湖区', '东村'],
    ['广西壮族自治区桂林市灵川县大圩镇古镇村', '广西壮族自治区', '桂林市', '灵川县', '大圩镇古镇村'],
    ['北京市海淀区西山营区收发室', '北京市', '北京市', '海淀区', '西山营区收发室'],
    ['江苏省无锡市滨湖区山水营区门岗', '江苏省', '无锡市', '滨湖区', '山水营区门岗'],
    ['广东省深圳市南山区科技园南门', '广东省', '深圳市', '南山区', '科技园南门'],
    ['广东省深圳市南山区创新产业园收发室', '广东省', '深圳市', '南山区', '创新产业园收发室'],
    ['上海市浦东新区张江科学城服务中心', '上海市', '上海市', '浦东新区', '张江科学城服务中心'],
    ['四川省成都市武侯区锦绣花园物业', '四川省', '成都市', '武侯区', '锦绣花园物业'],
    ['浙江省杭州市西湖区文三路创新大厦前台', '浙江省', '杭州市', '西湖区', '文三路创新大厦前台'],
    ['广东省广州市天河区科华学校收发室', '广东省', '广州市', '天河区', '科华学校收发室'],
    ['广东省深圳市南山区科苑路八号', '广东省', '深圳市', '南山区', '科苑路八号'],
    ['深圳市南山区科苑路8号A座', '广东省', '深圳市', '南山区', '科苑路8号A座'],
    ['重庆市渝北区金开大道100号二栋', '重庆市', '重庆市', '渝北区', '金开大道100号二栋'],
  ])('accepts the supplied destination %s without appending a number', (address, province, city, county, detail) => {
    const original = `收件人：林示例，手机：13800000001，地址：${address}`
    const rows = parseShippingText(original)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ recipient: '林示例', phone: '13800000001', originalText: original })
    const prepared = prepareBatchRecipient(rows[0])
    expect(prepared.recipient).toMatchObject({ province, city, county, address: detail })
    expect(prepared.errors).toEqual([])
    expect(contactSchema.safeParse(prepared.recipient).success).toBe(true)
  })

  it.each([
    ['北京办公室：林示例、13800000001、北京市海淀区中关村大街1号', '北京办公室'],
    ['上海办事处：林示例，13800000001，上海市浦东新区张杨路500号', '上海办事处'],
    ['部队：林示例、13800000001、无锡市滨湖区军东新村', '部队'],
    ['北京办公室：\n林示例\n13800000001\n北京市海淀区中关村大街1号', '北京办公室'],
    ['部队：\n无锡市滨湖区山水东路军东新村\n谢老师，13800000001', '部队'],
    ['公司名称：示例科技有限公司\n收件人：林示例\n电话：13800000001\n地址：深圳市南山区科技园南门', '示例科技有限公司'],
    ['1、北京办公室：林示例、13800000001、北京市海淀区中关村大街1号', '北京办公室'],
    ['2、部队：无锡市滨湖区军东新村，谢老师，13800000001', '部队'],
  ])('separates the explicit organization heading: %s', (text, customerName) => {
    const rows = parseShippingText(text)
    expect(rows).toHaveLength(1)
    expect(rows[0].customerName).toBe(customerName)
    expect(rows[0].recipient).toBe(text.includes('谢老师') ? '谢老师' : '林示例')
    expect(prepareBatchRecipient(rows[0]).errors).toEqual([])
    expect(rows[0].address).not.toContain(customerName)
  })

  it.each([
    '广东省深圳市南山区科技大道附近',
    '广东省深圳市南山区科技园附近',
    '广东省深圳市南山区科苑路8号附近',
    '广东省深圳市南山区科技大道',
    '广东省深圳市南山区待补充',
    '广东省深圳市南山区',
    '广东省深圳市',
    '广东省海淀区中关村大街1号',
    '江苏省无锡市海淀区示例路8号',
    '北京市浦东新区张杨路500号',
  ])('keeps incomplete, vague or conflicting address blocked: %s', address => {
    const rows = parseShippingText(`林示例 13800000001 ${address}`)
    expect(rows).toHaveLength(1)
    const prepared = prepareBatchRecipient(rows[0])
    expect(prepared.fieldErrors.address.length).toBeGreaterThan(0)
    expect(contactSchema.safeParse(prepared.recipient).success).toBe(false)
  })

  it.each([
    ['部队：无锡市滨湖区军东新村，13800000001', 'recipient'],
    ['部队：无锡市滨湖区军东新村，谢老师', 'phone'],
    ['部队：无锡市滨湖区军东新村，谢老师，1380000000', 'phone'],
  ] as const)('does not invent missing contact information: %s', (text, field) => {
    const [row] = parseShippingText(text)
    expect(prepareBatchRecipient(row).fieldErrors[field].length).toBeGreaterThan(0)
  })
})

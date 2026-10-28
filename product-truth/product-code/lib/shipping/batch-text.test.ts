import { describe, expect, it } from 'vitest'
import { parseShippingText, prepareBatchRecipient, SHIPPING_TEXT_MAX_LENGTH } from './batch-text'
import { contactSchema } from './validation'

describe('shipping text intake', () => {
  it('keeps company-prefixed multiline addresses together and preserves each original record', () => {
    const first = '示例文档公司： 张样例 13800000001\n四川省成都市锦江区示例路28号A座'
    const second = '示例通信公司： 北京市海淀区示例路65号院1号楼\n示例大厦A座21层行政部，邮编：100190，收件人：李样例，联系电话：62580000/13900000002。'
    const rows = parseShippingText(`${first}\n\n${second}`)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ recipient: '张样例', phone: '13800000001', address: '四川省成都市锦江区示例路28号A座', originalText: first })
    expect(rows[1]).toMatchObject({ recipient: '李样例', phone: '13900000002', originalText: second })
    expect(rows[1].address).toBe('北京市海淀区示例路65号院1号楼 示例大厦A座21层行政部')
    expect(rows.every(row => prepareBatchRecipient(row).errors.length === 0)).toBe(true)
  })

  it('groups four blank-separated records without turning address continuations into tickets', () => {
    const blocks = [
      '示例文档公司： 张样例 13800000001\n四川省成都市锦江区示例路28号A座',
      '示例通信公司： 北京市海淀区示例路65号院1号楼\n示例大厦A座21层行政部，邮编：100190，收件人：李样例，联系电话：62580000/13900000002。',
      '示例客户甲： 陈样例 13800000003 广东省深圳市南山区示例路8号',
      '示例客户乙： 浙江省杭州市西湖区示例路9号，唐样例，13800000004',
    ]
    const rows = parseShippingText(blocks.join('\n\n'))
    expect(rows).toHaveLength(4)
    expect(rows.map(row => row.originalText)).toEqual(blocks)
    expect(rows.map(row => row.recipient)).toEqual(['张样例', '李样例', '陈样例', '唐样例'])
    expect(rows.every(row => prepareBatchRecipient(row).errors.length === 0)).toBe(true)
  })

  it('splits clearly new recipients without blank lines and never pairs them with the previous address', () => {
    const rows = parseShippingText('张样例 13800000001\n四川省成都市锦江区示例路28号\n李样例 13800000002\n北京市海淀区示例路65号\n陈样例 13800000003 广东省深圳市南山区示例路8号')
    expect(rows).toHaveLength(3)
    expect(rows.map(({ recipient, phone, address }) => ({ recipient, phone, address }))).toEqual([
      { recipient: '张样例', phone: '13800000001', address: '四川省成都市锦江区示例路28号' },
      { recipient: '李样例', phone: '13800000002', address: '北京市海淀区示例路65号' },
      { recipient: '陈样例', phone: '13800000003', address: '广东省深圳市南山区示例路8号' },
    ])
  })

  it('does not move the next recipient address into an incomplete preceding ticket', () => {
    const rows = parseShippingText('张样例 13800000001\n李样例 13800000002\n北京市海淀区示例路65号')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ recipient: '张样例', phone: '13800000001', address: '' })
    expect(rows[1]).toMatchObject({ recipient: '李样例', address: '北京市海淀区示例路65号' })
    expect(prepareBatchRecipient(rows[0]).fieldErrors.address).toContain('缺少收件地址')
  })

  it('selects the only mobile number beside a landline and leaves multiple mobiles unresolved', () => {
    const [single] = parseShippingText('姓名：李样例\n联系电话：010-62580000/13900000002\n地址：北京市海淀区示例路65号')
    expect(single.phone).toBe('13900000002')
    expect(prepareBatchRecipient(single).errors).toEqual([])
    const [multiple] = parseShippingText('姓名：李样例\n手机：13800000001\n联系电话：13900000002\n地址：北京市海淀区示例路65号')
    expect(multiple.phone).toBe('13800000001 / 13900000002')
    expect(prepareBatchRecipient(multiple).fieldErrors.phone.join('')).toContain('多个电话号码')
  })

  it('exposes missing and invalid values on their own fields and updates errors after correction', () => {
    const row = { id: 1, key: 'test-key', recipient: '', phone: '', address: '', cargo: '文件' }
    const empty = prepareBatchRecipient(row)
    expect(empty.fieldErrors).toEqual({ recipient: ['缺少收件人'], phone: ['缺少联系电话'], address: ['缺少收件地址'] })
    expect(empty.errors).toEqual(['缺少收件人', '缺少联系电话', '缺少收件地址'])
    const corrected = prepareBatchRecipient({ ...row, recipient: '张样例', phone: '13800000001', address: '广东省深圳市南山区示例路8号' })
    expect(corrected.fieldErrors).toEqual({ recipient: [], phone: [], address: [] })
    expect(corrected.errors).toEqual([])
  })

  it('retains unknown company prefixes only in the original text, never as recipient or address', () => {
    const originalText = '  示例文档公司： 13800000001\r\n四川省成都市锦江区示例路28号  '
    const [row] = parseShippingText(originalText)
    expect(row).toMatchObject({ recipient: '', phone: '13800000001', address: '四川省成都市锦江区示例路28号', originalText })
    expect(prepareBatchRecipient(row).fieldErrors.recipient).toContain('缺少收件人')
  })

  it.each([
    '收件人：张样例 手机：13800000001 地址：四川省成都市锦江区示例路28号；收件人：李样例 手机：13900000002 地址：北京市海淀区示例路65号',
    '地址：四川省成都市锦江区示例路28号 收件人：张样例 手机：13800000001；地址：北京市海淀区示例路65号 收件人：李样例 手机：13900000002',
    '张样例 13800000001 四川省成都市锦江区示例路28号；李样例 13900000002 北京市海淀区示例路65号',
    '张样例 13800000001 四川省成都市锦江区示例路28号\n北京市海淀区示例路65号\n李样例 13900000002',
  ])('recognises separate recipients inside one paragraph without mixing their addresses: %s', text => {
    const rows = parseShippingText(text)
    expect(rows).toHaveLength(2)
    expect(rows.map(({ recipient, phone, address }) => ({ recipient, phone, address }))).toEqual([
      { recipient: '张样例', phone: '13800000001', address: '四川省成都市锦江区示例路28号' },
      { recipient: '李样例', phone: '13900000002', address: '北京市海淀区示例路65号' },
    ])
    expect(rows.every(row => prepareBatchRecipient(row).errors.length === 0)).toBe(true)
  })

  it('keeps two complete shipments separate even when the recipient names are identical', () => {
    const rows = parseShippingText('张样例 13800000001 四川省成都市锦江区示例路28号；张样例 13800000001 北京市海淀区示例路65号')
    expect(rows).toHaveLength(2)
    expect(rows.map(row => row.address)).toEqual(['四川省成都市锦江区示例路28号', '北京市海淀区示例路65号'])
  })

  it('does not copy one supplied address to a second explicitly named recipient', () => {
    const rows = parseShippingText('地址：北京市海淀区示例路65号 收件人：张样例 手机：13800000001；收件人：李样例 手机：13900000002')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ recipient: '张样例', address: '北京市海淀区示例路65号' })
    expect(rows[1]).toMatchObject({ recipient: '李样例', phone: '13900000002', address: '' })
    expect(prepareBatchRecipient(rows[1]).fieldErrors.address).toContain('缺少收件地址')
  })

  it.each(['A座', '创新中心'])('retains a bare building continuation %s on the same shipment', continuation => {
    const rows = parseShippingText(`张样例 13800000001\n广东省深圳市南山区示例路8号\n${continuation}`)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ recipient: '张样例', phone: '13800000001', address: `广东省深圳市南山区示例路8号 ${continuation}` })
    expect(prepareBatchRecipient(rows[0]).errors).toEqual([])
  })

  it.each(['A座', '创新中心'])('does not turn the building continuation %s into a missing recipient name', continuation => {
    const rows = parseShippingText(`广东省深圳市南山区示例路8号\n${continuation}\n13800000001`)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ recipient: '', phone: '13800000001', address: `广东省深圳市南山区示例路8号 ${continuation}` })
    expect(prepareBatchRecipient(rows[0]).fieldErrors.recipient).toContain('缺少收件人')
  })

  it('splits a second complete administrative address at EOF without copying the first recipient', () => {
    const rows = parseShippingText('张样例 13800000001\n广东省深圳市南山区示例路8号\n浙江省杭州市余杭区示例路9号')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ recipient: '张样例', phone: '13800000001', address: '广东省深圳市南山区示例路8号' })
    expect(rows[1]).toMatchObject({ recipient: '', phone: '', address: '浙江省杭州市余杭区示例路9号' })
    expect(prepareBatchRecipient(rows[1]).errors).toEqual(expect.arrayContaining(['缺少收件人', '缺少联系电话']))
  })

  it.each([
    '收件人：张样例 13800000001 广东省深圳市南山区示例路8号；李样例 13900000002 浙江省杭州市余杭区示例路9号',
    '姓名：张样例 电话：13800000001 地址：广东省深圳市南山区示例路8号；李样例 13900000002 浙江省杭州市余杭区示例路9号',
  ])('recognises a new unlabelled recipient after labelled fields: %s', text => {
    const rows = parseShippingText(text)
    expect(rows).toHaveLength(2)
    expect(rows.map(({ recipient, phone, address }) => ({ recipient, phone, address }))).toEqual([
      { recipient: '张样例', phone: '13800000001', address: '广东省深圳市南山区示例路8号' },
      { recipient: '李样例', phone: '13900000002', address: '浙江省杭州市余杭区示例路9号' },
    ])
  })

  it('keeps standalone name, phone and address lines together for multiple recipients without blank lines', () => {
    const rows = parseShippingText('张样例\n13800000001\n广东省深圳市南山区示例路8号\n李样例\n13900000002\n浙江省杭州市余杭区示例路9号')
    expect(rows).toHaveLength(2)
    expect(rows.map(row => row.recipient)).toEqual(['张样例', '李样例'])
    expect(rows.every(row => prepareBatchRecipient(row).errors.length === 0)).toBe(true)
  })

  it('normalises an explicit +86 mobile without losing its original text', () => {
    const originalText = '张样例 +86 138 0000 0001 广东省深圳市南山区示例路8号'
    const [row] = parseShippingText(originalText)
    expect(row).toMatchObject({ phone: '13800000001', originalText })
    expect(prepareBatchRecipient(row).fieldErrors.phone).toEqual([])
    const prepared = prepareBatchRecipient({ ...row, phone: '+86 138 0000 0001' })
    expect(prepared.recipient.phone).toBe('13800000001')
    expect(contactSchema.safeParse(prepared.recipient).success).toBe(true)
  })

  it('accepts complete domestic landlines and recognises a second named landline recipient', () => {
    const rows = parseShippingText('收件人：张样例 010-62580000 北京市海淀区示例路8号；李样例 0571-62580001 浙江省杭州市余杭区示例路9号')
    expect(rows).toHaveLength(2)
    expect(rows.map(row => row.phone)).toEqual(['010-62580000', '0571-62580001'])
    expect(rows.every(row => prepareBatchRecipient(row).errors.length === 0)).toBe(true)
    expect(rows.every(row => contactSchema.safeParse(prepareBatchRecipient(row).recipient).success)).toBe(true)
  })

  it('keeps local phone numbers for correction and splits two clearly named local-number recipients', () => {
    const rows = parseShippingText('张样例 62580000 北京市海淀区示例路8号；李样例 62580001 浙江省杭州市余杭区示例路9号')
    expect(rows).toHaveLength(2)
    expect(rows.map(row => row.phone)).toEqual(['62580000', '62580001'])
    expect(rows.every(row => prepareBatchRecipient(row).fieldErrors.phone.join('').includes('区号'))).toBe(true)
  })

  it.each(['+1 415 555 0123', '+44 20 7946 0958', '+852 6123 4567'])('preserves the full international prefix for manual review: %s', phone => {
    const originalText = `张样例 ${phone} 广东省深圳市南山区示例路8号`
    const [row] = parseShippingText(originalText)
    expect(row).toMatchObject({ recipient: '张样例', phone, address: '广东省深圳市南山区示例路8号', originalText })
    const errors = prepareBatchRecipient(row).fieldErrors.phone.join('')
    expect(errors).toContain('国内')
    expect(errors).not.toContain('11位')
  })

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

  it('infers an omitted province from the unique city reference', () => {
    const [row] = parseShippingText('林示例 13800000001 深圳市南山区科苑路8号')
    expect(row.address).toBe('深圳市南山区科苑路8号')
    const result = prepareBatchRecipient(row)
    expect(result.recipient).toMatchObject({province:'广东省',city:'深圳市',county:'南山区',address:'科苑路8号'})
    expect(result.errors).toEqual([])
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
    expect(prepareBatchRecipient(noDoor).errors).toContain('请补充具体投递地点，如村庄、园区、楼宇或门牌号')
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

  it('extracts the company abbreviation from a company document heading and keeps the complete address valid', () => {
    const originalText = '中核华辉验收文件            收货人：韩寿帅\n手机号：18733506883\n所在地区：河北雄安新区容城县\n详细地址：北京中核华辉科技发展有限公司中关村科技园B3栋北楼中核华辉'
    const [row] = parseShippingText(originalText)

    expect(row).toMatchObject({
      recipient: '韩寿帅',
      phone: '18733506883',
      customerName: '中核华辉',
      originalText,
    })
    const prepared = prepareBatchRecipient(row)
    expect(prepared.recipient).toMatchObject({
      province: '河北省',
      city: '雄安新区',
      county: '容城县',
    })
    expect(prepared.errors).toEqual([])
  })

  it('uses explicit company fields without treating a person or detailed-address company as the abbreviation', () => {
    const [row] = parseShippingText('公司名称：中核华辉科技有限公司\n收货人：韩寿帅\n手机号：18733506883\n地址：河北省雄安新区容城县中核华辉科技园1号楼')
    expect(row.customerName).toBe('中核华辉科技有限公司')
    expect(row.recipient).toBe('韩寿帅')
    expect(row.address).not.toContain('公司名称')
  })

  it('extracts numbered company abbreviations from address-led and contact-led headings', () => {
    const rows = parseShippingText([
      '1、易点云 -北京市海淀区西小口路41号易点云大厦  石嘉华13037500116',
      '',
      '2、开泰——联系人姓名：郭锦宏',
      '联系电话：15989168989',
      '联系地址：深圳市罗湖区笋岗街道宝安北路华润置地笋岗中心07-01地块东区（T2栋）16层',
    ].join('\n'))

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      customerName: '易点云',
      recipient: '石嘉华',
      phone: '13037500116',
    })
    expect(rows[0].address).toMatch(/^北京市/)
    expect(rows[1]).toMatchObject({
      customerName: '开泰',
      recipient: '郭锦宏',
      phone: '15989168989',
    })
    expect(rows[1].address).not.toContain('开泰')
    expect(rows[1].address).toContain('深圳市罗湖区')
  })
})

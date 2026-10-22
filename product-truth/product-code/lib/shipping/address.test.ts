import { describe, it, expect } from 'vitest'
import { parseAddress } from './address'
describe('address labels', () => {
  it('does not consume label words embedded in a name or street', () => {
    expect(parseAddress('测试收件人 13900000000 广东省深圳市南山区系统验收虚拟地址99号').contact).toEqual({ name: '测试收件人', phone: '13900000000', province: '广东省', city: '深圳市', county: '南山区', address: '系统验收虚拟地址99号' })
  })
  it('still recognizes explicit multiline labels', () => {
    expect(parseAddress('收件人：张三\n电话：13900000000\n地址：广东省深圳市南山区科苑路15号').contact).toEqual({ name: '张三', phone: '13900000000', province: '广东省', city: '深圳市', county: '南山区', address: '科苑路15号' })
  })
})

describe('shared domestic address parsing', () => {
  it('infers omitted province and removes company contact labels', () => {
    expect(parseAddress('收件人姓名：复临科技\n联系方式：13168731410\n邮寄地址：深圳市南山区粤海街道高新南十道16号金地威新中心A座20层').contact).toEqual({name:'复临科技',phone:'13168731410',province:'广东省',city:'深圳市',county:'南山区',address:'粤海街道高新南十道16号金地威新中心A座20层'})
  })
  it('accepts inline labels after the address and preserves a functional zone literally', () => {
    const result=parseAddress('地址：成都市天府新区华府大道一段建发鹭洲T31-36F 收件人：张三 联系电话：13900000000')
    expect(result.contact).toEqual({name:'张三',phone:'13900000000',province:'四川省',city:'成都市',county:'天府新区',address:'华府大道一段建发鹭洲T31-36F'})
    expect(result.warnings).toContain('区县按原文保留，请核对承运商是否支持该区域名称。')
  })
  it('supports 快递给 and municipalities without putting team into the name', () => {
    expect(parseAddress('公司名称：测试公司\n所属团队：北区一组\n快递给：韦佳乐\n联系电话：13900000000\n地址：北京市朝阳区安外小关东里10号院').contact).toEqual({name:'韦佳乐',phone:'13900000000',province:'北京市',city:'北京市',county:'朝阳区',address:'安外小关东里10号院'})
  })
  it('does not infer a province from an ambiguous district alone', () => {
    const result=parseAddress('张三 13900000000 朝阳区测试路1号')
    expect(result.contact.province).toBe('')
    expect(result.contact.address).toContain('朝阳区测试路1号')
  })
  it('recognises the Xiongan shorthand used by the carrier without inventing missing levels', () => {
    const result = parseAddress('收货人：韩寿帅 手机号：18733506883 所在地区：河北雄安新区容城县 详细地址：北京中核华辉科技发展有限公司中关村科技园B3栋北楼中核华辉')
    expect(result.contact).toMatchObject({
      name: '韩寿帅',
      phone: '18733506883',
      province: '河北省',
      city: '雄安新区',
      county: '容城县',
      address: '北京中核华辉科技发展有限公司中关村科技园B3栋北楼中核华辉',
    })
    expect(result.warnings).not.toContain('省市区未完整识别；已识别内容已填入，其余原文保留，请补齐缺项。')
  })
})

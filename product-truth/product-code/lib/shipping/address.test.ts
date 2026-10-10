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

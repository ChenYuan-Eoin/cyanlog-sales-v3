import { describe, expect, it } from 'vitest'
import { DOMESTIC_SHIPPING_PHONE_PATTERN, normalizeDomesticShippingPhone, recipientPhoneError } from './phone'
import { contactSchema } from './validation'

describe('recipient telephone format', () => {
  it.each(['13800000001', '010-62580000', '01062580000', '0755-23450000', '0592-2345000', '010-62580000-123'])('accepts the same domestic number as the server: %s', phone => {
    expect(recipientPhoneError(phone)).toBeNull()
    expect(DOMESTIC_SHIPPING_PHONE_PATTERN.test(phone)).toBe(true)
    expect(contactSchema.shape.phone.safeParse(phone).success).toBe(true)
  })

  it('distinguishes missing phones, missing area codes and malformed mobiles', () => {
    expect(recipientPhoneError('')).toBe('缺少联系电话')
    expect(recipientPhoneError('62580000')).toContain('缺少区号')
    expect(recipientPhoneError('2345000')).toContain('缺少区号')
    expect(recipientPhoneError('1380000000')).toBe('手机号需为11位')
    expect(recipientPhoneError('13800000001 / 13900000002')).toContain('多个电话号码')
  })

  it.each([
    ['+86 138 0000 0001', '13800000001'],
    ['0086 13800000001', '13800000001'],
    ['+86 10 62580000', '01062580000'],
    ['+86 (0755) 23450000', '075523450000'],
  ])('normalizes an explicit China prefix without guessing an area code: %s', (raw, expected) => {
    expect(normalizeDomesticShippingPhone(raw)).toBe(expected)
    expect(recipientPhoneError(raw)).toBeNull()
    expect(contactSchema.shape.phone.safeParse(expected).success).toBe(true)
  })

  it('preserves the distinction between international recognition and domestic service support', () => {
    expect(recipientPhoneError('+1 415 555 0123')).toContain('国际号码')
    expect(recipientPhoneError('+44 20 7946 0123')).not.toContain('11位')
    expect(recipientPhoneError('00852 2345 0000')).toContain('国际号码')
    expect(recipientPhoneError('+1234567890123456')).toContain('超过15位')
    expect(contactSchema.shape.phone.safeParse('+1 415 555 0123').success).toBe(false)
  })
})

// Keep batch validation aligned with the existing domestic carrier contract.
// This checks format, not whether a number is allocated or reachable.
export const DOMESTIC_SHIPPING_PHONE_PATTERN = /^(?:1[3-9]\d{9}|0\d{2,3}[- ]?\d{7,8}(?:[- ]\d{1,6})?)$/

export function normalizeDomesticShippingPhone(value: string): string {
  const phone = value.trim()
  if (DOMESTIC_SHIPPING_PHONE_PATTERN.test(phone)) return phone
  const compact = phone.replace(/[ ()（）-]/g, '')
  if (/^1[3-9]\d{9}$/.test(compact)) return compact
  if (/^(?:\+|00)86/.test(compact)) {
    const national = compact.replace(/^(?:\+|00)86/, '')
    if (/^1[3-9]\d{9}$/.test(national)) return national
    const domestic = national.startsWith('0') ? national : `0${national}`
    if (DOMESTIC_SHIPPING_PHONE_PATTERN.test(domestic)) return domestic
  }
  return phone
}

export function recipientPhoneError(value: string): string | null {
  const phone = normalizeDomesticShippingPhone(value)
  if (!phone) return '缺少联系电话'
  if (/[\/／]/.test(phone)) return '发现多个电话号码，请保留一个收件人联系电话'
  if (DOMESTIC_SHIPPING_PHONE_PATTERN.test(phone)) return null
  if (/^(?:\+|00)\d/.test(phone)) {
    const digits = phone.replace(/\D/g, '').replace(/^00/, '')
    if (digits.length > 15) return '国际号码超过15位数字，请核对国家代码和号码'
    return '已保留国际号码；当前仅支持国内寄件电话，请核对目的地和寄件服务'
  }
  if (/^[2-9]\d{6,7}(?:[- ]\d{1,6})?$/.test(phone)) return '座机号码缺少区号，请补充区号后确认'
  if (/^1\d*$/.test(phone)) return '手机号需为11位'
  return '请填写国内手机号或带区号的座机，分机请用短横线分隔'
}

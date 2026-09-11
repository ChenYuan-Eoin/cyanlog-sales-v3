import { emptyContact } from './types'
// Conservative parser: ambiguous fields stay editable, never invent a district.
export function parseAddress(raw: string) {
  const contact = emptyContact()
  const warnings: string[] = []
  let input = raw.slice(0, 2000).replace(/[，,；;\t]/g, ' ').trim()
  const phones = [...input.matchAll(/(?<!\d)(?:1[3-9]\d{9}|0\d{2,3}[- ]?\d{7,8})(?!\d)/g)]
  if (phones.length > 1) return { contact, warnings: ['发现多个电话号码，请每次粘贴一个收件人，并手工确认信息。'] }
  if (phones[0]) { contact.phone = phones[0][0]; input = input.replace(phones[0][0], ' ') }
  else warnings.push('未识别到联系电话，请补充。')
  const named = input.match(/(?:收件人|联系人|姓名)[：: ]+([^\s：:]{2,20})/)
  if (named) { contact.name = named[1]; input = input.replace(named[0], ' ') }
  input = input.replace(/(?:收件地址|详细地址|收货地址|地址|联系电话|手机号码|手机号|电话|手机)[：: ]*/g, ' ').trim()
  const province = input.match(/北京(?:市)?|上海(?:市)?|天津(?:市)?|重庆(?:市)?|内蒙古自治区|广西壮族自治区|西藏自治区|宁夏回族自治区|新疆维吾尔自治区|[\u4e00-\u9fff]{2,3}省/)
  if (province && province.index !== undefined) {
    const before = input.slice(0, province.index).trim()
    if (!contact.name && /^[\u4e00-\u9fff·]{2,8}$/.test(before)) contact.name = before
    let remainder = input.slice(province.index + province[0].length).trim()
    const municipality = province[0].match(/^(北京|上海|天津|重庆)/)
    contact.province = municipality ? municipality[1] + '市' : province[0]
    if (municipality) { contact.city = contact.province; remainder = remainder.replace(new RegExp('^' + contact.city), '').trim() }
    else { const city = remainder.match(/^([^\s]{2,12}?(?:市|自治州|地区|盟))/); if (city) { contact.city = city[1]; remainder = remainder.slice(city[1].length).trim() } }
    const district = remainder.match(/^([^\s]{2,12}?(?:区|县|旗|市))/)
    if (district) { contact.county = district[1]; remainder = remainder.slice(district[1].length).trim() }
    contact.address = remainder
  } else { contact.address = input; warnings.push('省市区未完整识别，请手工填写。') }
  if (!contact.name) warnings.push('请确认收件人姓名。')
  if (!contact.city || !contact.county) warnings.push('请确认城市和区县，未识别的内容保留在详细地址。')
  warnings.push('请核对姓名、电话、地区和门牌号后再下单。')
  return { contact, warnings }
}

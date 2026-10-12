import { emptyContact } from './types'
import regions from './china-regions.json'

// china-division 2.7.0; upstream bundled license preserved in china-regions.LICENSE. Vendored province/city/county reference only;
// this is an aid to parsing, not a delivery-area or carrier eligibility check.
// Source: https://unpkg.com/china-division@2.7.0/dist/pca.json
const municipalities = new Set(['北京市', '天津市', '上海市', '重庆市'])
const cities = Object.entries(regions).flatMap(([province, children]) =>
  Object.entries(children).map(([city, counties]) => ({ province, city: municipalities.has(province) ? province : city, counties })))
const labels = /(?:收件人姓名|寄件人姓名|寄件人|收件人|联系人|姓名|快递给|收件地址|寄件地址|邮寄地址|详细地址|收货地址|地址|联系方式|联系电话|手机号码|手机号|电话|手机|公司名称|所属团队)[：:]/g

export function parseAddress(raw: string) {
  const contact = emptyContact()
  const warnings: string[] = []
  let input = raw.slice(0, 2000).replace(/[，,；;\t]/g, ' ').replace(labels, '\n$&').trim()
  const phones = [...input.matchAll(/(?<!\d)(?:1[3-9]\d{9}|0\d{2,3}[- ]?\d{7,8})(?!\d)/g)]
  if (phones.length > 1) return { contact, warnings: ['发现多个电话号码，请每次粘贴一个收件人，并手工确认信息。'] }
  if (phones[0]) { contact.phone = phones[0][0]; input = input.replace(phones[0][0], ' ') }
  else warnings.push('未识别到联系电话，请补充。')
  const named = input.match(/(?:^|\s)(?:收件人姓名|寄件人姓名|寄件人|收件人|联系人|姓名|快递给)[：: ]+([^\s：:]{2,40})/)
  if (named) { contact.name = named[1]; input = input.replace(named[0], ' ') }
  // Explicit metadata belongs to separate business fields, never the street/name.
  input = input.replace(/(?:^|\n)(?:公司名称|所属团队)[：:][^\n]*/g, '\n')
  if (!contact.name) {
    const lines = input.split(/\r?\n/)
    const candidates = lines.map((line, index) => ({ text: line.trim(), index })).filter(({ text }) =>
      /^[\u4e00-\u9fff]{2,4}$/.test(text) && !/(?:公司|部门|团队|组|办公室|收件|寄件|地址|电话|手机|省|市|区|县|镇|村|路|街|楼|室|园)$/.test(text))
    if (candidates.length === 1) { contact.name = candidates[0].text; lines[candidates[0].index] = ''; input = lines.join('\n') }
  }
  input = input.replace(/(?:^|\s)(?:收件地址|寄件地址|邮寄地址|详细地址|收货地址|地址|联系方式|联系电话|手机号码|手机号|电话|手机)[：: ]*/g, ' ').trim()
  const provinceNames = Object.keys(regions).sort((a, b) => b.length - a.length)
  const province = provinceNames.map(name => ({ name, index: input.indexOf(name) })).filter(item => item.index >= 0).sort((a, b) => a.index - b.index)[0]
  const candidates = cities.filter(item => (!province || item.province === province.name) && input.includes(item.city))
  const distinct = candidates.filter((item, index) => candidates.findIndex(other => other.province === item.province && other.city === item.city) === index)
  const match = distinct.length === 1 ? distinct[0] : undefined
  let remainder = input
  if (match) {
    contact.province = match.province
    contact.city = match.city
    const start = province ? Math.min(province.index, input.indexOf(match.city)) : input.indexOf(match.city)
    const before = input.slice(0, start).trim()
    if (!contact.name && /^[\u4e00-\u9fff·]{2,8}$/.test(before) && !/(公司|团队|组)$/.test(before)) contact.name = before
    remainder = input.slice(input.indexOf(match.city) + match.city.length).trim()
    const counties = cities.filter(item => item.province === match.province && item.city === match.city).flatMap(item => item.counties)
    const county = counties.sort((a, b) => b.length - a.length).find(name => remainder.startsWith(name))
    if (county) { contact.county = county; remainder = remainder.slice(county.length).trim() }
    else {
      // Functional zones (e.g. 天府新区) may span administrative counties.
      // Keep their literal delivery address; do not silently map to a guessed county.
      const literal = remainder.match(/^([^\s]{2,12}?(?:区|县|旗))/)
      if (literal) { contact.county = literal[1]; remainder = remainder.slice(literal[1].length).trim(); warnings.push('区县按原文保留，请核对承运商是否支持该区域名称。') }
    }
  } else if (province) {
    contact.province = province.name
    remainder = input.slice(province.index + province.name.length).trim()
  }
  contact.address = remainder
  if (!contact.name) warnings.push('请确认联系人姓名。')
  if (!contact.province || !contact.city || !contact.county) warnings.push('省市区未完整识别；已识别内容已填入，其余原文保留，请补齐缺项。')
  return { contact, warnings }
}

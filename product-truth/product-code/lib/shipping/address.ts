import { emptyContact } from './types'
import regions from './china-regions.json'

// china-division 2.7.0; upstream bundled license preserved in china-regions.LICENSE. Vendored province/city/county reference only;
// this is an aid to parsing, not a delivery-area or carrier eligibility check.
// Source: https://unpkg.com/china-division@2.7.0/dist/pca.json
const municipalities = new Set(['北京市', '天津市', '上海市', '重庆市'])
const referenceCities = Object.entries(regions).flatMap(([province, children]) =>
  Object.entries(children).map(([city, counties]) => ({ province, city: municipalities.has(province) ? province : city, counties })))
const cities = [
  ...referenceCities,
  // Alibaba/China Division and the carrier expose Xiongan as a city-level
  // destination even though the reference table still groups these counties
  // under Baoding. Keep the carrier-facing composition explicit.
  { province: '河北省', city: '雄安新区', counties: ['容城县', '雄县', '安新县'] },
]
const provinceShortNames = new Set([
  ...Object.keys(regions).map((name) => name.replace(/(?:省|市|壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区)$/u, '')),
  '内蒙古', '广西', '西藏', '宁夏', '新疆', '香港', '澳门',
])
const labels = /(?:收件人姓名|寄件人姓名|收货人|寄件人|收件人|联系人|姓名|快递给|所在地区|收件地址|寄件地址|邮寄地址|详细地址|收货地址|地址|联系方式|联系电话|手机号码|手机号|电话|手机|公司名称|所属团队)[：:]/g

type PlaceHit = { name: string; index: number; length: number }

function placeAliases(name: string): string[] {
  const short = name.replace(/(?:特别行政区|壮族自治区|回族自治区|维吾尔自治区|自治区|自治州|地区|盟|省|市|区|县|旗)$/u, '')
  return short !== name && short.length >= 2 ? [name, short] : [name]
}

function earliestPlace(input: string, names: string[]): PlaceHit | null {
  const hits = names.flatMap((name) => placeAliases(name).map((alias) => ({
    name,
    index: input.indexOf(alias),
    length: alias.length,
  }))).filter((hit) => hit.index >= 0)
  return hits.sort((left, right) => left.index - right.index || right.length - left.length)[0] || null
}

export function parseAddress(raw: string) {
  const contact = emptyContact()
  const warnings: string[] = []
  let input = raw.slice(0, 2000).replace(/[，,；;\t]/g, ' ').replace(labels, '\n$&').trim()
  const phones = [...input.matchAll(/(?<!\d)(?:1[3-9]\d{9}|0\d{2,3}[- ]?\d{7,8})(?!\d)/g)]
  if (phones.length > 1) return { contact, warnings: ['发现多个电话号码，请每次粘贴一个收件人，并手工确认信息。'] }
  if (phones[0]) { contact.phone = phones[0][0]; input = input.replace(phones[0][0], ' ') }
  else warnings.push('未识别到联系电话，请补充。')
  const named = input.match(/(?:^|\s)(?:收件人姓名|寄件人姓名|收货人|寄件人|收件人|联系人|姓名|快递给)[：: ]+([^\s：:]{2,40})/)
  if (named) { contact.name = named[1]; input = input.replace(named[0], ' ') }
  // Explicit metadata belongs to separate business fields, never the street/name.
  input = input.replace(/(?:^|\n)(?:公司名称|所属团队)[：:][^\n]*/g, '\n')
  if (!contact.name) {
    const lines = input.split(/\r?\n/)
    const candidates = lines.map((line, index) => ({ text: line.trim(), index })).filter(({ text }) =>
      /^[\u4e00-\u9fff]{2,4}$/.test(text) && !/(?:公司|部门|团队|组|办公室|收件|寄件|地址|电话|手机|省|市|区|县|镇|村|路|街|楼|室|园)$/.test(text))
    if (candidates.length === 1) { contact.name = candidates[0].text; lines[candidates[0].index] = ''; input = lines.join('\n') }
  }
  input = input.replace(/(?:^|\s)(?:所在地区|收件地址|寄件地址|邮寄地址|详细地址|收货地址|地址|联系方式|联系电话|手机号码|手机号|电话|手机)[：: ]*/g, ' ').trim()
  const province = earliestPlace(input, Object.keys(regions))
  const cityCandidates = cities.filter(item => !province || item.province === province.name)
  const matches = cityCandidates.flatMap((item) => {
    const cityHit = earliestPlace(input, [item.city])
    if (!cityHit || (province && cityHit.index < province.index)) return []
    const afterCity = input.slice(cityHit.index + cityHit.length)
    const countyInput = afterCity.trimStart()
    const countyHit = earliestPlace(countyInput, item.counties)
    const literalCounty = countyHit?.index === 0
      ? null
      : countyInput.match(/^([^\s]{2,12}?(?:新区|区|县|旗))/u)?.[1] || null
    if ((!countyHit || countyHit.index !== 0) && !literalCounty) return []
    const county = countyHit?.index === 0 ? countyHit.name : literalCounty!
    const countyLength = countyHit?.index === 0 ? countyHit.length : literalCounty!.length
    return [{
      province: item.province,
      city: item.city,
      county,
      literalCounty: Boolean(literalCounty),
      cityIndex: cityHit.index,
      cityLength: cityHit.length,
      countyEnd: cityHit.index + cityHit.length + (afterCity.length - countyInput.length) + countyLength,
    }]
  }).filter((item, index, all) => all.findIndex(other => (
    other.province === item.province && other.city === item.city && other.county === item.county
  )) === index)
  const match = matches.length === 1 ? matches[0] : undefined
  let remainder = input
  if (match) {
    contact.province = match.province
    contact.city = match.city
    contact.county = match.county
    if (match.literalCounty) warnings.push('区县按原文保留，请核对承运商是否支持该区域名称。')
    const start = province ? Math.min(province.index, match.cityIndex) : match.cityIndex
    const before = input.slice(0, start).trim()
    if (!contact.name && /^[\u4e00-\u9fff·]{2,8}$/.test(before) && !provinceShortNames.has(before) && !/(公司|团队|组)$/.test(before)) contact.name = before
    remainder = input.slice(match.countyEnd).trim()
  } else if (province) {
    contact.province = province.name
    remainder = input.slice(province.index + province.length).trim()
  }
  contact.address = remainder
  if (!contact.name) warnings.push('请确认联系人姓名。')
  if (!contact.province || !contact.city || !contact.county) warnings.push('省市区未完整识别；已识别内容已填入，其余原文保留，请补齐缺项。')
  return { contact, warnings }
}

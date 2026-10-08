import { parseAddress } from './address'
import { DOMESTIC_SHIPPING_PHONE_PATTERN, normalizeDomesticShippingPhone, recipientPhoneError } from './phone'
import type { BatchDraftRow } from './import-parser'
import type { Contact } from './types'

export const SHIPPING_TEXT_MAX_LENGTH = 100_000
export const SHIPPING_TEXT_MAX_ROWS = 200

type TextField = 'name' | 'phone' | 'address'
const labels = /(?<![\p{L}\d])(?:收件人姓名|收件人|联系人|姓名|联系电话|手机号码|手机号|电话|手机|收件地址|详细地址|收货地址|地址)(?:\s*[:：]\s*|\s+)/gu
// Recognise only explicit province names. Missing provinces are left for the user to correct.
const provinceStart = /北京市?|上海市?|天津市?|重庆市?|内蒙古自治区|广西壮族自治区|西藏自治区|宁夏回族自治区|新疆维吾尔自治区|(?:河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾)省|香港特别行政区|澳门特别行政区/
// Preserve an explicit international prefix as one candidate. Unsupported numbers remain
// editable; extracting a domestic-looking suffix would silently change the destination contact.
const phoneCandidates = /(?<![\d+])(?:(?:\+|00)\d(?:[\d ()（）-]*\d)?|(?:86[ -]?)?(?:1\d{2}[ -]\d{4}[ -]\d{4}|0\d{2,3}[- ]\d{7,8}(?:[- ]\d{1,6})?|\d{7,20}))(?!\d)/g
const mobilePhone = /^1[3-9]\d{9}$/
const namedPhone = new RegExp(`(?:^|[\\s，,；;：:])([\\p{L}·][\\p{L}·.'-]{0,59})\\s*(?=${phoneCandidates.source})`, 'gu')

function clean(value: string) { return value.replace(/[，,；;。/／\t]/g, ' ').replace(/\s+/g, ' ').trim() }
function fieldOf(label: string): TextField {
  if (/地址/.test(label)) return 'address'
  if (/电话|手机/.test(label)) return 'phone'
  return 'name'
}
function fieldParts(value: string) {
  const matches = [...value.matchAll(labels)]
  return matches.map((match, index) => ({
    field: fieldOf(match[0]),
    value: clean(value.slice(match.index! + match[0].length, matches[index + 1]?.index ?? value.length)),
  }))
}
function withoutPhones(value: string) { return clean(value.replace(phoneCandidates, ' ')) }
function plausibleName(value: string) {
  return /^[\p{L}·][\p{L}· .'-]{0,59}$/u.test(value) && !/[省市区县镇乡街路道号栋幢楼室村座层]$/.test(value) && !/(?:公司|集团|大厦|行政部|产业园|工业园|写字楼|中心|园区|基地|广场|仓库|学校|办公)/.test(value)
}
function textForFields(raw: string) {
  return raw.split(/\r?\n/).map(line => {
    const prefix = line.match(/^\s*([^:：，,；;]+)[:：]\s*/)
    // A company/customer heading is context, not a recipient or street. Keep it in originalText.
    if (prefix && !/(?:邮政编码|邮编)\s*$/.test(prefix[1]) && !fieldParts(`${prefix[1]}：`).length && !provinceStart.test(prefix[1]) && ![...prefix[1].matchAll(phoneCandidates)].length) line = line.slice(prefix[0].length)
    return line.replace(/(?:邮政编码|邮编)\s*[:：]\s*\d{6}(?!\d)/g, ' ')
  }).join('\n')
}

type TextUnit = { raw: string; ending: string; parsed: ReturnType<typeof parseFields>; named: boolean; independentAddress: boolean }
function unitsFromLine(raw: string, ending: string): TextUnit[] {
  const labelled = [...raw.matchAll(labels)]
  const boundaries = new Uint8Array(raw.length)
  boundaries[0] = 1
  labelled.forEach(match => { boundaries[match.index!] = 1 })
  // A named phone remains a new-recipient cue when another record on the line uses labels.
  const names = [...raw.matchAll(namedPhone)]
  let labelIndex = -1
  for (const match of names) {
    if (!plausibleName(match[1])) continue
    const offset = match.index! + match[0].indexOf(match[1])
    while (labelIndex + 1 < labelled.length && labelled[labelIndex + 1].index! < offset) labelIndex += 1
    if (labelIndex >= 0 && fieldOf(labelled[labelIndex][0]) === 'name' && offset === labelled[labelIndex].index! + labelled[labelIndex][0].length) continue
    boundaries[offset] = 1
  }
  const offsets: number[] = []
  for (let index = 0; index < boundaries.length; index += 1) if (boundaries[index]) offsets.push(index)
  return offsets.map((offset, index) => {
    const value = raw.slice(offset, offsets[index + 1] ?? raw.length)
    const parsed = parseFields(value)
    const fields = fieldParts(textForFields(value))
    const address = parseAddress(parsed.address).contact
    return { raw: value, ending: index === offsets.length - 1 ? ending : '', parsed, named: Boolean(parsed.recipient && parsed.phone) || fields.some(part => part.field === 'name'), independentAddress: Boolean(address.province && address.city && address.county) }
  })
}

function recordsFromText(text: string): string[] {
  const records: string[] = []
  let units: TextUnit[] = []
  let hasName = false, hasAddress = false
  const flush = () => {
    if (units.length) records.push(units.map((unit, index) => unit.raw + (index < units.length - 1 ? unit.ending : '')).join(''))
    if (records.length > SHIPPING_TEXT_MAX_ROWS) throw new Error(`每次最多解析 ${SHIPPING_TEXT_MAX_ROWS} 票，请分批粘贴。`)
    units = []
    hasName = false; hasAddress = false
  }
  const rawLines = text.split(/(\r?\n)/)
  const inputUnits: Array<TextUnit | null> = []
  for (let index = 0; index < rawLines.length; index += 2) {
    const raw = rawLines[index]
    if (!raw.trim()) inputUnits.push(null)
    else inputUnits.push(...unitsFromLine(raw, rawLines[index + 1] || ''))
  }
  for (let index = 0; index < inputUnits.length; index += 1) {
    const unit = inputUnits[index]
    if (!unit) { flush(); continue }
    const next = inputUnits[index + 1]
    // A bare word alone is not a new recipient. A separate name followed by a phone-only
    // line is supported, while building/floor continuations remain in their address.
    if (!unit.named && unit.parsed.recipient && !unit.parsed.address && !unit.parsed.phone && next?.parsed.phone && !next.parsed.recipient && !next.parsed.address) unit.named = true
    if ((unit.named && hasName) || (unit.independentAddress && hasAddress)) flush()
    units.push(unit)
    hasName ||= unit.named
    hasAddress ||= unit.independentAddress
  }
  flush()
  return records
}

function parseFields(original: string) {
  const raw = textForFields(original)
  const parts = fieldParts(raw)
  const phones = [...new Set([...raw.matchAll(phoneCandidates)].map(match => normalizeDomesticShippingPhone(match[0])))]
  const mobiles = phones.filter(phone => mobilePhone.test(phone))
  const onlyMobileWithLandlines = mobiles.length === 1 && phones.every(phone => DOMESTIC_SHIPPING_PHONE_PATTERN.test(phone) || /^[2-9]\d{6,7}$/.test(phone))
  const phone = onlyMobileWithLandlines ? mobiles[0] : phones.length ? phones.join(' / ') : (parts.find(part => part.field === 'phone')?.value || '')
  let address = withoutPhones(raw.replace(labels, ' '))
  let recipient = ''
  const named = parts.find(part => part.field === 'name')
  if (named) {
    const nameText = withoutPhones(named.value)
    const regionIndex = nameText.search(provinceStart)
    const candidate = clean(regionIndex < 0 ? nameText : nameText.slice(0, regionIndex))
    if (plausibleName(candidate)) recipient = candidate
  }
  if (!recipient) {
    const regionIndex = address.search(provinceStart)
    const beforeRegion = regionIndex > 0 ? clean(address.slice(0, regionIndex)) : ''
    if (plausibleName(beforeRegion)) recipient = beforeRegion
    else {
      const tokens = address.split(' ')
      if (tokens.length > 1 && plausibleName(tokens[0])) recipient = tokens[0]
      else if (tokens.length > 1 && plausibleName(tokens[tokens.length - 1])) recipient = tokens[tokens.length - 1]
      else if (plausibleName(address) && !provinceStart.test(address)) recipient = address
    }
  }
  if (recipient) {
    if (address.startsWith(recipient)) address = clean(address.slice(recipient.length))
    else {
      const escaped = recipient.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      address = clean(address.replace(new RegExp(`(^|\\s)${escaped}(?=\\s|$)`), ' '))
    }
  }
  // An explicitly labelled invalid phone must stay in its editable phone field.
  if (!phones.length && phone) address = clean(address.replace(phone, ' '))
  return { recipient, phone, address }
}

export function parseShippingText(text: string, cargo = '文件/合同'): BatchDraftRow[] {
  if (text.length > SHIPPING_TEXT_MAX_LENGTH) throw new Error(`文本不能超过 ${SHIPPING_TEXT_MAX_LENGTH.toLocaleString('en-US')} 字，请分批粘贴。`)
  return recordsFromText(text).map((originalText, index) => ({ id: index + 1, key: crypto.randomUUID(), ...parseFields(originalText), cargo, originalText }))
}

/** The preview and the submitted payload share this exact prepared contact. */
export function prepareBatchRecipient(row: BatchDraftRow): { recipient: Contact; errors: string[]; fieldErrors: { recipient: string[]; phone: string[]; address: string[] } } {
  const recipient = { ...parseAddress(row.address).contact, name: row.recipient.trim(), phone: normalizeDomesticShippingPhone(row.phone) }
  const fieldErrors: { recipient: string[]; phone: string[]; address: string[] } = { recipient: [], phone: [], address: [] }
  if (!recipient.name) fieldErrors.recipient.push('缺少收件人')
  else if (recipient.name.length > 60) fieldErrors.recipient.push('收件人姓名不能超过60字')
  const phoneError = recipientPhoneError(recipient.phone)
  if (phoneError) fieldErrors.phone.push(phoneError)
  if (!row.address.trim()) fieldErrors.address.push('缺少收件地址')
  else {
    if (!recipient.province || !recipient.city || !recipient.county) fieldErrors.address.push('地址需包含完整省市区，请补充后重新确认')
    if ([recipient.province, recipient.city, recipient.county].some(value => value.length > 30)) fieldErrors.address.push('省市区名称不能超过30字')
    if (recipient.address.length < 5 || !/\d|[一二三四五六七八九十百]+(?:号|栋|幢|楼|室)/.test(recipient.address)) fieldErrors.address.push('请补充街道和门牌号')
    if (recipient.address.length > 200 || row.address.length > 2000) fieldErrors.address.push('详细地址不能超过200字')
  }
  return { recipient, errors: [...fieldErrors.recipient, ...fieldErrors.phone, ...fieldErrors.address], fieldErrors }
}

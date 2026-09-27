import { parseAddress } from './address'
import type { BatchDraftRow } from './import-parser'
import type { Contact } from './types'

export const SHIPPING_TEXT_MAX_LENGTH = 100_000
export const SHIPPING_TEXT_MAX_ROWS = 200

type TextField = 'name' | 'phone' | 'address'
const labels = /(?<![\p{L}\d])(?:收件人姓名|收件人|联系人|姓名|联系电话|手机号码|手机号|电话|手机|收件地址|详细地址|收货地址|地址)(?:\s*[:：]\s*|\s+)/gu
// Recognise only explicit province names. Missing provinces are left for the user to correct.
const provinceStart = /北京市?|上海市?|天津市?|重庆市?|内蒙古自治区|广西壮族自治区|西藏自治区|宁夏回族自治区|新疆维吾尔自治区|(?:河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾)省|香港特别行政区|澳门特别行政区/
const phoneCandidates = /(?<!\d)(?:\+?86[ -]?)?(?:1\d{2}[ -]\d{4}[ -]\d{4}|\d{7,20})(?!\d)/g

function clean(value: string) { return value.replace(/[，,；;\t]/g, ' ').replace(/\s+/g, ' ').trim() }
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
  return /^[\p{L}·][\p{L}· .'-]{0,59}$/u.test(value) && !/[省市区县镇乡街路道号栋幢楼室村]$/.test(value)
}

function recordsFromText(text: string): string[] {
  const records: string[] = []
  let labelled: string[] = []
  let fields = new Set<TextField>()
  const flush = () => {
    if (labelled.length) records.push(labelled.join(' '))
    labelled = []
    fields = new Set()
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = clean(raw)
    if (!line) { flush(); continue }
    const lineFields = fieldParts(line).map(part => part.field)
    if (!lineFields.length) { flush(); records.push(line); continue }
    // Repeated labels start the next recipient, even without a blank separator.
    if (lineFields.some(field => fields.has(field))) flush()
    labelled.push(line)
    lineFields.forEach(field => fields.add(field))
  }
  flush()
  if (records.length > SHIPPING_TEXT_MAX_ROWS) throw new Error(`每次最多解析 ${SHIPPING_TEXT_MAX_ROWS} 票，请分批粘贴。`)
  return records
}

function parseRecord(raw: string, index: number, cargo: string): BatchDraftRow {
  const parts = fieldParts(raw)
  const phones = [...raw.matchAll(phoneCandidates)].map(match => match[0].replace(/^\+?86[ -]?(?=1)/, '').replace(/[ -]/g, ''))
  const phone = phones.length ? phones.join(' / ') : (parts.find(part => part.field === 'phone')?.value || '')
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
  return { id: index + 1, key: crypto.randomUUID(), recipient, phone, address, cargo }
}

export function parseShippingText(text: string, cargo = '文件/合同'): BatchDraftRow[] {
  if (text.length > SHIPPING_TEXT_MAX_LENGTH) throw new Error(`文本不能超过 ${SHIPPING_TEXT_MAX_LENGTH.toLocaleString('en-US')} 字，请分批粘贴。`)
  return recordsFromText(text).map((record, index) => parseRecord(record, index, cargo))
}

/** The preview and the submitted payload share this exact prepared contact. */
export function prepareBatchRecipient(row: BatchDraftRow): { recipient: Contact; errors: string[] } {
  const recipient = { ...parseAddress(row.address).contact, name: row.recipient.trim(), phone: row.phone.trim() }
  const errors: string[] = []
  if (!recipient.name) errors.push('缺少收件人')
  else if (recipient.name.length > 60) errors.push('收件人姓名不能超过60字')
  if (recipient.phone.includes(' / ')) errors.push('发现多个电话号码，请保留一个收件人手机号')
  else if (!/^1[3-9]\d{9}$/.test(recipient.phone)) errors.push('手机号需为11位')
  if (!recipient.province || !recipient.city || !recipient.county) errors.push('地址需包含完整省市区，请补充后重新确认')
  if ([recipient.province, recipient.city, recipient.county].some(value => value.length > 30)) errors.push('省市区名称不能超过30字')
  if (recipient.address.length < 5 || !/\d|[一二三四五六七八九十百]+(?:号|栋|幢|楼|室)/.test(recipient.address)) errors.push('请补充街道和门牌号')
  if (recipient.address.length > 200 || row.address.length > 2000) errors.push('详细地址不能超过200字')
  return { recipient, errors }
}

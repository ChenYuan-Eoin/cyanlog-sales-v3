import type { TrackingEventStatus } from './types'

type TrackingStatusInput = {
  firstStatusName?: string | null
  secondaryStatusName?: string | null
  opCode?: string | null
  description: string
}

// Verified in the current SF route query response example. Other operation
// codes deliberately have no inferred meaning, including custom route codes.
// https://open.sf-express.com/Api/ApiDetails?interName=路由查询接口-EXP_RECE_SEARCH_ROUTES&level3=397
const operationStatuses: Record<string, TrackingEventStatus> = { '54': 'in_transit', '655': 'waybill_created' }
const namedStatuses: Record<string, TrackingEventStatus> = {
  待揽收: 'waybill_created', 未揽收: 'waybill_created', 尚未揽收: 'waybill_created',
  已揽收: 'in_transit', 已收取: 'in_transit', 运输中: 'in_transit', 转运中: 'in_transit',
  派送中: 'out_for_delivery', 派件中: 'out_for_delivery', 正在派送: 'out_for_delivery',
  已签收: 'delivered', 签收成功: 'delivered', 已妥投: 'delivered',
  签收失败: 'exception', 派送失败: 'exception', 拒收: 'exception', 异常: 'exception',
}
const negativeDelivery = /(?:尚未|未|没有|待|等待)(?:完成|成功)?签收|未妥投|尚未送达/

function descriptionStatus(description: string): TrackingEventStatus {
  if (/(?:签收|派送|配送|揽收)失败|拒收|拒签|已退回|退运中|快件异常|滞留|丢失|破损/.test(description)) return 'exception'
  if (/(?:尚未|未|没有|待)(?:被)?(?:成功)?(?:揽收|收取|取件)/.test(description)) return 'waybill_created'
  if (!negativeDelivery.test(description) && /已签收|签收成功|已妥投|本人签收|收件人已收件/.test(description)) return 'delivered'
  if (/正在派送|派送中|派件中|正在派件|正在为您派/.test(description)) return 'out_for_delivery'
  if (/已揽收|已收取|已取件|运输中|转运中|已发出|已到达|已装车|已发车/.test(description)) return 'in_transit'
  return 'unknown'
}

export function normalizeTrackingStatus(input: TrackingStatusInput): TrackingEventStatus {
  const first = input.firstStatusName?.trim() || ''
  const secondary = input.secondaryStatusName?.trim() || ''
  const code = input.opCode?.trim() || ''
  const lookup = (values: Record<string, TrackingEventStatus>, key: string) => Object.hasOwn(values, key) ? values[key] : undefined
  const structured = new Set([lookup(namedStatuses, first), lookup(namedStatuses, secondary), lookup(operationStatuses, code)].filter((status): status is TrackingEventStatus => Boolean(status)))
  const description = descriptionStatus(input.description)
  const transitStatus = (status: TrackingEventStatus) => status === 'in_transit' || status === 'out_for_delivery'
  let status = [...structured][0]
  if (structured.size > 1) {
    if (structured.has('exception')) return 'exception'
    // Dispatch is a more specific transit stage, often carried by the secondary name.
    if ([...structured].every(transitStatus)) status = 'out_for_delivery'
    else return 'unknown'
  }
  // An unmapped operation code has no assigned meaning. When there is no
  // status name, an unambiguous remark may still establish the event status.
  if (!status) return first || secondary ? 'unknown' : description
  if (description === 'exception' || status === 'exception') return 'exception'
  if (status === 'delivered' && negativeDelivery.test(input.description)) return 'unknown'
  if (description !== 'unknown' && description !== status) {
    if (transitStatus(status) && transitStatus(description)) return status
    // A remark alone cannot advance a structured transit status to delivered.
    if (description === 'delivered' && (status === 'in_transit' || status === 'out_for_delivery')) return status
    return 'unknown'
  }
  return status
}

/** SF local route timestamps are China standard time, independent of host TZ. */
export function normalizeTrackingTime(raw: string): string | null {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})([ T])(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(raw.trim())
  if (!match) return null
  const [, yearText, monthText, dayText, separator, hourText, minuteText, secondText, fraction, zone] = match
  if (!zone && (separator !== ' ' || !secondText)) return null
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText || '0'].map(Number)
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null
  const local = new Date(0)
  local.setUTCFullYear(year, month - 1, day)
  local.setUTCHours(hour, minute, second, Number((fraction || '').padEnd(3, '0')))
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day) return null
  let offsetMinutes = 8 * 60
  if (zone === 'Z') offsetMinutes = 0
  else if (zone) {
    const offset = /^([+-])(\d{2}):?(\d{2})$/.exec(zone)!
    const hours = Number(offset[2]), minutes = Number(offset[3])
    if (hours > 23 || minutes > 59) return null
    offsetMinutes = (hours * 60 + minutes) * (offset[1] === '+' ? 1 : -1)
  }
  const timestamp = local.getTime() - offsetMinutes * 60_000
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

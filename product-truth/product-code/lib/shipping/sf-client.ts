// REQ: F054. SF standard API protocol. Verify account-specific permissions in sandbox before release.
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { requireShippingConnection, ShippingError } from './config'
import type { ShippingInput, TrackingResult } from './types'
export function sfDigest(message: string, timestamp: string, checkWord: string) {
  // Java URLEncoder / PHP urlencode compatible UTF-8 form encoding, then raw MD5 + Base64.
  const encoded = new URLSearchParams({ v: message + timestamp + checkWord }).toString().slice(2)
  return createHash('md5').update(encoded).digest('base64')
}
const envelope = z.object({ apiResultCode: z.string(), apiResultData: z.union([z.string(), z.record(z.string(), z.unknown())]).optional() })
const business = z.object({ success: z.union([z.boolean(), z.enum(['true', 'false'])]), errorCode: z.string().optional(), msgData: z.unknown().optional() })
export function decodeSfResponse(raw: unknown): unknown {
  const outer = envelope.parse(raw)
  if (outer.apiResultCode !== 'A1000') throw new ShippingError(502, '顺丰接口未受理请求，请检查账号权限后再查询结果。')
  const data = business.parse(typeof outer.apiResultData === 'string' ? JSON.parse(outer.apiResultData) : outer.apiResultData)
  if (data.success !== true && data.success !== 'true') throw new ShippingError(502, '顺丰未返回成功结果，请核对资料、手机号验证或接口权限。')
  return data.msgData
}
export async function sfCall(serviceCode: string, message: unknown): Promise<unknown> {
  const config = requireShippingConnection(serviceCode === 'EXP_RECE_CREATE_ORDER')
  const timestamp = Date.now().toString(), msgData = JSON.stringify(message)
  const body = new URLSearchParams({ partnerID: config.partner, requestID: randomUUID(), serviceCode, timestamp, msgData, msgDigest: sfDigest(msgData, timestamp, config.checkWord) })
  const url = config.environment === 'sandbox' ? 'https://sfapi-sbox.sf-express.com/std/service' : 'https://sfapi.sf-express.com/std/service'
  const started = Date.now()
  let upstreamStatus: number | undefined
  try {
    const response = await fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, signal: AbortSignal.timeout(12000), cache: 'no-store', redirect: 'error' })
    upstreamStatus = response.status
    if (!response.ok) throw new Error('upstream status')
    return decodeSfResponse(await response.json())
  } catch (error) {
    if (error instanceof ShippingError) throw error
    // Only transport metadata: never log request bodies, credentials or customer details.
    const failure = error as { name?: string; cause?: { code?: string } }
    console.error('shipping.sf.transport', { serviceCode, environment: config.environment, upstreamStatus, elapsedMs: Date.now() - started, errorType: failure?.name, networkCode: /^[A-Z0-9_]+$/.test(failure?.cause?.code || '') ? failure.cause?.code : undefined })
    throw new ShippingError(502, '顺丰响应超时或格式异常，请查询原请求结果，勿重复寄件。')
  }
}
export function buildSfOrder(orderId: string, input: ShippingInput, monthlyCard: string) {
  // Missing payment is only for recovery of legacy monthly-payment snapshots.
  const payment = input.payment || 'sender_monthly'
  if (payment === 'sender_monthly' && !monthlyCard) throw new ShippingError(400, '月结付款尚未配置，请选择现结或到付。', 'validation')
  return { orderId, language: 'zh-CN', ...(payment === 'sender_monthly' ? { monthlyCard } : {}), payMethod: payment === 'recipient' ? 2 : 1, expressTypeId: input.serviceId, parcelQty: 1, totalWeight: input.weight, isDocall: 1, remark: input.remark,
    cargoDetails: [{ name: input.cargo, count: 1, unit: '件', weight: input.weight }],
    contactInfoList: [input.sender, input.recipient].map((c, i) => ({ contactType: i + 1, contact: c.name, tel: c.phone, country: 'CN', province: c.province, city: c.city, county: c.county, address: c.address })) }
}
const orderResult = z.object({ orderId: z.string(), waybillNoInfoList: z.array(z.object({ waybillType: z.number().optional(), waybillNo: z.string().min(1) })).optional() })
export function extractOrder(raw: unknown, expectedId: string) {
  const data = orderResult.parse(raw)
  if (data.orderId !== expectedId) throw new ShippingError(502, '顺丰返回的请求编号不一致，结果待确认。')
  return data.waybillNoInfoList?.find(x => x.waybillType === 1)?.waybillNo || data.waybillNoInfoList?.[0]?.waybillNo || null
}
export async function createSfOrder(id: string, input: ShippingInput) {
  return extractOrder(await sfCall('EXP_RECE_CREATE_ORDER', buildSfOrder(id, input, requireShippingConnection(true).monthly)), id)
}
export async function lookupSfOrder(id: string) {
  return extractOrder(await sfCall('EXP_RECE_SEARCH_ORDER_RESP', { orderId: id, language: 'zh-CN', searchType: '1' }), id)
}
const routeData = z.object({ routeResps: z.array(z.object({ mailNo: z.string().nullable().optional(), routes: z.array(z.object({ acceptTime: z.string(), acceptAddress: z.string().nullish(), remark: z.string() })) })) })
export function extractTracking(raw: unknown, waybill: string): TrackingResult {
  const data = routeData.parse(raw)
  const match = data.routeResps.find(r => r.mailNo === waybill)
  if (!match && data.routeResps.some(r => r.routes.length)) throw new ShippingError(502, '顺丰返回的运单号不一致。')
  return { waybill, queriedAt: new Date().toISOString(), events: (match?.routes || []).map(r => ({ time: r.acceptTime, location: r.acceptAddress || '', description: r.remark })).sort((a, b) => b.time.localeCompare(a.time)) }
}
export async function querySfTracking(waybill: string, phoneSuffix?: string) {
  return extractTracking(await sfCall('EXP_RECE_SEARCH_ROUTES', { language: '0', trackingType: '1', trackingNumber: [waybill], methodType: '1', ...(phoneSuffix ? { checkPhoneNo: phoneSuffix } : {}) }), waybill)
}

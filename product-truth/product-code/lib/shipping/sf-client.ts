// REQ: F054. SF standard API protocol. Verify account-specific permissions in sandbox before release.
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ShippingError } from './config'
import type { ShippingInput, TrackingResult } from './types'
import type { ShippingRuntimeConfig } from './runtime-config'
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
  if (data.success !== true && data.success !== 'true') throw new ShippingError(422, `顺丰拒绝受理${data.errorCode ? `（${data.errorCode}）` : ''}，请核对资料或接口权限。`, 'provider_rejected')
  return data.msgData
}
export async function sfCall(serviceCode: string, message: unknown, config: Pick<ShippingRuntimeConfig, 'environment' | 'partnerId' | 'checkWord'>): Promise<unknown> {
  const timestamp = Date.now().toString(), msgData = JSON.stringify(message)
  const body = new URLSearchParams({ partnerID: config.partnerId, requestID: randomUUID(), serviceCode, timestamp, msgData, msgDigest: sfDigest(msgData, timestamp, config.checkWord) })
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

/**
 * Performs a signed, read-only sandbox order-result query with a synthetic ID.
 * This checks transport/signature acceptance without creating a shipment.
 * It does not prove that create, tracking, or cancellation permissions are enabled.
 */
export async function probeSfSandbox(partnerId: string, checkWord: string) {
  const serviceCode = 'EXP_RECE_SEARCH_ORDER_RESP'
  const timestamp = Date.now().toString()
  const msgData = JSON.stringify({ orderId: randomUUID(), language: 'zh-CN', searchType: '1' })
  const body = new URLSearchParams({ partnerID: partnerId, requestID: randomUUID(), serviceCode, timestamp, msgData, msgDigest: sfDigest(msgData, timestamp, checkWord) })
  let response: Response
  try {
    response = await fetch('https://sfapi-sbox.sf-express.com/std/service', {
      method: 'POST', body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      signal: AbortSignal.timeout(12000), cache: 'no-store', redirect: 'error'
    })
  } catch {
    return { connected: false, message: '无法连接顺丰沙盒，请检查网络和机器凭据。' }
  }
  if (!response.ok) return { connected: false, message: '顺丰沙盒未接受连接请求，请检查服务端响应和机器凭据。' }
  let raw: unknown
  try { raw = await response.json() } catch { return { connected: false, message: '顺丰沙盒返回无法识别的响应。' } }
  let outer: z.infer<typeof envelope>
  try { outer = envelope.parse(raw) } catch { return { connected: false, message: '顺丰沙盒返回无法识别的响应。' } }
  if (outer.apiResultCode !== 'A1000') return { connected: false, message: '顺丰沙盒拒绝了签名请求，请核对PartnerID和CheckWord。' }
  // A successful envelope may contain a business-level “order not found” result
  // because this probe deliberately uses a one-time synthetic order ID.
  try { business.parse(typeof outer.apiResultData === 'string' ? JSON.parse(outer.apiResultData) : outer.apiResultData) }
  catch { return { connected: false, message: '顺丰沙盒返回无法识别的响应。' } }
  return { connected: true, message: '顺丰沙盒已接受只读签名请求；此结果不代表下单、轨迹或取消权限已开通。' }
}
export function buildSfOrder(orderId: string, input: ShippingInput, monthlyCard: string) {
  if (!input.serviceId) throw new ShippingError(400, '请先选择已授权的承运商服务产品。', 'validation')
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
export async function createSfOrder(id: string, input: ShippingInput, config: ShippingRuntimeConfig) {
  return extractOrder(await sfCall('EXP_RECE_CREATE_ORDER', buildSfOrder(id, input, config.billingAccount), config), id)
}
export async function lookupSfOrder(id: string, config: ShippingRuntimeConfig) {
  return extractOrder(await sfCall('EXP_RECE_SEARCH_ORDER_RESP', { orderId: id, language: 'zh-CN', searchType: '1' }, config), id)
}
const cancelResult = z.object({ orderId: z.string() })
export function extractCancellation(raw: unknown, expectedId: string) {
  const data = cancelResult.parse(raw)
  if (data.orderId !== expectedId) throw new ShippingError(502, '顺丰返回的取消订单编号不一致，请人工核对。')
  return true
}
export async function cancelSfOrder(orderId: string, config: ShippingRuntimeConfig) {
  return extractCancellation(await sfCall('EXP_RECE_UPDATE_ORDER', { orderId, dealType: 2, language: 'zh-CN' }, config), orderId)
}
const routeData = z.object({ routeResps: z.array(z.object({ mailNo: z.string().nullable().optional(), routes: z.array(z.object({ acceptTime: z.string(), acceptAddress: z.string().nullish(), remark: z.string() })) })) })
export function extractTracking(raw: unknown, waybill: string): TrackingResult {
  const data = routeData.parse(raw)
  const match = data.routeResps.find(r => r.mailNo === waybill)
  if (!match && data.routeResps.some(r => r.routes.length)) throw new ShippingError(502, '顺丰返回的运单号不一致。')
  return { waybill, queriedAt: new Date().toISOString(), events: (match?.routes || []).map(r => ({ time: r.acceptTime, location: r.acceptAddress || '', description: r.remark })).sort((a, b) => b.time.localeCompare(a.time)) }
}
export async function querySfTracking(waybill: string, phoneSuffix: string | undefined, config: ShippingRuntimeConfig) {
  return extractTracking(await sfCall('EXP_RECE_SEARCH_ROUTES', { language: '0', trackingType: '1', trackingNumber: [waybill], methodType: '1', ...(phoneSuffix ? { checkPhoneNo: phoneSuffix } : {}) }, config), waybill)
}

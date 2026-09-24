// REQ: F054. SF OAuth2 API protocol. Verify account-specific permissions in sandbox before release.
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ShippingError } from './config'
import type { ShippingInput, TrackingResult } from './types'
import type { ShippingRuntimeConfig } from './runtime-config'
const envelope = z.object({ apiResultCode: z.string(), apiResultData: z.union([z.string(), z.record(z.string(), z.unknown())]).optional() })
const business = z.object({ success: z.union([z.boolean(), z.enum(['true', 'false'])]), errorCode: z.string().optional(), msgData: z.unknown().optional() })
const tokenResponse = z.object({ apiResultCode: z.string(), accessToken: z.string().min(1).nullable().optional(), expiresIn: z.number().int().positive().max(86400).nullable().optional() })
type SfAuthConfig = Pick<ShippingRuntimeConfig, 'environment' | 'partnerId' | 'checkWord'>
const tokenCache = new Map<string, { accessToken: string; expiresAt: number }>()
const tokenRequests = new Map<string, Promise<string>>()
const tokenRefreshMarginMs = 60_000

function sfBaseUrl(environment: SfAuthConfig['environment']) {
  return environment === 'sandbox' ? 'https://sfapi-sbox.sf-express.com' : 'https://bspgw.sf-express.com'
}

async function getSfAccessToken(config: SfAuthConfig): Promise<string> {
  const cacheKey = createHash('sha256').update(`${config.environment}\0${config.partnerId}\0${config.checkWord}`).digest('hex')
  const now = Date.now()
  const cached = tokenCache.get(cacheKey)
  if (cached && cached.expiresAt > now + tokenRefreshMarginMs) return cached.accessToken
  const activeRequest = tokenRequests.get(cacheKey)
  if (activeRequest) return activeRequest

  const request = (async () => {
    const body = new URLSearchParams({ partnerID: config.partnerId, secret: config.checkWord, grantType: 'password' })
    const startedAt = Date.now()
    const tokenUrl = `${sfBaseUrl(config.environment)}/oauth2/accessToken`
    let response: Response
    try {
      response = await fetch(tokenUrl, {
        method: 'POST', body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        signal: AbortSignal.timeout(12000), cache: 'no-store', redirect: 'error'
      })
    } catch (error) {
      const failure = error as { name?: string; cause?: { code?: string } }
      const networkCode = failure?.cause?.code
      console.error('shipping.sf.oauth_transport', {
        environment: config.environment,
        elapsedMs: Date.now() - startedAt,
        errorType: failure?.name,
        networkCode: /^[A-Z0-9_]+$/.test(networkCode || '') ? networkCode : undefined
      })
      throw new ShippingError(502, '无法连接顺丰OAuth2认证服务，请稍后重试。')
    }
    if (!response.ok) {
      console.error('shipping.sf.oauth_http', { environment: config.environment, upstreamStatus: response.status, elapsedMs: Date.now() - startedAt })
      throw new ShippingError(502, '顺丰OAuth2认证服务暂不可用，请稍后重试。')
    }
    let parsed: z.infer<typeof tokenResponse>
    try { parsed = tokenResponse.parse(await response.json()) }
    catch { throw new ShippingError(502, '顺丰OAuth2认证服务返回无法识别的响应。') }
    if (parsed.apiResultCode !== 'A1000' || !parsed.accessToken || !parsed.expiresIn) {
      throw new ShippingError(502, '顺丰OAuth2认证失败，请检查PartnerID、CheckWord和应用授权。')
    }
    tokenCache.set(cacheKey, { accessToken: parsed.accessToken, expiresAt: Date.now() + parsed.expiresIn * 1000 })
    return parsed.accessToken
  })()
  tokenRequests.set(cacheKey, request)
  try { return await request }
  finally { tokenRequests.delete(cacheKey) }
}
export function decodeSfResponse(raw: unknown): unknown {
  const outer = envelope.parse(raw)
  if (outer.apiResultCode !== 'A1000') throw new ShippingError(502, '顺丰接口未受理请求，请检查账号权限后再查询结果。')
  const data = business.parse(typeof outer.apiResultData === 'string' ? JSON.parse(outer.apiResultData) : outer.apiResultData)
  if (data.success !== true && data.success !== 'true') throw new ShippingError(422, `顺丰拒绝受理${data.errorCode ? `（${data.errorCode}）` : ''}，请核对资料或接口权限。`, 'provider_rejected')
  return data.msgData
}
async function postSfService(serviceCode: string, message: unknown, config: SfAuthConfig, accessToken: string): Promise<unknown> {
  const timestamp = Date.now().toString(), msgData = JSON.stringify(message)
  const body = new URLSearchParams({ partnerID: config.partnerId, requestID: randomUUID(), serviceCode, timestamp, accessToken, msgData })
  const url = `${sfBaseUrl(config.environment)}/std/service`
  const started = Date.now()
  let upstreamStatus: number | undefined
  try {
    const response = await fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, signal: AbortSignal.timeout(12000), cache: 'no-store', redirect: 'error' })
    upstreamStatus = response.status
    if (!response.ok) throw new Error('upstream status')
    return await response.json()
  } catch (error) {
    if (error instanceof ShippingError) throw error
    // Only transport metadata: never log request bodies, credentials or customer details.
    const failure = error as { name?: string; cause?: { code?: string } }
    console.error('shipping.sf.transport', { serviceCode, environment: config.environment, upstreamStatus, elapsedMs: Date.now() - started, errorType: failure?.name, networkCode: /^[A-Z0-9_]+$/.test(failure?.cause?.code || '') ? failure.cause?.code : undefined })
    throw new ShippingError(502, '顺丰响应超时或格式异常，请查询原请求结果，勿重复寄件。')
  }
}

export async function sfCall(serviceCode: string, message: unknown, config: Pick<ShippingRuntimeConfig, 'environment' | 'partnerId' | 'checkWord'>): Promise<unknown> {
  const accessToken = await getSfAccessToken(config)
  return decodeSfResponse(await postSfService(serviceCode, message, config, accessToken))
}

/**
 * Checks sandbox OAuth2 credentials only. It never creates a shipment and does not
 * prove that create, tracking, or cancellation permissions are enabled.
 */
export async function probeSfSandbox(partnerId: string, checkWord: string) {
  const config: SfAuthConfig = { environment: 'sandbox', partnerId, checkWord }
  try {
    const accessToken = await getSfAccessToken(config)
    const raw = await postSfService('EXP_RECE_SEARCH_ORDER_RESP', { orderId: randomUUID(), language: 'zh-CN', searchType: '1' }, config, accessToken)
    let outer: z.infer<typeof envelope>
    try { outer = envelope.parse(raw) }
    catch { return { connected: false, message: '顺丰沙盒OAuth2已认证，但只读API返回无法识别的响应；未创建运单。' } }
    if (outer.apiResultCode === 'A1000') {
      try { business.parse(typeof outer.apiResultData === 'string' ? JSON.parse(outer.apiResultData) : outer.apiResultData) }
      catch { return { connected: false, message: '顺丰沙盒OAuth2已认证，但只读API返回无法识别的响应；未创建运单。' } }
      return { connected: true, message: '顺丰沙盒OAuth2认证及只读API连通通过；未创建运单，也不代表下单、轨迹或取消权限已开通。' }
    }
    if (outer.apiResultCode === 'A1011') {
      return { connected: false, message: '顺丰OAuth2令牌未被标准接口接受；请检查应用鉴权配置。未创建运单。' }
    }
    // Token success is distinct from API permissions. An API-level denial still
    // establishes credential connectivity; individual capabilities stay unverified.
    return { connected: true, message: '顺丰沙盒OAuth2认证通过；只读查询接口未受理，业务接口权限仍需分别核验。未创建运单。' }
  } catch (error) {
    if (error instanceof ShippingError && error.message.includes('OAuth2认证')) return { connected: false, message: error.message }
    return { connected: false, message: '顺丰沙盒OAuth2/只读API连通失败；未创建运单。' }
  }
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

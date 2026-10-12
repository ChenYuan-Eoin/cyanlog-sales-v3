// REQ: F054. SF Node.js OAuth2 API protocol. Tokens stay in process memory only.
import { createHash, randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import { z } from 'zod'
import { ShippingError } from './config'
import type { ShippingInput, TrackingResult } from './types'
import type { ShippingRuntimeConfig } from './runtime-config'
import { normalizeTrackingStatus, normalizeTrackingTime } from './tracking-status'
const envelope = z.object({ apiResultCode: z.string(), apiResultData: z.union([z.string(), z.record(z.string(), z.unknown())]).optional() })
const business = z.object({ success: z.union([z.boolean(), z.enum(['true', 'false'])]), errorCode: z.string().optional(), msgData: z.unknown().optional(), obj: z.unknown().optional() })
const tokenResponse = z.object({ apiResultCode: z.string(), accessToken: z.string().min(1).nullable().optional(), expiresIn: z.number().int().positive().max(86400).nullable().optional() })
type SfAuthConfig = Pick<ShippingRuntimeConfig, 'environment' | 'partnerId' | 'checkWord'>
const tokenCache = new Map<string, { accessToken: string; expiresAt: number }>()
const tokenRequests = new Map<string, Promise<string>>()
const tokenRefreshMarginMs = 60_000
const transportErrorCodes = new Set([
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_ABORTED',
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'EPIPE',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
])

function sfTokenUrl(environment: SfAuthConfig['environment']) {
  const origin = environment === 'sandbox' ? 'https://sfapi-sbox.sf-express.com' : 'https://bspgw.sf-express.com'
  return `${origin}/oauth2/accessToken`
}

function sfServiceUrl(environment: SfAuthConfig['environment']) {
  const origin = environment === 'sandbox' ? 'https://sfapi-sbox.sf-express.com' : 'https://sfapi.sf-express.com'
  return `${origin}/std/service`
}

function endpointMetadata(endpoint: string) {
  const region = process.env.VERCEL_REGION
  return {
    endpointHostname: new URL(endpoint).hostname,
    runtimeRegion: typeof region === 'string' && /^[a-z]{3}\d{1,2}$/.test(region) ? region : undefined,
  }
}

function transportMetadata(error: unknown, endpoint: string) {
  const asRecord = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
  const failure = asRecord(error), cause = asRecord(failure.cause)
  const attemptedAddresses: Array<{ address: string; family: 4 | 6 }> = []
  const knownAddresses = new Set<string>()
  const addAddress = (value: unknown) => {
    if (typeof value !== 'string' || value.length > 80 || attemptedAddresses.length >= 8) return
    let address = value.trim()
    // Only strip unambiguous host:port forms. A bare IPv6 address is never split at its last colon.
    if (!isIP(address)) {
      const bracketed = address.match(/^\[([0-9a-fA-F:.]+)\](?::(\d{1,5}))?$/)
      const ipv4Port = address.match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/)
      const parsed = bracketed || ipv4Port
      if (!parsed || (parsed[2] !== undefined && (Number(parsed[2]) < 1 || Number(parsed[2]) > 65535))) return
      address = parsed[1]
    }
    const family = isIP(address)
    if ((family !== 4 && family !== 6) || address.includes('%')) return
    address = address.toLowerCase()
    if (knownAddresses.has(address)) return
    knownAddresses.add(address)
    attemptedAddresses.push({ address, family })
  }
  const pending: unknown[] = [error]
  const visited = new Set<unknown>()
  // Bounded traversal also handles Node's AggregateError without serialising arbitrary error content.
  for (let index = 0; index < pending.length && index < 16; index += 1) {
    const current = pending[index]
    if (visited.has(current)) continue
    visited.add(current)
    const item = asRecord(current)
    addAddress(item.address)
    if (typeof item.message === 'string' && item.message.length <= 4096) {
      const attempted = item.message.match(/\battempted address(?:es)?:\s*([^)]*)(?:\)|$)/i)?.[1]
      if (attempted && attempted.length <= 2048) attempted.split(',').slice(0, 32).forEach(addAddress)
    }
    if (item.cause && typeof item.cause === 'object') pending.push(item.cause)
    if ((current instanceof AggregateError || item.name === 'AggregateError') && Array.isArray(item.errors)) pending.push(...item.errors.slice(0, 8))
  }
  return {
    ...endpointMetadata(endpoint),
    attemptedAddresses,
    errorType: typeof failure.name === 'string' && /^(?:Error|TypeError|AbortError|TimeoutError|AggregateError)$/.test(failure.name) ? failure.name : undefined,
    networkCode: typeof cause.code === 'string' && transportErrorCodes.has(cause.code) ? cause.code : undefined,
  }
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
    // Both endpoints are published in SF's OAuth2 guide (activeIndex=641728).
    // Fail over authentication transport only; never replay a business request here.
    const endpoints = config.environment === 'production'
      ? [sfTokenUrl(config.environment), 'https://sfapi.sf-express.com/oauth2/accessToken']
      : [sfTokenUrl(config.environment)]
    const retryableCodes = new Set(['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH'])
    let response: Response | undefined
    let responseEndpoint = endpoints[0]
    for (let attempt = 0; attempt < endpoints.length; attempt += 1) {
      responseEndpoint = endpoints[attempt]
      try {
        response = await fetch(responseEndpoint, {
          method: 'POST', body,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          signal: AbortSignal.timeout(endpoints.length > 1 ? 6000 : 12000), cache: 'no-store', redirect: 'error'
        })
        break
      } catch (error) {
        const failure = error as { name?: string; cause?: { code?: string } }
        const networkCode = failure?.cause?.code
        const timedOut = networkCode === 'UND_ERR_CONNECT_TIMEOUT' || failure?.name === 'TimeoutError' || failure?.name === 'AbortError'
        const canFailover = attempt + 1 < endpoints.length && (networkCode ? retryableCodes.has(networkCode) : timedOut)
        const metadata = { environment: config.environment, elapsedMs: Date.now() - startedAt, ...transportMetadata(error, responseEndpoint) }
        if (canFailover) { console.warn('shipping.sf.oauth_transport_fallback', metadata); continue }
        console.error('shipping.sf.oauth_transport', metadata)
        throw new ShippingError(502, timedOut ? '顺丰OAuth2认证连接超时，未收到顺丰响应。' : '无法连接顺丰OAuth2认证服务，未收到响应。', 'provider_unreachable')
      }
    }
    if (!response) throw new ShippingError(502, '顺丰认证服务未返回响应。', 'provider_unreachable')
    if (!response.ok) {
      console.error('shipping.sf.oauth_http', { environment: config.environment, upstreamStatus: response.status, elapsedMs: Date.now() - startedAt })
      throw new ShippingError(502, `顺丰OAuth2认证服务返回HTTP错误（${response.status}）。`, 'provider_http_error')
    }
    let parsed: z.infer<typeof tokenResponse>
    try { parsed = tokenResponse.parse(await response.json()) }
    catch { throw new ShippingError(502, '顺丰OAuth2认证服务返回无法识别的响应。', 'provider_invalid_response') }
    if (parsed.apiResultCode !== 'A1000' || !parsed.accessToken || !parsed.expiresIn) {
      throw new ShippingError(502, '顺丰OAuth2认证失败，请检查PartnerID、CheckWord和应用授权。', 'provider_rejected')
    }
    if (responseEndpoint !== endpoints[0]) console.info('shipping.sf.oauth_fallback_succeeded', { ...endpointMetadata(responseEndpoint), elapsedMs: Date.now() - startedAt })
    tokenCache.set(cacheKey, { accessToken: parsed.accessToken, expiresAt: Date.now() + parsed.expiresIn * 1000 })
    return parsed.accessToken
  })()
  tokenRequests.set(cacheKey, request)
  try { return await request }
  finally { tokenRequests.delete(cacheKey) }
}
export function decodeSfResponse(raw: unknown, payloadField: 'msgData' | 'obj' = 'msgData'): unknown {
  const outer = envelope.parse(raw)
  if (outer.apiResultCode !== 'A1000') {
    const code = /^[A-Z0-9_]{1,20}$/.test(outer.apiResultCode) ? outer.apiResultCode : 'unknown'
    throw new ShippingError(502, `顺丰接口未受理请求（${code}），请检查账号权限。`, 'provider_rejected')
  }
  const data = business.parse(typeof outer.apiResultData === 'string' ? JSON.parse(outer.apiResultData) : outer.apiResultData)
  if (data.success !== true && data.success !== 'true') throw new ShippingError(422, data.errorCode === '6150' ? '顺丰未找到该订单（6150）。' : `顺丰拒绝受理${data.errorCode ? `（${data.errorCode}）` : ''}，请核对资料或接口权限。`, 'provider_rejected')
  return data[payloadField]
}
async function postSfService(serviceCode: string, message: unknown, config: SfAuthConfig, accessToken: string): Promise<unknown> {
  const timestamp = Date.now().toString(), msgData = JSON.stringify(message)
  const body = new URLSearchParams({ partnerID: config.partnerId, requestID: randomUUID(), serviceCode, timestamp, accessToken, msgData })
  const url = sfServiceUrl(config.environment)
  const started = Date.now()
  let response: Response
  try {
    response = await fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, signal: AbortSignal.timeout(12000), cache: 'no-store', redirect: 'error' })
  } catch (error) {
    // Only transport metadata: never log request bodies, credentials or customer details.
    const failure = error as { name?: string; cause?: { code?: string } }
    console.error('shipping.sf.transport', { serviceCode, environment: config.environment, upstreamStatus: undefined, elapsedMs: Date.now() - started, ...transportMetadata(error, url) })
    const timedOut = failure?.cause?.code === 'UND_ERR_CONNECT_TIMEOUT' || failure?.name === 'TimeoutError' || failure?.name === 'AbortError'
    throw new ShippingError(502, timedOut ? '顺丰网关连接超时，未收到顺丰响应。' : '无法连接顺丰网关，未收到顺丰响应。', 'provider_unreachable')
  }
  const upstreamStatus = response.status
  console.info('shipping.sf.response', { serviceCode, environment: config.environment, ...endpointMetadata(url), status: upstreamStatus, elapsedMs: Date.now() - started })
  if (!response.ok) {
    console.error('shipping.sf.http', { serviceCode, environment: config.environment, upstreamStatus, elapsedMs: Date.now() - started })
    throw new ShippingError(502, `顺丰标准接口返回HTTP错误（${response.status}），连接未验证。`, 'provider_http_error')
  }
  try { return await response.json() }
  catch {
    console.error('shipping.sf.invalid_response', { serviceCode, environment: config.environment, upstreamStatus, elapsedMs: Date.now() - started })
    throw new ShippingError(502, '顺丰标准接口返回无法识别的响应，连接未验证。', 'provider_invalid_response')
  }
}

export async function sfCall(serviceCode: string, message: unknown, config: Pick<ShippingRuntimeConfig, 'environment' | 'partnerId' | 'checkWord'>, payloadField: 'msgData' | 'obj' = 'msgData'): Promise<unknown> {
  const accessToken = await getSfAccessToken(config)
  return decodeSfResponse(await postSfService(serviceCode, message, config, accessToken), payloadField)
}

/**
 * Checks sandbox OAuth2 credentials using a read-only standard API call. It never creates a shipment and does not
 * prove that create, tracking, or cancellation permissions are enabled.
 */
export async function probeSfConnection(environment: SfAuthConfig['environment'], partnerId: string, checkWord: string) {
  const config: SfAuthConfig = { environment, partnerId, checkWord }
  const environmentName = environment === 'sandbox' ? '沙盒' : '生产'
  try {
    const accessToken = await getSfAccessToken(config)
    const raw = await postSfService('EXP_RECE_SEARCH_ORDER_RESP', { orderId: randomUUID(), language: 'zh-CN', searchType: '1' }, config, accessToken)
    let outer: z.infer<typeof envelope>
    try { outer = envelope.parse(raw) }
    catch { return { connected: false, queryVerified: false, message: `顺丰${environmentName}OAuth2已认证，但只读API返回无法识别的响应；未创建运单。` } }
    if (outer.apiResultCode === 'A1000') {
      try { business.parse(typeof outer.apiResultData === 'string' ? JSON.parse(outer.apiResultData) : outer.apiResultData) }
      catch { return { connected: false, queryVerified: false, message: `顺丰${environmentName}OAuth2已认证，但只读API返回无法识别的响应；未创建运单。` } }
      const productionNote = environment === 'production' ? '生产下单能力仍需由操作员核对每票收寄资料与费用后实测。' : '不代表下单、轨迹或取消权限已开通。'
      return { connected: true, queryVerified: true, message: `顺丰${environmentName}OAuth2认证及只读API连通通过；未创建运单。${productionNote}` }
    }
    if (outer.apiResultCode === 'A1011') return { connected: false, queryVerified: false, message: `顺丰${environmentName}OAuth2令牌未被标准接口接受；请检查应用鉴权配置。未创建运单。` }
    return { connected: true, queryVerified: false, message: `顺丰${environmentName}OAuth2认证通过；只读查询接口未受理，其他业务接口权限仍需分别核验。未创建运单。` }
  } catch (error) {
    if (error instanceof ShippingError && error.requestStage === 'provider_unreachable') {
      return { connected: false, queryVerified: false, message: `${error.message} 凭据尚未验证，也未创建运单。` }
    }
    if (error instanceof ShippingError && (error.requestStage === 'provider_http_error' || error.requestStage === 'provider_invalid_response')) {
      return { connected: false, queryVerified: false, message: `${error.message} 也未创建运单。` }
    }
    if (error instanceof ShippingError && error.requestStage === 'provider_rejected') return { connected: false, queryVerified: false, message: `${error.message} 未创建运单。` }
    return { connected: false, queryVerified: false, message: `顺丰${environmentName}标准接口连通失败；未创建运单。` }
  }
}

export async function probeSfSandbox(partnerId: string, checkWord: string) {
  const { connected, message } = await probeSfConnection('sandbox', partnerId, checkWord)
  return { connected, message }
}

export function probeSfProduction(partnerId: string, checkWord: string) {
  return probeSfConnection('production', partnerId, checkWord)
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
const routeData = z.object({ routeResps: z.array(z.object({ mailNo: z.string().nullable().optional(), routes: z.array(z.object({
  acceptTime: z.string(), acceptAddress: z.string().nullish(), remark: z.string(),
  firstStatusName: z.string().nullish(), secondaryStatusName: z.string().nullish(), opCode: z.string().nullish(),
})) })) })
export function extractTracking(raw: unknown, waybill: string): TrackingResult {
  const data = routeData.parse(raw)
  const match = data.routeResps.find(r => r.mailNo === waybill)
  if (!match && data.routeResps.some(r => r.routes.length)) throw new ShippingError(502, '顺丰返回的运单号不一致。')
  const events = (match?.routes || []).map(route => ({
    event: {
      time: route.acceptTime, location: route.acceptAddress || '', description: route.remark,
      status: normalizeTrackingStatus({ ...route, description: route.remark }),
    },
    timestamp: normalizeTrackingTime(route.acceptTime),
  })).sort((a, b) => {
    if (!a.timestamp) return b.timestamp ? 1 : 0
    if (!b.timestamp) return -1
    return Date.parse(b.timestamp) - Date.parse(a.timestamp)
  }).map(({ event }) => event)
  return { waybill, queriedAt: new Date().toISOString(), events }
}
export async function querySfTracking(waybill: string, phoneSuffix: string | undefined, config: ShippingRuntimeConfig) {
  return extractTracking(await sfCall('EXP_RECE_SEARCH_ROUTES', { language: 'zh-CN', trackingType: '1', trackingNumber: [waybill], methodType: '1', ...(phoneSuffix ? { checkPhoneNo: phoneSuffix } : {}) }, config), waybill)
}

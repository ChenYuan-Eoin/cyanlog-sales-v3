// REQ: F003 / WP92. Optional relay for read-only organization synchronization.
import { FxiaokeError } from '../contracts'
import { executeRequest, validRequest, type EgressResult } from './protocol.mjs'
import { transportForOrganization } from './server'

const relayUnavailable = new Set(['EGRESS_UNAVAILABLE', 'EGRESS_IP_CHANGED', 'EGRESS_PROVIDER_UNREACHABLE'])
const unavailable = () => new FxiaokeError(
  'DIRECTORY_SOURCE_UNAVAILABLE',
  '暂时无法读取纷享来源，本次同步未完成。已有组织架构和人员数据保留，可继续使用；请稍后重试同步。',
  503,
)

function needsAlternateRoute(result: EgressResult) {
  if ('error' in result) return result.error !== 'INVALID_RESPONSE'
  if (result.status >= 500) return true
  try {
    const body = JSON.parse(result.body)
    // An IP restriction can be satisfied by the existing approved relay. Never
    // change a provider allowlist or retry other credential/permission failures.
    return Number.isInteger(body.errorCode) && body.errorCode !== 0 && typeof body.errorMessage === 'string'
      && /\bip\b|白名单|whitelist/i.test(body.errorMessage)
  } catch { return false }
}

function response(result: EgressResult) {
  if ('error' in result) {
    if (result.error === 'INVALID_RESPONSE') throw new FxiaokeError('INVALID_RESPONSE', '纷享接口没有返回有效数据。', 502)
    throw unavailable()
  }
  return new Response([204, 205, 304].includes(result.status) ? null : result.body, {
    status: result.status, headers: { 'Content-Type': 'application/json' },
  })
}

export function directoryTransportForOrganization(orgId: string): typeof fetch {
  // Local to one directory read: no stale global circuit state across tenants.
  let preferRelay = false
  return async (url, init) => {
    const input = { url: String(url), headers: Object.fromEntries(new Headers(init?.headers).entries()), body: init?.body }
    if (init?.method !== 'POST' || !validRequest(input)) {
      throw new FxiaokeError('EGRESS_REQUEST_DENIED', '此纷享接口不在组织同步允许范围内。', 403)
    }
    const body = JSON.parse(input.body)
    if (body.grantType !== 'app_secret' && body.returnTotalNum !== 1) {
      throw new FxiaokeError('EGRESS_REQUEST_DENIED', '此纷享接口不在组织同步允许范围内。', 403)
    }
    init?.signal?.throwIfAborted()

    const direct = async () => {
      const result = await executeRequest(input, (target, options) => fetch(target, {
        ...options,
        signal: AbortSignal.any([options!.signal!, ...(init?.signal ? [init.signal] : [])]),
      }), 6000)
      init?.signal?.throwIfAborted()
      return result
    }
    const relay = async () => {
      const send = transportForOrganization(orgId)
      if (!send) throw unavailable()
      return send(url, init)
    }
    const tryRelay = async () => {
      try { return await relay() } catch (error) {
        init?.signal?.throwIfAborted()
        if (error instanceof FxiaokeError && relayUnavailable.has(error.code)) throw unavailable()
        throw error
      }
    }

    if (preferRelay) {
      try { return await tryRelay() } catch (error) {
        if (!(error instanceof FxiaokeError) || error.code !== 'DIRECTORY_SOURCE_UNAVAILABLE') throw error
        const result = await direct()
        if (needsAlternateRoute(result)) throw unavailable()
        preferRelay = false
        return response(result)
      }
    }
    const result = await direct()
    if (!needsAlternateRoute(result)) return response(result)
    const alternate = await tryRelay()
    preferRelay = true
    return alternate
  }
}

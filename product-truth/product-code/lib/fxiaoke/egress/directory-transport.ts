// REQ: F003 / WP92. Organization reads must not depend on the cloud computer.
import { FxiaokeError } from '../contracts'
import { executeRequest, validRequest, type EgressResult } from './protocol.mjs'
const unavailable = () => new FxiaokeError(
  'DIRECTORY_SOURCE_UNAVAILABLE',
  '暂时无法读取纷享来源，本次同步未完成。已有组织架构和人员数据保留，可继续使用；请稍后重试同步。',
  503,
)

function response(result: EgressResult) {
  if ('error' in result) {
    if (result.error === 'INVALID_RESPONSE') throw new FxiaokeError('INVALID_RESPONSE', '纷享接口没有返回有效数据。', 502)
    throw unavailable()
  }
  return new Response([204, 205, 304].includes(result.status) ? null : result.body, {
    status: result.status, headers: { 'Content-Type': 'application/json' },
  })
}

export function directoryTransportForOrganization(_orgId: string): typeof fetch {
  return async (url, init) => {
    const input = { url: String(url), headers: Object.fromEntries(new Headers(init?.headers).entries()), body: init?.body }
    if (init?.method !== 'POST' || !validRequest(input)) {
      throw new FxiaokeError('EGRESS_REQUEST_DENIED', '此纷享接口不在组织同步允许范围内。', 403)
    }
    // validRequest() is the complete allowlist for the fixed token, directory
    // query, and read-only object metadata shapes. Directory/metadata reads
    // never accept the superset protocol's OAuth authorization-code grant.
    if (JSON.parse(input.body).grantType === 'authorization_code') {
      throw new FxiaokeError('EGRESS_REQUEST_DENIED', '此纷享接口不在组织同步允许范围内。', 403)
    }
    init?.signal?.throwIfAborted()

    const result = await executeRequest(input, (target, options) => fetch(target, {
      ...options,
      signal: AbortSignal.any([options!.signal!, ...(init?.signal ? [init.signal] : [])]),
    }), 6000)
    init?.signal?.throwIfAborted()
    return response(result)
  }
}

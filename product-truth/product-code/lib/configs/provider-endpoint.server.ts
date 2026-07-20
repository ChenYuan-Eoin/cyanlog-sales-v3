import {
  openOutboundSession,
  OutboundPolicyError,
  type OutboundPolicyErrorCode,
  type ResolveHost,
} from '../security/outbound-http'
import {
  type ProviderRuntimeLocation,
  UnsafeProviderEndpointError,
  validateProviderEndpointLocation,
} from './provider-endpoint'

export type ResolvedProviderAddress = { address: string; family: 4 | 6 }
export type ProviderDnsLookup = (hostname: string) => Promise<ResolvedProviderAddress[]>

export interface SafeProviderProbeTransport {
  baseUrl: string
  fetch: typeof fetch
  close: () => Promise<void>
  pinnedAddresses: readonly ResolvedProviderAddress[]
}

const OUTBOUND_ERROR_MESSAGES: Partial<Record<OutboundPolicyErrorCode, string>> = {
  INVALID_URL: 'Provider 地址格式无效。',
  UNSAFE_PROTOCOL: '云端 Provider 必须使用 HTTPS。',
  URL_CREDENTIALS_FORBIDDEN: 'Provider 地址不能携带用户名或密码。',
  URL_FRAGMENT_FORBIDDEN: 'Provider 地址不能携带片段。',
  IP_LITERAL_FORBIDDEN: '云端 Provider 必须使用可审计的公网域名。',
  METADATA_HOST_FORBIDDEN: 'Provider 地址不能指向云元数据服务。',
  LOCAL_ENDPOINT_FORBIDDEN: '本地 Provider 仅允许在显式启用并配置精确来源白名单的开发环境探测。',
  DNS_RESOLUTION_FAILED: 'Provider 域名无法解析。',
  DNS_RESOLUTION_TIMEOUT: 'Provider 域名解析超时。',
  DNS_NO_ADDRESSES: 'Provider 域名没有可用地址。',
  NON_PUBLIC_ADDRESS: '云端 Provider 域名解析到非公网地址，已阻止探测。',
  PINNED_HOST_MISMATCH: 'Provider 连接地址与已校验域名不一致。',
  CROSS_ORIGIN_FORBIDDEN: 'Provider 请求不能跳转到其他来源。',
  REDIRECT_BLOCKED: 'Provider 返回了重定向，已阻止探测。',
  RESPONSE_TOO_LARGE: 'Provider 响应超过安全大小限制。',
  UNSAFE_HEADER_FORBIDDEN: 'Provider 请求包含不安全的传输头。',
  SESSION_CLOSED: 'Provider 探测会话已关闭。',
}

function endpointError(error: unknown): UnsafeProviderEndpointError {
  if (error instanceof OutboundPolicyError) {
    return new UnsafeProviderEndpointError(
      OUTBOUND_ERROR_MESSAGES[error.code] || 'Provider 地址安全校验失败。',
    )
  }
  if (error instanceof UnsafeProviderEndpointError) return error
  return new UnsafeProviderEndpointError('Provider 地址安全校验失败。')
}

/**
 * Reuse the repository-wide outbound HTTP boundary instead of maintaining a
 * second SSRF implementation. The shared session resolves with a deadline,
 * validates every address, pins DNS, rejects redirects/cross-origin requests,
 * limits response size and only allows loopback in an explicit development
 * allowlist.
 */
export async function createSafeProviderProbeTransport(
  rawBaseUrl: string,
  runtimeLocation: ProviderRuntimeLocation,
  lookup?: ProviderDnsLookup,
  fetchImpl?: typeof fetch,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<SafeProviderProbeTransport> {
  const locationCheck = validateProviderEndpointLocation(rawBaseUrl, runtimeLocation)
  if (!locationCheck.valid) {
    throw new UnsafeProviderEndpointError(locationCheck.reason)
  }

  const transportUrl = new URL(locationCheck.canonicalBaseUrl)
  // The shared boundary deliberately allowlists literal loopback origins. Keep
  // localhost convenient for administrators while making the actual transport
  // and LOCAL_AI_ALLOWED_ORIGINS comparison explicit and deterministic.
  if (runtimeLocation === 'local' && transportUrl.hostname === 'localhost') {
    transportUrl.hostname = '127.0.0.1'
  }

  const resolveHost: ResolveHost | undefined = lookup
    ? async (hostname) => lookup(hostname)
    : undefined

  try {
    const session = await openOutboundSession(
      transportUrl,
      {
        purpose: 'ai-provider',
        allowLocalDevelopment: runtimeLocation === 'local',
      },
      {
        resolveHost,
        env,
        fetchImpl: fetchImpl as never,
        dnsResolutionTimeoutMs: 5_000,
        requestTimeoutMs: 300_000,
        maxResponseSizeBytes: 4 * 1024 * 1024,
      },
    )

    return {
      baseUrl: session.target.url.href.replace(/\/$/, ''),
      fetch: session.fetch,
      close: () => session.close(),
      pinnedAddresses: session.target.addresses.map(({ address, family }) => ({ address, family })),
    }
  } catch (error) {
    throw endpointError(error)
  }
}

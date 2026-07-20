import ipaddr from 'ipaddr.js'
import { normalizeOpenAICompatibleBaseUrl } from '@/lib/ai/openai-compatible'

export type ProviderRuntimeLocation = 'local' | 'cloud'

export class UnsafeProviderEndpointError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeProviderEndpointError'
  }
}

export function normalizedProviderHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
}

export function parseProviderIp(hostname: string): ipaddr.IPv4 | ipaddr.IPv6 | null {
  const normalized = normalizedProviderHostname(hostname)
  if (!ipaddr.isValid(normalized)) return null
  return ipaddr.parse(normalized)
}

export function isLoopbackProviderAddress(address: ipaddr.IPv4 | ipaddr.IPv6): boolean {
  if (address.kind() === 'ipv6' && address.range() === 'ipv4Mapped') {
    return isLoopbackProviderAddress((address as ipaddr.IPv6).toIPv4Address())
  }
  return address.range() === 'loopback'
}

export function isPublicProviderAddress(address: ipaddr.IPv4 | ipaddr.IPv6): boolean {
  if (address.kind() === 'ipv6' && address.range() === 'ipv4Mapped') {
    return isPublicProviderAddress((address as ipaddr.IPv6).toIPv4Address())
  }
  return address.range() === 'unicast'
}

function parseCanonicalUrl(rawBaseUrl: string): URL {
  const trimmed = rawBaseUrl.trim()
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new UnsafeProviderEndpointError('Provider 地址必须是完整 URL。')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UnsafeProviderEndpointError('Provider 地址只允许 HTTP 或 HTTPS 协议。')
  }
  if (parsed.username || parsed.password) {
    throw new UnsafeProviderEndpointError('Provider 地址不能在 URL 中携带用户名或密码。')
  }
  if (parsed.search || parsed.hash) {
    throw new UnsafeProviderEndpointError('Provider 地址不能携带查询参数或片段。')
  }

  return new URL(normalizeOpenAICompatibleBaseUrl(parsed.toString()))
}

export function canonicalizeProviderBaseUrl(rawBaseUrl: string): string {
  return parseCanonicalUrl(rawBaseUrl).toString().replace(/\/$/, '')
}

/**
 * Synchronous location check used by persistence validation. DNS is checked
 * separately immediately before a probe so configuration never mistakes a
 * hostname for a trusted network destination.
 */
export function validateProviderEndpointLocation(
  rawBaseUrl: string,
  runtimeLocation: ProviderRuntimeLocation,
): { valid: true; canonicalBaseUrl: string } | { valid: false; reason: string } {
  try {
    const parsed = parseCanonicalUrl(rawBaseUrl)
    const hostname = normalizedProviderHostname(parsed.hostname)
    const address = parseProviderIp(hostname)

    if (runtimeLocation === 'local') {
      const loopback = hostname === 'localhost' || (address !== null && isLoopbackProviderAddress(address))
      if (!loopback) {
        return { valid: false, reason: '本地 Provider 只允许 localhost 或回环 IP。' }
      }
    } else {
      if (parsed.protocol !== 'https:') {
        return { valid: false, reason: '云端 Provider 只允许 HTTPS 地址。' }
      }
      if (hostname === 'localhost' || (address !== null && !isPublicProviderAddress(address))) {
        return { valid: false, reason: '云端 Provider 不能指向回环、私网、链路本地或保留地址。' }
      }
    }

    return {
      valid: true,
      canonicalBaseUrl: parsed.toString().replace(/\/$/, ''),
    }
  } catch (error) {
    return {
      valid: false,
      reason: error instanceof Error ? error.message : 'Provider 地址无效。',
    }
  }
}

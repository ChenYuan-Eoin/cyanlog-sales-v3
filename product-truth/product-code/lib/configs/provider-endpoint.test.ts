import { describe, expect, it, vi } from 'vitest'
import {
  canonicalizeProviderBaseUrl,
  validateProviderEndpointLocation,
} from './provider-endpoint'
import { createSafeProviderProbeTransport } from './provider-endpoint.server'

describe('Provider endpoint safety', () => {
  it('canonicalizes equivalent OpenAI-compatible base URLs', () => {
    expect(canonicalizeProviderBaseUrl('  https://EXAMPLE.com/  ')).toBe('https://example.com/v1')
    expect(canonicalizeProviderBaseUrl('https://example.com/v1///')).toBe('https://example.com/v1')
  })

  it.each([
    'http://127.0.0.1:1234/v1',
    'http://[::1]:1234/v1',
    'http://localhost:1234/v1',
  ])('allows loopback-only local endpoints: %s', (baseUrl) => {
    expect(validateProviderEndpointLocation(baseUrl, 'local').valid).toBe(true)
  })

  it.each([
    'http://0.0.0.0:1234/v1',
    'http://10.0.0.8:1234/v1',
    'https://provider.example/v1',
  ])('rejects non-loopback endpoints declared as local: %s', (baseUrl) => {
    expect(validateProviderEndpointLocation(baseUrl, 'local').valid).toBe(false)
  })

  it.each([
    'http://8.8.8.8/v1',
    'https://127.0.0.1/v1',
    'https://10.0.0.1/v1',
    'https://169.254.169.254/latest',
    'https://[::1]/v1',
    'https://[fc00::1]/v1',
    'https://user:pass@example.com/v1',
    'https://example.com/v1?next=http://127.0.0.1',
  ])('rejects unsafe cloud endpoint syntax or literals: %s', (baseUrl) => {
    expect(validateProviderEndpointLocation(baseUrl, 'cloud').valid).toBe(false)
  })

  it('rejects a hostname when any DNS answer is non-public', async () => {
    await expect(createSafeProviderProbeTransport(
      'https://provider.example/v1',
      'cloud',
      async () => [
        { address: '8.8.8.8', family: 4 },
        { address: '10.0.0.5', family: 4 },
      ],
    )).rejects.toThrow('非公网地址')
  })

  it('pins the validated DNS answer into the shared outbound transport', async () => {
    const lookup = vi.fn(async () => [{ address: '8.8.8.8', family: 4 as const }])
    const fetchMock = vi.fn(async (
      _input: Parameters<typeof fetch>[0],
      _init?: Parameters<typeof fetch>[1],
    ) => new Response('{}', { status: 200 }))
    const fetchImpl = fetchMock as unknown as typeof fetch
    const transport = await createSafeProviderProbeTransport(
      'https://provider.example/v1',
      'cloud',
      lookup,
      fetchImpl,
    )

    await transport.fetch('https://provider.example/v1/models')

    expect(lookup).toHaveBeenCalledTimes(1)
    expect(transport.pinnedAddresses).toEqual([{ address: '8.8.8.8', family: 4 }])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [requestUrl, requestInit] = fetchMock.mock.calls[0]
    expect(String(requestUrl)).toBe('https://provider.example/v1/models')
    expect(requestInit).toEqual(expect.objectContaining({
      redirect: 'manual',
      dispatcher: expect.anything(),
      signal: expect.anything(),
    }))
    await transport.close()
  })

  it('rejects local loopback probe unless development and the exact origin are explicitly allowed', async () => {
    await expect(createSafeProviderProbeTransport(
      'http://127.0.0.1:1234/v1',
      'local',
      undefined,
      undefined,
      {
        NODE_ENV: 'production',
        ALLOW_LOCAL_AI_ENDPOINTS: 'true',
        LOCAL_AI_ALLOWED_ORIGINS: 'http://127.0.0.1:1234',
      },
    )).rejects.toThrow('仅允许在显式启用')

    await expect(createSafeProviderProbeTransport(
      'http://127.0.0.1:1234/v1',
      'local',
      undefined,
      undefined,
      {
        NODE_ENV: 'development',
        ALLOW_LOCAL_AI_ENDPOINTS: 'true',
        LOCAL_AI_ALLOWED_ORIGINS: 'http://127.0.0.1:9999',
      },
    )).rejects.toThrow('精确来源白名单')
  })

  it('allows an exact development loopback origin and canonicalizes localhost transport', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch
    const transport = await createSafeProviderProbeTransport(
      'http://localhost:1234/v1',
      'local',
      undefined,
      fetchImpl,
      {
        NODE_ENV: 'development',
        ALLOW_LOCAL_AI_ENDPOINTS: 'true',
        LOCAL_AI_ALLOWED_ORIGINS: 'http://127.0.0.1:1234',
      },
    )

    expect(transport.baseUrl).toBe('http://127.0.0.1:1234/v1')
    expect(transport.pinnedAddresses).toEqual([{ address: '127.0.0.1', family: 4 }])
    await transport.fetch('http://127.0.0.1:1234/v1/models')
    await transport.close()
  })
})

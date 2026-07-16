import { createServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import type { AddressInfo, LookupFunction } from 'node:net'
import type { TLSSocket } from 'node:tls'
import { gzipSync } from 'node:zlib'

import { Agent, fetch as undiciFetch } from 'undici'
import { describe, expect, it, vi } from 'vitest'

import {
  createPinnedLookup,
  openOutboundSession,
  validateOutboundTarget,
  type AgentFactory,
  type OutboundPolicyErrorCode,
  type OutboundSessionDeps,
  type ResolvedAddress,
} from './outbound-http'

const publicIPv4: ResolvedAddress = { address: '93.184.216.34', family: 4 }
const publicIPv6: ResolvedAddress = { address: '2606:4700:4700::1111', family: 6 }

// Static self-signed test identity for provider.example. It is not a runtime key.
const TEST_TLS_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDwhyvfo1sDiltg
rFFpl4s1RUmB8ngkHqDTvGP/xFy10wbLviVaCNhxQ10eZIlEBzKBO8SLk2ZvxfBZ
ixRHH/PKyVpGX4n/4ssnW2mwExhWZdbd2v/Wtq+bs+QovqOwu2P3gj/ua2CRLJiN
2E9atFUI2fpESemrsd9TD6JP5CIShSEPd4XInDOlc/UvoYBAUsXCNWCOHqY8c3lE
VvsCErFxDhlmo6Y/VVZcttM/0CEwf/mTseOZ/8bMwvP3dXsmTuq9Rcbnf+JZKOvu
cxsaZ1WTuU8PPls8NrTwvh/bo82N2EkkYUJg3CqVSw35egnIpiiKBGmZHTBXQM1s
M8QH0R0TAgMBAAECggEBAOfr7kn9YUzQo7tbbES8cuYyoOZDvcRWJA0FogaEeEB5
8huShMGDte/AXJFpr1GA/xnNX36V6jfsTAyLJkpObOwjqoAgrxekvu58HjRAtT7Z
g4z4FagbDsi7dEw1RfCrP4DwfmSN9NcGgTKEWD/Fkhiu1bny6vU61XNpp8AQ4Smo
hcnMIhscMxkJpsYSa+5hUZMAfKSIC3mKTHL+PzBDLzg31rytEhT/5TQV9TlEQdtP
MtIU/rx415+Tee13dD0aQEMt5V5kRUX29wQXWtUU6aG0v3u0dZ1pTz6/sK0w6bJC
bf2PD9ShCjLjm46vVolw9omBwqvFXrvPFFnT1LKOWMECgYEA/Zzy8NVh8NIFDgGD
sd50XOFFHpgeKqifXEw19LQXVsz8fARVUpW1H5HPgzoWWahx+UffYJjlef8kSASK
70WGRZmwMxV4SpmvOkV7JmJo45C6hEyyYJdKmsB807M8ISszvBg5YagJVyjQt50M
si5q1B2dgK2FeEiyfmQIB6wSA08CgYEA8sqyCTy9Cg5mDl0rcTwwJVIJw950LvSt
GcWPTd6+dZdu3DUD0rsFhCMbxxjGuv2pzLIS8BZt/w1KkFUcQVGKl5o1lEoIvqFA
uxxy8/zdS8ZEXqQhisKdCZhCqTeZMve9mixZmqNuEg4DmLF9THujuEQdvtSt4G8U
SZ2scESoqP0CgYEAmXKuF4O0R8Z7IndOHH/RfiUa8iDuF7eA/JJsDwwsFuveVJc2
nMpSFbDekrLBtSvTEhYnlMXOCtuSMzT0b0Nss44C61WxO8nzGNnTYm0ms5HtGIFj
aEgB7tJKdLi8yADgw40QowLN6/uZFY+jj+e/4Wmt056p5BZwUULrDOFS4McCgYAo
+xmuAXiPF/sV9Zf9lwExa3WGgCfwPRByxyv3It/XDWaC+NfaXAMEWMC5jG8O5P4i
NPSJXd/XKzEox5TrWY4hJMBidVSgiKtaaeTlVgssXRzxNJcMyuii0/Z8hYvwVGzG
dzHwriFIHuFwhpT1sfDii2zR5ygqN9Wez2Rp1sz5KQKBgBSyHyKwABrKEflr4lIZ
riLKZg90pgyjBABUiMmQ+l8Hk4ypGLqab3HOoszUS4q7DNtAxUDVVubqScNJrz13
OfyvqcrZM5V/DUWEAbqzDjvsl6br7MQSMSAQTAbpZubdOz8rI/sNTxryUAqLihGu
e+lVMNl+55j77XxgD9x1Fw40
-----END PRIVATE KEY-----`

const TEST_TLS_CERT = `-----BEGIN CERTIFICATE-----
MIIC2DCCAcCgAwIBAgIJALePw2ubmByvMA0GCSqGSIb3DQEBCwUAMBsxGTAXBgNV
BAMMEHByb3ZpZGVyLmV4YW1wbGUwHhcNMjYwNzE1MTYxNjQyWhcNMzYwNzEyMTYx
NjQyWjAbMRkwFwYDVQQDDBBwcm92aWRlci5leGFtcGxlMIIBIjANBgkqhkiG9w0B
AQEFAAOCAQ8AMIIBCgKCAQEA8Icr36NbA4pbYKxRaZeLNUVJgfJ4JB6g07xj/8Rc
tdMGy74lWgjYcUNdHmSJRAcygTvEi5Nmb8XwWYsURx/zyslaRl+J/+LLJ1tpsBMY
VmXW3dr/1ravm7PkKL6jsLtj94I/7mtgkSyYjdhPWrRVCNn6REnpq7HfUw+iT+Qi
EoUhD3eFyJwzpXP1L6GAQFLFwjVgjh6mPHN5RFb7AhKxcQ4ZZqOmP1VWXLbTP9Ah
MH/5k7Hjmf/GzMLz93V7Jk7qvUXG53/iWSjr7nMbGmdVk7lPDz5bPDa08L4f26PN
jdhJJGFCYNwqlUsN+XoJyKYoigRpmR0wV0DNbDPEB9EdEwIDAQABox8wHTAbBgNV
HREEFDASghBwcm92aWRlci5leGFtcGxlMA0GCSqGSIb3DQEBCwUAA4IBAQDrzCG8
w5C8r5gfL6i6tkt1EkZ6vB6UnqrAVfr0S2UPhI5DvrUcGmYScNNGiZ6vqnS1rpet
tL1ROCYU+qV4cR5multmINzyKX1iYZAt7/9fmqznhazJCAX+NSJiT8CLo3WqLrzy
recLyJKv0gxgHEIrZXee+Bp6lLXQKQOYywAiJMwhmqyJrBVDGkrwjA3axReM/YEp
L39BbH63xF4MMZTH6inHQVexdsJge7z5+7jn01hd45mP2/R3Mzlwf3InFl2QB7XO
3WFmMASk8IUEe5zfPbquhkVINJM2nz6Pwk14jllz12sdxeKDbY4tkx59lE5gJdCk
3T6VlIC3504ZBZMt
-----END CERTIFICATE-----`

function resolver(...addresses: ResolvedAddress[]) {
  return vi.fn(async () => addresses)
}

async function expectPolicyError(
  promise: Promise<unknown>,
  code: OutboundPolicyErrorCode
) {
  await expect(promise).rejects.toMatchObject({
    name: 'OutboundPolicyError',
    code,
    message: code,
  })
}

function aiPolicy(allowLocalDevelopment = false) {
  return {
    purpose: 'ai-provider' as const,
    allowLocalDevelopment,
  }
}

function sessionHarness(response: Response = new Response('ok')) {
  let capturedOptions: Parameters<AgentFactory>[0] | null = null
  const destroy = vi.fn(async (): Promise<void> => undefined)
  const dispatcher = { destroy }
  const agentFactory: AgentFactory = vi.fn((options) => {
    capturedOptions = options
    return dispatcher as never
  })
  const fetchImpl = vi.fn(async (_input: unknown, _init?: unknown) => response)
  const deps: OutboundSessionDeps = {
    resolveHost: resolver(publicIPv4, publicIPv6),
    agentFactory,
    fetchImpl: fetchImpl as never,
  }

  return {
    deps,
    destroy,
    dispatcher,
    fetchImpl,
    options: () => capturedOptions,
  }
}

describe('validateOutboundTarget', () => {
  it('accepts a public HTTPS hostname only after validating every A and AAAA answer', async () => {
    const resolveHost = resolver(publicIPv4, publicIPv6)

    const target = await validateOutboundTarget(
      'https://provider.example/v1',
      aiPolicy(),
      { resolveHost }
    )

    expect(target).toMatchObject({
      mode: 'public-https',
      addresses: [publicIPv4, publicIPv6],
    })
    expect(target.url.href).toBe('https://provider.example/v1')
    expect(resolveHost).toHaveBeenCalledWith('provider.example')
  })

  it.each([
    'http://provider.example',
    'file:///etc/passwd',
    'ftp://provider.example/file',
    'gopher://provider.example',
    'data:text/plain,hello',
  ])('rejects unsafe protocol input %s', async (url) => {
    await expectPolicyError(
      validateOutboundTarget(url, aiPolicy(), { resolveHost: resolver(publicIPv4) }),
      'UNSAFE_PROTOCOL'
    )
  })

  it('rejects credentials and fragments before DNS', async () => {
    const resolveHost = resolver(publicIPv4)

    await expectPolicyError(
      validateOutboundTarget('https://user:secret@provider.example', aiPolicy(), { resolveHost }),
      'URL_CREDENTIALS_FORBIDDEN'
    )
    await expectPolicyError(
      validateOutboundTarget('https://provider.example/#secret', aiPolicy(), { resolveHost }),
      'URL_FRAGMENT_FORBIDDEN'
    )
    expect(resolveHost).not.toHaveBeenCalled()
  })

  it.each([
    'https://8.8.8.8',
    'https://[2606:4700:4700::1111]',
  ])('rejects every public IP literal %s', async (url) => {
    await expectPolicyError(validateOutboundTarget(url, aiPolicy()), 'IP_LITERAL_FORBIDDEN')
  })

  it.each([
    'https://127.0.0.1',
    'https://127.1',
    'https://2130706433',
    'https://0x7f000001',
    'https://0177.0.0.1',
    'https://[::1]',
  ])('rejects normalized loopback literal %s without the explicit local capability', async (url) => {
    await expectPolicyError(validateOutboundTarget(url, aiPolicy()), 'LOCAL_ENDPOINT_FORBIDDEN')
  })

  it.each([
    'https://metadata',
    'https://metadata.google.internal',
    'https://metadata.google.internal.',
    'https://instance-data.ec2.internal',
  ])('rejects metadata hostname %s before DNS', async (url) => {
    const resolveHost = resolver(publicIPv4)
    await expectPolicyError(
      validateOutboundTarget(url, aiPolicy(), { resolveHost }),
      'METADATA_HOST_FORBIDDEN'
    )
    expect(resolveHost).not.toHaveBeenCalled()
  })

  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.0.1',
    '192.0.2.1',
    '224.0.0.1',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
    '2002::1',
  ])('rejects a DNS answer in a non-public range: %s', async (address) => {
    await expectPolicyError(
      validateOutboundTarget('https://provider.example', aiPolicy(), {
        resolveHost: resolver({ address, family: address.includes(':') ? 6 : 4 }),
      }),
      'NON_PUBLIC_ADDRESS'
    )
  })

  it('rejects the whole DNS set when one answer is private', async () => {
    await expectPolicyError(
      validateOutboundTarget('https://provider.example', aiPolicy(), {
        resolveHost: resolver(publicIPv4, { address: '10.0.0.5', family: 4 }),
      }),
      'NON_PUBLIC_ADDRESS'
    )
  })

  it('rejects an empty or failed DNS result with a stable error code', async () => {
    await expectPolicyError(
      validateOutboundTarget('https://provider.example', aiPolicy(), {
        resolveHost: resolver(),
      }),
      'DNS_NO_ADDRESSES'
    )
    await expectPolicyError(
      validateOutboundTarget('https://provider.example', aiPolicy(), {
        resolveHost: vi.fn(async () => {
          throw new Error('resolver detail must not escape')
        }),
      }),
      'DNS_RESOLUTION_FAILED'
    )
  })

  it('bounds a DNS resolver that never settles', async () => {
    await expectPolicyError(
      validateOutboundTarget('https://provider.example', aiPolicy(), {
        resolveHost: () => new Promise(() => undefined),
        dnsResolutionTimeoutMs: 100,
      }),
      'DNS_RESOLUTION_TIMEOUT'
    )
  })

  it('requires fixed integrations to match an exact configured origin', async () => {
    const policy = {
      purpose: 'fixed-origin' as const,
      allowedOrigins: ['https://open.feishu.cn'],
    }

    await expect(validateOutboundTarget(
      'https://open.feishu.cn/open-apis/users',
      policy,
      { resolveHost: resolver(publicIPv4) }
    )).resolves.toMatchObject({ mode: 'public-https' })
    await expectPolicyError(
      validateOutboundTarget(
        'https://open.feishu.cn.attacker.example/open-apis/users',
        policy,
        { resolveHost: resolver(publicIPv4) }
      ),
      'ORIGIN_FORBIDDEN'
    )
  })

  it('allows a loopback model only through an exact, non-Vercel development capability', async () => {
    const env = {
      NODE_ENV: 'development',
      ALLOW_LOCAL_AI_ENDPOINTS: 'true',
      LOCAL_AI_ALLOWED_ORIGINS: 'http://127.0.0.1:1234,http://[::1]:1234',
    }

    await expect(validateOutboundTarget(
      'http://127.0.0.1:1234/v1',
      aiPolicy(true),
      { env }
    )).resolves.toMatchObject({
      mode: 'local-development',
      addresses: [{ address: '127.0.0.1', family: 4 }],
    })
    await expect(validateOutboundTarget(
      'http://[::1]:1234/v1',
      aiPolicy(true),
      { env }
    )).resolves.toMatchObject({ mode: 'local-development' })
  })

  it.each([
    [{ NODE_ENV: 'production' }],
    [{ ALLOW_LOCAL_AI_ENDPOINTS: 'true' }],
    [{ NODE_ENV: 'development', VERCEL: '1' }],
    [{ NODE_ENV: 'development', VERCEL_ENV: 'preview' }],
    [{ NODE_ENV: 'development', ALLOW_LOCAL_AI_ENDPOINTS: 'false' }],
    [{ NODE_ENV: 'development', ALLOW_LOCAL_AI_ENDPOINTS: 'true', LOCAL_AI_ALLOWED_ORIGINS: 'http://127.0.0.1:9999' }],
  ])('fails closed for an incompletely authorized local endpoint: %j', async (partialEnv) => {
    await expectPolicyError(
      validateOutboundTarget('http://127.0.0.1:1234/v1', aiPolicy(true), {
        env: {
          LOCAL_AI_ALLOWED_ORIGINS: 'http://127.0.0.1:1234',
          ...partialEnv,
        },
      }),
      'LOCAL_ENDPOINT_FORBIDDEN'
    )
  })

  it.each([
    'http://localhost:1234/v1',
    'http://0.0.0.0:1234/v1',
  ])('never treats a broad hostname or bind address as a local exception: %s', async (url) => {
    await expectPolicyError(
      validateOutboundTarget(url, aiPolicy(true), {
        env: {
          NODE_ENV: 'development',
          ALLOW_LOCAL_AI_ENDPOINTS: 'true',
          LOCAL_AI_ALLOWED_ORIGINS: url.replace('/v1', ''),
        },
      }),
      'UNSAFE_PROTOCOL'
    )
  })
})

describe('createPinnedLookup', () => {
  it('returns only prevalidated addresses and honors the requested family', () => {
    const lookup = createPinnedLookup('provider.example', [publicIPv4, publicIPv6])
    const callback = vi.fn()

    lookup('provider.example', { family: 6 }, callback)

    expect(callback).toHaveBeenCalledWith(null, publicIPv6.address, 6)
  })

  it('supports all-address lookup without performing DNS again', () => {
    const lookup = createPinnedLookup('provider.example', [publicIPv4, publicIPv6])
    const callback = vi.fn()

    lookup('provider.example', { all: true }, callback)

    expect(callback).toHaveBeenCalledWith(null, [publicIPv4, publicIPv6])
  })

  it('rejects use for a different hostname', () => {
    const lookup = createPinnedLookup('provider.example', [publicIPv4])
    const callback = vi.fn()

    lookup('attacker.example', {}, callback)

    expect(callback.mock.calls[0][0]).toMatchObject({
      code: 'PINNED_HOST_MISMATCH',
    })
  })

  it('pins a real socket while preserving the original HTTP Host', async () => {
    let receivedHost: string | undefined
    const server = createServer((request, response) => {
      receivedHost = request.headers.host
      response.end('pinned')
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const port = (server.address() as AddressInfo).port
    const dispatcher = new Agent({
      connections: 1,
      connect: {
        lookup: createPinnedLookup('provider.example', [
          { address: '127.0.0.1', family: 4 },
        ]),
      },
    })

    try {
      const response = await undiciFetch(`http://provider.example:${port}/probe`, {
        dispatcher,
        redirect: 'manual',
      })
      expect(await response.text()).toBe('pinned')
      expect(receivedHost).toBe(`provider.example:${port}`)
    } finally {
      await dispatcher.close()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve())
      })
    }
  })

  it('preserves the original TLS SNI, certificate hostname and HTTP Host', async () => {
    let receivedHost: string | undefined
    let receivedServername: string | undefined
    const server = createHttpsServer(
      { key: TEST_TLS_KEY, cert: TEST_TLS_CERT },
      (request, response) => {
        receivedHost = request.headers.host
        const servername = (request.socket as TLSSocket).servername
        receivedServername = typeof servername === 'string' ? servername : undefined
        response.end('secure pinned')
      }
    )
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const port = (server.address() as AddressInfo).port
    const dispatcher = new Agent({
      connections: 1,
      connect: {
        ca: TEST_TLS_CERT,
        lookup: createPinnedLookup('provider.example', [
          { address: '127.0.0.1', family: 4 },
        ]),
      },
    })

    try {
      const response = await undiciFetch(
        `https://provider.example:${port}/probe`,
        { dispatcher, redirect: 'manual' }
      )
      expect(await response.text()).toBe('secure pinned')
      expect(receivedServername).toBe('provider.example')
      expect(receivedHost).toBe(`provider.example:${port}`)
    } finally {
      await dispatcher.destroy()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve())
      })
    }
  })
})

describe('outbound session transport', () => {
  it('supports a native Request through the real Undici transport', async () => {
    let receivedBody = ''
    let receivedContentType: string | undefined
    const server = createServer(async (request, response) => {
      receivedContentType = request.headers['content-type']
      for await (const chunk of request) {
        receivedBody += chunk.toString()
      }
      response.end('accepted')
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const port = (server.address() as AddressInfo).port
    const origin = `http://127.0.0.1:${port}`
    const session = await openOutboundSession(
      `${origin}/v1`,
      aiPolicy(true),
      {
        env: {
          NODE_ENV: 'development',
          ALLOW_LOCAL_AI_ENDPOINTS: 'true',
          LOCAL_AI_ALLOWED_ORIGINS: origin,
        },
        requestTimeoutMs: 2_000,
      }
    )

    try {
      const request = new Request(`${origin}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'contract text' }),
      })
      const response = await session.fetch(request)

      expect(response).toBeInstanceOf(Response)
      expect(response.headers).toBeInstanceOf(Headers)
      expect(response.url).toBe(`${origin}/v1/chat/completions`)
      const clonedResponse = response.clone()
      expect(clonedResponse).toBeInstanceOf(Response)
      expect(clonedResponse.headers).toBeInstanceOf(Headers)
      expect(clonedResponse.url).toBe(response.url)
      expect(clonedResponse.redirected).toBe(response.redirected)
      expect(clonedResponse.type).toBe(response.type)
      expect(await response.text()).toBe('accepted')
      expect(await clonedResponse.text()).toBe('accepted')
      expect(receivedContentType).toBe('application/json')
      expect(receivedBody).toBe('{"prompt":"contract text"}')
    } finally {
      await session.close()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve())
      })
    }
  })

  it('preserves native Request override semantics before adapting to Undici', async () => {
    const harness = sessionHarness()
    const session = await openOutboundSession(
      'https://provider.example/v1',
      aiPolicy(),
      harness.deps
    )
    const aborted = new AbortController()
    aborted.abort()
    const request = new Request('https://provider.example/v1/models', {
      method: 'custom',
      signal: aborted.signal,
    })

    try {
      await expect(session.fetch(request, { signal: null })).resolves.toMatchObject({
        status: 200,
      })
      const [, transportInit] = harness.fetchImpl.mock.calls[0]
      expect(transportInit).toMatchObject({ method: 'custom' })
      expect((transportInit as { signal: AbortSignal }).signal.aborted).toBe(false)

      await expect(session.fetch(request, { method: '' })).rejects.toBeInstanceOf(TypeError)
      expect(harness.fetchImpl).toHaveBeenCalledOnce()
    } finally {
      await session.close()
    }
  })

  it('enforces a total deadline against a server that never sends headers', async () => {
    const server = createServer(() => undefined)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const port = (server.address() as AddressInfo).port
    const origin = `http://127.0.0.1:${port}`
    const session = await openOutboundSession(
      `${origin}/v1`,
      aiPolicy(true),
      {
        env: {
          NODE_ENV: 'development',
          ALLOW_LOCAL_AI_ENDPOINTS: 'true',
          LOCAL_AI_ALLOWED_ORIGINS: origin,
        },
        requestTimeoutMs: 100,
      }
    )

    try {
      await expect(session.fetch(`${origin}/v1/hang`)).rejects.toMatchObject({
        name: expect.stringMatching(/AbortError|TimeoutError/),
      })
    } finally {
      await session.close()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve())
      })
    }
  })

  it('keeps the total deadline active after response headers arrive', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.flushHeaders()
      response.write('partial')
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const port = (server.address() as AddressInfo).port
    const origin = `http://127.0.0.1:${port}`
    const session = await openOutboundSession(
      `${origin}/v1`,
      aiPolicy(true),
      {
        env: {
          NODE_ENV: 'development',
          ALLOW_LOCAL_AI_ENDPOINTS: 'true',
          LOCAL_AI_ALLOWED_ORIGINS: origin,
        },
        requestTimeoutMs: 100,
      }
    )

    try {
      const response = await session.fetch(`${origin}/v1/slow-body`)
      await expect(response.text()).rejects.toMatchObject({
        name: expect.stringMatching(/AbortError|TimeoutError/),
      })
    } finally {
      await session.close()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve())
      })
    }
  })

  it('enforces the configured maximum response size', async () => {
    const server = createServer((_request, response) => {
      response.end('x'.repeat(4_096))
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const port = (server.address() as AddressInfo).port
    const origin = `http://127.0.0.1:${port}`
    const session = await openOutboundSession(
      `${origin}/v1`,
      aiPolicy(true),
      {
        env: {
          NODE_ENV: 'development',
          ALLOW_LOCAL_AI_ENDPOINTS: 'true',
          LOCAL_AI_ALLOWED_ORIGINS: origin,
        },
        maxResponseSizeBytes: 1_024,
        requestTimeoutMs: 2_000,
      }
    )

    try {
      await expect((async () => {
        const response = await session.fetch(`${origin}/v1/large`)
        await response.arrayBuffer()
      })()).rejects.toThrow()
    } finally {
      await session.close()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve())
      })
    }
  })

  it('enforces the response limit after automatic gzip decompression', async () => {
    const decoded = Buffer.from('x'.repeat(200 * 1_024))
    const compressed = gzipSync(decoded)
    expect(compressed.byteLength).toBeLessThan(1_024)
    const server = createServer((_request, response) => {
      response.writeHead(200, {
        'content-encoding': 'gzip',
        'content-length': String(compressed.byteLength),
      })
      response.end(compressed)
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const port = (server.address() as AddressInfo).port
    const origin = `http://127.0.0.1:${port}`
    const session = await openOutboundSession(
      `${origin}/v1`,
      aiPolicy(true),
      {
        env: {
          NODE_ENV: 'development',
          ALLOW_LOCAL_AI_ENDPOINTS: 'true',
          LOCAL_AI_ALLOWED_ORIGINS: origin,
        },
        maxResponseSizeBytes: 1_024,
        requestTimeoutMs: 2_000,
      }
    )

    try {
      const response = await session.fetch(`${origin}/v1/compressed`)
      await expect(response.arrayBuffer()).rejects.toMatchObject({
        code: 'RESPONSE_TOO_LARGE',
      })
    } finally {
      await session.close()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve())
      })
    }
  })

  it('applies the total deadline while streaming a request body', async () => {
    let receivedBytes = 0
    let cancelCount = 0
    let resolveCancelled: (() => void) | undefined
    const cancelled = new Promise<void>((resolve) => {
      resolveCancelled = resolve
    })
    const server = createServer(async (request, response) => {
      try {
        for await (const chunk of request) {
          receivedBytes += chunk.length
        }
        response.end('unexpected completion')
      } catch {
        // The expected deadline aborts the inbound stream.
      }
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const port = (server.address() as AddressInfo).port
    const origin = `http://127.0.0.1:${port}`
    const session = await openOutboundSession(
      `${origin}/v1`,
      aiPolicy(true),
      {
        env: {
          NODE_ENV: 'development',
          ALLOW_LOCAL_AI_ENDPOINTS: 'true',
          LOCAL_AI_ALLOWED_ORIGINS: origin,
        },
        requestTimeoutMs: 100,
      }
    )
    const request = new Request(
      `${origin}/v1/chat/completions`,
      {
        method: 'POST',
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('partial'))
          },
          cancel() {
            cancelCount += 1
            resolveCancelled?.()
            throw new Error('cancel cleanup failed')
          },
        }),
        duplex: 'half',
      } as RequestInit & { duplex: 'half' }
    )

    try {
      await expect(session.fetch(request)).rejects.toMatchObject({
        name: expect.stringMatching(/AbortError|TimeoutError/),
      })
      await cancelled
      expect(receivedBytes).toBeGreaterThan(0)
      expect(cancelCount).toBe(1)
      expect(request.body?.locked).toBe(false)
    } finally {
      await session.close()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve())
      })
    }
  })

  it('cancels the original streaming upload when the session closes', async () => {
    let resolveReceived: (() => void) | undefined
    const received = new Promise<void>((resolve) => {
      resolveReceived = resolve
    })
    const server = createServer(async (request) => {
      try {
        for await (const chunk of request) {
          if (chunk.length > 0) resolveReceived?.()
        }
      } catch {
        // Closing the session intentionally aborts the upload.
      }
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const port = (server.address() as AddressInfo).port
    const origin = `http://127.0.0.1:${port}`
    const session = await openOutboundSession(
      `${origin}/v1`,
      aiPolicy(true),
      {
        env: {
          NODE_ENV: 'development',
          ALLOW_LOCAL_AI_ENDPOINTS: 'true',
          LOCAL_AI_ALLOWED_ORIGINS: origin,
        },
        requestTimeoutMs: 2_000,
      }
    )
    let cancelCount = 0
    const request = new Request(
      `${origin}/v1/chat/completions`,
      {
        method: 'POST',
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('partial'))
          },
          cancel() {
            cancelCount += 1
          },
        }),
        duplex: 'half',
      } as RequestInit & { duplex: 'half' }
    )

    try {
      const pendingFetch = session.fetch(request)
      const fetchError = pendingFetch.then(
        () => null,
        (error: unknown) => error
      )
      await received
      await session.close()
      await expect(fetchError).resolves.toMatchObject({
        name: expect.stringMatching(/AbortError|TimeoutError/),
      })
      expect(cancelCount).toBe(1)
      expect(request.body?.locked).toBe(false)
    } finally {
      await session.close()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve())
      })
    }
  })

  it('cancels a streaming upload when the transport fails before consuming it', async () => {
    const harness = sessionHarness()
    harness.fetchImpl.mockRejectedValueOnce(new Error('connect failed'))
    let cancelCount = 0
    let resolveCancelled: (() => void) | undefined
    const cancelled = new Promise<void>((resolve) => {
      resolveCancelled = resolve
    })
    const request = new Request(
      'https://provider.example/v1/chat/completions',
      {
        method: 'POST',
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('partial'))
          },
          cancel() {
            cancelCount += 1
            resolveCancelled?.()
          },
        }),
        duplex: 'half',
      } as RequestInit & { duplex: 'half' }
    )
    const session = await openOutboundSession(
      'https://provider.example/v1',
      aiPolicy(),
      harness.deps
    )

    try {
      await expect(session.fetch(request)).rejects.toThrow('connect failed')
      await cancelled
      expect(cancelCount).toBe(1)
      expect(request.body?.locked).toBe(false)
    } finally {
      await session.close()
    }
  })

  it('cancels a streaming upload when the server responds before consuming it', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(413, { 'content-type': 'text/plain' })
      response.end('too large')
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const port = (server.address() as AddressInfo).port
    const origin = `http://127.0.0.1:${port}`
    const session = await openOutboundSession(
      `${origin}/v1`,
      aiPolicy(true),
      {
        env: {
          NODE_ENV: 'development',
          ALLOW_LOCAL_AI_ENDPOINTS: 'true',
          LOCAL_AI_ALLOWED_ORIGINS: origin,
        },
        requestTimeoutMs: 2_000,
      }
    )
    let cancelCount = 0
    let producer: ReturnType<typeof setInterval> | undefined
    const request = new Request(
      `${origin}/v1/chat/completions`,
      {
        method: 'POST',
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('partial'))
            producer = setInterval(() => {
              controller.enqueue(new TextEncoder().encode('more'))
            }, 5)
          },
          cancel() {
            cancelCount += 1
            if (producer) clearInterval(producer)
            return new Promise<void>(() => undefined)
          },
        }),
        duplex: 'half',
      } as RequestInit & { duplex: 'half' }
    )

    try {
      const response = await session.fetch(request)
      expect(response.status).toBe(413)
      expect(await response.text()).toBe('too large')
      expect(cancelCount).toBe(1)
      expect(request.body?.locked).toBe(false)
    } finally {
      if (producer) clearInterval(producer)
      await session.close()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve())
      })
    }
  })

  it('destroys an active unconsumed response without waiting for its body', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.flushHeaders()
      response.write('partial')
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const port = (server.address() as AddressInfo).port
    const origin = `http://127.0.0.1:${port}`
    const session = await openOutboundSession(
      `${origin}/v1`,
      aiPolicy(true),
      {
        env: {
          NODE_ENV: 'development',
          ALLOW_LOCAL_AI_ENDPOINTS: 'true',
          LOCAL_AI_ALLOWED_ORIGINS: origin,
        },
        requestTimeoutMs: 2_000,
      }
    )
    let deadline: ReturnType<typeof setTimeout> | undefined

    try {
      const response = await session.fetch(`${origin}/v1/stream`)
      expect(response.status).toBe(200)
      await Promise.race([
        session.close(),
        new Promise<never>((_resolve, reject) => {
          deadline = setTimeout(
            () => reject(new Error('session close exceeded deadline')),
            1_000
          )
        }),
      ])
    } finally {
      if (deadline) clearTimeout(deadline)
      await session.close()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve())
      })
    }
  })

  it('keeps the original hostname while injecting the pinned dispatcher and manual redirect policy', async () => {
    const harness = sessionHarness()
    const session = await openOutboundSession(
      'https://provider.example/v1',
      aiPolicy(),
      harness.deps
    )

    const response = await session.fetch('https://provider.example/v1/models', {
      redirect: 'follow',
      headers: { authorization: 'Bearer test-secret' },
    })

    expect(response.status).toBe(200)
    expect(harness.fetchImpl).toHaveBeenCalledOnce()
    const [input, init] = harness.fetchImpl.mock.calls[0]
    expect(input).toBeInstanceOf(URL)
    expect((input as URL).hostname).toBe('provider.example')
    expect(init).toMatchObject({
      redirect: 'manual',
      dispatcher: harness.dispatcher,
    })
    expect(harness.options()).toMatchObject({
      headersTimeout: 120_000,
      bodyTimeout: 120_000,
      maxResponseSize: 32 * 1024 * 1024,
    })

    const connect = harness.options()?.connect as { lookup: LookupFunction }
    const callback = vi.fn()
    connect.lookup('provider.example', { family: 4 }, callback)
    expect(callback).toHaveBeenCalledWith(null, publicIPv4.address, 4)

    await session.close()
    expect(harness.destroy).toHaveBeenCalledOnce()
  })

  it('rejects a different origin before any network call', async () => {
    const harness = sessionHarness()
    const session = await openOutboundSession(
      'https://provider.example/v1',
      aiPolicy(),
      harness.deps
    )

    await expectPolicyError(
      session.fetch('https://attacker.example/steal'),
      'CROSS_ORIGIN_FORBIDDEN'
    )
    expect(harness.fetchImpl).not.toHaveBeenCalled()
    await session.close()
  })

  it('rejects per-request credentials and fragments before any network call', async () => {
    const harness = sessionHarness()
    const session = await openOutboundSession(
      'https://provider.example/v1',
      aiPolicy(),
      harness.deps
    )

    await expectPolicyError(
      session.fetch('https://user:secret@provider.example/v1/models'),
      'URL_CREDENTIALS_FORBIDDEN'
    )
    await expectPolicyError(
      session.fetch('https://provider.example/v1/models#secret'),
      'URL_FRAGMENT_FORBIDDEN'
    )
    expect(harness.fetchImpl).not.toHaveBeenCalled()
    await session.close()
  })

  it.each([
    'host',
    'content-length',
    'transfer-encoding',
    'proxy-connection',
  ])(
    'rejects an unsafe %s header before any network call',
    async (header) => {
      const harness = sessionHarness()
      const session = await openOutboundSession(
        'https://provider.example/v1',
        aiPolicy(),
        harness.deps
      )

      await expectPolicyError(
        session.fetch('https://provider.example/v1/models', {
          headers: { [header]: header === 'host' ? 'attacker.example' : '1' },
        }),
        'UNSAFE_HEADER_FORBIDDEN'
      )
      expect(harness.fetchImpl).not.toHaveBeenCalled()
      await session.close()
    }
  )

  it('does not let caller mutation change the validated origin or pinned addresses', async () => {
    const harness = sessionHarness()
    const session = await openOutboundSession(
      'https://provider.example/v1',
      aiPolicy(),
      harness.deps
    )

    session.target.url.hostname = 'attacker.example'
    ;(session.target.addresses as ResolvedAddress[]).unshift({ address: '127.0.0.1', family: 4 })

    await expectPolicyError(
      session.fetch('https://attacker.example/steal'),
      'CROSS_ORIGIN_FORBIDDEN'
    )
    const connect = harness.options()?.connect as { lookup: LookupFunction }
    const callback = vi.fn()
    connect.lookup('provider.example', { family: 4 }, callback)
    expect(callback).toHaveBeenCalledWith(null, publicIPv4.address, 4)
    await session.close()
  })

  it.each([301, 302, 303, 307, 308])(
    'blocks HTTP %s without replaying credentials or body',
    async (status) => {
    const harness = sessionHarness(new Response(null, {
      status,
      headers: { location: 'https://attacker.example/steal' },
    }))
    const session = await openOutboundSession(
      'https://provider.example/v1',
      aiPolicy(),
      harness.deps
    )

    await expectPolicyError(
      session.fetch('https://provider.example/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: 'Bearer test-secret' },
        body: 'contract text',
      }),
      'REDIRECT_BLOCKED'
    )
    expect(harness.fetchImpl).toHaveBeenCalledOnce()
      await session.close()
    }
  )

  it('does not misclassify a 304 response as a redirect', async () => {
    const harness = sessionHarness(new Response(null, { status: 304 }))
    const session = await openOutboundSession(
      'https://provider.example/v1',
      aiPolicy(),
      harness.deps
    )

    await expect(
      session.fetch('https://provider.example/v1/models')
    ).resolves.toMatchObject({ status: 304 })
    await session.close()
  })

  it('closes idempotently and refuses reuse after close', async () => {
    const harness = sessionHarness()
    const session = await openOutboundSession(
      'https://provider.example/v1',
      aiPolicy(),
      harness.deps
    )

    await session.close()
    await session.close()
    expect(harness.destroy).toHaveBeenCalledOnce()
    await expectPolicyError(
      session.fetch('https://provider.example/v1/models'),
      'SESSION_CLOSED'
    )
  })

  it('makes concurrent close callers await the same dispatcher teardown', async () => {
    const harness = sessionHarness()
    let resolveDestroy: (() => void) | undefined
    const destroy = vi.fn(() => new Promise<void>((resolve) => {
      resolveDestroy = resolve
    }))
    harness.dispatcher.destroy = destroy
    const session = await openOutboundSession(
      'https://provider.example/v1',
      aiPolicy(),
      harness.deps
    )

    const firstClose = session.close()
    const secondClose = session.close()
    let secondResolved = false
    void secondClose.then(() => {
      secondResolved = true
    })
    await Promise.resolve()

    expect(secondResolved).toBe(false)
    expect(destroy).toHaveBeenCalledOnce()
    resolveDestroy?.()
    await Promise.all([firstClose, secondClose])
    expect(secondResolved).toBe(true)
  })
})

import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP, type LookupFunction } from 'node:net'

import ipaddr from 'ipaddr.js'
import {
  Agent,
  fetch as undiciFetch,
  type Dispatcher,
} from 'undici'

export type ResolvedAddress = Readonly<{
  address: string
  family: 4 | 6
}>

export type ResolveHost = (hostname: string) => Promise<readonly ResolvedAddress[]>

export type OutboundPolicy =
  | Readonly<{
      purpose: 'ai-provider'
      allowLocalDevelopment?: boolean
    }>
  | Readonly<{
      purpose: 'fixed-origin'
      allowedOrigins: readonly string[]
    }>

export type ValidatedOutboundTarget = Readonly<{
  url: URL
  mode: 'public-https' | 'local-development'
  addresses: readonly ResolvedAddress[]
}>

export type OutboundPolicyErrorCode =
  | 'INVALID_URL'
  | 'UNSAFE_PROTOCOL'
  | 'URL_CREDENTIALS_FORBIDDEN'
  | 'URL_FRAGMENT_FORBIDDEN'
  | 'IP_LITERAL_FORBIDDEN'
  | 'METADATA_HOST_FORBIDDEN'
  | 'ORIGIN_FORBIDDEN'
  | 'LOCAL_ENDPOINT_FORBIDDEN'
  | 'DNS_RESOLUTION_FAILED'
  | 'DNS_RESOLUTION_TIMEOUT'
  | 'DNS_NO_ADDRESSES'
  | 'NON_PUBLIC_ADDRESS'
  | 'PINNED_HOST_MISMATCH'
  | 'CROSS_ORIGIN_FORBIDDEN'
  | 'REDIRECT_BLOCKED'
  | 'RESPONSE_TOO_LARGE'
  | 'UNSAFE_HEADER_FORBIDDEN'
  | 'SESSION_CLOSED'

export class OutboundPolicyError extends Error {
  readonly code: OutboundPolicyErrorCode

  constructor(code: OutboundPolicyErrorCode) {
    super(code)
    this.name = 'OutboundPolicyError'
    this.code = code
  }
}

export type AgentFactory = (options: Agent.Options) => Dispatcher
type UndiciRequestInit = NonNullable<Parameters<typeof undiciFetch>[1]>

export type OutboundValidationDeps = Readonly<{
  resolveHost?: ResolveHost
  env?: Readonly<Record<string, string | undefined>>
  dnsResolutionTimeoutMs?: number
}>

export type OutboundSessionDeps = OutboundValidationDeps & Readonly<{
  agentFactory?: AgentFactory
  fetchImpl?: typeof undiciFetch
  requestTimeoutMs?: number
  maxResponseSizeBytes?: number
}>

export interface OutboundSession {
  readonly target: ValidatedOutboundTarget
  readonly fetch: typeof globalThis.fetch
  close(): Promise<void>
}

const METADATA_HOSTNAMES = new Set([
  'metadata',
  'metadata.google.internal',
  'instance-data.ec2.internal',
])

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000
const MIN_REQUEST_TIMEOUT_MS = 100
const MAX_REQUEST_TIMEOUT_MS = 300_000
const DEFAULT_DNS_RESOLUTION_TIMEOUT_MS = 5_000
const MAX_DNS_RESOLUTION_TIMEOUT_MS = 10_000
const DEFAULT_MAX_RESPONSE_SIZE_BYTES = 32 * 1024 * 1024
const MIN_MAX_RESPONSE_SIZE_BYTES = 1_024
const MAX_MAX_RESPONSE_SIZE_BYTES = 64 * 1024 * 1024
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const FORBIDDEN_TRANSPORT_HEADERS = [
  'connection',
  'content-length',
  'expect',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
] as const

function policyError(code: OutboundPolicyErrorCode): never {
  throw new OutboundPolicyError(code)
}

function normalizedHostname(hostname: string): string {
  const withoutBrackets = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname
  return withoutBrackets.toLowerCase().replace(/\.$/, '')
}

function parseUrl(input: string | URL): URL {
  try {
    return new URL(input.toString())
  } catch {
    return policyError('INVALID_URL')
  }
}

function isMetadataHostname(hostname: string): boolean {
  return METADATA_HOSTNAMES.has(normalizedHostname(hostname))
}

function isVercelEnvironment(env: Readonly<Record<string, string | undefined>>): boolean {
  return Boolean(env.VERCEL || env.VERCEL_ENV)
}

function loopbackAddressFor(hostname: string): ResolvedAddress | null {
  const normalized = normalizedHostname(hostname)
  if (normalized === '127.0.0.1') {
    return { address: normalized, family: 4 }
  }
  if (normalized === '::1') {
    return { address: normalized, family: 6 }
  }
  return null
}

function configuredLocalOrigins(env: Readonly<Record<string, string | undefined>>): Set<string> {
  const origins = new Set<string>()
  for (const rawEntry of (env.LOCAL_AI_ALLOWED_ORIGINS || '').split(',')) {
    const entry = rawEntry.trim()
    if (!entry) continue
    try {
      const url = new URL(entry)
      if (
        !['http:', 'https:'].includes(url.protocol)
        || url.username
        || url.password
        || url.pathname !== '/'
        || url.search
        || url.hash
        || !loopbackAddressFor(url.hostname)
      ) {
        continue
      }
      origins.add(url.origin)
    } catch {
      // Invalid deployment entries never widen the allowlist.
    }
  }
  return origins
}

function localDevelopmentTarget(
  url: URL,
  policy: OutboundPolicy,
  env: Readonly<Record<string, string | undefined>>
): ValidatedOutboundTarget | null {
  const loopback = loopbackAddressFor(url.hostname)
  if (!loopback) return null

  if (
    policy.purpose !== 'ai-provider'
    || policy.allowLocalDevelopment !== true
    || env.NODE_ENV !== 'development'
    || isVercelEnvironment(env)
    || env.ALLOW_LOCAL_AI_ENDPOINTS !== 'true'
    || !configuredLocalOrigins(env).has(url.origin)
  ) {
    return policyError('LOCAL_ENDPOINT_FORBIDDEN')
  }

  return {
    url,
    mode: 'local-development',
    addresses: [loopback],
  }
}

function normalizePublicAddress(address: string): ResolvedAddress {
  let parsed: ipaddr.IPv4 | ipaddr.IPv6
  try {
    parsed = ipaddr.process(address)
  } catch {
    return policyError('NON_PUBLIC_ADDRESS')
  }

  if (parsed.range() !== 'unicast') {
    return policyError('NON_PUBLIC_ADDRESS')
  }

  return parsed.kind() === 'ipv4'
    ? { address: parsed.toString(), family: 4 }
    : { address: (parsed as ipaddr.IPv6).toRFC5952String(), family: 6 }
}

const defaultResolveHost: ResolveHost = async (hostname) => {
  try {
    const addresses = await dnsLookup(hostname, { all: true, verbatim: true })
    return addresses.map(({ address, family }) => ({
      address,
      family: family === 6 ? 6 : 4,
    }))
  } catch {
    return policyError('DNS_RESOLUTION_FAILED')
  }
}

function boundedDnsResolutionTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_DNS_RESOLUTION_TIMEOUT_MS
  }
  return Math.min(
    MAX_DNS_RESOLUTION_TIMEOUT_MS,
    Math.max(MIN_REQUEST_TIMEOUT_MS, Math.trunc(value))
  )
}

function resolveHostWithDeadline(
  resolveHost: ResolveHost,
  hostname: string,
  timeoutMs: number
): Promise<readonly ResolvedAddress[]> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new OutboundPolicyError('DNS_RESOLUTION_TIMEOUT'))
    }, timeoutMs)
    void Promise.resolve()
      .then(() => resolveHost(hostname))
      .then(
        (addresses) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(addresses)
        },
        (error: unknown) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          reject(error)
        }
      )
  })
}

function allowedFixedOrigins(policy: Extract<OutboundPolicy, { purpose: 'fixed-origin' }>): Set<string> {
  const origins = new Set<string>()
  for (const value of policy.allowedOrigins) {
    try {
      origins.add(new URL(value).origin)
    } catch {
      // Invalid allowlist entries never widen access.
    }
  }
  return origins
}

export async function validateOutboundTarget(
  input: string | URL,
  policy: OutboundPolicy,
  deps: OutboundValidationDeps = {}
): Promise<ValidatedOutboundTarget> {
  const url = parseUrl(input)
  const env = deps.env || process.env

  if (url.username || url.password) policyError('URL_CREDENTIALS_FORBIDDEN')
  if (url.hash) policyError('URL_FRAGMENT_FORBIDDEN')

  const localTarget = localDevelopmentTarget(url, policy, env)
  if (localTarget) return localTarget

  if (url.protocol !== 'https:') policyError('UNSAFE_PROTOCOL')
  if (isIP(normalizedHostname(url.hostname)) !== 0) policyError('IP_LITERAL_FORBIDDEN')
  if (isMetadataHostname(url.hostname)) policyError('METADATA_HOST_FORBIDDEN')

  if (
    policy.purpose === 'fixed-origin'
    && !allowedFixedOrigins(policy).has(url.origin)
  ) {
    policyError('ORIGIN_FORBIDDEN')
  }

  let resolved: readonly ResolvedAddress[]
  try {
    resolved = await resolveHostWithDeadline(
      deps.resolveHost || defaultResolveHost,
      normalizedHostname(url.hostname),
      boundedDnsResolutionTimeout(deps.dnsResolutionTimeoutMs)
    )
  } catch (error) {
    if (error instanceof OutboundPolicyError) throw error
    return policyError('DNS_RESOLUTION_FAILED')
  }

  if (resolved.length === 0) policyError('DNS_NO_ADDRESSES')

  const addresses = Array.from(new Map(
    resolved.map(({ address }) => {
      const normalized = normalizePublicAddress(address)
      return [`${normalized.family}:${normalized.address}`, normalized]
    })
  ).values())

  return {
    url,
    mode: 'public-https',
    addresses,
  }
}

function lookupError(code: OutboundPolicyErrorCode, hostname: string): NodeJS.ErrnoException {
  const error = new OutboundPolicyError(code) as NodeJS.ErrnoException & { hostname: string }
  error.hostname = hostname
  return error
}

export function createPinnedLookup(
  expectedHostname: string,
  addresses: readonly ResolvedAddress[]
): LookupFunction {
  const normalizedExpected = normalizedHostname(expectedHostname)
  const pinnedAddresses = addresses.map(({ address, family }) => ({ address, family }))

  return (hostname, options, callback) => {
    if (normalizedHostname(hostname) !== normalizedExpected) {
      callback(lookupError('PINNED_HOST_MISMATCH', hostname), '', 0)
      return
    }

    const requestedFamily = options.family === 6 || options.family === 'IPv6'
      ? 6
      : options.family === 4 || options.family === 'IPv4'
        ? 4
        : 0
    const candidates = requestedFamily === 0
      ? pinnedAddresses
      : pinnedAddresses.filter(({ family }) => family === requestedFamily)

    if (candidates.length === 0) {
      callback(lookupError('DNS_NO_ADDRESSES', hostname), '', 0)
      return
    }

    if (options.all) {
      callback(null, candidates.map(({ address, family }) => ({ address, family })))
      return
    }

    callback(null, candidates[0].address, candidates[0].family)
  }
}

function requestUrl(input: Parameters<typeof globalThis.fetch>[0], baseUrl: URL): URL {
  try {
    if (typeof input === 'string') return new URL(input, baseUrl)
    if (input instanceof URL) return new URL(input.href)
    return new URL(input.url)
  } catch {
    return policyError('INVALID_URL')
  }
}

function isRedirect(status: number): boolean {
  return REDIRECT_STATUSES.has(status)
}

function globalResponseFrom(
  response: Awaited<ReturnType<typeof undiciFetch>>,
  maxDecodedResponseSizeBytes: number
): globalThis.Response {
  const adapted = new globalThis.Response(
    response.body
      ? boundedResponseBody(
          response.body as globalThis.ReadableStream<Uint8Array>,
          maxDecodedResponseSizeBytes
        )
      : null,
    {
      status: response.status,
      statusText: response.statusText,
      headers: Array.from(response.headers.entries()),
    }
  )
  const metadata = {
    url: response.url,
    redirected: response.redirected,
    type: response.type,
  }

  return applyResponseMetadata(adapted, metadata)
}

function boundedResponseBody(
  source: ReadableStream<Uint8Array>,
  maxBytes: number
): ReadableStream<Uint8Array> {
  const reader = source.getReader()
  let byteLength = 0
  let settled = false

  const release = () => {
    try {
      reader.releaseLock()
    } catch {
      // The lock may already have been released by transport cleanup.
    }
  }
  const cancelSource = (reason: unknown) => {
    if (settled) return
    settled = true
    try {
      void reader.cancel(reason).catch(() => undefined)
    } finally {
      release()
    }
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (settled) return
      try {
        const result = await reader.read()
        if (settled) return
        if (result.done) {
          settled = true
          release()
          controller.close()
          return
        }

        byteLength += result.value.byteLength
        if (byteLength > maxBytes) {
          const error = new OutboundPolicyError('RESPONSE_TOO_LARGE')
          cancelSource(error)
          controller.error(error)
          return
        }
        controller.enqueue(result.value)
      } catch (error) {
        if (settled) return
        settled = true
        release()
        controller.error(error)
      }
    },
    cancel(reason) {
      cancelSource(reason)
    },
  })
}

function applyResponseMetadata(
  response: globalThis.Response,
  metadata: Readonly<{
    url: string
    redirected: boolean
    type: ResponseType
  }>
): globalThis.Response {
  const nativeClone = response.clone.bind(response)

  Object.defineProperties(response, {
    url: { value: metadata.url, enumerable: true },
    redirected: { value: metadata.redirected, enumerable: true },
    type: { value: metadata.type, enumerable: true },
    clone: {
      value: () => applyResponseMetadata(nativeClone(), metadata),
      configurable: true,
      writable: true,
    },
  })
  return response
}

function boundedRequestTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_REQUEST_TIMEOUT_MS
  }
  return Math.min(
    MAX_REQUEST_TIMEOUT_MS,
    Math.max(MIN_REQUEST_TIMEOUT_MS, Math.trunc(value))
  )
}

function boundedMaxResponseSize(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_MAX_RESPONSE_SIZE_BYTES
  }
  return Math.min(
    MAX_MAX_RESPONSE_SIZE_BYTES,
    Math.max(MIN_MAX_RESPONSE_SIZE_BYTES, Math.trunc(value))
  )
}

type NormalizedOutboundRequest = Readonly<{
  method: string
  headers: Headers
  body: ReadableStream<Uint8Array> | null
  signal: AbortSignal
}>

function requestFromInput(
  input: Parameters<typeof globalThis.fetch>[0],
  url: URL,
  init?: RequestInit
): NormalizedOutboundRequest {
  if (typeof Request === 'undefined') {
    throw new TypeError('Global Request support is required for outbound HTTP')
  }

  if (!(input instanceof Request)) {
    const request = new Request(url, init)
    return {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: request.signal,
    }
  }

  const body = init?.body !== undefined ? init.body : input.body
  const request = new Request(url, {
    method: init?.method !== undefined ? init.method : input.method,
    headers: init?.headers !== undefined ? init.headers : input.headers,
    body,
    signal: init?.signal !== undefined ? init.signal : input.signal,
    duplex: body ? 'half' : undefined,
  } as RequestInit & { duplex?: 'half' })
  return {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: request.signal,
  }
}

type GuardedRequestBody = Readonly<{
  stream: ReadableStream<Uint8Array>
  cancel(reason: unknown): Promise<void>
}>

function guardedRequestBody(
  source: ReadableStream<Uint8Array>,
  signal: AbortSignal
): GuardedRequestBody {
  const reader = source.getReader()
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined
  let settled = false
  let cancellation: Promise<void> | null = null

  const cleanup = () => signal.removeEventListener('abort', onAbort)
  const release = () => {
    try {
      reader.releaseLock()
    } catch {
      // The lock may already have been released by a completed cancellation.
    }
  }
  const cancelSource = (reason: unknown): Promise<void> => {
    if (cancellation) return cancellation
    if (settled) return Promise.resolve()
    settled = true
    cleanup()
    try {
      controller?.close()
    } catch {
      // The consumer may already have closed or cancelled the wrapper.
    }
    try {
      cancellation = reader.cancel(reason)
    } catch (error) {
      cancellation = Promise.reject(error)
    } finally {
      release()
    }
    return cancellation
  }
  const onAbort = () => {
    const reason = signal.reason || new DOMException('Request aborted', 'AbortError')
    void cancelSource(reason).catch(() => undefined)
  }

  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    },
    async pull(streamController) {
      if (settled) return
      try {
        const result = await reader.read()
        if (settled) return
        if (result.done) {
          settled = true
          cleanup()
          release()
          streamController.close()
          return
        }
        streamController.enqueue(result.value)
      } catch (error) {
        if (settled) return
        settled = true
        cleanup()
        release()
        streamController.error(error)
      }
    },
    cancel(reason) {
      void cancelSource(reason).catch(() => undefined)
    },
  })

  return { stream, cancel: cancelSource }
}

type PreparedTransportRequest = Readonly<{
  init: UndiciRequestInit
  cancelBody(reason: unknown): Promise<void>
}>

async function transportRequestInit(
  input: Parameters<typeof globalThis.fetch>[0],
  url: URL,
  init: RequestInit | undefined,
  dispatcher: Dispatcher,
  requestTimeoutMs: number,
  sessionSignal: AbortSignal,
  lifecycleSignal: AbortSignal
): Promise<PreparedTransportRequest> {
  // Do not pass Node's global Request object into the separately installed
  // Undici package. Normalize URL, method and headers while retaining the
  // standards-compatible Web ReadableStream for bounded streaming uploads.
  const request = requestFromInput(input, url, init)
  const method = request.method
  if (FORBIDDEN_TRANSPORT_HEADERS.some((header) => request.headers.has(header))) {
    policyError('UNSAFE_HEADER_FORBIDDEN')
  }
  const signal = AbortSignal.any([
    request.signal,
    sessionSignal,
    lifecycleSignal,
    AbortSignal.timeout(requestTimeoutMs),
  ])
  const guardedBody = request.body && method !== 'GET' && method !== 'HEAD'
    ? guardedRequestBody(request.body, signal)
    : undefined

  return {
    init: {
      method,
      headers: Array.from(request.headers.entries()),
      body: guardedBody?.stream as UndiciRequestInit['body'],
      duplex: guardedBody ? 'half' : undefined,
      signal,
      redirect: 'manual',
      dispatcher,
    },
    cancelBody: guardedBody?.cancel || (async () => undefined),
  }
}

export async function openOutboundSession(
  input: string | URL,
  policy: OutboundPolicy,
  deps: OutboundSessionDeps = {}
): Promise<OutboundSession> {
  const requestTimeoutMs = boundedRequestTimeout(deps.requestTimeoutMs)
  const target = await validateOutboundTarget(input, policy, {
    resolveHost: deps.resolveHost,
    env: deps.env,
    dnsResolutionTimeoutMs: Math.min(
      boundedDnsResolutionTimeout(deps.dnsResolutionTimeoutMs),
      requestTimeoutMs
    ),
  })
  const targetBaseUrl = new URL(target.url.href)
  const targetOrigin = targetBaseUrl.origin
  const maxResponseSizeBytes = boundedMaxResponseSize(deps.maxResponseSizeBytes)
  const dispatcher = (deps.agentFactory || ((options) => new Agent(options)))({
    connections: 1,
    pipelining: 1,
    maxRedirections: 0,
    headersTimeout: requestTimeoutMs,
    bodyTimeout: requestTimeoutMs,
    maxResponseSize: maxResponseSizeBytes,
    connect: {
      lookup: createPinnedLookup(targetBaseUrl.hostname, target.addresses),
      timeout: 10_000,
    },
  })
  const transportFetch = deps.fetchImpl || undiciFetch
  const sessionAbortController = new AbortController()
  let closed = false
  let closePromise: Promise<void> | null = null

  const safeFetch = (async (requestInput, init) => {
    if (closed) policyError('SESSION_CLOSED')

    const url = requestUrl(requestInput, targetBaseUrl)
    if (url.username || url.password) policyError('URL_CREDENTIALS_FORBIDDEN')
    if (url.hash) policyError('URL_FRAGMENT_FORBIDDEN')
    if (url.origin !== targetOrigin) policyError('CROSS_ORIGIN_FORBIDDEN')

    const lifecycleController = new AbortController()
    let preparedRequest: PreparedTransportRequest | undefined
    try {
      preparedRequest = await transportRequestInit(
        requestInput,
        url,
        init,
        dispatcher,
        requestTimeoutMs,
        sessionAbortController.signal,
        lifecycleController.signal
      )
      const response = await transportFetch(
        url,
        preparedRequest.init
      )
      void preparedRequest.cancelBody(
        new DOMException('Response received before upload completion', 'AbortError')
      ).catch(() => undefined)

      if (isRedirect(response.status)) {
        void response.body?.cancel().catch(() => undefined)
        policyError('REDIRECT_BLOCKED')
      }

      return globalResponseFrom(response, maxResponseSizeBytes)
    } catch (error) {
      lifecycleController.abort(error)
      void preparedRequest?.cancelBody(error).catch(() => undefined)
      throw error
    }
  }) as typeof globalThis.fetch

  return {
    target,
    fetch: safeFetch,
    close() {
      if (closePromise) return closePromise
      closed = true
      closePromise = Promise.resolve().then(async () => {
        sessionAbortController.abort(
          new DOMException('Outbound session closed', 'AbortError')
        )
        await dispatcher.destroy()
      })
      return closePromise
    },
  }
}

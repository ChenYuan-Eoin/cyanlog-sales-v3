import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const from = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from })),
}))
vi.mock('@/lib/api/auth-wrapper', () => ({
  withAuthAndOrg: vi.fn(async (_req, handler) => handler({ id: 'user-1' }, 'org-1')),
}))

import { GET } from './route'
import { runSourceDependency } from '@/lib/documents/source-ticket'

const identity = {
  storage_path: 'contract-1/source.docx',
  source_hash: 'a'.repeat(64),
  source_text_hash: 'b'.repeat(64),
}
const contract = {
  id: 'contract-1',
  filename: 'source.docx',
  mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  storage_path: identity.storage_path,
}
const pageMap = { ...identity, render_mode: 'browser-ooxml' }

function maybeSingleQuery(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    abortSignal: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  }
}

function request(overrides: Partial<typeof identity> = {}) {
  const params = new URLSearchParams({ ...identity, ...overrides })
  return new NextRequest(`http://localhost/api/contracts/contract-1/source?${params}`)
}

describe('GET browser Word source ticket', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://preview.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role')
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('has a hard deadline even when a dependency ignores its abort signal', async () => {
    vi.useFakeTimers()
    const captured: { signal?: AbortSignal } = {}
    const pending = runSourceDependency((signal) => {
      captured.signal = signal
      return new Promise<never>(() => undefined)
    }, 25)
    const rejection = expect(pending).rejects.toMatchObject({
      name: 'SourceDependencyUnavailableError',
      message: 'Contract source dependency timed out',
    })
    await vi.advanceTimersByTimeAsync(25)
    await rejection
    expect(captured.signal?.aborted).toBe(true)
  })

  it('returns 404 only when the scoped contract is absent', async () => {
    from.mockReturnValueOnce(maybeSingleQuery({ data: null, error: null }))
    const response = await GET(request(), { params: Promise.resolve({ id: contract.id }) })
    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('R001')
  })

  it('returns 503 when the contract dependency fails', async () => {
    from.mockReturnValueOnce(maybeSingleQuery({ data: null, error: { message: 'upstream unavailable' } }))
    const response = await GET(request(), { params: Promise.resolve({ id: contract.id }) })
    expect(response.status).toBe(503)
    expect((await response.json()).error.code).toBe('S003')
  })

  it('returns 409 only when the current source identity is not established', async () => {
    from
      .mockReturnValueOnce(maybeSingleQuery({ data: contract, error: null }))
      .mockReturnValueOnce(maybeSingleQuery({ data: null, error: null }))
    const response = await GET(request(), { params: Promise.resolve({ id: contract.id }) })
    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe('R003')
  })

  it('returns 503 when the page-map dependency fails', async () => {
    from
      .mockReturnValueOnce(maybeSingleQuery({ data: contract, error: null }))
      .mockReturnValueOnce(maybeSingleQuery({ data: null, error: { message: 'upstream unavailable' } }))
    const response = await GET(request(), { params: Promise.resolve({ id: contract.id }) })
    expect(response.status).toBe(503)
    expect((await response.json()).error.code).toBe('S003')
  })

  it('keeps source identity drift as a 409 without signing a URL', async () => {
    from
      .mockReturnValueOnce(maybeSingleQuery({ data: contract, error: null }))
      .mockReturnValueOnce(maybeSingleQuery({ data: pageMap, error: null }))
    const response = await GET(request({ source_hash: 'c'.repeat(64) }), { params: Promise.resolve({ id: contract.id }) })
    expect(response.status).toBe(409)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns 503 when Storage cannot create a fresh ticket', async () => {
    from
      .mockReturnValueOnce(maybeSingleQuery({ data: contract, error: null }))
      .mockReturnValueOnce(maybeSingleQuery({ data: pageMap, error: null }))
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 503 }))
    const response = await GET(request(), { params: Promise.resolve({ id: contract.id }) })
    expect(response.status).toBe(503)
    expect((await response.json()).error.code).toBe('S003')
  })

  it('returns a no-store fresh Storage URL for a matching immutable identity', async () => {
    from
      .mockReturnValueOnce(maybeSingleQuery({ data: contract, error: null }))
      .mockReturnValueOnce(maybeSingleQuery({ data: pageMap, error: null }))
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ signedURL: '/object/sign/contracts/source.docx?token=fresh' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    const response = await GET(request(), { params: Promise.resolve({ id: contract.id }) })
    const payload = await response.json()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(payload.data.download_url).toBe('https://preview.supabase.co/storage/v1/object/sign/contracts/source.docx?token=fresh')
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/storage/v1/object/sign/contracts/contract-1/source.docx'), expect.objectContaining({
      method: 'POST',
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    }))
  })
})

/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(),
  })),
}))

import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { middleware } from './middleware'

function makeRequest(url: string, headers: Record<string, string> = {}): NextRequest {
  const nextUrl = new URL(url) as URL & { clone: () => URL }
  nextUrl.clone = () => new URL(nextUrl.toString())
  const request = {
    nextUrl,
    headers: new Headers(headers),
    cookies: {
      get: vi.fn(),
    },
    url,
  } as unknown as NextRequest

  return request
}

const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://preview.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'preview-service-role-key'
})

afterEach(() => {
  if (originalServiceRoleKey === undefined) {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
  } else {
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey
  }

  if (originalSupabaseUrl === undefined) {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
  } else {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl
  }
})

function mockTokenLookup(result: { data: unknown; error: unknown }) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    abortSignal: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  }
  ;(createClient as any).mockReturnValue({
    from: vi.fn().mockReturnValue(query),
  })
}

describe('middleware host routing', () => {
  it('redirects quote subdomain to sales quotes entry', async () => {
    const res = await middleware(
      makeRequest('https://quote.cyanlog.icu/', { host: 'quote.cyanlog.icu' }),
    )

    expect(res.status).toBe(308)
    expect(res.headers.get('location')).toBe('https://sales.cyanlog.icu/quotes')
  })

  it('redirects contract subdomain to sales contracts entry', async () => {
    const res = await middleware(
      makeRequest('https://contract.cyanlog.icu/anything', { host: 'contract.cyanlog.icu' }),
    )

    expect(res.status).toBe(308)
    expect(res.headers.get('location')).toBe('https://sales.cyanlog.icu/anything')
  })

  it('redirects apex domain to sales home', async () => {
    const res = await middleware(
      makeRequest('https://cyanlog.icu/', { host: 'cyanlog.icu' }),
    )

    expect(res.status).toBe(308)
    expect(res.headers.get('location')).toBe('https://sales.cyanlog.icu/')
  })

  it('returns 503 for protected pages when service role key is missing', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY

    const req = makeRequest('https://sales.cyanlog.icu/configs', { host: 'sales.cyanlog.icu' })
    req.cookies.get = vi.fn().mockReturnValue({ value: 'token-1' })

    const res = await middleware(req)

    expect(res.status).toBe(503)
  })

  it('认证依赖查询失败时 API 返回 503，而不是误报 401', async () => {
    mockTokenLookup({ data: null, error: { message: 'fetch failed' } })
    const req = makeRequest('https://sales.cyanlog.icu/api/contracts', {
      host: 'sales.cyanlog.icu',
      authorization: 'Bearer still-valid',
    })

    const res = await middleware(req)

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      error: 'Authentication unavailable',
      code: 'AUTH_DEPENDENCY_UNAVAILABLE',
    })
  })

  it('真正查无 token 时 API 仍返回 401', async () => {
    mockTokenLookup({ data: null, error: null })
    const req = makeRequest('https://sales.cyanlog.icu/api/contracts', {
      host: 'sales.cyanlog.icu',
      authorization: 'Bearer invalid',
    })

    const res = await middleware(req)

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
  })
})

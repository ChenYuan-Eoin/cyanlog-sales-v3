import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(),
  })),
}))

import type { NextRequest } from 'next/server'
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

afterEach(() => {
  if (originalServiceRoleKey === undefined) {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
  } else {
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey
  }
})

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
})

describe('middleware public API routing', () => {
  it('serves runtime brand assets without requiring an authenticated session', async () => {
    const brandAsset = await middleware(
      makeRequest('https://sales.cyanlog.icu/brand/ones-symbol-square.svg', { host: 'sales.cyanlog.icu' }),
    )
    const brandNeighbor = await middleware(
      makeRequest('https://sales.cyanlog.icu/branding/private', { host: 'sales.cyanlog.icu' }),
    )

    expect(brandAsset.status).toBe(200)
    expect(brandNeighbor.status).toBe(307)
    expect(brandNeighbor.headers.get('location')).toBe('https://sales.cyanlog.icu/login')
  })

  it('allows both registration entrypoints without opening every auth API route', async () => {
    const legacyRegister = await middleware(
      makeRequest('https://sales.cyanlog.icu/api/auth', { host: 'sales.cyanlog.icu' }),
    )
    const registerAlias = await middleware(
      makeRequest('https://sales.cyanlog.icu/api/auth/register', { host: 'sales.cyanlog.icu' }),
    )
    const authProfile = await middleware(
      makeRequest('https://sales.cyanlog.icu/api/auth/me', { host: 'sales.cyanlog.icu' }),
    )
    const authPrefixNeighbor = await middleware(
      makeRequest('https://sales.cyanlog.icu/api/auth/login-extra', { host: 'sales.cyanlog.icu' }),
    )

    expect(legacyRegister.status).toBe(200)
    expect(registerAlias.status).toBe(200)
    expect(authProfile.status).toBe(401)
    expect(authPrefixNeighbor.status).toBe(401)
  })

  it('uses exact public API matches for health and cron routes', async () => {
    const health = await middleware(
      makeRequest('https://sales.cyanlog.icu/api/health', { host: 'sales.cyanlog.icu' }),
    )
    const cron = await middleware(
      makeRequest('https://sales.cyanlog.icu/api/cron', { host: 'sales.cyanlog.icu' }),
    )
    const healthNeighbor = await middleware(
      makeRequest('https://sales.cyanlog.icu/api/health-extra', { host: 'sales.cyanlog.icu' }),
    )

    expect(health.status).toBe(200)
    expect(cron.status).toBe(200)
    expect(healthNeighbor.status).toBe(401)
  })
})

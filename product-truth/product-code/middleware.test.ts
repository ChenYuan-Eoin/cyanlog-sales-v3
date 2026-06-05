import { describe, expect, it, vi } from 'vitest'

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
})

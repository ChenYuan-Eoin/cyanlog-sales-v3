import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMiddlewareRestClient } from './middleware-rest-client'

const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const originalVercel = process.env.VERCEL
const originalVercelEnv = process.env.VERCEL_ENV
const testServiceCredential = ['unit', 'test', 'credential'].join('-')

afterEach(() => {
  vi.unstubAllGlobals()
  process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl
  process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey
  process.env.VERCEL = originalVercel
  process.env.VERCEL_ENV = originalVercelEnv
})

describe('middleware PostgREST client', () => {
  it('uses service-role headers, exact filters and no-store reads', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://isolated.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = testServiceCredential
    delete process.env.VERCEL
    delete process.env.VERCEL_ENV
    const fetchMock = vi.fn(async () => Response.json([{ id: 'row-1' }]))
    vi.stubGlobal('fetch', fetchMock)

    const client = createMiddlewareRestClient()
    await expect(client.selectRows('user_roles', {
      user_id: 'user-1',
      scope_type: 'org',
      scope_id: 'org-a',
    }, 'scope_type,scope_id', 10)).resolves.toEqual([{ id: 'row-1' }])

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const parsed = new URL(url)
    expect(parsed.pathname).toBe('/rest/v1/user_roles')
    expect(parsed.searchParams.get('select')).toBe('scope_type,scope_id')
    expect(parsed.searchParams.getAll('user_id')).toEqual(['eq.user-1'])
    expect(parsed.searchParams.getAll('scope_type')).toEqual(['eq.org'])
    expect(parsed.searchParams.getAll('scope_id')).toEqual(['eq.org-a'])
    expect(parsed.searchParams.get('limit')).toBe('10')
    expect(init.cache).toBe('no-store')
    expect(init.headers).toMatchObject({
      apikey: testServiceCredential,
      Authorization: `Bearer ${testServiceCredential}`,
    })
  })

  it('fails closed on non-success or malformed PostgREST responses', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://isolated.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = testServiceCredential
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 503 })))
    await expect(createMiddlewareRestClient().selectRows('users', {}, 'id'))
      .rejects.toThrow(/auth middleware query failed/)

    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'not-array' })))
    await expect(createMiddlewareRestClient().selectRows('users', {}, 'id'))
      .rejects.toThrow(/invalid JSON/)
  })
})

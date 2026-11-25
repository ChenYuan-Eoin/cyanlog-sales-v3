import { beforeEach, describe, expect, it, vi } from 'vitest'

import { loadHomeInitialData, primeHomeAuthContext } from './home-data-client'
import { scopedCacheKey } from './browser-cache'

const store = new Map<string, string>()

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

describe('home-data-client', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    store.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => store.set(key, value)),
      removeItem: vi.fn((key: string) => store.delete(key)),
    })
  })

  it('无 localStorage token 时依赖 cookie 会话加载首页数据', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/auth/me') {
        return Promise.resolve(jsonResponse({ user: { id: 'u1', email: 'u@example.com' } }))
      }
      if (url === '/api/dashboard?view=personal') {
        return Promise.resolve(jsonResponse({ organizationId: 'org-1', agenda: [], reminders: [] }))
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    })

    const data = await loadHomeInitialData(null)

    expect(data.profile).toEqual({ id: 'u1', email: 'u@example.com' })
    expect(data.dashboard).toEqual({ organizationId: 'org-1', agenda: [], reminders: [] })
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/me', expect.not.objectContaining({
      headers: expect.anything(),
    }))
    expect(fetchMock).toHaveBeenCalledWith('/api/dashboard?view=personal', expect.not.objectContaining({
      headers: expect.anything(),
    }))
  })

  it('有 token 时保留原 Bearer header 与缓存路径', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/auth/me') {
        return Promise.resolve(jsonResponse({ user: { id: 'u2', email: 'token@example.com' } }))
      }
      if (url === '/api/dashboard?view=personal') {
        return Promise.resolve(jsonResponse({ organizationId: 'org-2', agenda: [], reminders: [] }))
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    })

    await loadHomeInitialData('token-abc')

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/me', expect.objectContaining({
      headers: { Authorization: 'Bearer token-abc' },
    }))
    expect(fetchMock).toHaveBeenCalledWith('/api/dashboard?view=personal', expect.objectContaining({
      headers: { Authorization: 'Bearer token-abc' },
    }))
    expect([...store.keys()].some((key) => key.includes('home:initial'))).toBe(true)
  })

  it('预热 auth context 时支持 cookie-only 会话', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    primeHomeAuthContext(null)
    await Promise.resolve()

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/context', { method: 'POST' })
  })

  it('revalidates personal workspace data each time and removes previously cached personal data', async () => {
    const token = 'legacy-cache'
    const legacy = scopedCacheKey(token, 'home:initial')
    const legacyPersonal = scopedCacheKey(token, 'home:initial:personal')
    store.set(legacy, 'old private data')
    store.set(legacyPersonal, 'old private data')
    const personal = [
      { organizationId: 'org-3', agenda: [{ id: 'private-agenda' }], reminders: [{ id: 'private-reminder' }] },
      { agenda: [{ id: 'private-agenda' }] },
      { agenda: [] },
    ]
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/auth/me') return Promise.resolve(jsonResponse({ user: { id: 'u3' } }))
      if (url === '/api/dashboard?view=personal') return Promise.resolve(jsonResponse(personal.shift()))
      return Promise.resolve(new Response(null, { status: 404 }))
    })
    await loadHomeInitialData(token)
    const scoped = await loadHomeInitialData(token, { view: 'personal' })
    const afterRevocation = await loadHomeInitialData(token, { view: 'personal' })
    expect(scoped.dashboard).toEqual({ agenda: [{ id: 'private-agenda' }] })
    expect(afterRevocation.dashboard).toEqual({ agenda: [] })
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/dashboard?view=personal')).toHaveLength(3)
    expect(fetchMock).toHaveBeenCalledWith('/api/dashboard?view=personal', expect.objectContaining({ cache: 'no-store' }))
    expect(store.has(legacy)).toBe(false)
    expect(store.has(legacyPersonal)).toBe(false)
    const workspace = store.get(scopedCacheKey(token, 'home:initial:v2'))
    expect(workspace).toContain('org-3')
    expect(workspace).not.toMatch(/private-agenda|private-reminder/)
  })
})

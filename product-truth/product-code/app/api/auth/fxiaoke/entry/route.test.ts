// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const getAuthUser = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth', () => ({ getAuthUser }))

import { GET } from './route'

const origin = 'https://sales.cyanlog.icu'
const request = (next: string) => new NextRequest(`${origin}/api/auth/fxiaoke/entry?${new URLSearchParams({ next })}`)

describe('configured Fxiaoke app entry', () => {
  beforeEach(() => { getAuthUser.mockReset().mockResolvedValue(null) })

  it('sends the employee through OAuth once and preserves the original page', async () => {
    const response = await GET(request('/shipping?tab=orders'))
    expect(response.headers.get('location')).toBe(`${origin}/api/auth/fxiaoke/start?next=%2Fshipping%3Ftab%3Dorders`)
  })

  it('uses the existing ICU session and sends the request through business authorization', async () => {
    getAuthUser.mockResolvedValue({ id: 'current-employee' })
    expect((await GET(request('/shipping?tab=orders'))).headers.get('location')).toBe(`${origin}/shipping?tab=orders`)
  })

  it('does not redirect outside ICU or restart authentication from the login page', async () => {
    expect((await GET(request('//example.org'))).headers.get('location')).toBe(`${origin}/api/auth/fxiaoke/start`)
    expect((await GET(request('/login'))).headers.get('location')).toBe(`${origin}/api/auth/fxiaoke/start`)
    getAuthUser.mockRejectedValue(new Error('temporary admission issue'))
    expect((await GET(request('/shipping'))).headers.get('location')).toBe(`${origin}/login?next=%2Fshipping`)
  })
})

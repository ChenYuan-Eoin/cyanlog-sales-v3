import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { Sidebar } from './Sidebar'

const prefetch = vi.fn()
let currentPathname = '/'
vi.mock('next/navigation', () => ({
  usePathname: () => currentPathname,
  useRouter: () => ({ replace: vi.fn(), prefetch }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))
vi.mock('@/components/branding/BrandMark', () => ({ BrandMark: () => <span>Brand</span> }))
vi.mock('@/components/branding/BrandingProvider', () => ({
  useBranding: () => ({ brandName: 'Brand', productSubtitle: 'Workbench' }),
}))
vi.mock('@/lib/session-client', () => ({ logoutClientSession: vi.fn() }))

describe('Sidebar shipping navigation lookup', () => {
  beforeEach(() => {
    currentPathname = '/'
    localStorage.setItem('token', `token-${Math.random()}`)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('does not refetch shipping navigation settings on every route change or remount within the cache window', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ navigationAvailable: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const first = render(<Sidebar />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    currentPathname = '/quotes'
    first.rerender(<Sidebar />)
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    first.unmount()
    render(<Sidebar />)
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('prefetches just the visible destination on hover or keyboard focus', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })))
    prefetch.mockClear()
    render(<Sidebar />)
    const knowledge = screen.getByRole('link', { name: '知识库' })
    const agenda = screen.getByRole('link', { name: '日程' })
    expect(prefetch).not.toHaveBeenCalled()
    fireEvent.mouseEnter(knowledge)
    fireEvent.focus(agenda)
    expect(prefetch.mock.calls).toEqual([['/knowledge'], ['/schedule']])
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  })

  it('shows proposal navigation and hides configuration for a baseline Fxiaoke member', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/auth/me'
      ? new Response(JSON.stringify({ user: { authMethod: 'fxiaoke', roles: [{ code: 'FXIAOKE_BASELINE' }] } }), { status: 200 })
      : new Response('{}', { status: 403 })))
    render(<Sidebar />)
    await waitFor(() => expect(screen.getAllByRole('link', { name: /自助收寄/ }).length).toBeGreaterThan(0))
    expect(screen.queryByRole('link', { name: /配置中心/ })).toBeNull()
  })

  it('hides configuration for a Fxiaoke member with a scoped business role', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/auth/me'
      ? new Response(JSON.stringify({ user: { authMethod: 'fxiaoke', roles: [{ code: 'SALES' }], canManageOrg: false } }), { status: 200 })
      : new Response('{}', { status: 403 })))
    render(<Sidebar />)
    await waitFor(() => expect(screen.getAllByRole('link', { name: /自助收寄/ }).length).toBeGreaterThan(0))
    expect(screen.queryByRole('link', { name: /配置中心/ })).toBeNull()
  })
})

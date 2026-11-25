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

  it('rechecks shipping on a new mount without probing settings or repeating profile reads on route changes', async () => {
    const fetchMock = vi.fn(async (url: string) => Response.json(url === '/api/navigation'
      ? { paths: ['/shipping'] }
      : { user: { roles: [{ code: 'ADMIN' }], canManageOrg: true } }))
    vi.stubGlobal('fetch', fetchMock)
    const first = render(<Sidebar />)
    await screen.findByRole('link', { name: '自助收寄' })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/auth/me', '/api/navigation'])

    currentPathname = '/quotes'
    first.rerender(<Sidebar />)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    first.unmount()
    render(<Sidebar />)
    await screen.findByRole('link', { name: '自助收寄' })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/auth/me', '/api/navigation', '/api/navigation'])
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
      : Response.json({ paths: ['/shipping'] })))
    render(<Sidebar />)
    await waitFor(() => expect(screen.getAllByRole('link', { name: /自助收寄/ }).length).toBeGreaterThan(0))
    expect(screen.queryByRole('link', { name: /配置中心/ })).toBeNull()
  })

  it('hides configuration for a Fxiaoke member with a scoped business role', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/auth/me'
      ? new Response(JSON.stringify({ user: { authMethod: 'fxiaoke', roles: [{ code: 'SALES' }], canManageOrg: false } }), { status: 200 })
      : Response.json({ paths: ['/shipping'] })))
    render(<Sidebar />)
    await waitFor(() => expect(screen.getAllByRole('link', { name: /自助收寄/ }).length).toBeGreaterThan(0))
    expect(screen.queryByRole('link', { name: /配置中心/ })).toBeNull()
  })

  it('shows manager-only shipping settings and keeps existing other navigation', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/navigation'
      ? Response.json({ paths: ['/shipping/settings'] })
      : Response.json({ user: { roles: [{ code: 'ADMIN' }], canManageOrg: true } })))
    render(<Sidebar />)
    expect(await screen.findByRole('link', { name: '寄件设置' })).toHaveAttribute('href', '/shipping/settings')
    expect(screen.queryByRole('link', { name: '自助收寄' })).toBeNull()
    expect(await screen.findByRole('link', { name: '配置中心' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '合同审核' })).toBeInTheDocument()
  })

  it('removes only revoked shipping links after window focus', async () => {
    let paths = ['/shipping', '/shipping/settings']
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/navigation'
      ? Response.json({ paths })
      : Response.json({ user: { roles: [{ code: 'ADMIN' }], canManageOrg: true } })))
    render(<Sidebar />)
    await screen.findByRole('link', { name: '寄件设置' })
    paths = ['/shipping']
    fireEvent(window, new Event('focus'))
    await waitFor(() => expect(screen.queryByRole('link', { name: '寄件设置' })).toBeNull())
    expect(screen.getByRole('link', { name: '自助收寄' })).toBeInTheDocument()

    paths = []
    fireEvent(window, new Event('focus'))
    await waitFor(() => expect(screen.queryByRole('link', { name: '自助收寄' })).toBeNull())
    expect(screen.getByRole('link', { name: '配置中心' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '合同审核' })).toBeInTheDocument()
  })
})

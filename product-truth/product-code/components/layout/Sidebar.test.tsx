import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

describe('Sidebar navigation projection', () => {
  beforeEach(() => {
    currentPathname = '/'
    localStorage.setItem('token', `token-${Math.random()}`)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('uses one navigation lookup on mount and keeps ordinary route changes quiet', async () => {
    const fetchMock = vi.fn(async (_url: string) => Response.json({ paths: ['/shipping'] }))
    vi.stubGlobal('fetch', fetchMock)
    const first = render(<Sidebar />)
    await screen.findByRole('link', { name: '自助收寄' })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/navigation'])

    currentPathname = '/quotes'
    first.rerender(<Sidebar />)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    first.unmount()
    render(<Sidebar />)
    await screen.findByRole('link', { name: '自助收寄' })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/navigation', '/api/navigation'])
  })

  it('checks permissions again when leaving a permission-controlled page in the same session', async () => {
    currentPathname = '/shipping'
    let finishLookup: (response: Response) => void = () => {}
    const nextLookup = new Promise<Response>(resolve => { finishLookup = resolve })
    const fetchMock = vi.fn<(_url: string, _init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(Response.json({ paths: ['/shipping', '/configs'], onlyProjectedPaths: true }))
      .mockReturnValueOnce(nextLookup)
    vi.stubGlobal('fetch', fetchMock)
    const token = localStorage.getItem('token')
    const view = render(<Sidebar />)
    await screen.findByRole('link', { name: '自助收寄' })

    currentPathname = '/profile'
    view.rerender(<Sidebar />)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenLastCalledWith('/api/navigation', expect.objectContaining({
      cache: 'no-store', headers: { Authorization: `Bearer ${token}` },
    }))
    expect(screen.getByRole('link', { name: '配置中心' })).toBeInTheDocument()

    await act(async () => finishLookup(Response.json({ paths: ['/configs'], onlyProjectedPaths: true })))
    expect(screen.queryByRole('link', { name: '自助收寄' })).toBeNull()
    expect(screen.getByRole('link', { name: '配置中心' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '个人信息' })).toBeInTheDocument()
  })

  it('prefetches only the visible destination on hover or keyboard focus', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ paths: [] })))
    prefetch.mockClear()
    render(<Sidebar />)
    const knowledge = await screen.findByRole('link', { name: '知识库' })
    const agenda = screen.getByRole('link', { name: '日程' })
    expect(prefetch).not.toHaveBeenCalled()
    fireEvent.mouseEnter(knowledge)
    fireEvent.focus(agenda)
    expect(prefetch.mock.calls).toEqual([['/knowledge'], ['/schedule']])
  })

  it.each([
    { paths: ['/shipping'], showsWorkbench: false, showsShipping: true },
    { paths: ['/', '/shipping'], showsWorkbench: true, showsShipping: true },
    { paths: ['/'], showsWorkbench: true, showsShipping: false },
  ])('shows only projected department work with $paths', async ({ paths, showsWorkbench, showsShipping }) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ paths, onlyProjectedPaths: true })))
    render(<Sidebar />)
    if (showsWorkbench) {
      expect(await screen.findByRole('link', { name: '工作台' })).toHaveAttribute('href', '/')
    } else {
      expect(await screen.findByRole('link', { name: '自助收寄' })).toHaveAttribute('href', '/shipping')
    }
    expect(Boolean(screen.queryByRole('link', { name: '工作台' }))).toBe(showsWorkbench)
    expect(Boolean(screen.queryByRole('link', { name: '自助收寄' }))).toBe(showsShipping)
    for (const name of ['报价中心', '合同审核', '标书中心', '知识库', '日程', '寄件设置', '配置中心']) {
      expect(screen.queryByRole('link', { name })).toBeNull()
    }
  })

  it('shows configuration as the only business entry for settings-only access', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      paths: ['/shipping/settings', '/configs'], onlyProjectedPaths: true,
    })))
    render(<Sidebar />)
    expect(await screen.findByRole('link', { name: '配置中心' })).toHaveAttribute('href', '/configs')
    expect(screen.queryByRole('link', { name: '寄件设置' })).toBeNull()
    expect(screen.queryByRole('link', { name: '自助收寄' })).toBeNull()
    expect(screen.queryByRole('link', { name: '合同审核' })).toBeNull()
  })

  it('refreshes shipping and configuration grants on focus while keeping other navigation', async () => {
    let paths = ['/shipping', '/configs']
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ paths }))
    vi.stubGlobal('fetch', fetchMock)
    const token = localStorage.getItem('token')
    render(<Sidebar />)
    await screen.findByRole('link', { name: '配置中心' })
    expect(screen.getByRole('link', { name: '自助收寄' })).toBeInTheDocument()

    paths = ['/shipping']
    fireEvent(window, new Event('focus'))
    await waitFor(() => expect(screen.queryByRole('link', { name: '配置中心' })).toBeNull())
    expect(screen.getByRole('link', { name: '自助收寄' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '合同审核' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenLastCalledWith('/api/navigation', expect.objectContaining({
      cache: 'no-store', headers: { Authorization: `Bearer ${token}` },
    }))

    paths = ['/configs']
    fireEvent(window, new Event('focus'))
    expect(await screen.findByRole('link', { name: '配置中心' })).toHaveAttribute('href', '/configs')
    expect(screen.queryByRole('link', { name: '自助收寄' })).toBeNull()
  })

  it('ignores an older response after a focus refresh and clears access on a session change', async () => {
    let completeLookup: (response: Response) => void = () => {}
    const pendingLookup = new Promise<Response>(resolve => { completeLookup = resolve })
    const fetchMock = vi.fn<(_url: string, _init?: RequestInit) => Promise<Response>>()
      .mockReturnValueOnce(pendingLookup)
      .mockResolvedValueOnce(Response.json({ paths: ['/shipping'], onlyProjectedPaths: true }))
      .mockResolvedValueOnce(new Response('{}', { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<Sidebar />)
    expect(screen.queryByRole('link', { name: '合同审核' })).toBeNull()
    fireEvent(window, new Event('focus'))
    await screen.findByRole('link', { name: '自助收寄' })
    await act(async () => completeLookup(Response.json({ paths: ['/configs'] })))
    expect(screen.queryByRole('link', { name: '配置中心' })).toBeNull()

    localStorage.setItem('token', 'other-session')
    fireEvent(window, new StorageEvent('storage', { key: 'token' }))
    await waitFor(() => expect(screen.queryByRole('link', { name: '自助收寄' })).toBeNull())
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

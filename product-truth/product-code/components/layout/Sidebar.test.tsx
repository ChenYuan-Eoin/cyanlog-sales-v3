import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { Sidebar } from './Sidebar'

let currentPathname = '/'
vi.mock('next/navigation', () => ({
  usePathname: () => currentPathname,
  useRouter: () => ({ replace: vi.fn() }),
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
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    currentPathname = '/quotes'
    first.rerender(<Sidebar />)
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    first.unmount()
    render(<Sidebar />)
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

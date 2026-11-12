import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('@/components/branding/BrandingProvider', () => ({
  useBranding: () => ({ loginTitle: '登录', loginSubtitle: '请使用企业账号登录' }),
}))
vi.mock('@/components/branding/BrandMark', () => ({ BrandMark: () => <div>brand</div> }))
vi.mock('@/lib/session-client', () => ({ persistClientSession: vi.fn() }))
vi.mock('@/lib/home-data-client', () => ({
  primeHomeAuthContext: vi.fn(),
  primeHomeInitialData: vi.fn(),
  primeHomeInitialSnapshot: vi.fn(),
  primeHomeProfile: vi.fn(),
}))
vi.mock('@/lib/core-page-warmup', () => ({ primeCorePageCaches: vi.fn(), scheduleCorePageWarmup: vi.fn() }))

import LoginPage from './page'

describe('LoginPage enterprise identity', () => {
  beforeEach(() => window.history.replaceState({}, '', '/login'))
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('keeps account login hidden while the server switch is off', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      providers: [{ id: 'fxiaoke', label: '纷享销客', startUrl: '/api/auth/fxiaoke/start' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })))
    render(<LoginPage />)
    expect(await screen.findByRole('link', { name: '使用纷享销客登录' })).toHaveAttribute('href', '/api/auth/fxiaoke/start')
    expect(screen.queryByText('管理员应急登录')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('密码')).not.toBeInTheDocument()
  })

  it('never renders a dead SSO button when no provider is genuinely available', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ providers: [], providerStatus: 'paused' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })))
    render(<LoginPage />)
    expect(await screen.findByText(/纷享登录目前已暂停/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /纷享销客登录/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /请联系管理员开通/ })).not.toBeInTheDocument()
  })

  it('distinguishes missing configuration from a temporarily unavailable provider', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ providers: [], providerStatus: 'not_configured' })))
    const view = render(<LoginPage />)
    expect(await screen.findByText('纷享登录尚未配置，请联系管理员。')).toBeInTheDocument()
    view.unmount()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ providers: [], providerStatus: 'unavailable' }, { status: 503 })))
    render(<LoginPage />)
    expect(await screen.findByText('纷享登录服务暂时不可用，请稍后重试。')).toBeInTheDocument()
  })

  it('turns SSO callback failures into fixed user-facing messages', async () => {
    window.history.replaceState({}, '', '/login?sso_error=SSO_STATE_INVALID')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ providers: [] }), { status: 200 })))
    render(<LoginPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('企业登录状态已失效，请重新发起登录。')
  })

  it('shows a usable account form alongside the existing enterprise link when enabled', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      localAccountEnabled: true,
      providers: [{ id: 'fxiaoke', label: '纷享销客', startUrl: '/api/auth/fxiaoke/start' }],
    })))
    render(<LoginPage />)
    expect(await screen.findByLabelText('密码')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '使用纷享销客登录' })).toBeInTheDocument()
  })

  it('keeps enabled account admission available when Fxiaoke discovery returns 503', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      providers: [], localAccountEnabled: true, error: 'private provider diagnostic',
    }, { status: 503 })))
    render(<LoginPage />)
    expect(await screen.findByRole('button', { name: '登录' })).toBeInTheDocument()
    expect(screen.queryByText('private provider diagnostic')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /纷享销客登录/ })).not.toBeInTheDocument()
  })

  it('dismisses a previous enterprise failure when entering the account form without submitting credentials', async () => {
    window.history.replaceState({}, '', '/login?sso_error=SSO_IDENTITY_REJECTED')
    const fetcher = vi.fn(async () => Response.json({
      localAccountEnabled: true,
      providers: [{ id: 'fxiaoke', label: '纷享销客', startUrl: '/api/auth/fxiaoke/start' }],
    }))
    vi.stubGlobal('fetch', fetcher)
    render(<LoginPage />)
    expect(screen.getByRole('alert')).toHaveTextContent('企业登录提示')
    fireEvent.focus(await screen.findByLabelText('邮箱或手机号'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(window.location.search).toBe('')
    expect(fetcher).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '使用纷享销客登录' })).toBeInTheDocument()
  })

})

import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  fetch: vi.fn(),
  getItem: vi.fn(),
  prefetch: vi.fn(),
  primeHomeInitialData: vi.fn(),
  sendBeacon: vi.fn(),
}))

vi.mock('@sentry/nextjs', () => ({
  captureException: mocks.captureException,
}))

vi.mock('@/lib/home-data-client', () => ({
  primeHomeInitialData: mocks.primeHomeInitialData,
}))

import { scheduleBoundaryReport, warmHomeRecovery } from './error-recovery'

describe('error boundary recovery helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.fetch.mockResolvedValue(new Response(null, { status: 200 }))
    mocks.getItem.mockReturnValue('token-1')
    mocks.sendBeacon.mockReturnValue(true)
    vi.stubGlobal('fetch', mocks.fetch)
    vi.stubGlobal('localStorage', {
      getItem: mocks.getItem,
    })
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      value: mocks.sendBeacon,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('预热首页恢复链路，避免返回首页时才开始加载', () => {
    warmHomeRecovery({ prefetch: mocks.prefetch })

    expect(mocks.prefetch).toHaveBeenCalledWith('/')
    expect(mocks.primeHomeInitialData).toHaveBeenCalledWith('token-1')
  })

  it('延后错误上报，并优先使用 beacon 避免阻塞恢复操作', () => {
    const error = new Error('boom') as Error & { digest?: string }
    error.digest = 'digest-1'

    scheduleBoundaryReport(error)

    expect(mocks.captureException).not.toHaveBeenCalled()
    expect(mocks.sendBeacon).not.toHaveBeenCalled()

    act(() => {
      vi.runOnlyPendingTimers()
    })

    expect(mocks.captureException).toHaveBeenCalledWith(error, {
      tags: { source: 'error-boundary' },
    })
    expect(mocks.sendBeacon).toHaveBeenCalledWith('/api/client-errors', expect.any(Blob))
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})

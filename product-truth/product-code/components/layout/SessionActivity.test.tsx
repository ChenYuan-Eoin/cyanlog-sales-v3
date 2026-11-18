import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SessionActivity } from './SessionActivity'

const fetcher = vi.fn()
const clearSession = vi.hoisted(() => vi.fn())
vi.mock('@/lib/session-client', () => ({ clearClientSession: clearSession }))
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('React', React)
  vi.stubGlobal('fetch', fetcher)
  fetcher.mockReset().mockImplementation(async () => Response.json({ managed: true, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() }))
  clearSession.mockReset()
  localStorage.clear()
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals() })

it('never renews from polling, synthetic input or programmatic scrolling', async () => {
  const listen = vi.spyOn(window, 'addEventListener')
  await act(async () => { render(<SessionActivity />) })
  const pointer = listen.mock.calls.find(([name]) => name === 'pointerdown')![1] as EventListener
  await act(async () => {
    pointer({ isTrusted: false } as Event)
    await vi.advanceTimersByTimeAsync(29 * 60_000)
  })
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher.mock.calls[0][1].method).toBe('GET')
  expect(listen.mock.calls.some(([name]) => name === 'scroll')).toBe(false)
})

it('renews real foreground input and throttles repeated activity', async () => {
  const listen = vi.spyOn(window, 'addEventListener')
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  await act(async () => { render(<SessionActivity />) })
  const pointer = listen.mock.calls.find(([name]) => name === 'pointerdown')![1] as EventListener
  await act(async () => { pointer({ isTrusted: true } as Event) })
  await act(async () => { pointer({ isTrusted: true } as Event) })
  expect(fetcher.mock.calls.map(([, init]) => init.method)).toEqual(['GET', 'POST'])
})

it('does not clear a new account when an old request returns unauthorized', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {}) // jsdom does not implement full navigation.
  let finish!: (response: Response) => void
  fetcher.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve }))
  localStorage.setItem('token', 'old-session')
  await act(async () => { render(<SessionActivity />) })
  localStorage.setItem('token', 'new-session')
  await act(async () => { finish(new Response(null, { status: 401 })) })
  expect(clearSession).not.toHaveBeenCalled()
  expect(localStorage.getItem('token')).toBe('new-session')
})

it('stops using the old session after a cross-tab account change', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  localStorage.setItem('token', 'old-session')
  await act(async () => { render(<SessionActivity />) })
  await act(async () => {
    localStorage.setItem('token', 'new-session')
    window.dispatchEvent(new StorageEvent('storage', { key: 'token' }))
    await vi.advanceTimersByTimeAsync(31 * 60_000)
  })
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(clearSession).not.toHaveBeenCalled()
  expect(localStorage.getItem('token')).toBe('new-session')
})

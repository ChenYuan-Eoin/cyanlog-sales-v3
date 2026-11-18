import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SessionActivity } from './SessionActivity'

const fetcher = vi.fn()
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('React', React)
  vi.stubGlobal('fetch', fetcher)
  fetcher.mockReset().mockImplementation(async () => Response.json({ managed: true, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() }))
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

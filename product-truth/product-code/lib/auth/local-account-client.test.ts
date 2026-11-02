// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { completeLocalAccountLogin } from './local-account-client'
afterEach(() => { vi.unstubAllGlobals() })
describe('local account session handoff', () => {
  it('persists the shared client session before a full navigation to the fixed home route', () => {
    const replace = vi.fn()
    const persist = vi.fn()
    const writeCookie = vi.fn()
    vi.stubGlobal('window', { location: { replace } })
    vi.stubGlobal('localStorage', { setItem: persist })
    vi.stubGlobal('document', Object.defineProperty({}, 'cookie', { set: writeCookie }))
    completeLocalAccountLogin('example-local-session')
    expect(persist).toHaveBeenCalledWith('token', 'example-local-session')
    expect(writeCookie).not.toHaveBeenCalled()
    expect(replace).toHaveBeenCalledWith('/')
    expect(persist.mock.invocationCallOrder[0]).toBeLessThan(replace.mock.invocationCallOrder[0])
  })
})

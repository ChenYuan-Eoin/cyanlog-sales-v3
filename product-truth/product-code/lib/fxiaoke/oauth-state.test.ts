// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFxiaokeOAuthContext, readFxiaokeOAuthContext } from './oauth-state'
import { fxiaokeReturnPath } from './return-path'

const state = 'a'.repeat(32)
const revision = '33333333-3333-4333-8333-333333333333'

describe('Fxiaoke OAuth browser context', () => {
  beforeEach(() => vi.stubEnv('ORGANIZATION_CREDENTIALS_ENCRYPTION_KEY', 'ab'.repeat(32)))
  afterEach(() => vi.unstubAllEnvs())

  it('binds the original business URL and credential revision to one random state', () => {
    const next = '/shipping?tab=orders#record'
    const cookie = createFxiaokeOAuthContext(state, revision, next)
    expect(readFxiaokeOAuthContext(state, cookie)).toEqual({ revision, next })
    expect(readFxiaokeOAuthContext('b'.repeat(32), cookie)).toBeNull()
    const [payload, signature] = cookie.split('.')
    const changed = Buffer.from(JSON.stringify({ revision, next: '/configs?tab=integrations' })).toString('base64url')
    expect(readFxiaokeOAuthContext(state, `${changed}.${signature}`)).toBeNull()
    expect(readFxiaokeOAuthContext(state, `${payload}.${signature.slice(2)}`)).toBeNull()
  })

  it.each(['https://example.org', '//example.org', '/\\example.org', '/%2Fexample.org', '/.//example.org',
    '/%09example.org', '/a/../login', '/%6Cogin', '/api/auth/fxiaoke/start', '/accept-invitation?secret=example'])
  ('rejects unsafe targets and authentication routes %s', target => {
    expect(fxiaokeReturnPath(target)).toBeNull()
    expect(readFxiaokeOAuthContext(state, createFxiaokeOAuthContext(state, revision, target)))
      .toEqual({ revision, next: null })
  })

  it('requires persistent server signing material', () => {
    vi.stubEnv('ORGANIZATION_CREDENTIALS_ENCRYPTION_KEY', '')
    vi.stubEnv('SHIPPING_CREDENTIALS_ENCRYPTION_KEY', '')
    expect(() => createFxiaokeOAuthContext(state, revision, null)).toThrow()
  })
})

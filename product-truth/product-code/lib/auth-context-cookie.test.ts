import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createAuthContextCookieValue,
  readAuthContextCookieValue,
} from './auth-context-cookie'

const originalSecret = process.env.AUTH_CONTEXT_SECRET
const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
let secretSequence = 0

function makeInput() {
  return {
    userId: '30000001-0000-0000-0000-000000000000',
    orgId: '10000001-0000-0000-0000-000000000000',
    roleCodes: ['SUPER_ADMIN'],
    allPermissions: ['*'],
    full: true,
  }
}

describe('auth context cookie signing', () => {
  beforeEach(() => {
    secretSequence += 1
    process.env.AUTH_CONTEXT_SECRET = `test-auth-context-secret-${secretSequence}`
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
  })

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.AUTH_CONTEXT_SECRET
    } else {
      process.env.AUTH_CONTEXT_SECRET = originalSecret
    }

    if (originalServiceRoleKey === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey
    }

    vi.restoreAllMocks()
  })

  it('复用同一 secret 的 HMAC key', async () => {
    const importKey = vi.spyOn(crypto.subtle, 'importKey')

    const first = await createAuthContextCookieValue('token-1', makeInput())
    const second = await createAuthContextCookieValue('token-2', makeInput())

    expect(first).toBeTruthy()
    expect(second).toBeTruthy()
    expect(importKey).toHaveBeenCalledTimes(1)
  })

  it('secret 变化后重新导入 HMAC key 并拒绝旧签名', async () => {
    const importKey = vi.spyOn(crypto.subtle, 'importKey')
    const first = await createAuthContextCookieValue('token-1', makeInput())

    process.env.AUTH_CONTEXT_SECRET = `test-auth-context-secret-${secretSequence}-rotated`
    const second = await createAuthContextCookieValue('token-1', makeInput())

    expect(importKey).toHaveBeenCalledTimes(2)
    expect(first).toBeTruthy()
    expect(second).toBeTruthy()
    expect(await readAuthContextCookieValue('token-1', first || undefined)).toBeNull()
    expect(await readAuthContextCookieValue('token-1', second || undefined)).toMatchObject({
      userId: '30000001-0000-0000-0000-000000000000',
      orgId: '10000001-0000-0000-0000-000000000000',
      roleCodes: ['SUPER_ADMIN'],
      allPermissions: ['*'],
      full: true,
    })
  })
})

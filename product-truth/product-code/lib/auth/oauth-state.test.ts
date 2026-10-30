// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  inserts: [] as Array<Record<string, unknown>>,
  insertError: null as null | { message: string },
  rpcData: null as unknown,
  rpcError: null as null | { message: string },
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      insert: vi.fn(async (row: Record<string, unknown>) => {
        db.inserts.push(row)
        return { error: db.insertError }
      }),
    })),
    rpc: vi.fn(async () => ({ data: db.rpcData, error: db.rpcError })),
  },
}))

import {
  createOAuthState,
  consumeOAuthState,
  hashOAuthState,
  oauthStatesMatch,
} from './oauth-state'

const orgId = '00000001-0000-0000-0000-000000000000'
const redirectUrl = 'https://sales.cyanlog.icu/api/auth/fxiaoke/callback'

describe('Fxiaoke OAuth state', () => {
  beforeEach(() => {
    db.inserts.length = 0
    db.insertError = null
    db.rpcData = null
    db.rpcError = null
  })

  it('stores only a hash of a random state and returns the raw state to the browser', async () => {
    const result = await createOAuthState(orgId, redirectUrl)

    expect(result.state).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(db.inserts).toHaveLength(1)
    expect(db.inserts[0]).toMatchObject({ system_org_id: orgId, redirect_url: redirectUrl })
    expect(db.inserts[0].state_hash).toBe(hashOAuthState(result.state))
    expect(JSON.stringify(db.inserts[0])).not.toContain(result.state)
  })

  it('supports database seed UUIDs without RFC version bits', async () => {
    const result = await createOAuthState(orgId, redirectUrl)
    expect(db.inserts[0]).toMatchObject({ system_org_id: orgId, redirect_url: redirectUrl })
    expect(result.state).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('atomically consumes one exact organization-bound redirect and rejects expired or replayed state', async () => {
    const state = 'a'.repeat(43)
    db.rpcData = [{ system_org_id: orgId, redirect_url: redirectUrl }]
    await expect(consumeOAuthState(state)).resolves.toEqual({ orgId, redirectUrl })

    db.rpcData = []
    await expect(consumeOAuthState(state)).resolves.toBeNull()
    await expect(consumeOAuthState('not-valid')).resolves.toBeNull()
  })

  it('compares state cookies in constant time and fails closed on missing or malformed values', () => {
    const state = 'b'.repeat(43)
    expect(oauthStatesMatch(state, state)).toBe(true)
    expect(oauthStatesMatch(state, 'c'.repeat(43))).toBe(false)
    expect(oauthStatesMatch(undefined, state)).toBe(false)
    expect(oauthStatesMatch(state, 'short')).toBe(false)
  })

  it('never reflects storage failures or raw state values', async () => {
    db.insertError = { message: 'database secret' }
    await expect(createOAuthState(orgId, redirectUrl)).rejects.toMatchObject({
      code: 'OAUTH_STATE_STORE_UNAVAILABLE',
    })

    db.rpcError = { message: 'database secret' }
    await expect(consumeOAuthState('d'.repeat(43))).rejects.not.toThrow('database secret')
  })
})

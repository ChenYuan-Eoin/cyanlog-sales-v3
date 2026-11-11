// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ state: {} as any, compare: vi.fn(), issue: vi.fn(), revoke: vi.fn(), inserts: [] as any[], accountKeys: [] as string[] }))
vi.mock('bcryptjs', () => ({ default: { compare: mocks.compare } }))
vi.mock('./session-response', () => ({ issueSystemSession: mocks.issue }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn((table: string) => {
  if (table === 'auth_tokens') return { delete: () => ({ eq: mocks.revoke }) }
  let operation = 'read'
  let payload: any
  const filters: Record<string, unknown> = {}
  const query: any = {
    select: () => query,
    eq: (key: string, value: unknown) => { filters[key] = value; return query },
    gte: () => query,
    order: () => query,
    insert: (value: any) => { operation = 'insert'; payload = value; mocks.inserts.push({ table, payload }); return query },
    update: (value: any) => { operation = 'update'; payload = value; return query },
    limit: async () => {
      const s = mocks.state
      if (table === 'users') return { data: s.users, error: s.usersError }
      if (table === 'user_organizations') return { data: s.memberships, error: s.memberError }
      if (table === 'login_attempts') {
        if (filters.identifier) mocks.accountKeys.push(String(filters.identifier))
        const rows = s.sharedReservations
          ? s.reservations.filter((row: any) => row.success === false && (filters.identifier ? row.identifier === filters.identifier : row.ip_address === filters.ip_address))
          : filters.identifier ? s.accountFailures : s.ipFailures
        return { data: rows, error: s.readError }
      }
      throw new Error(`unexpected read ${table}`)
    },
    maybeSingle: async () => table === 'users'
      ? { data: mocks.state.users.find((user: any) => user.id === filters.id) ?? null, error: mocks.state.freshUserError }
      : { data: mocks.state.organization, error: mocks.state.orgError },
    single: async () => {
      if (table !== 'login_attempts') throw new Error(`unexpected single ${table}`)
      if (operation === 'insert') {
        mocks.state.attemptId = payload.id
        if (mocks.state.sharedReservations) mocks.state.reservations.push({ ...payload, attempted_at: new Date().toISOString() })
        return { data: { id: payload.id, attempted_at: new Date().toISOString() }, error: mocks.state.insertError }
      }
      if (operation === 'update') {
        const reserved = mocks.state.reservations?.find((row: any) => row.id === filters.id)
        if (reserved) reserved.success = payload.success
        return { data: { id: filters.id }, error: mocks.state.auditError }
      }
      throw new Error('unexpected single operation')
    },
  }
  return query
}) } }))

import { loginExistingLocalAccount, parseLocalLoginInput, validateLocalLoginRequest } from './local-account'
import { isLocalAccountLoginEnabled } from './local-account-config'
const userId = '11111111-1111-4111-8111-111111111111'
const orgId = '22222222-2222-4222-8222-222222222222'
const hash = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.3DKN29OMzysfeCgONBqIh9sB1laRVHy'
const input = { kind: 'email' as const, identifier: 'member@example.test', password: 'example-correct-password' }
const failures = (n: number) => Array.from({ length: n }, () => ({ attempted_at: new Date().toISOString() }))
const request = (body: string, headers: Record<string, string> = {}, origin = 'https://sales.cyanlog.icu') => new NextRequest(`${origin}/api/auth/login`, {
  method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-real-ip': '203.0.113.1', ...headers }, body,
})

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('VERCEL', '1')
  vi.stubEnv('LOCAL_ACCOUNT_LOGIN_ENABLED', 'true')
  mocks.state = {
    users: [{ id: userId, password_hash: hash, must_change_password: false, status: 'active', login_enabled: true }],
    memberships: [{ org_id: orgId, status: 'active', employment_status: 'active', is_default: true, left_at: null }],
    organization: { id: orgId, status: 'active' }, accountFailures: failures(1), ipFailures: failures(1),
  }
  mocks.inserts.length = 0
  mocks.accountKeys.length = 0
  mocks.compare.mockReset().mockResolvedValue(true)
  mocks.issue.mockReset().mockResolvedValue({ sessionId: 'session-id', token: 'example-local-session', expiresAt: new Date('2030-01-01'), authContextCookie: 'signed' })
  mocks.revoke.mockReset().mockResolvedValue({ error: null })
})
afterEach(() => vi.unstubAllEnvs())

describe('existing member credential admission', () => {
  it('uses the same UUID session issuer and does not provision or bind identities', async () => {
    const session = await loginExistingLocalAccount(input, '203.0.113.1')
    expect(session.token).toBe('example-local-session')
    expect(mocks.issue).toHaveBeenCalledWith(userId, orgId)
    expect(mocks.inserts.map(entry => entry.table)).toEqual(['login_attempts'])
    expect(mocks.inserts[0].payload.success).toBe(false)
    expect(mocks.accountKeys).toEqual([`local:user:${userId}`])
  })

  it('makes email and phone aliases share the canonical account limit', async () => {
    await loginExistingLocalAccount(input, '203.0.113.1')
    await loginExistingLocalAccount({ ...input, kind: 'phone', identifier: '13800138000' }, '203.0.113.1')
    expect(new Set(mocks.accountKeys)).toEqual(new Set([`local:user:${userId}`]))
  })

  it.each([
    ['unknown', (s: any) => { s.users = [] }],
    ['ambiguous', (s: any) => { s.users.push({ ...s.users[0], id: orgId }) }],
    ['missing hash', (s: any) => { s.users[0].password_hash = null }],
    ['invalid hash', (s: any) => { s.users[0].password_hash = 'invalid' }],
    ['forced change', (s: any) => { s.users[0].must_change_password = true }],
    ['disabled', (s: any) => { s.users[0].login_enabled = false }],
    ['inactive', (s: any) => { s.users[0].status = 'inactive' }],
    ['no default membership', (s: any) => { s.memberships = [] }],
    ['duplicate default', (s: any) => { s.memberships.push({ ...s.memberships[0] }) }],
    ['invited', (s: any) => { s.memberships[0].status = 'invited' }],
    ['suspended employment', (s: any) => { s.memberships[0].employment_status = 'suspended' }],
    ['ended', (s: any) => { s.memberships[0].left_at = new Date().toISOString() }],
    ['inactive organization', (s: any) => { s.organization.status = 'inactive' }],
  ])('rejects %s without issuing any session', async (_, change) => {
    change(mocks.state)
    await expect(loginExistingLocalAccount(input, '203.0.113.1')).rejects.toMatchObject({ code: 'AUTH_FAILED' })
    expect(mocks.issue).not.toHaveBeenCalled()
  })

  it('rejects wrong passwords and zero fresh organization roles', async () => {
    mocks.compare.mockResolvedValueOnce(false)
    await expect(loginExistingLocalAccount(input, '203.0.113.1')).rejects.toMatchObject({ code: 'AUTH_FAILED' })
    mocks.issue.mockRejectedValueOnce(Object.assign(new Error('no role'), { code: 'SESSION_NO_ROLE' }))
    await expect(loginExistingLocalAccount(input, '203.0.113.1')).rejects.toMatchObject({ code: 'AUTH_FAILED' })
  })

  it.each([['account', 5, 1], ['IP', 1, 15]])('admits the final allowed %s attempt including the reservation', async (_, a, i) => {
    mocks.state.accountFailures = failures(a)
    mocks.state.ipFailures = failures(i)
    await expect(loginExistingLocalAccount(input, '203.0.113.1')).resolves.toMatchObject({ token: 'example-local-session' })
  })

  it.each([['account', 6, 1], ['IP', 1, 16]])('blocks the next %s attempt before bcrypt', async (_, a, i) => {
    mocks.state.accountFailures = failures(a)
    mocks.state.ipFailures = failures(i)
    await expect(loginExistingLocalAccount(input, '203.0.113.1')).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    expect(mocks.compare).not.toHaveBeenCalled()
    expect(mocks.issue).not.toHaveBeenCalled()
  })

  it('counts an in-flight reservation against concurrent attempts before bcrypt finishes', async () => {
    mocks.state.sharedReservations = true
    mocks.state.reservations = []
    let release: (matches: boolean) => void = () => {}
    mocks.compare.mockImplementationOnce(() => new Promise<boolean>(resolve => { release = resolve }))
    const first = loginExistingLocalAccount(input, '203.0.113.1')
    await vi.waitFor(() => expect(mocks.compare).toHaveBeenCalledOnce())
    const rest = await Promise.allSettled(Array.from({ length: 8 }, () => loginExistingLocalAccount(input, '203.0.113.1')))
    expect(rest.filter(result => result.status === 'fulfilled')).toHaveLength(0)
    for (const result of rest) {
      expect(result.status === 'rejected' && result.reason.code).toBe('RATE_LIMITED')
    }
    expect(mocks.compare).toHaveBeenCalledOnce()
    release(true)
    await expect(first).resolves.toMatchObject({ token: 'example-local-session' })
  })

  it.each(['usersError', 'insertError', 'readError', 'memberError', 'orgError', 'freshUserError'])('fails closed on %s', async key => {
    mocks.state[key] = { code: 'unavailable' }
    await expect(loginExistingLocalAccount(input, '203.0.113.1')).rejects.toMatchObject({ code: 'UNAVAILABLE' })
    expect(mocks.issue).not.toHaveBeenCalled()
  })

  it('rejects a credential changed while bcrypt was running before creating a session', async () => {
    mocks.compare.mockImplementationOnce(async () => {
      mocks.state.users[0].password_hash = hash.slice(0, -1) + 'z'
      return true
    })
    await expect(loginExistingLocalAccount(input, '203.0.113.1')).rejects.toMatchObject({ code: 'AUTH_FAILED' })
    expect(mocks.issue).not.toHaveBeenCalled()
  })

  it('revokes a new token if credentials are forced to change during session issuance', async () => {
    mocks.issue.mockImplementationOnce(async () => {
      mocks.state.users[0].must_change_password = true
      return { sessionId: 'session-id', token: 'example-local-session', expiresAt: new Date('2030-01-01'), authContextCookie: 'signed' }
    })
    await expect(loginExistingLocalAccount(input, '203.0.113.1')).rejects.toMatchObject({ code: 'AUTH_FAILED' })
    expect(mocks.revoke).toHaveBeenCalledWith('token', 'example-local-session')
  })

  it('revokes a new token if successful audit persistence fails', async () => {
    mocks.state.auditError = { code: 'unavailable' }
    await expect(loginExistingLocalAccount(input, '203.0.113.1')).rejects.toMatchObject({ code: 'UNAVAILABLE' })
    expect(mocks.revoke).toHaveBeenCalledWith('token', 'example-local-session')
  })

  it('revokes a new token if membership changes during issuance', async () => {
    mocks.issue.mockImplementationOnce(async () => {
      mocks.state.memberships[0].employment_status = 'ended'
      return { sessionId: 'session-id', token: 'example-local-session', expiresAt: new Date('2030-01-01'), authContextCookie: 'signed' }
    })
    await expect(loginExistingLocalAccount(input, '203.0.113.1')).rejects.toMatchObject({ code: 'AUTH_FAILED' })
    expect(mocks.revoke).toHaveBeenCalledWith('token', 'example-local-session')
  })
})

describe('request and password boundaries', () => {
  it('requires exact opt-in, a fixed same Origin and a platform-owned single IP', () => {
    expect(isLocalAccountLoginEnabled()).toBe(true)
    vi.stubEnv('LOCAL_ACCOUNT_LOGIN_ENABLED', '1')
    expect(isLocalAccountLoginEnabled()).toBe(false)
    const req = request('{}', { 'cf-connecting-ip': '198.51.100.8', 'x-forwarded-for': '198.51.100.9', 'x-vercel-forwarded-for': '198.51.100.10' })
    expect(validateLocalLoginRequest(req)).toBe('203.0.113.1')
    expect(() => validateLocalLoginRequest(request('{}', { origin: 'https://evil.test' }))).toThrow('INVALID_REQUEST')
    expect(() => validateLocalLoginRequest(request('{}', { 'x-real-ip': '203.0.113.1, 198.51.100.1' }))).toThrow('UNAVAILABLE')
    vi.stubEnv('VERCEL', '0')
    expect(() => validateLocalLoginRequest(request('{}'))).toThrow('UNAVAILABLE')
  })

  it('normalizes equivalent IPv6 representations into one limiter key', () => {
    const a = validateLocalLoginRequest(request('{}', { 'x-real-ip': '2001:db8::1' }))
    const b = validateLocalLoginRequest(request('{}', { 'x-real-ip': '2001:0DB8:0:0:0:0:0:1' }))
    expect(a).toBe(b)
  })

  it.each([
    JSON.stringify({ identifier: 'member@example.test', password: 'a'.repeat(73) }),
    JSON.stringify({ identifier: 'member@example.test', password: '界'.repeat(25) }),
    JSON.stringify({ identifier: 'member@example.test', password: 'good', orgId: 'injected' }),
    JSON.stringify({ identifier: 'member@example.test', password: 'a\0b' }),
    'not-json',
    'x'.repeat(1025),
  ])('rejects malformed or truncated input without touching storage', async body => {
    await expect(parseLocalLoginInput(request(body, { 'content-length': '1' }))).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect(mocks.inserts).toHaveLength(0)
  })

  it('preserves password whitespace and exact email semantics', async () => {
    await expect(parseLocalLoginInput(request(JSON.stringify({ identifier: ' member@example.test ', password: ' abc ' })))).resolves.toEqual({ kind: 'email', identifier: 'member@example.test', password: ' abc ' })
  })
})

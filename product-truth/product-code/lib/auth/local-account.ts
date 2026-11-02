// F003 / WP94: existing accounts only. No provisioning, password mutation or RPC fallback.
import { createHash, randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import bcrypt from 'bcryptjs'
import ipaddr from 'ipaddr.js'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { issueSystemSession, type IssuedSystemSession } from './session-response'

const BODY_LIMIT_BYTES = 1024
const WINDOW_MS = 15 * 60 * 1000
const ACCOUNT_LIMIT = 5
const IP_LIMIT = 15
// Public work-only hash; never accepted as an account credential.
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.3DKN29OMzysfeCgONBqIh9sB1laRVHy'
const emailSchema = z.string().email().max(254)

type AccountInput = { kind: 'email' | 'phone'; identifier: string; password: string }
type AccountRow = {
  id: string
  password_hash: string | null
  must_change_password: boolean
  status: string | null
  login_enabled: boolean
}

export class LocalAccountLoginError extends Error {
  constructor(readonly code: 'INVALID_REQUEST' | 'AUTH_FAILED' | 'RATE_LIMITED' | 'UNAVAILABLE', readonly retryAfter?: number) {
    super(code)
    this.name = 'LocalAccountLoginError'
  }
}

function unavailable(): never { throw new LocalAccountLoginError('UNAVAILABLE') }
function denied(): never { throw new LocalAccountLoginError('AUTH_FAILED') }

export function validateLocalLoginRequest(req: NextRequest): string {
  const url = new URL(req.url)
  const origin = req.headers.get('origin')
  const local = process.env.NODE_ENV !== 'production'
    && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  const expectedOrigin = local ? url.origin : 'https://sales.cyanlog.icu'
  if (origin !== expectedOrigin
    || (!local && (url.hostname !== 'sales.cyanlog.icu' || url.protocol !== 'https:'))
    || !['same-origin', null].includes(req.headers.get('sec-fetch-site'))
    || req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new LocalAccountLoginError('INVALID_REQUEST')
  }
  const declaredLength = req.headers.get('content-length')
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > BODY_LIMIT_BYTES)) {
    throw new LocalAccountLoginError('INVALID_REQUEST')
  }
  if (local) return '127.0.0.1'
  // Vercel overwrites this header at its edge. Other forwarded/CF headers are ignored.
  if (process.env.VERCEL !== '1') unavailable()
  const ip = req.headers.get('x-real-ip')
  if (!ip || ip.length > 64 || isIP(ip) === 0) unavailable()
  return ipaddr.process(ip).toNormalizedString()
}

export async function parseLocalLoginInput(req: NextRequest): Promise<AccountInput> {
  if (!req.body) throw new LocalAccountLoginError('INVALID_REQUEST')
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}) }, 5000)
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > BODY_LIMIT_BYTES) {
        await reader.cancel()
        throw new LocalAccountLoginError('INVALID_REQUEST')
      }
      chunks.push(value)
    }
    if (timedOut) throw new LocalAccountLoginError('INVALID_REQUEST')
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || Object.keys(raw).sort().join(',') !== 'identifier,password') throw new Error('shape')
    const values = raw as Record<string, unknown>
    if (typeof values.identifier !== 'string' || typeof values.password !== 'string') throw new Error('shape')
    const identifier = values.identifier.trim()
    const password = values.password
    if (!password || password.includes('\0') || Buffer.byteLength(password, 'utf8') > 72) throw new Error('password length')
    if (emailSchema.safeParse(identifier).success) return { kind: 'email', identifier, password }
    if (/^1[3-9]\d{9}$/.test(identifier)) return { kind: 'phone', identifier, password }
    throw new Error('identifier')
  } catch (error) {
    if (error instanceof LocalAccountLoginError) throw error
    throw new LocalAccountLoginError('INVALID_REQUEST')
  } finally {
    clearTimeout(timer)
    reader.releaseLock()
  }
}

async function reserveAttempt(accountKey: string, ip: string): Promise<string> {
  const id = randomUUID()
  const result = await supabaseAdmin.from('login_attempts')
    .insert({ id, identifier: accountKey, ip_address: ip, success: false })
    .select('id,attempted_at').single()
  const attemptedAt = Date.parse(result.data?.attempted_at ?? '')
  if (result.error || result.data?.id !== id || !Number.isFinite(attemptedAt)) unavailable()
  const since = new Date(attemptedAt - WINDOW_MS).toISOString()
  const readFailures = (column: 'identifier' | 'ip_address', value: string, limit: number) =>
    supabaseAdmin.from('login_attempts').select('attempted_at').eq(column, value)
      .eq('success', false).gte('attempted_at', since)
      .order('attempted_at', { ascending: true }).limit(limit + 1)
  const [account, address] = await Promise.all([
    readFailures('identifier', accountKey, ACCOUNT_LIMIT),
    readFailures('ip_address', ip, IP_LIMIT),
  ])
  if (account.error || address.error || !Array.isArray(account.data) || !Array.isArray(address.data)) unavailable()
  const exceeded = account.data.length > ACCOUNT_LIMIT ? account.data
    : address.data.length > IP_LIMIT ? address.data : null
  if (exceeded) {
    const oldest = Date.parse(exceeded[0]?.attempted_at ?? '')
    if (!Number.isFinite(oldest)) unavailable()
    throw new LocalAccountLoginError('RATE_LIMITED', Math.max(1, Math.ceil((oldest + WINDOW_MS - Date.now()) / 1000)))
  }
  return id
}

async function activeOrganizationFor(userId: string): Promise<string> {
  const result = await supabaseAdmin.from('user_organizations')
    .select('org_id,status,employment_status,is_default,left_at')
    .eq('user_id', userId).eq('is_default', true).limit(2)
  if (result.error || !Array.isArray(result.data)) unavailable()
  if (result.data.length !== 1) denied()
  const member = result.data[0]
  if (member.status !== 'active' || member.employment_status !== 'active'
    || member.is_default !== true || member.left_at !== null || typeof member.org_id !== 'string') denied()
  const organization = await supabaseAdmin.from('organizations').select('id,status').eq('id', member.org_id).maybeSingle()
  if (organization.error) unavailable()
  if (organization.data?.id !== member.org_id || organization.data?.status !== 'active') denied()
  return member.org_id
}

async function assertCurrentCredential(userId: string, verifiedHash: string): Promise<void> {
  const current = await supabaseAdmin.from('users')
    .select('id,password_hash,must_change_password,status,login_enabled').eq('id', userId).maybeSingle()
  if (current.error) unavailable()
  if (current.data?.id !== userId || current.data.password_hash !== verifiedHash
    || current.data.must_change_password !== false || current.data.status !== 'active'
    || current.data.login_enabled !== true) denied()
}

export async function revokeLocalLoginSession(token: string): Promise<void> {
  const result = await supabaseAdmin.from('auth_tokens').delete().eq('token', token)
  if (result.error) unavailable()
}

export async function loginExistingLocalAccount(input: AccountInput, ip: string): Promise<IssuedSystemSession> {
  // Exact identifier lookup preserves the existing email semantics; never OR/LIMIT 1.
  const candidates = await supabaseAdmin.from('users')
    .select('id,password_hash,must_change_password,status,login_enabled')
    .eq(input.kind, input.identifier).limit(2)
  if (candidates.error || !Array.isArray(candidates.data)) unavailable()
  const user = candidates.data.length === 1 ? candidates.data[0] as AccountRow : null
  // Both aliases of a unique user share one account limit. Unknown/ambiguous inputs stay private.
  const accountKey = user ? `local:user:${user.id}`
    : `local:unknown:${createHash('sha256').update(input.identifier.toLowerCase()).digest('hex')}`
  const attemptId = await reserveAttempt(accountKey, ip)
  const hash = user?.password_hash
  const usableHash = typeof hash === 'string'
    && /^\$2[aby]\$(0[4-9]|1[0-4])\$[./A-Za-z0-9]{53}$/.test(hash)
  const passwordMatches = await bcrypt.compare(input.password, usableHash ? hash : DUMMY_HASH).catch(() => false)
  if (!user || !usableHash || !passwordMatches || user.status !== 'active'
    || user.login_enabled !== true || user.must_change_password !== false) denied()
  const orgId = await activeOrganizationFor(user.id)
  await assertCurrentCredential(user.id, hash)
  let session: IssuedSystemSession | null = null
  try {
    session = await issueSystemSession(user.id, orgId)
    await assertCurrentCredential(user.id, hash)
    // Recheck membership after issuance; the shared issuer already refreshes global status/roles.
    if (await activeOrganizationFor(user.id) !== orgId) denied()
    const audit = await supabaseAdmin.from('login_attempts').update({ success: true })
      .eq('id', attemptId).eq('success', false).select('id').single()
    if (audit.error || audit.data?.id !== attemptId) unavailable()
    return session
  } catch (error) {
    if (session) {
      // Never expose cookies/token after a failed post-issuance check or audit.
      // If the database itself is unavailable, revocation cannot be proven; fail closed to the caller.
      await revokeLocalLoginSession(session.token)
    }
    if (error instanceof LocalAccountLoginError) throw error
    if (error instanceof Error && ['SESSION_USER_DISABLED', 'SESSION_USER_NOT_FOUND', 'SESSION_NO_ROLE'].includes((error as Error & { code?: string }).code ?? '')) denied()
    unavailable()
  }
}

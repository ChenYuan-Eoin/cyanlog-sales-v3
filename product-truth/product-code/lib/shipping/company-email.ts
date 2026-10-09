import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

// This identity grants workorder submission only, never shipping:operate.
export const EMPLOYEE_SESSION_COOKIE = 'shipping_employee_session'
export const EMPLOYEE_SESSION_MAX_AGE_SECONDS = 60 * 24 * 60 * 60
export const EMAIL_CODE_LIFETIME_SECONDS = 10 * 60
export const EMAIL_CODE_MAX_ATTEMPTS = 5

const emailSchema = z.email().max(254)
const domainSchema = z.string().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/)

export function normalizeEmployeeEmail(value: string): string {
  return emailSchema.parse(value.trim()).toLowerCase()
}

export function normalizeCompanyEmailDomains(values: readonly string[]): string[] {
  return [...new Set(values.map(value => domainSchema.parse(value.trim().replace(/^@/, '').toLowerCase())))].sort()
}

export function companyEmailAllowed(value: string, domains: readonly string[]): boolean {
  try {
    const email = normalizeEmployeeEmail(value)
    return normalizeCompanyEmailDomains(domains).includes(email.slice(email.lastIndexOf('@') + 1))
  } catch { return false }
}

export function newEmployeeEmailCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}

export function employeeEmailCodeHash(args: { secret: string; orgId: string; email: string; challengeId: string; code: string }): string {
  if (args.secret.length < 32 || !args.orgId || !args.challengeId || !/^\d{6}$/.test(args.code)) throw new Error('Invalid email challenge configuration')
  return createHmac('sha256', args.secret).update(JSON.stringify(['shipping-email-code-v1', args.orgId, normalizeEmployeeEmail(args.email), args.challengeId, args.code])).digest('hex')
}

export function emailCodeHashesEqual(expected: string, actual: string): boolean {
  return /^[a-f0-9]{64}$/.test(expected) && /^[a-f0-9]{64}$/.test(actual) && timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'))
}

export function newEmployeeSessionToken(): string { return randomBytes(32).toString('base64url') }

export function employeeSessionTokenHash(token: string): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Invalid employee session token')
  return createHash('sha256').update(`shipping-employee-session-v1\0${token}`).digest('hex')
}

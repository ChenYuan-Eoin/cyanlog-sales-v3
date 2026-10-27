// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { issueWecomRuntimeEnrollment, verifyWecomRuntimeEnrollment } from './wecom-runtime-enrollment'

afterEach(() => vi.unstubAllEnvs())

it('issues a short-lived token bound to one bot configuration version', () => {
  vi.stubEnv('SHIPPING_RECEIPT_SECRET', 's'.repeat(40))
  const issued = issueWecomRuntimeEnrollment('bot-row', 'version-a', 1_000_000)
  expect(issued.expiresAt).toBe('1970-01-01T00:26:40.000Z')
  expect(() => verifyWecomRuntimeEnrollment(issued.token, 'bot-row', 'version-a', 1_000_000)).not.toThrow()
  expect(() => verifyWecomRuntimeEnrollment(issued.token, 'other-bot', 'version-a', 1_000_000)).toThrow('无效')
  expect(() => verifyWecomRuntimeEnrollment(issued.token, 'bot-row', 'version-b', 1_000_000)).toThrow('无效')
  expect(() => verifyWecomRuntimeEnrollment(issued.token, 'bot-row', 'version-a', 1_601_000)).toThrow('过期')
})

it('rejects an altered token', () => {
  vi.stubEnv('SHIPPING_RECEIPT_SECRET', 's'.repeat(40))
  const { token } = issueWecomRuntimeEnrollment('bot-row', 'version-a', 1_000_000)
  const altered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`
  expect(() => verifyWecomRuntimeEnrollment(altered, 'bot-row', 'version-a', 1_000_000)).toThrow('无效')
})

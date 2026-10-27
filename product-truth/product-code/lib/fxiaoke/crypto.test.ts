// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { decryptCredentials, encryptCredentials } from './crypto'
afterEach(() => vi.unstubAllEnvs())
it('binds ciphertext to its organization and detects tampering', () => {
  vi.stubEnv('ORGANIZATION_CREDENTIALS_ENCRYPTION_KEY', 'ab'.repeat(32))
  const secret = 'test-only-credential'
  const encrypted = encryptCredentials('org-a', secret)
  expect(encrypted).not.toContain(secret)
  expect(decryptCredentials('org-a', encrypted)).toBe(secret)
  expect(() => decryptCredentials('org-b', encrypted)).toThrow('无法读取')
  expect(() => decryptCredentials('org-a', encrypted.slice(0, -4) + 'AAAA')).toThrow('无法读取')
})
it('fails closed if encryption key is unavailable', () => {
  vi.stubEnv('ORGANIZATION_CREDENTIALS_ENCRYPTION_KEY', '')
  vi.stubEnv('SHIPPING_CREDENTIALS_ENCRYPTION_KEY', '')
  expect(() => encryptCredentials('org-a', 'secret')).toThrow('未配置')
})

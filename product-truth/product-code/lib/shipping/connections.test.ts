import { afterEach, describe, expect, it, vi } from 'vitest'
import { decryptShippingSecret, encryptShippingSecret } from './connections'

describe('encrypted carrier configuration secrets', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('encrypts with authenticated AES-GCM and decrypts only on the server', () => {
    vi.stubEnv('SHIPPING_CREDENTIALS_ENCRYPTION_KEY', '11'.repeat(32))
    const secret = JSON.stringify({ partnerId: 'partner-8391', checkWord: 'check-word-private' })
    const ciphertext = encryptShippingSecret(secret)
    expect(ciphertext).not.toContain('partner-8391')
    expect(ciphertext).not.toContain('check-word-private')
    expect(decryptShippingSecret(ciphertext)).toBe(secret)
  })

  it('rejects modified ciphertext and refuses a missing or malformed key', () => {
    vi.stubEnv('SHIPPING_CREDENTIALS_ENCRYPTION_KEY', '22'.repeat(32))
    const ciphertext = encryptShippingSecret('secret-value')
    const [version, iv, tag, encryptedData] = ciphertext.split('.')
    const modifiedTag = `${tag[0] === 'A' ? 'B' : 'A'}${tag.slice(1)}`
    expect(() => decryptShippingSecret(`${version}.${iv}.${modifiedTag}.${encryptedData}`)).toThrow('无法解密')
    vi.stubEnv('SHIPPING_CREDENTIALS_ENCRYPTION_KEY', '')
    expect(() => encryptShippingSecret('secret-value')).toThrow('加密密钥尚未配置')
  })
})

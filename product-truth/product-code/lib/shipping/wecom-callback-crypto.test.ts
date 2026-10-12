// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createCipheriv, createHash } from 'node:crypto'
import { decryptWecomCallback, encryptWecomCallback, newWecomCallbackKeys, validateWecomCallbackKeys } from './wecom-callback-crypto'
const now = 1791780000000
const keys = { token: 'exampleCallbackToken', encodingAESKey: Buffer.alloc(32, 7).toString('base64').slice(0, -1) }
const reply = (message = '回调验证消息') => encryptWecomCallback(keys, message, 'example-nonce', now)
function decode(value: ReturnType<typeof reply>, at = now) { return decryptWecomCallback(keys, { signature: value.msgsignature, timestamp: String(value.timestamp), nonce: value.nonce }, value.encrypt, at) }
describe('WeCom internal robot callback cryptography', () => {
  it('round trips UTF-8 JSON and URL challenge text with empty ReceiveId', () => {
    expect(decode(reply())).toBe('回调验证消息')
    const json = JSON.stringify({ msgid: 'message-1', text: { content: '寄件：合同📦' } })
    expect(decode(reply(json))).toBe(json)
  })
  it('generates valid independent credentials', () => { const a = newWecomCallbackKeys(), b = newWecomCallbackKeys(); expect(a).not.toEqual(b); expect(() => validateWecomCallbackKeys(a)).not.toThrow() })
  it('generates keys accepted by the provider alphanumeric-only setup form', () => {
    for (let i = 0; i < 128; i++) {
      const generated = newWecomCallbackKeys()
      expect(generated.encodingAESKey).toMatch(/^[A-Za-z0-9]{43}$/)
      expect(() => validateWecomCallbackKeys(generated)).not.toThrow()
    }
  })
  it('rejects tampered signatures, ciphertext, nonce and stale callbacks', () => {
    const value = reply()
    expect(() => decode({ ...value, msgsignature: '0'.repeat(40) })).toThrow('验证失败')
    expect(() => decode({ ...value, encrypt: value.encrypt.slice(4) })).toThrow('验证失败')
    expect(() => decode({ ...value, nonce: 'different' })).toThrow('验证失败')
    expect(() => decode(value, now + 601000)).toThrow('验证失败')
  })
  it('does not accept application callbacks containing a nonempty receiver', () => {
    const message = Buffer.from('hello'), size = Buffer.alloc(4); size.writeUInt32BE(message.length)
    const plain = Buffer.concat([Buffer.alloc(16), size, message, Buffer.from('different-corp')]); const padding = 32 - plain.length % 32
    const key = Buffer.from(keys.encodingAESKey + '=', 'base64'), cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16)); cipher.setAutoPadding(false)
    const encrypt = Buffer.concat([cipher.update(Buffer.concat([plain, Buffer.alloc(padding, padding)])), cipher.final()]).toString('base64')
    const timestamp = now / 1000, nonce = 'example'; const msgsignature = createHash('sha1').update([keys.token, String(timestamp), nonce, encrypt].sort().join('')).digest('hex')
    expect(() => decode({ encrypt, timestamp, nonce, msgsignature })).toThrow('验证失败')
  })
  it('fails closed for malformed keys and oversized messages', () => {
    expect(() => validateWecomCallbackKeys({ ...keys, encodingAESKey: 'x'.repeat(43) })).toThrow('密钥配置无效')
    expect(() => reply('x'.repeat(60001))).toThrow('超出限制')
  })
})

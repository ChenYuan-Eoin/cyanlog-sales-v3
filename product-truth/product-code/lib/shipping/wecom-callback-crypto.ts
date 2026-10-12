import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { ShippingError } from './config'

// Official robot callback protocol: document/path/101033. ReceiveId is empty
// for an internal enterprise robot, unlike application callbacks (CorpID).
export type WecomCallbackKeys = { token: string; encodingAESKey: string }
export type WecomCallbackQuery = { signature: string; timestamp: string; nonce: string }
const MAX_CIPHERTEXT = 96_000
function keyBuffer(keys: WecomCallbackKeys) {
  if (!/^[A-Za-z0-9]{3,32}$/.test(keys.token) || !/^[A-Za-z0-9+/]{43}$/.test(keys.encodingAESKey)) throw new ShippingError(503, '机器人回调密钥配置无效。')
  const key = Buffer.from(keys.encodingAESKey + '=', 'base64')
  if (key.length !== 32 || key.toString('base64').slice(0, -1) !== keys.encodingAESKey) throw new ShippingError(503, '机器人回调密钥配置无效。')
  return key
}
export function newWecomCallbackKeys(): WecomCallbackKeys {
  return { token: randomBytes(16).toString('hex'), encodingAESKey: randomBytes(32).toString('base64').slice(0, -1) }
}
export function validateWecomCallbackKeys(keys: WecomCallbackKeys) { keyBuffer(keys) }
function signature(keys: WecomCallbackKeys, timestamp: string, nonce: string, encrypted: string) {
  return createHash('sha1').update([keys.token, timestamp, nonce, encrypted].sort().join('')).digest('hex')
}
export function decryptWecomCallback(keys: WecomCallbackKeys, query: WecomCallbackQuery, encrypted: string, now = Date.now()): string {
  const key = keyBuffer(keys)
  if (!/^\d{10}$/.test(query.timestamp) || Math.abs(now / 1000 - Number(query.timestamp)) > 600 || !query.nonce || query.nonce.length > 128 || !/^[a-fA-F0-9]{40}$/.test(query.signature)) throw new ShippingError(403, '机器人回调验证失败。')
  if (!encrypted || encrypted.length > MAX_CIPHERTEXT || !/^[A-Za-z0-9+/]+={0,2}$/.test(encrypted)) throw new ShippingError(400, '机器人消息格式无效。')
  const expected = Buffer.from(signature(keys, query.timestamp, query.nonce, encrypted), 'hex')
  if (!timingSafeEqual(expected, Buffer.from(query.signature, 'hex'))) throw new ShippingError(403, '机器人回调验证失败。')
  try {
    const ciphertext = Buffer.from(encrypted, 'base64')
    if (ciphertext.length < 32 || ciphertext.length % 16 !== 0 || ciphertext.toString('base64') !== encrypted) throw new Error('invalid ciphertext')
    const decipher = createDecipheriv('aes-256-cbc', key, key.subarray(0, 16)); decipher.setAutoPadding(false)
    const padded = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    const padding = padded[padded.length - 1]
    if (padding < 1 || padding > 32 || padded.subarray(-padding).some(byte => byte !== padding)) throw new Error('invalid padding')
    const plaintext = padded.subarray(0, -padding)
    if (plaintext.length < 20) throw new Error('short plaintext')
    const length = plaintext.readUInt32BE(16)
    // A non-empty trailing receiver is not an internal-robot message.
    if (length !== plaintext.length - 20) throw new Error('invalid receiver or length')
    return new TextDecoder('utf-8', { fatal: true }).decode(plaintext.subarray(20))
  } catch { throw new ShippingError(403, '机器人回调验证失败。') }
}
export function encryptWecomCallback(keys: WecomCallbackKeys, message: string, nonce: string, now = Date.now()) {
  const key = keyBuffer(keys), body = Buffer.from(message, 'utf8')
  if (body.length > 60_000 || !nonce || nonce.length > 128) throw new ShippingError(400, '机器人回复内容超出限制。')
  const length = Buffer.alloc(4); length.writeUInt32BE(body.length)
  const plaintext = Buffer.concat([randomBytes(16), length, body])
  const padding = 32 - plaintext.length % 32
  const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16)); cipher.setAutoPadding(false)
  const encrypt = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.alloc(padding, padding)])), cipher.final()]).toString('base64')
  const timestamp = Math.floor(now / 1000)
  return { encrypt, msgsignature: signature(keys, String(timestamp), nonce, encrypt), timestamp, nonce }
}

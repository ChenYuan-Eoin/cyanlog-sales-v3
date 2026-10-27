// REQ: F003. Context-bound authenticated encryption; never expose ciphertext.
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'
import { FxiaokeError } from './contracts'

function key() {
  const master = process.env.ORGANIZATION_CREDENTIALS_ENCRYPTION_KEY || process.env.SHIPPING_CREDENTIALS_ENCRYPTION_KEY || ''
  if (!/^[a-fA-F0-9]{64}$/.test(master)) throw new FxiaokeError('ENCRYPTION_UNAVAILABLE', '组织凭据加密服务未配置，请联系系统管理员。', 503)
  return createHmac('sha256', Buffer.from(master, 'hex')).update('organization:fxiaoke:credentials:v1').digest()
}
export function encryptCredentials(orgId: string, plaintext: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  cipher.setAAD(Buffer.from(`fxiaoke:${orgId}`))
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.')
}
export function decryptCredentials(orgId: string, ciphertext: string) {
  const secretKey = key()
  try {
    const parts = ciphertext.split('.')
    if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('invalid envelope')
    const decipher = createDecipheriv('aes-256-gcm', secretKey, Buffer.from(parts[1], 'base64url'))
    decipher.setAAD(Buffer.from(`fxiaoke:${orgId}`))
    decipher.setAuthTag(Buffer.from(parts[2], 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    throw new FxiaokeError('CREDENTIALS_UNREADABLE', '已保存的组织凭据无法读取，请重新配置。', 503)
  }
}

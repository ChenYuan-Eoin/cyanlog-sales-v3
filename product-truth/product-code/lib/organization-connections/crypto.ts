// REQ: F003 / WP50. One authenticated-encryption envelope for every provider.
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'
import { OrganizationConnectionError } from './errors'
import type { AdapterContext, OrganizationConnectionAdapter } from './types'

export const SHARED_ENVELOPE = 'shared-v1'

type EncryptionContext = AdapterContext & {
  sourceId: string
  provider: string
}

function key() {
  const master = process.env.ORGANIZATION_CREDENTIALS_ENCRYPTION_KEY || process.env.SHIPPING_CREDENTIALS_ENCRYPTION_KEY || ''
  if (!/^[a-fA-F0-9]{64}$/.test(master)) {
    throw new OrganizationConnectionError(
      'ENCRYPTION_UNAVAILABLE',
      '组织连接凭据加密服务未配置，请联系系统管理员。',
      503,
    )
  }
  return createHmac('sha256', Buffer.from(master, 'hex'))
    .update('organization:connection:credentials:v1')
    .digest()
}

function additionalData(context: EncryptionContext) {
  return Buffer.from(`organization-connection:v1:${context.provider}:${context.systemOrgId}:${context.sourceId}`)
}

export function encryptConnectionPayload(context: EncryptionContext, value: Record<string, unknown>) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  cipher.setAAD(additionalData(context))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return [SHARED_ENVELOPE, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.')
}

export function decryptConnectionPayload(
  context: EncryptionContext,
  ciphertext: string,
  envelope: string,
  adapter: OrganizationConnectionAdapter,
) {
  if (envelope !== SHARED_ENVELOPE) {
    if (!adapter.decryptLegacy) throw unreadable()
    return adapter.validateStored(adapter.decryptLegacy(ciphertext, context))
  }
  try {
    const parts = ciphertext.split('.')
    if (parts.length !== 4 || parts[0] !== SHARED_ENVELOPE) throw new Error('invalid envelope')
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(parts[1], 'base64url'))
    decipher.setAAD(additionalData(context))
    decipher.setAuthTag(Buffer.from(parts[2], 'base64url'))
    const plaintext = Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString('utf8')
    const value: unknown = JSON.parse(plaintext)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid payload')
    return adapter.validateStored(value as Record<string, unknown>)
  } catch (error) {
    if (error instanceof OrganizationConnectionError) throw error
    throw unreadable()
  }
}

function unreadable() {
  return new OrganizationConnectionError(
    'CREDENTIALS_UNREADABLE',
    '已保存的组织连接凭据无法读取，请管理员重新配置。',
    503,
  )
}

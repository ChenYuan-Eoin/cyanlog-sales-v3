import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { ShippingError } from './config'

const enrollmentTtlSeconds = 10 * 60

function enrollmentKey() {
  const secret = process.env.SHIPPING_RECEIPT_SECRET
  if (!secret || secret.length < 32) throw new ShippingError(503, '机器人接入安全配置尚未就绪。')
  return secret
}

function versionHash(version: string) {
  return createHash('sha256').update(version).digest('base64url').slice(0, 16)
}

export function issueWecomRuntimeEnrollment(botId: string, botVersion: string, now = Date.now()) {
  if (!botId || !botVersion) throw new ShippingError(400, '机器人配置不完整。')
  const expiresAt = Math.floor(now / 1000) + enrollmentTtlSeconds
  const version = versionHash(botVersion)
  const payload = `${botId}.${expiresAt}.${version}`
  const signature = createHmac('sha256', enrollmentKey()).update(`wecom-runtime-enroll:${payload}`).digest('base64url')
  return {
    token: `${payload}.${signature}`,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  }
}

export function verifyWecomRuntimeEnrollment(token: string, botId: string, botVersion: string, now = Date.now()) {
  if (!token || token.length > 512) throw new ShippingError(401, '云桌面接入令牌无效。')
  const [tokenBotId, expiryText, version, signature, extra] = token.split('.')
  const expiresAt = Number(expiryText)
  if (
    extra
    || tokenBotId !== botId
    || !Number.isSafeInteger(expiresAt)
    || expiresAt <= Math.floor(now / 1000)
    || version !== versionHash(botVersion)
    || !signature
  ) throw new ShippingError(401, '云桌面接入令牌无效或已过期。')
  const expected = Buffer.from(createHmac('sha256', enrollmentKey())
    .update(`wecom-runtime-enroll:${tokenBotId}.${expiresAt}.${version}`)
    .digest('base64url'))
  const actual = Buffer.from(signature)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new ShippingError(401, '云桌面接入令牌无效。')
  }
}

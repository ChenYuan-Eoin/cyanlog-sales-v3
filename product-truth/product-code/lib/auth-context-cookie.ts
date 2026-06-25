export const AUTH_CONTEXT_COOKIE_NAME = 'auth_context'
export const AUTH_CONTEXT_COOKIE_MAX_AGE_SECONDS = 15

export type AuthContextCookie = {
  v: 1
  userId: string
  tokenHash: string
  mustChangePassword: boolean
  roleCodes: string[]
  allPermissions: string[]
  full: boolean
  exp: number
}

export type AuthContextCookieInput = Omit<AuthContextCookie, 'v' | 'tokenHash' | 'exp'>

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function getAuthContextSecret(): string | null {
  return process.env.AUTH_CONTEXT_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || null
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunkSize))
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function base64UrlDecode(value: string): Uint8Array | null {
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  } catch {
    return null
  }
}

async function getHmacKey(): Promise<CryptoKey | null> {
  const secret = getAuthContextSecret()
  if (!secret) return null

  return crypto.subtle.importKey(
    'raw',
    toArrayBuffer(textEncoder.encode(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
}

async function signPayload(payload: string): Promise<string | null> {
  const key = await getHmacKey()
  if (!key) return null

  const signature = await crypto.subtle.sign('HMAC', key, toArrayBuffer(textEncoder.encode(payload)))
  return base64UrlEncode(new Uint8Array(signature))
}

async function verifyPayload(payload: string, signature: string): Promise<boolean> {
  const key = await getHmacKey()
  const signatureBytes = base64UrlDecode(signature)
  if (!key || !signatureBytes) return false

  return crypto.subtle.verify(
    'HMAC',
    key,
    toArrayBuffer(signatureBytes),
    toArrayBuffer(textEncoder.encode(payload))
  )
}

export async function hashAuthContextToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(textEncoder.encode(token)))
  return base64UrlEncode(new Uint8Array(digest))
}

export async function createAuthContextCookieValue(
  token: string,
  input: AuthContextCookieInput
): Promise<string | null> {
  const payload: AuthContextCookie = {
    v: 1,
    ...input,
    tokenHash: await hashAuthContextToken(token),
    exp: Date.now() + AUTH_CONTEXT_COOKIE_MAX_AGE_SECONDS * 1000,
  }
  const encodedPayload = base64UrlEncode(textEncoder.encode(JSON.stringify(payload)))
  const signature = await signPayload(encodedPayload)
  if (!signature) return null

  return `${encodedPayload}.${signature}`
}

export async function readAuthContextCookieValue(
  token: string,
  value: string | undefined
): Promise<AuthContextCookie | null> {
  if (!value) return null

  const [encodedPayload, signature] = value.split('.')
  if (!encodedPayload || !signature) return null
  if (!await verifyPayload(encodedPayload, signature)) return null

  const payloadBytes = base64UrlDecode(encodedPayload)
  if (!payloadBytes) return null

  try {
    const payload = JSON.parse(textDecoder.decode(payloadBytes)) as AuthContextCookie
    if (payload.v !== 1 || payload.exp < Date.now()) return null
    if (payload.tokenHash !== await hashAuthContextToken(token)) return null
    if (!payload.userId || !Array.isArray(payload.roleCodes) || !Array.isArray(payload.allPermissions)) {
      return null
    }
    return payload
  } catch {
    return null
  }
}

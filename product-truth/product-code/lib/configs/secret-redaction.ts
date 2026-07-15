const SENSITIVE_KEY = /(?:^|[_-])(?:api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|secret|token)(?:$|[_-])/i
const CREDENTIAL_PATTERNS = [
  /\bBearer\s+[^\s,;]+/gi,
  /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|secret)\b(\s*[:=]\s*)([^\s,;]+)/gi,
] as const

function usableSecrets(secrets: Array<string | null | undefined>): string[] {
  return Array.from(new Set(
    secrets
      .filter((secret): secret is string => typeof secret === 'string')
      .map((secret) => secret.trim())
      .filter((secret) => secret.length > 0)
  )).sort((left, right) => right.length - left.length)
}

export function redactSecretText(
  value: string,
  secrets: Array<string | null | undefined> = []
): string {
  let redacted = value

  for (const secret of usableSecrets(secrets)) {
    redacted = redacted.split(secret).join('[REDACTED]')
  }

  redacted = redacted.replace(CREDENTIAL_PATTERNS[0], 'Bearer [REDACTED]')
  redacted = redacted.replace(
    CREDENTIAL_PATTERNS[1],
    (_match, label: string, separator: string) => `${label}${separator}[REDACTED]`
  )

  return redacted
}

function redactValue(
  value: unknown,
  secrets: string[],
  key: string | null,
  seen: WeakSet<object>
): unknown {
  if (typeof value === 'string') {
    if (key && SENSITIVE_KEY.test(key)) {
      return value.length > 0 ? '[REDACTED]' : value
    }
    return redactSecretText(value, secrets)
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  if (seen.has(value)) {
    return '[REDACTED:CIRCULAR]'
  }
  seen.add(value)

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, secrets, key, seen))
  }

  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      redactValue(entryValue, secrets, entryKey, seen),
    ])
  )
}

export function redactSecretsDeep<T>(
  value: T,
  secrets: Array<string | null | undefined> = []
): T {
  return redactValue(value, usableSecrets(secrets), null, new WeakSet()) as T
}

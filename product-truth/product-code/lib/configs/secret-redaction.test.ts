import { describe, expect, it } from 'vitest'
import { redactSecretText, redactSecretsDeep } from './secret-redaction'

describe('configuration secret redaction', () => {
  it('removes exact canary secrets from nested provider output', () => {
    const secret = 'sk-canary-never-return-this-value'
    const result = redactSecretsDeep({
      runtime_reason: `upstream rejected ${secret}`,
      nested: [{ error: `Bearer ${secret}` }],
      api_key: secret,
    }, [secret])

    expect(JSON.stringify(result)).not.toContain(secret)
    expect(result.api_key).toBe('[REDACTED]')
    expect(result.runtime_reason).toContain('[REDACTED]')
  })

  it('redacts common credential patterns even without the exact secret', () => {
    const value = redactSecretText(
      'Authorization: Bearer abc123 api_key=provider-secret refresh_token: refresh-secret'
    )

    expect(value).not.toContain('abc123')
    expect(value).not.toContain('provider-secret')
    expect(value).not.toContain('refresh-secret')
  })

  it('does not alter numeric token usage evidence', () => {
    expect(redactSecretsDeep({ prompt_tokens: 120, completion_tokens: 40 })).toEqual({
      prompt_tokens: 120,
      completion_tokens: 40,
    })
  })

  it('removes even a short exact secret when legacy data bypassed validation', () => {
    expect(redactSecretText('upstream echoed abc', ['abc'])).toBe('upstream echoed [REDACTED]')
  })
})

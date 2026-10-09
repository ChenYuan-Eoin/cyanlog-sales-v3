import { describe, expect, it } from 'vitest'
import { companyEmailAllowed, normalizeEmployeeEmail, normalizeCompanyEmailDomains, newEmployeeEmailCode, employeeEmailCodeHash, emailCodeHashesEqual, newEmployeeSessionToken, employeeSessionTokenHash } from './company-email'

describe('company email access primitives', () => {
  const domains = ['company.example', 'company.test']
  it('normalizes configured exact domains and employee email casing', () => {
    expect(normalizeCompanyEmailDomains([' @Company.Example ', 'company.example', 'company.test'])).toEqual(domains)
    expect(normalizeEmployeeEmail(' Sales@Company.Example ')).toBe('sales@company.example')
    expect(companyEmailAllowed('Sales@Company.Example', domains)).toBe(true)
  })
  it.each(['sales@evilcompany.example', 'sales@company.example.evil.test', 'sales@sub.company.example', 'sales@company.example.', 'sales@company.example\r\nBcc: other@example.com', 'sales@company。example'])('rejects an unapproved or ambiguous address: %s', email => {
    expect(companyEmailAllowed(email, domains)).toBe(false)
  })
  it('fails closed when no domains are configured or a wildcard is supplied', () => {
    expect(companyEmailAllowed('sales@company.example', [])).toBe(false)
    expect(companyEmailAllowed('sales@company.example', ['*.company.example'])).toBe(false)
  })
  it('generates six digit codes and binds their hash to organization, email and challenge', () => {
    expect(newEmployeeEmailCode()).toMatch(/^\d{6}$/)
    const input = { secret: 'example-test-pepper-'.repeat(3), orgId: 'org-a', email: 'sales@company.example', challengeId: 'challenge-a', code: '123456' }
    const hash = employeeEmailCodeHash(input)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(emailCodeHashesEqual(hash, employeeEmailCodeHash({ ...input, email: 'Sales@Company.Example' }))).toBe(true)
    for (const change of [{ orgId: 'org-b' }, { email: 'other@company.example' }, { challengeId: 'challenge-b' }, { code: '654321' }]) expect(emailCodeHashesEqual(hash, employeeEmailCodeHash({ ...input, ...change }))).toBe(false)
    expect(emailCodeHashesEqual(hash, '123456')).toBe(false)
  })
  it('creates distinct opaque employee tokens and stores only their scoped hashes', () => {
    const first = newEmployeeSessionToken(), second = newEmployeeSessionToken()
    expect(first).toHaveLength(43)
    expect(first).not.toBe(second)
    expect(employeeSessionTokenHash(first)).toMatch(/^[a-f0-9]{64}$/)
    expect(employeeSessionTokenHash(first)).not.toBe(first)
    expect(employeeSessionTokenHash(first)).not.toBe(employeeSessionTokenHash(second))
    expect(() => employeeSessionTokenHash('example-invalid')).toThrow()
  })
})

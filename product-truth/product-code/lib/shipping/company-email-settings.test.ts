import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ from: vi.fn(), encrypt: vi.fn(), decrypt: vi.fn(), verify: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))
vi.mock('./connections', () => ({ encryptShippingSecret: mocks.encrypt, decryptShippingSecret: mocks.decrypt }))
vi.mock('./company-mailer', () => ({ verifyCompanyMailer: mocks.verify, CompanyMailError: class extends Error { constructor(public reason: string) { super('sanitized') } } }))
import { loadCompanyEmailSettings, loadCompanyMailerConfig, saveCompanyEmailSettings } from './company-email-settings'

const row = {
  org_id: 'org-a', enabled: true, allowed_domains: ['company.example'], smtp_host: 'smtp.company.example',
  smtp_port: 465, smtp_secure: true, from_email: 'sender@company.example', from_name: '自助收寄',
  credentials_ciphertext: 'example-encrypted-credentials', connection_status: 'verified', last_tested_at: null,
  updated_at: '2026-10-08T00:00:00.000Z',
}
const input = { enabled: true, allowedDomains: ['@COMPANY.EXAMPLE'], smtpHost: row.smtp_host, smtpPort: 465, fromEmail: row.from_email, fromName: row.from_name, expectedUpdatedAt: row.updated_at }
function query(result: unknown) {
  const builder = { select: vi.fn(), eq: vi.fn(), update: vi.fn(), insert: vi.fn(), maybeSingle: vi.fn(), single: vi.fn() }
  builder.select.mockReturnValue(builder); builder.eq.mockReturnValue(builder); builder.update.mockReturnValue(builder); builder.insert.mockReturnValue(builder)
  builder.maybeSingle.mockResolvedValue(result); builder.single.mockResolvedValue(result)
  return builder
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.decrypt.mockReturnValue(JSON.stringify({ kind: 'shipping_smtp', host: row.smtp_host, username: row.from_email, password: 'example-smtp-password' }))
  mocks.encrypt.mockReturnValue('example-new-ciphertext')
})
describe('company email configuration', () => {
  it('returns only metadata to the manager and scopes reads by organization', async () => {
    const lookup = query({ data: row, error: null }); mocks.from.mockReturnValue(lookup)
    const settings = await loadCompanyEmailSettings('org-a')
    expect(lookup.eq).toHaveBeenCalledWith('org_id', 'org-a')
    expect(settings).toMatchObject({ hasCredentials: true, smtpHost: row.smtp_host, fromEmail: row.from_email })
    expect(JSON.stringify(settings)).not.toContain('example-encrypted')
    expect(mocks.decrypt).not.toHaveBeenCalled()
  })
  it('keeps an existing secret when saving normalized domain rules', async () => {
    const lookup = query({ data: row, error: null }), write = query({ data: row, error: null })
    mocks.from.mockReturnValueOnce(lookup).mockReturnValueOnce(write)
    await saveCompanyEmailSettings('org-a', 'operator-a', input)
    expect(write.update).toHaveBeenCalledWith(expect.objectContaining({ org_id: 'org-a', allowed_domains: ['company.example'], credentials_ciphertext: row.credentials_ciphertext }))
    expect(write.eq).toHaveBeenCalledWith('updated_at', row.updated_at)
    expect(mocks.encrypt).not.toHaveBeenCalled()
  })
  it('requires new credentials when changing their destination', async () => {
    mocks.from.mockReturnValue(query({ data: row, error: null }))
    await expect(saveCompanyEmailSettings('org-a', 'operator-a', { ...input, smtpHost: 'different.company.example' })).rejects.toMatchObject({ status: 400 })
    expect(mocks.from).toHaveBeenCalledTimes(1)
  })
  it('rejects stale writes and leaves existing credentials untouched', async () => {
    mocks.from.mockReturnValue(query({ data: row, error: null }))
    await expect(saveCompanyEmailSettings('org-a', 'operator-a', { ...input, expectedUpdatedAt: null })).rejects.toMatchObject({ status: 409 })
    expect(mocks.from).toHaveBeenCalledTimes(1)
  })
  it('binds decrypted credentials to their configured host and account', async () => {
    mocks.from.mockReturnValue(query({ data: row, error: null }))
    const result = await loadCompanyMailerConfig('org-a')
    expect(result.mailer).toMatchObject({ host: row.smtp_host, username: row.from_email, password: 'example-smtp-password' })
    mocks.decrypt.mockReturnValue(JSON.stringify({ kind: 'shipping_smtp', host: 'other.company.example', username: row.from_email, password: 'example-smtp-password' }))
    await expect(loadCompanyMailerConfig('org-a')).rejects.toMatchObject({ status: 503 })
  })
})

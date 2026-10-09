import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ create: vi.fn(), validate: vi.fn(), verify: vi.fn(), send: vi.fn(), close: vi.fn() }))
vi.mock('nodemailer', () => ({ default: { createTransport: mocks.create } }))
vi.mock('@/lib/security/outbound-http', () => ({ validateOutboundTarget: mocks.validate }))
import { CompanyMailError, sendEmployeeEmailCode, verifyCompanyMailer } from './company-mailer'

const config = { host: 'smtp.company.example', port: 465 as const, secure: true, username: 'sender@company.example', password: 'example-smtp-password', fromEmail: 'sender@company.example', fromName: '自助收寄', allowedDomains: ['company.example'] }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.create.mockReturnValue({ verify: mocks.verify, sendMail: mocks.send, close: mocks.close })
  mocks.validate.mockResolvedValue({ addresses: [{ address: '203.0.113.10', family: 4 }] })
  mocks.verify.mockResolvedValue(true)
  mocks.send.mockResolvedValue({ accepted: ['staff@company.example'] })
})
describe('company SMTP adapter', () => {
  it('verifies TLS and authentication without sending an email', async () => {
    await verifyCompanyMailer(config)
    expect(mocks.verify).toHaveBeenCalledOnce()
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ host: '203.0.113.10', port: 465, secure: true, requireTLS: true, logger: false, debug: false, tls: expect.objectContaining({ servername: config.host, rejectUnauthorized: true }) }))
    expect(mocks.close).toHaveBeenCalledOnce()
  })
  it('requires STARTTLS on port 587 and pins a publicly validated destination', async () => {
    await verifyCompanyMailer({ ...config, port: 587, secure: false })
    expect(mocks.validate).toHaveBeenCalledWith('https://smtp.company.example:587', { purpose: 'fixed-origin', allowedOrigins: ['https://smtp.company.example:587'] })
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ secure: false, requireTLS: true, ignoreTLS: false }))
  })
  it('sends only to an allowed normalized employee email', async () => {
    await sendEmployeeEmailCode(config, 'Staff@Company.Example', '123456')
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'staff@company.example', text: expect.stringContaining('123456'), disableUrlAccess: true, disableFileAccess: true }))
    expect(mocks.close).toHaveBeenCalledOnce()
  })
  it('rejects outside recipients before DNS or SMTP work', async () => {
    await expect(sendEmployeeEmailCode(config, 'staff@company.example.evil.test', '123456')).rejects.toBeInstanceOf(CompanyMailError)
    expect(mocks.validate).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('keeps the system sender independent from employee access domains', async () => {
    const systemSender = { ...config, username: 'noreply@mailer.example', fromEmail: 'noreply@mailer.example' }
    await sendEmployeeEmailCode(systemSender, 'staff@company.example', '123456')
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ from: { address: 'noreply@mailer.example', name: config.fromName }, to: 'staff@company.example' }))
    await expect(sendEmployeeEmailCode(systemSender, 'outsider@mailer.example', '123456')).rejects.toMatchObject({ reason: 'configuration' })
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })
  it('rejects insecure settings and non-public network targets', async () => {
    await expect(verifyCompanyMailer({ ...config, secure: false })).rejects.toMatchObject({ reason: 'configuration' })
    expect(mocks.create).not.toHaveBeenCalled()
    mocks.validate.mockRejectedValueOnce(new Error('private network diagnostic'))
    await expect(verifyCompanyMailer(config)).rejects.toMatchObject({ reason: 'connection' })
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('does not return upstream credentials, email details or codes on failure', async () => {
    mocks.send.mockRejectedValueOnce(Object.assign(new Error('example-smtp-password 123456 staff@company.example'), { code: 'EAUTH' }))
    try { await sendEmployeeEmailCode(config, 'staff@company.example', '123456'); throw new Error('expected failure') }
    catch (error) {
      expect(error).toMatchObject({ reason: 'authentication' })
      expect(String(error)).not.toContain('example-smtp-password')
      expect(String(error)).not.toContain('123456')
      expect(String(error)).not.toContain('staff@company.example')
    }
    expect(mocks.close).toHaveBeenCalledOnce()
  })
  it('does not claim acceptance when SMTP did not accept the recipient', async () => {
    mocks.send.mockResolvedValueOnce({ accepted: [], rejected: ['staff@company.example'] })
    await expect(sendEmployeeEmailCode(config, 'staff@company.example', '123456')).rejects.toMatchObject({ reason: 'delivery' })
  })
})

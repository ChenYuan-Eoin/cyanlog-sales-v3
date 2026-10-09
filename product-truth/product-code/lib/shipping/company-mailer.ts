import nodemailer from 'nodemailer'
import { z } from 'zod'
import { validateOutboundTarget } from '@/lib/security/outbound-http'
import { companyEmailAllowed, normalizeEmployeeEmail } from './company-email'

const mailerSchema = z.object({
  host: z.string().trim().toLowerCase().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/),
  port: z.union([z.literal(465), z.literal(587)]),
  secure: z.boolean(),
  username: z.string().min(1).max(254),
  password: z.string().min(1).max(1024),
  fromEmail: z.email().max(254),
  fromName: z.string().trim().min(1).max(80).regex(/^[^\r\n]+$/),
  allowedDomains: z.array(z.string()).max(20),
}).strict().refine(value => value.secure === (value.port === 465))
export type CompanyMailerConfig = z.infer<typeof mailerSchema>

export class CompanyMailError extends Error {
  constructor(public readonly reason: 'configuration' | 'authentication' | 'connection' | 'delivery') {
    super('公司邮箱发信服务暂不可用，请联系配置管理员。')
    this.name = 'CompanyMailError'
  }
}

function sanitizedMailError(error: unknown) {
  if (error instanceof CompanyMailError) return error
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  return new CompanyMailError(code === 'EAUTH' ? 'authentication' : code === 'EENVELOPE' || code === 'EMESSAGE' ? 'delivery' : 'connection')
}

async function createCompanyTransport(value: CompanyMailerConfig) {
  const result = mailerSchema.safeParse(value)
  if (!result.success) throw new CompanyMailError('configuration')
  const config = result.data
  const endpoint = `https://${config.host}:${config.port}`
  // Reuse the application's public-network validation. SMTP is restricted to
  // its two TLS ports and connects to the validated IP, retaining hostname/SNI.
  const target = await validateOutboundTarget(endpoint, { purpose: 'fixed-origin', allowedOrigins: [endpoint] })
  const address = target.addresses.find(item => item.family === 4) || target.addresses[0]
  if (!address) throw new CompanyMailError('connection')
  const transport = nodemailer.createTransport({
    host: address.address, port: config.port, secure: config.secure,
    requireTLS: true, ignoreTLS: false,
    tls: { servername: config.host, rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    auth: { user: config.username, pass: config.password },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
  })
  return { transport, config }
}

export async function verifyCompanyMailer(value: CompanyMailerConfig): Promise<void> {
  let transport: Awaited<ReturnType<typeof createCompanyTransport>>['transport'] | undefined
  try {
    ;({ transport } = await createCompanyTransport(value))
    await transport.verify()
  } catch (error) { throw sanitizedMailError(error) }
  finally { transport?.close() }
}

export async function sendEmployeeEmailCode(value: CompanyMailerConfig, email: string, code: string): Promise<void> {
  if (!/^\d{6}$/.test(code) || !companyEmailAllowed(email, value.allowedDomains)) throw new CompanyMailError('configuration')
  const recipient = normalizeEmployeeEmail(email)
  let transport: Awaited<ReturnType<typeof createCompanyTransport>>['transport'] | undefined
  try {
    const prepared = await createCompanyTransport(value)
    transport = prepared.transport
    const result = await transport.sendMail({
      from: { address: normalizeEmployeeEmail(prepared.config.fromEmail), name: prepared.config.fromName },
      to: recipient,
      subject: '自助收寄 · 公司邮箱验证码',
      text: `你的公司邮箱验证码是：${code}\n\n验证码10分钟内有效，仅用于员工寄件工单身份验证。请勿向他人提供验证码。\n如非本人操作，请忽略本邮件。`,
      disableFileAccess: true, disableUrlAccess: true,
    })
    if (!result.accepted?.some(item => typeof item === 'string' && item.toLowerCase() === recipient)) throw new CompanyMailError('delivery')
  } catch (error) { throw sanitizedMailError(error) }
  finally { transport?.close() }
}

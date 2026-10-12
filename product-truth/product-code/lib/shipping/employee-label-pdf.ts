// Server-only internal adapter. It is intentionally not an HTTP endpoint or account manager.
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { z } from 'zod'
import { buildSfOrder, extractOrder, sfCall } from './sf-client'
import { contactSchema } from './validation'
import { ShippingError } from './config'

export type EmployeeSfMapping = { monthlyCard: string; enterpriseId: string }
export type EmployeeSfPdfConfig = {
  environment: 'sandbox' | 'production'
  partnerId: string
  checkWord: string
  templateCode: string
  employees: Readonly<Record<string, EmployeeSfMapping>>
  outputDirectory?: string
}
const shipmentSchema = z.object({
  // Stable business order ID supplied by the caller; do not create a new one on retry.
  orderId: z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/),
  sender: contactSchema, recipient: contactSchema,
  cargo: z.string().trim().min(1).max(60), weight: z.number().positive().max(20),
  serviceId: z.number().int().positive(), remark: z.string().trim().max(100).default(''),
}).strict()
export type EmployeeSfShipment = z.input<typeof shipmentSchema>
export type EmployeeSfPdf = { pdfPath: string; waybillNo: string; orderId: string; employeeId: string; enterpriseId: string }
export class EmployeeSfPdfError extends Error {
  constructor(message: string, public readonly stage: 'configuration' | 'order' | 'print' | 'download' | 'save', public readonly orderId?: string, public readonly waybillNo?: string) {
    super(message); this.name = 'EmployeeSfPdfError'
  }
}
const printResult = z.object({ files: z.array(z.object({ url: z.string().url().max(4096), token: z.string().min(1).max(4096), waybillNo: z.string() })).min(1) })
const MAX_PDF_BYTES = 10 * 1024 * 1024

async function downloadPdf(url: string, token: string): Promise<Buffer> {
  const target = new URL(url)
  if (target.protocol !== 'https:' || target.username || target.password || (target.port && target.port !== '443') || !target.hostname.endsWith('.sf-express.com')) {
    throw new Error('PDF下载地址不属于顺丰HTTPS服务。')
  }
  const response = await fetch(target, { method: 'GET', headers: { 'X-Auth-token': token }, redirect: 'error', signal: AbortSignal.timeout(20_000), cache: 'no-store' })
  if (!response.ok) throw new Error(`PDF下载失败（HTTP ${response.status}）。`)
  if (!response.body || Number(response.headers.get('content-length')) > MAX_PDF_BYTES) throw new Error('PDF文件为空或过大。')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      length += next.value.length
      if (length > MAX_PDF_BYTES) { await reader.cancel(); throw new Error('PDF文件超过10MB限制。') }
      chunks.push(next.value)
    }
  } finally { reader.releaseLock() }
  const pdf = Buffer.concat(chunks)
  if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('下载结果不是PDF文件。')
  return pdf
}

/** Bind server-held local configuration once; returned function takes only employeeId + shipment. */
export function createEmployeeSfPdfFunction(config: EmployeeSfPdfConfig) {
  return async function createEmployeeSfPdf(employeeId: string, shipment: EmployeeSfShipment): Promise<EmployeeSfPdf> {
    const data = shipmentSchema.parse(shipment)
    if (!Object.hasOwn(config.employees, employeeId)) throw new EmployeeSfPdfError('该员工尚未配置寄件映射。', 'configuration', data.orderId)
    const mapping = config.employees[employeeId]
    if (!['sandbox', 'production'].includes(config.environment) || !config.partnerId?.trim() || !config.checkWord?.trim() || !config.templateCode?.trim() || !mapping.enterpriseId?.trim() || (config.environment === 'production' && !mapping.monthlyCard?.trim())) {
      throw new EmployeeSfPdfError('请补齐服务端顺丰凭据、打印模板和员工映射。', 'configuration', data.orderId)
    }
    // monthlyCard is a settlement account. enterpriseId remains local metadata;
    // legacy XML j_custid is not part of EXP_RECE_CREATE_ORDER's JSON contract.
    const monthlyCard = config.environment === 'sandbox' ? '' : mapping.monthlyCard.trim()
    const input = { ...data, source: 'manual' as const, payment: monthlyCard ? 'sender_monthly' as const : 'sender_cash' as const }
    const request = { ...buildSfOrder(data.orderId, input, monthlyCard), monthlyCard }
    const auth = { environment: config.environment, partnerId: config.partnerId, checkWord: config.checkWord }
    let waybillNo: string
    try {
      const result = extractOrder(await sfCall('EXP_RECE_CREATE_ORDER', request, auth), data.orderId)
      if (!result || !/^(?:SF)?\d{10,20}$/.test(result)) throw new Error('未返回有效运单号。')
      waybillNo = result
    } catch (error) {
      throw new EmployeeSfPdfError(error instanceof ShippingError ? error.message : '下单结果未能确认，请按原orderId查回，不要更换编号重复下单。', 'order', data.orderId)
    }
    const pdfPath = await printSfWaybillPdf(waybillNo, data.orderId, config)
    return { pdfPath, waybillNo, orderId: data.orderId, employeeId, enterpriseId: mapping.enterpriseId }
  }
}


/** Reprint an already-issued shipment. This helper never calls the create-order API. */
export async function printSfWaybillPdf(waybillNo: string, orderId: string, config: EmployeeSfPdfConfig): Promise<string> {
  if (!/^(?:SF)?\d{10,20}$/.test(waybillNo) || !config.templateCode?.trim() || !['sandbox', 'production'].includes(config.environment)) throw new EmployeeSfPdfError('运单号或打印配置无效。', 'configuration', orderId, waybillNo)
  const auth = { environment: config.environment, partnerId: config.partnerId, checkWord: config.checkWord }
    let file: z.infer<typeof printResult>['files'][number]
    try {
      const printed = printResult.parse(await sfCall('COM_RECE_CLOUD_PRINT_WAYBILLS', { templateCode: config.templateCode, version: '2.0', fileType: 'pdf', sync: true, documents: [{ masterWaybillNo: waybillNo }] }, auth, 'obj'))
      const matches = printed.files.filter(item => item.waybillNo === waybillNo)
      if (matches.length !== 1 || printed.files.length !== 1) throw new Error('面单文件与运单不匹配。')
      file = matches[0]
    } catch (error) {
      throw new EmployeeSfPdfError(`已出号，面单生成失败：${error instanceof ShippingError ? error.message : '未收到匹配的PDF文件。'} 请只重试打印，勿重新下单。`, 'print', orderId, waybillNo)
    }
    let pdf: Buffer
    try { pdf = await downloadPdf(file.url, file.token) }
    catch { throw new EmployeeSfPdfError('已出号，但PDF下载失败；请重新获取面单，勿重新下单。', 'download', orderId, waybillNo) }
    let directory: string | undefined
    try {
      const root = config.outputDirectory || join(tmpdir(), 'sf-labels')
      await mkdir(root, { recursive: true, mode: 0o700 })
      directory = await mkdtemp(join(root, 'label-'))
      const pdfPath = join(directory, `${waybillNo}.pdf`)
      await writeFile(pdfPath, pdf, { mode: 0o600, flag: 'wx' })
      return pdfPath
    } catch {
      if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined)
      throw new EmployeeSfPdfError('已出号，但PDF保存失败；请检查保存目录，勿重新下单。', 'save', orderId, waybillNo)
    }
}

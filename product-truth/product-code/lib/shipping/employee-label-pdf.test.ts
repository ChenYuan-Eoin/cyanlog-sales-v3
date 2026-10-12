// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('./sf-client', async original => ({ ...await original<typeof import('./sf-client')>(), sfCall: mocks.call }))
import { createEmployeeSfPdfFunction, type EmployeeSfPdfConfig } from './employee-label-pdf'
import { decodeSfResponse } from './sf-client'
import { ShippingError } from './config'
const contact = { name: '测试联系人', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '虚拟验收路100号' }
const shipment = { orderId: 'employee-label-test-1', sender: contact, recipient: contact, cargo: '文件', weight: 1, serviceId: 1 }
const waybill = 'SF1234567890123', pdfBytes = Buffer.from('%PDF-1.7\n% downloaded fixture bytes\n%%EOF')
let config: EmployeeSfPdfConfig, root: string
const download = vi.fn()
beforeEach(async () => {
 root = await mkdtemp(join(tmpdir(), 'sf-label-test-'))
 config = { environment: 'production', partnerId: 'example-partner', checkWord: 'example-checkword', templateCode: 'example-template', employees: { staff1: { monthlyCard: '0000000000', enterpriseId: 'example-company' } }, outputDirectory: root }
 mocks.call.mockReset().mockImplementation(async (service: string) => service === 'EXP_RECE_CREATE_ORDER' ? { orderId: shipment.orderId, waybillNoInfoList: [{ waybillType: 1, waybillNo: waybill }] } : { files: [{ waybillNo: waybill, url: 'https://print.sf-express.com/label.pdf', token: 'example-download-token' }] })
 download.mockReset().mockResolvedValue(new Response(pdfBytes, { headers: { 'Content-Type': 'application/pdf' } }))
 vi.stubGlobal('fetch', download)
})
afterEach(async () => { vi.unstubAllGlobals(); await rm(root, { recursive: true, force: true }) })
it('maps the employee, orders once, requests synchronous PDF, downloads with the token header and saves exact bytes', async () => {
 const result = await createEmployeeSfPdfFunction(config)('staff1', shipment)
 expect(result).toMatchObject({ employeeId: 'staff1', enterpriseId: 'example-company', orderId: shipment.orderId, waybillNo: waybill })
 expect(await readFile(result.pdfPath)).toEqual(pdfBytes)
 const order = mocks.call.mock.calls[0][1]
 expect(order.monthlyCard).toBe('0000000000');expect(order.payMethod).toBe(1);expect(order).not.toHaveProperty('j_custid')
 expect(mocks.call.mock.calls[1]).toEqual(['COM_RECE_CLOUD_PRINT_WAYBILLS', expect.objectContaining({ sync: true, version: '2.0', fileType: 'pdf', documents: [{ masterWaybillNo: waybill }] }), expect.any(Object), 'obj'])
 expect(download).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ method: 'GET', headers: { 'X-Auth-token': 'example-download-token' }, redirect: 'error' }))
})
it('sends an explicit empty monthlyCard in sandbox even when the local employee mapping contains one', async () => {
 await createEmployeeSfPdfFunction({ ...config, environment: 'sandbox' })('staff1', shipment)
 expect(mocks.call.mock.calls[0][1]).toMatchObject({ monthlyCard: '', payMethod: 1 })
})
it('rejects an unmapped employee before contacting SF', async () => {
 await expect(createEmployeeSfPdfFunction(config)('outside', shipment)).rejects.toMatchObject({ stage: 'configuration' })
 expect(mocks.call).not.toHaveBeenCalled()
})
it('stops before printing when ordering is rejected', async () => {
 mocks.call.mockRejectedValueOnce(new ShippingError(502, '顺丰拒绝受理', 'provider_rejected'))
 await expect(createEmployeeSfPdfFunction(config)('staff1', shipment)).rejects.toMatchObject({ stage: 'order', orderId: shipment.orderId, waybillNo: undefined })
 expect(mocks.call).toHaveBeenCalledTimes(1);expect(download).not.toHaveBeenCalled()
})
it('preserves the issued waybill on print failure and never resubmits the order', async () => {
 mocks.call.mockResolvedValueOnce({ orderId: shipment.orderId, waybillNoInfoList: [{ waybillNo: waybill }] }).mockRejectedValueOnce(new ShippingError(502, '打印接口拒绝'))
 await expect(createEmployeeSfPdfFunction(config)('staff1', shipment)).rejects.toMatchObject({ stage: 'print', waybillNo: waybill })
 expect(mocks.call.mock.calls.filter(([service]) => service === 'EXP_RECE_CREATE_ORDER')).toHaveLength(1)
})
it.each([new Response('denied', {status:403}),new Response('<html>not a PDF</html>')])('rejects unsuccessful or non-PDF downloads without losing the waybill', async response => {
 download.mockResolvedValueOnce(response)
 await expect(createEmployeeSfPdfFunction(config)('staff1', shipment)).rejects.toMatchObject({ stage: 'download', waybillNo: waybill })
})
it('never sends the download token to an unrelated host', async () => {
 mocks.call.mockResolvedValueOnce({ orderId: shipment.orderId, waybillNoInfoList: [{ waybillNo: waybill }] }).mockResolvedValueOnce({ files: [{ waybillNo: waybill, url: 'https://unrelated.example/label.pdf', token: 'example-download-token' }] })
 await expect(createEmployeeSfPdfFunction(config)('staff1', shipment)).rejects.toMatchObject({ stage: 'download', waybillNo: waybill })
 expect(download).not.toHaveBeenCalled()
})
it('decodes the official print obj envelope separately from order msgData', () => {
 const obj={files:[]}
 expect(decodeSfResponse({apiResultCode:'A1000',apiResultData:JSON.stringify({success:true,obj})},'obj')).toEqual(obj)
 expect(decodeSfResponse({apiResultCode:'A1000',apiResultData:JSON.stringify({success:true,msgData:{orderId:'example'}})})).toEqual({orderId:'example'})
})

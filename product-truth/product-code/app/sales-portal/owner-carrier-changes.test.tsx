import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { OwnerCarrierChanges } from './owner-carrier-changes'

const orderNo = 'SO-20261118-ABC12345'
const endpoint = '/api/shipping/owner/orders/' + orderNo + '/carrier-changes'
const original = { name: '测试联系人', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '深南路一号' }
const sender = { ...original, name: '原寄件人', address: '寄件路二号' }
const destination = { ...original, address: '新园路九号' }
const detail = { orderNo, actions: ['modify_recipient', 'return_to_sender'], currentRecipient: original, returnDestination: sender, latest: null }
const receipt = { action: 'modify_recipient', status: 'accepted', requestedAt: '2026-11-18T10:03:00Z',
  originalRecipient: original, destination, instructionId: 'SF-TEST', amount: '12.50' }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
const fetcher = vi.fn()
const writes = () => fetcher.mock.calls.filter(([, options]) => options?.method === 'POST')
beforeEach(() => { vi.stubGlobal('React', React); fetcher.mockReset(); vi.stubGlobal('fetch', fetcher) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('shows no operations or addresses when the carrier change endpoint is forbidden', async () => {
  let finish!: (value: Response) => void
  fetcher.mockReturnValueOnce(new Promise<Response>(resolve => { finish = resolve }))
  const { container } = render(<OwnerCarrierChanges orderNo={orderNo} />)
  await act(async () => { finish(json({ ...detail, actions: [], currentRecipient: null, returnDestination: null }, 403)) })
  expect(container).toBeEmptyDOMElement()
  expect(fetcher).toHaveBeenCalledWith(endpoint, expect.objectContaining({ cache: 'no-store', credentials: 'same-origin' }))
  expect(writes()).toHaveLength(0)
})

it('explains a tracked waybill that is already beyond the carrier forwarding window', async () => {
  fetcher.mockResolvedValueOnce(json({ ...detail, actions: [], currentRecipient: null, returnDestination: null }))
  render(<OwnerCarrierChanges orderNo={orderNo} />)
  expect(await screen.findByRole('status')).toHaveTextContent('当前运单暂不能转寄或退回')
  expect(screen.queryByRole('button', { name: '转寄 / 改派' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '取消' })).not.toBeInTheDocument()
})

it('shows the original connection’s forwarding configuration gap accurately', async () => {
  fetcher.mockResolvedValueOnce(json({ ...detail, actions: [], unavailableReason: 'intercept_disabled' }))
  render(<OwnerCarrierChanges orderNo={orderNo} />)
  expect(await screen.findByRole('status')).toHaveTextContent('尚未在寄件配置中启用在途转寄与退回')
  expect(screen.queryByRole('button', { name: '转寄 / 改派' })).not.toBeInTheDocument()
})

it('parses and allows correction of a pasted forwarding address before submitting', async () => {
  const recipient = { name: '陈明', phone: '13900000001', province: '江苏省', city: '南京市', county: '鼓楼区', address: '中山北路36号2楼' }
  fetcher.mockResolvedValueOnce(json(detail)).mockResolvedValueOnce(json({ ...receipt, destination: recipient }))
  render(<OwnerCarrierChanges orderNo={orderNo} />)
  fireEvent.click(await screen.findByRole('button', { name: '转寄 / 改派' }))
  fireEvent.change(screen.getByLabelText('粘贴新收件地址'), { target: {
    value: '收件人：陈明\n手机号：13900000001\n江苏省南京市鼓楼区中山北路36号',
  } })
  fireEvent.click(screen.getByRole('button', { name: '确认提交转寄 / 改派' }))
  expect(writes()).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: '识别并填写' }))
  expect(screen.getByLabelText('新收件人姓名')).toHaveValue(recipient.name)
  expect(screen.getByLabelText('新收件人联系电话')).toHaveValue(recipient.phone)
  expect(screen.getByLabelText('新收件人省份')).toHaveValue(recipient.province)
  expect(screen.getByLabelText('新收件人城市')).toHaveValue(recipient.city)
  expect(screen.getByLabelText('新收件人区县')).toHaveValue(recipient.county)
  const address = screen.getByLabelText('新收件人详细地址')
  expect(address).toHaveValue('中山北路36号')
  fireEvent.change(address, { target: { value: recipient.address } })
  fireEvent.click(screen.getByRole('button', { name: '确认提交转寄 / 改派' }))
  const history = await screen.findByRole('region', { name: '顺丰指令记录' })
  expect(history).toHaveTextContent(recipient.address)
  expect(writes()).toHaveLength(1)
  expect(writes()[0][0]).toBe(endpoint)
  expect(JSON.parse(writes()[0][1].body)).toEqual({ action: 'modify_recipient', recipient, key: expect.any(String) })
})

it('keeps the return action before forwarding when both carrier actions are available', async () => {
  fetcher.mockResolvedValueOnce(json(detail))
  render(<OwnerCarrierChanges orderNo={orderNo} />)

  const returnAction = await screen.findByRole('button', { name: '取消' })
  const forwardAction = screen.getByRole('button', { name: '转寄 / 改派' })
  expect(returnAction.compareDocumentPosition(forwardAction) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

it('keeps the original instruction and key when a verified retry follows a lost response', async () => {
  fetcher.mockResolvedValueOnce(json(detail)).mockRejectedValueOnce(new TypeError('unavailable'))
    .mockResolvedValueOnce(json(detail)).mockResolvedValueOnce(json({ ...receipt, action: 'return_to_sender', destination: sender }))
  render(<OwnerCarrierChanges orderNo={orderNo} />)
  fireEvent.click(await screen.findByRole('button', { name: '取消' }))
  fireEvent.click(screen.getByRole('button', { name: '确认取消并申请退回' }))
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: '查询处理结果' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '确认取消并申请退回' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '确认取消并申请退回' }))
  await screen.findByRole('region', { name: '顺丰指令记录' })
  expect(writes()).toHaveLength(2)
  expect(writes()[1][1].body).toBe(writes()[0][1].body)
})

it('edits the saved recipient and shows the accepted instruction with the two addresses and receipt time', async () => {
  let finish!: (value: Response) => void
  fetcher.mockResolvedValueOnce(json({ ...detail, actions: ['modify_recipient'] }))
    .mockReturnValueOnce(new Promise<Response>(resolve => { finish = resolve }))
  const onPendingChange = vi.fn()
  render(<OwnerCarrierChanges orderNo={orderNo} onPendingChange={onPendingChange} />)
  fireEvent.click(await screen.findByRole('button', { name: '转寄 / 改派' }))
  expect(screen.queryByRole('button', { name: '取消' })).not.toBeInTheDocument()
  const address = screen.getByLabelText('新收件人详细地址')
  expect(address).toHaveValue(original.address)
  fireEvent.change(address, { target: { value: destination.address } })
  const confirm = screen.getByRole('button', { name: '确认提交转寄 / 改派' })
  fireEvent.click(confirm); fireEvent.click(confirm)
  expect(writes()).toHaveLength(1)
  expect(writes()[0][0]).toBe(endpoint)
  expect(JSON.parse(writes()[0][1].body)).toEqual({ action: 'modify_recipient', recipient: destination, key: expect.any(String) })
  expect(onPendingChange).toHaveBeenLastCalledWith(true)
  finish(json(receipt))
  const history = await screen.findByRole('region', { name: '顺丰指令记录' })
  expect(within(history).getByRole('status')).toHaveTextContent('顺丰已受理指令，实际处理结果待确认')
  expect(history).toHaveTextContent(original.address)
  expect(history).toHaveTextContent(destination.address)
  expect(history).toHaveTextContent('18:03')
  expect(history).toHaveTextContent('SF-TEST')
  expect(history).toHaveTextContent('12.50')
  expect(onPendingChange).toHaveBeenLastCalledWith(false)
  expect(screen.queryByRole('button', { name: '转寄 / 改派' })).not.toBeInTheDocument()
})

it('requests return to the original sender when cancelling in transit and distinguishes acceptance from cancellation', async () => {
  fetcher.mockResolvedValueOnce(json({ ...detail, actions: ['return_to_sender'] }))
    .mockResolvedValueOnce(json({ ...receipt, action: 'return_to_sender', destination: sender }))
  render(<OwnerCarrierChanges orderNo={orderNo} />)
  fireEvent.click(await screen.findByRole('button', { name: '取消' }))
  expect(screen.queryByRole('button', { name: '转寄 / 改派' })).not.toBeInTheDocument()
  const confirmation = screen.getByRole('form', { name: '申请退回至原寄件人' })
  expect(confirmation).toHaveTextContent('快件已揽收，取消将向顺丰申请退回原寄件人。')
  expect(confirmation).toHaveTextContent(sender.address)
  expect(within(confirmation).queryByRole('textbox')).not.toBeInTheDocument()
  expect(writes()).toHaveLength(0)
  fireEvent.click(within(confirmation).getByRole('button', { name: '确认取消并申请退回' }))
  expect(JSON.parse(writes()[0][1].body)).toEqual({ key: expect.any(String), action: 'return_to_sender' })
  const history = await screen.findByRole('region', { name: '顺丰指令记录' })
  expect(history).toHaveTextContent('快件退回')
  expect(history).toHaveTextContent('顺丰已受理指令，实际处理结果待确认')
  expect(history).not.toHaveTextContent('已取消')
})

it('reads the outcome of an uncertain submission without sending another instruction', async () => {
  fetcher.mockResolvedValueOnce(json(detail)).mockRejectedValueOnce(new TypeError('unavailable'))
    .mockResolvedValueOnce(json({ ...detail, latest: { ...receipt, action: 'return_to_sender', status: 'unknown', destination: sender }, actions: [] }))
  render(<OwnerCarrierChanges orderNo={orderNo} />)
  fireEvent.click(await screen.findByRole('button', { name: '取消' }))
  fireEvent.click(screen.getByRole('button', { name: '确认取消并申请退回' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('提交结果尚未确认')
  expect(screen.getByRole('button', { name: '确认取消并申请退回' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '查询处理结果' }))
  expect(await screen.findByRole('status')).toHaveTextContent('处理结果待核实')
  expect(screen.queryByRole('button', { name: '确认取消并申请退回' })).not.toBeInTheDocument()
  expect(writes()).toHaveLength(1)
})

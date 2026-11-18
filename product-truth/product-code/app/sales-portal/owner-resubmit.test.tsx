import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { SalesRequestForm } from './portal'

const orderNo = 'SO-20261118-1111AAAA'
const issuedOrderNo = 'SO-20261118-2222BBBB'
const detailPath = `/api/shipping/owner/orders/${orderNo}/resubmit`
const deptId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const currentSender = { name: '当前寄方', phone: '13900139000', province: '广东省', city: '深圳市', county: '南山区', address: '公司路1号' }
const savedSender = { ...currentSender, name: '原单寄方', address: '原始揽收路12号' }
const recipient = { name: '原收件人', phone: '13800138000', province: '广东省', city: '广州市', county: '天河区', address: '客户路8号' }
const input = {
  sender: savedSender, recipient, customerName: '原单客户公司', cargo: '项目资料', weight: 2,
  servicePreference: 'urgent', serviceId: 3, specialRequirements: '门口联系', remark: '', source: 'manual',
  submittedBy: { name: '业务员工', phone: currentSender.phone, team: '销售部', departmentId: deptId },
}
const serviceOptions = [{ id: 2, name: '标准服务', preference: 'standard' as const }, { id: 3, name: '加急服务', preference: 'urgent' as const }]
const send = vi.fn()
const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 })
let saved = false

beforeEach(() => {
  saved = false
  vi.stubGlobal('React', React)
  send.mockReset().mockImplementation(async (url: string, init?: RequestInit) => {
    if (/^\/api\/shipping\/(owner|public)\/orders\?page=0$/.test(url)) {
      const returned = {
        orderNo, status: saved ? 'awaiting_confirmation' : 'returned', waybill: null,
        revision: saved ? 2 : 1, returnedReason: saved ? null : '缺少楼层',
        createdAt: '2026-11-18T10:03:00Z', customerName: input.customerName,
      }
      return json({ orders: [returned, { ...returned, orderNo: issuedOrderNo, status: 'waybill_created', customerName: '已出号客户', waybill: 'SF1234567890' }], nextPage: null })
    }
    if (url === detailPath && init?.method === 'POST') {
      saved = true
      return json({ orderNo, status: 'awaiting_confirmation', revision: 2, waybill: null })
    }
    if (url === detailPath && (!init?.method || init.method === 'GET')) return json({ orderNo, revision: 1, input, returnedReason: '缺少楼层' })
    throw new Error(`Unexpected request: ${init?.method || 'GET'} ${url}`)
  })
  vi.stubGlobal('fetch', send)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function renderForm(owner = true) {
  const employee = { id: 'staff', email: 'staff@example.test', team: '销售部', updatedAt: '2026-11-18T00:00:00Z', sender: currentSender }
  return render(<SalesRequestForm mode={owner ? 'fxiaoke' : 'public'} employee={owner ? employee : null}
    accessReady draftSender={currentSender} draftTeam="销售部" departmentId={deptId}
    departments={[{ id: deptId, name: '销售部', path: '总部 / 销售部' }]} services={serviceOptions} />)
}

async function openReturnedOrder() {
  const summary = await screen.findByRole('button', { name: /原单客户公司/ })
  const row = summary.closest('li')!
  fireEvent.click(summary)
  expect(within(row).getByText(orderNo)).toBeInTheDocument()
  fireEvent.click(within(row).getByRole('button', { name: '修改' }))
  await waitFor(() => expect(screen.getByLabelText('收件人')).toHaveValue(recipient.name))
}

it('fills the returned ticket, previews the edits and submits one revision to the original order', async () => {
  renderForm()
  await openReturnedOrder()
  expect(send.mock.calls.filter(([url, init]) => url === detailPath && init?.method !== 'POST')).toHaveLength(1)
  expect(screen.getByLabelText('单票客户公司名称')).toHaveValue(input.customerName)
  expect(screen.getByLabelText('详细地址')).toHaveValue(recipient.address)
  expect(screen.getByLabelText('托寄物')).toHaveValue(input.cargo)
  expect(screen.getByLabelText(/我的特殊需求/)).toHaveValue(input.specialRequirements)
  fireEvent.change(screen.getByLabelText('详细地址'), { target: { value: '客户路8号2楼' } })
  fireEvent.click(screen.getByRole('button', { name: /预览(?:工单|重提)/ }))
  expect(screen.getByRole('region', { name: '寄出预览' })).toHaveTextContent('客户路8号2楼')
  expect(send.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: /确认重提/ }))
  await waitFor(() => expect(screen.getByRole('button', { name: /原单客户公司/ })).toHaveTextContent(/第\s*1\s*次更改/))
  const writes = send.mock.calls.filter(([, init]) => init?.method === 'POST')
  expect(writes).toHaveLength(1)
  expect(writes[0][0]).toBe(detailPath)
  const payload = JSON.parse(writes[0][1].body)
  expect(payload).toMatchObject({
    expectedRevision: 1,
    key: expect.stringMatching(/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i),
    input: {
      sender: savedSender, recipient: { ...recipient, address: '客户路8号2楼' }, customerName: input.customerName,
      cargo: input.cargo, weight: input.weight, servicePreference: input.servicePreference,
      serviceId: input.serviceId, specialRequirements: input.specialRequirements, submittedBy: { departmentId: deptId },
    },
  })
  const records = screen.getByRole('region', { name: '按日期分组的提报记录' })
  expect(within(records).getAllByRole('listitem')).toHaveLength(2)
  fireEvent.click(within(records).getByRole('button', { name: /原单客户公司/ }))
  expect(within(records).getAllByText(orderNo)).toHaveLength(1)
  expect(within(records).queryByRole('button', { name: '修改' })).not.toBeInTheDocument()
})

it('keeps returned-order edits single-ticket when the pasted text contains multiple recipients', async () => {
  renderForm()
  await openReturnedOrder()
  fireEvent.change(screen.getByLabelText('智能地址一键粘贴'), { target: { value: [
    '张三 13800138000 广东省深圳市南山区科技路1号',
    '李四 13900139000 广东省广州市天河区中新路2号',
  ].join('\n') } })
  fireEvent.click(screen.getByRole('button', { name: '识别并填充' }))
  expect(screen.queryByRole('button', { name: /预览\s*2\s*票|确认提交\s*2\s*票/ })).not.toBeInTheDocument()
  expect(screen.queryByLabelText('第2票收件人')).not.toBeInTheDocument()
  expect(screen.getByLabelText('收件人')).toHaveValue(recipient.name)
  expect(send.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
})

it('offers no resubmission or separate address change for issued waybills or anonymous records', async () => {
  const owner = renderForm()
  const issuedSummary = await screen.findByRole('button', { name: /已出号客户/ })
  fireEvent.click(issuedSummary)
  const issuedRow = issuedSummary.closest('li')!
  expect(within(issuedRow).getByText(issuedOrderNo)).toBeInTheDocument()
  expect(within(issuedRow).queryByRole('button', { name: /^(重提|改址|修改地址|修改)$/ })).not.toBeInTheDocument()
  owner.unmount()
  renderForm(false)
  await screen.findByText(orderNo, { selector: 'li strong' })
  expect(screen.queryByRole('button', { name: /^(重提|改址|修改地址|修改)$/ })).not.toBeInTheDocument()
  expect(send.mock.calls.some(([url]) => url === detailPath)).toBe(false)
})

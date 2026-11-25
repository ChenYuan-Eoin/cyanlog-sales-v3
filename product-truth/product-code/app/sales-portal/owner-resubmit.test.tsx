import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { FxiaokeShippingProposal, SalesRequestForm } from './portal'
import { DEFAULT_INTAKE_RULES } from '@/lib/shipping/intake-rules'

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
      return json({ orderNo, status: 'awaiting_confirmation', revision: 2, waybill: null, resubmittedFrom: null, replayed: true })
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
  const row = await screen.findByRole('listitem', { name: `提报 ${orderNo}` })
  expect(row).not.toHaveTextContent(orderNo)
  fireEvent.click(within(row).getByRole('button', { name: '修改并重提' }))
  await waitFor(() => expect(screen.getByLabelText('收件人')).toHaveValue(recipient.name))
}

it('loads edits and accepts a legacy replay of the original order revision without adding a record', async () => {
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
  expect(send.mock.calls.filter(([url, init]) => init?.method === 'POST' && !url.endsWith('/tracking'))).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: /确认重提/ }))
  const updated = await screen.findByRole('listitem', { name: `提报 ${orderNo}` })
  await waitFor(() => expect(updated).toHaveTextContent(/第\s*1\s*次更改/))
  const writes = send.mock.calls.filter(([url, init]) => init?.method === 'POST' && !url.endsWith('/tracking'))
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
  await waitFor(() => expect(updated).toHaveTextContent('待审核'))
  expect(updated).toHaveTextContent('待审核')
  expect(within(updated).queryByRole('button', { name: '修改并重提' })).not.toBeInTheDocument()
})

it('shows the original in history and the successor under its new submission date', async () => {
  const fallback = send.getMockImplementation()!
  const successorNo = 'SO-20261125-3333CCCC'
  const successor = {
    orderNo: successorNo, status: 'awaiting_confirmation', revision: 1, waybill: null,
    createdAt: '2026-11-25T01:00:00Z', nextReviewAt: '2026-11-25T03:00:00Z',
    customerName: '今日重提客户', resubmittedFrom: orderNo,
  }
  let persisted = false
  send.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === detailPath && init?.method === 'POST') {
      persisted = true
      return json({ ...successor, replayed: false })
    }
    if (persisted && url.endsWith('owner/orders?page=0')) {
      return json({
        orders: [
          { ...successor, customerName: '服务端回读客户' },
          { orderNo, status: 'resubmitted', revision: 1, waybill: null,
            createdAt: '2026-11-18T10:03:00Z', customerName: input.customerName },
        ],
        nextPage: null,
      })
    }
    return fallback(url, init)
  })
  renderForm()
  const filter = await screen.findByRole('button', { name: '已退回' })
  fireEvent.click(filter)
  await waitFor(() => expect(screen.getByRole('button', { name: '刷新提报记录' })).toBeEnabled())
  await openReturnedOrder()
  fireEvent.change(screen.getByLabelText('单票客户公司名称'), { target: { value: successor.customerName } })
  fireEvent.click(screen.getByRole('button', { name: '预览工单' }))
  expect(screen.getByRole('region', { name: '寄出预览' })).toHaveTextContent('原记录保留')
  fireEvent.click(screen.getByRole('button', { name: '确认重提' }))
  expect(await screen.findByRole('button', { name: '全部 (2)' })).toHaveAttribute('aria-pressed', 'true')
  const recent = screen.getByRole('region', { name: '2026年11月25日' })
  expect(within(recent).getByRole('listitem', { name: `提报 ${successorNo}` })).toHaveTextContent('待审核')
  await within(recent).findByText('服务端回读客户')
  const oldDate = screen.getByRole('region', { name: '2026年11月18日' })
  const original = within(oldDate).getByRole('listitem', { name: `提报 ${orderNo}` })
  expect(original).toHaveTextContent('已重提')
  expect(original).toHaveTextContent(input.customerName)
  expect(within(original).queryByRole('button', { name: '修改并重提' })).not.toBeInTheDocument()
  expect(send.mock.calls.filter(([url, init]) => url === detailPath && init?.method === 'POST')).toHaveLength(1)
})

it('saves the edited pickup address to the employee profile without resubmitting or losing the draft', async () => {
  const fallback = send.getMockImplementation()!
  const profilePath = '/api/shipping/owner/profile'
  const profile = {
    id: 'staff', email: 'staff@example.test', fxiaoke: true, team: '销售部',
    updatedAt: '2026-11-18T00:00:00Z', sender: currentSender, departmentId: deptId,
    departments: [{ id: deptId, name: '销售部', path: '总部 / 销售部', isPrimary: true }],
    senderChoices: { company: currentSender, personal: null },
  }
  const newSender = { ...savedSender, address: '修改后的揽收地址22号' }
  let profileWrites = 0
  send.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url !== profilePath) return fallback(url, init)
    if (init?.method !== 'POST') return json({ employee: profile })
    profileWrites++
    if (profileWrites === 1) return new Response(JSON.stringify({ error: '资料已更新，请重试。' }), { status: 409 })
    return json({ employee: { ...profile, sender: newSender, senderChoices: { ...profile.senderChoices, personal: newSender } } })
  })

  render(<FxiaokeShippingProposal profile={profile} rules={DEFAULT_INTAKE_RULES} services={serviceOptions} />)
  await openReturnedOrder()
  fireEvent.click(screen.getByText(/寄件人 · 原单寄方/))
  fireEvent.change(screen.getByLabelText('寄件详细地址'), { target: { value: newSender.address } })
  fireEvent.change(screen.getByLabelText('详细地址'), { target: { value: '收件地址草稿不丢失' } })
  const save = screen.getByRole('button', { name: '保存为我的常用地址' })
  fireEvent.click(save)
  expect(await screen.findByRole('alert')).toHaveTextContent('资料已更新，请重试。')
  expect(screen.getByLabelText('寄件详细地址')).toHaveValue(newSender.address)
  fireEvent.click(save)
  await screen.findByText('揽收地址已保存为我的常用地址，下次可以直接选用。')
  expect(screen.getByLabelText('详细地址')).toHaveValue('收件地址草稿不丢失')
  const writes = send.mock.calls.filter(([url, init]) => init?.method === 'POST' && !url.endsWith('/tracking'))
  expect(writes.map(([url]) => url)).toEqual([profilePath, profilePath])
  expect(JSON.parse(writes[1][1].body)).toMatchObject({
    action: 'save_profile', profile: { departmentId: deptId, expectedUpdatedAt: profile.updatedAt, sender: newSender },
  })
  fireEvent.change(screen.getByLabelText('寄件详细地址'), { target: { value: '另外编辑的地址' } })
  fireEvent.click(screen.getByRole('button', { name: '使用我的常用地址' }))
  expect(screen.getByLabelText('寄件详细地址')).toHaveValue(newSender.address)
})

it('loads later pages, refreshes page zero and can reopen the updated older record', async () => {
  const fallback = send.getMockImplementation()!
  const recent = Array.from({ length: 6 }, (_, i) => ({
    orderNo: 'RECENT-' + i, status: 'confirmed', customerName: '近期客户' + i, waybill: null, revision: 1,
    createdAt: '2026-11-18T10:03:00Z',
  }))
  send.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith('orders?page=0')) return json({ orders: recent, nextPage: 1 })
    if (url.endsWith('orders?page=1')) return json({ orders: [{
      orderNo, status: saved ? 'awaiting_confirmation' : 'returned', waybill: null, revision: saved ? 2 : 1,
      customerName: saved ? '重提后公司' : input.customerName, createdAt: '2026-11-17T10:03:00Z',
    }], nextPage: null })
    return fallback(url, init)
  })
  renderForm()
  const records = await screen.findByRole('region', { name: '按日期分组的提报记录' })
  expect(within(records).getAllByRole('listitem')).toHaveLength(5)
  fireEvent.click(screen.getByRole('button', { name: '显示更多记录' }))
  expect(within(records).getAllByRole('listitem')).toHaveLength(6)
  await waitFor(() => expect(screen.getByRole('button', { name: '刷新提报记录' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '显示更多记录' }))
  await screen.findByRole('listitem', { name: `提报 ${orderNo}` })
  await openReturnedOrder()
  fireEvent.change(screen.getByLabelText('单票客户公司名称'), { target: { value: '重提后公司' } })
  fireEvent.click(screen.getByRole('button', { name: '预览工单' }))
  fireEvent.click(screen.getByRole('button', { name: '确认重提' }))
  const updated = await screen.findByRole('listitem', { name: `提报 ${orderNo}` })
  await waitFor(() => expect(updated).toHaveTextContent('重提后公司'))
  expect(updated).toHaveTextContent('待审核')
  expect(updated).toHaveTextContent('第 1 次更改')
  expect(screen.getAllByRole('listitem', { name: `提报 ${orderNo}` })).toHaveLength(1)
  const afterEdit = screen.getByRole('region', { name: '按日期分组的提报记录' })
  expect(within(afterEdit).getAllByRole('listitem')).toHaveLength(7)
  expect(send.mock.calls.filter(([url]) => url.endsWith('orders?page=1')).length).toBeGreaterThanOrEqual(1)
  expect(send.mock.calls.filter(([url]) => url.endsWith('orders?page=0')).length).toBeGreaterThanOrEqual(2)
  fireEvent.click(screen.getByRole('button', { name: '刷新提报记录' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '刷新提报记录' })).toBeEnabled())
  expect(screen.getByRole('listitem', { name: `提报 ${orderNo}` })).toBeInTheDocument()
  const reloaded = await screen.findByRole('listitem', { name: `提报 ${orderNo}` })
  expect(reloaded).toHaveTextContent('重提后公司')
  expect(reloaded).toHaveTextContent('待审核')
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
  expect(send.mock.calls.filter(([url, init]) => init?.method === 'POST' && !url.endsWith('/tracking'))).toHaveLength(0)
})

it('offers no resubmission or separate address change for issued waybills or anonymous records', async () => {
  const owner = renderForm()
  const issuedRow = await screen.findByRole('listitem', { name: `提报 ${issuedOrderNo}` })
  expect(issuedRow).not.toHaveTextContent(issuedOrderNo)
  expect(within(issuedRow).queryByRole('button', { name: /^(重提|改址|修改地址|修改并重提)$/ })).not.toBeInTheDocument()
  owner.unmount()
  renderForm(false)
  const anonymousRow = await screen.findByRole('listitem', { name: `提报 ${orderNo}` })
  expect(anonymousRow).not.toHaveTextContent('缺少楼层')
  expect(screen.queryByRole('button', { name: /^(重提|改址|修改地址|修改并重提)$/ })).not.toBeInTheDocument()
  expect(send.mock.calls.some(([url]) => url === detailPath)).toBe(false)
})

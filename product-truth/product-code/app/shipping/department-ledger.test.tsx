// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ShipmentOrder } from '@/lib/shipping/types'
import DepartmentLedger from './department-ledger'

const parent = 'be279d15-5e53-4b46-b0d9-a293654dc145'
const child = 'e582bc58-cdf9-4d71-8f50-d21541a17ec3'
const other = 'dfec2ec6-2848-4cd0-91d8-8ae335cf67dd'
const orderId = '9bc524f9-3833-4a68-ab81-f6c1d533e732'
const departments = [
  { id: parent, name: '华南', parentId: null },
  { id: child, name: '销售一部', parentId: parent },
  { id: other, name: '华东', parentId: null },
]
const fetcher = vi.fn<typeof fetch>()

function record(orderNo: string): ShipmentOrder {
  return {
    id: orderId, orderNo, createdAt: '2026-11-26T03:00:00Z', nextReviewAt: null,
    intakeSource: 'owner_web', confirmationPolicy: 'scheduled_review', status: 'in_transit', waybill: 'SF100001',
    relation: { salesRef: null, customerRef: null, assignmentStatus: 'unassigned' },
    input: {
      sender: { name: '寄件人甲', phone: '', province: '', city: '', county: '', address: '' },
      recipient: { name: '收件人乙', phone: '', province: '', city: '', county: '', address: '' },
      cargo: '样品', weight: 1, remark: '', source: 'manual', customerName: `客户 ${orderNo}`,
      submittedBy: { name: '提报员工', phone: '', team: '销售一部', departmentId: child },
    },
    trackingEvents: [{ time: '2026-11-26T03:01:00Z', location: '深圳市', description: '快件已发出' }],
  }
}

function pendingRecord(canReturn: boolean) {
  return { ...record('SO-RETURN'), status: 'awaiting_confirmation' as const, waybill: null, canReturn }
}

function ledgerPage(records: ShipmentOrder[] = [], nextPage: number | null = null) {
  return Response.json({ records, nextPage })
}

function prepareLedger() {
  return render(<DepartmentLedger departments={departments} canViewOwn={false} canManageConnections={false} />)
}

function selectDepartment(departmentId: string) {
  fireEvent.change(screen.getByRole('combobox', { name: '查看部门' }), { target: { value: departmentId } })
}

function readRequest(index: number) {
  const [url, init] = fetcher.mock.calls[index]
  return { url: new URL(String(url), 'https://example.test'), init }
}

beforeEach(() => {
  fetcher.mockReset()
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('starts with the authorized union, narrows by department, includes descendants by choice, and resets pagination', async () => {
  fetcher.mockImplementation(async url => {
    const query = new URL(String(url), 'https://example.test').searchParams
    return ledgerPage([record(`SO-${query.get('page')}`)], query.get('page') === '0' ? 1 : null)
  })
  prepareLedger()
  await screen.findByText('客户 SO-0')
  expect(screen.getByRole('combobox', { name: '查看部门' })).toHaveValue('')
  expect(screen.getByRole('option', { name: '全部已授权部门' })).toBeInTheDocument()
  expect(screen.getByRole('option', { name: '华南 / 销售一部' })).toHaveValue(child)
  expect(readRequest(0).url.searchParams.toString()).toBe('page=0&limit=50')

  fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  await screen.findByText('客户 SO-1')
  expect(readRequest(1).url.searchParams.get('page')).toBe('1')

  selectDepartment(parent)
  await screen.findByText('客户 SO-0')
  expect(readRequest(2).url.searchParams.toString()).toBe(`departmentId=${parent}&includeSubdepartments=false&page=0&limit=50`)
  fireEvent.click(screen.getByRole('checkbox', { name: '含下级部门' }))
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4))
  expect(readRequest(3).url.searchParams.toString()).toBe(`departmentId=${parent}&includeSubdepartments=true&page=0&limit=50`)

  selectDepartment(other)
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(5))
  expect(readRequest(4).url.searchParams.get('includeSubdepartments')).toBe('false')
  expect(screen.queryByRole('checkbox', { name: '含下级部门' })).not.toBeInTheDocument()
})

it('drops a previous department list and rejects delayed results after another department is selected', async () => {
  let finishPrevious!: (value: Response) => void
  fetcher.mockResolvedValueOnce(ledgerPage([record('SO-ALL')]))
    .mockReturnValueOnce(new Promise(resolve => { finishPrevious = resolve }))
    .mockResolvedValueOnce(ledgerPage([record('SO-CURRENT')]))
  prepareLedger()
  await screen.findByText('客户 SO-ALL')

  selectDepartment(parent)
  expect(screen.queryByText('客户 SO-ALL')).not.toBeInTheDocument()
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  selectDepartment(other)
  await screen.findByText('客户 SO-CURRENT')
  expect(readRequest(1).init?.signal?.aborted).toBe(true)
  await act(async () => finishPrevious(ledgerPage([record('SO-STALE')])))
  expect(screen.getByText('客户 SO-CURRENT')).toBeInTheDocument()
  expect(screen.queryByText('客户 SO-STALE')).not.toBeInTheDocument()
})

it('reads scoped details and cached tracking through GET only', async () => {
  fetcher.mockImplementation(async url => {
    if (new URL(String(url), 'https://example.test').pathname.endsWith(orderId)) {
      return Response.json({ record: record('SO-READONLY') })
    }
    return ledgerPage([record('SO-READONLY')])
  })
  render(<DepartmentLedger departments={departments} canViewOwn canManageConnections={false} />)
  await screen.findByText('客户 SO-READONLY')
  expect(screen.getByRole('link', { name: '本人寄件' })).toHaveAttribute('href', '/sales-portal')
  expect(screen.queryByRole('link', { name: '寄件设置' })).not.toBeInTheDocument()
  selectDepartment(parent)
  await screen.findByRole('button', { name: '查看寄件详情 SO-READONLY' })
  fireEvent.click(screen.getByRole('checkbox', { name: '含下级部门' }))
  fireEvent.click(await screen.findByRole('button', { name: '查看寄件详情 SO-READONLY' }))
  expect(await screen.findByText(/快件已发出/)).toBeInTheDocument()
  expect(screen.getByRole('region', { name: '寄件详情' })).toHaveTextContent('样品')
  expect(screen.queryByRole('button', { name: /下单|同步物流|取消运单|转寄|退回/ })).not.toBeInTheDocument()
  expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
  expect(readRequest(3).url.pathname).toBe(`/api/shipping/ledger/${orderId}`)
  expect(readRequest(3).url.searchParams.toString()).toBe(`departmentId=${parent}&includeSubdepartments=true`)
})

it('shows the return action only for pending records whose response permits it', async () => {
  const pending = pendingRecord(false)
  const statusChanged = { ...record('SO-IN-TRANSIT'), id: child, canReturn: true }
  fetcher.mockResolvedValue(ledgerPage([pending, statusChanged]))
  prepareLedger()
  await screen.findByText('客户 SO-RETURN')

  expect(screen.queryByRole('button', { name: '退回工单' })).not.toBeInTheDocument()
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('returns a pending order with its reason and rereads the current department, page, and opened detail', async () => {
  const pending = pendingRecord(true)
  let resolvedRecord: ShipmentOrder & { canReturn: boolean } = pending
  let finishReturn!: (response: Response) => void
  const pendingReturn = new Promise<Response>(resolve => { finishReturn = resolve })
  fetcher.mockImplementation(async (url, init) => {
    const request = new URL(String(url), 'https://example.test')
    if (init?.method === 'POST') return pendingReturn
    if (request.pathname.endsWith(orderId)) return Response.json({ record: resolvedRecord })
    return ledgerPage([resolvedRecord], request.searchParams.get('page') === '0' ? 1 : null)
  })
  prepareLedger()
  await screen.findByRole('button', { name: '退回工单' })
  selectDepartment(parent)
  await screen.findByRole('button', { name: '退回工单' })
  fireEvent.click(screen.getByRole('checkbox', { name: '含下级部门' }))
  fireEvent.click(await screen.findByRole('button', { name: '下一页' }))
  fireEvent.click(await screen.findByRole('button', { name: '查看寄件详情 SO-RETURN' }))
  await screen.findByRole('region', { name: '寄件详情' })
  fireEvent.click(screen.getByRole('button', { name: '退回工单' }))
  const form = screen.getByRole('form', { name: '退回工单 SO-RETURN' })
  fireEvent.change(screen.getByLabelText('退回原因'), { target: { value: ' ' } })
  expect(screen.getByRole('button', { name: '确认退回' })).toBeDisabled()
  fireEvent.submit(form)
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)

  fireEvent.change(screen.getByLabelText('退回原因'), { target: { value: ' 请补齐收件地址 ' } })
  fireEvent.click(screen.getByRole('button', { name: '确认退回' }))
  expect(screen.getByRole('button', { name: '退回中…' })).toBeDisabled()
  fireEvent.submit(form)
  const postRequests = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')
  expect(postRequests).toHaveLength(1)
  expect(postRequests[0]).toEqual([`/api/shipping/ledger/${orderId}/return`, expect.objectContaining({
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: '请补齐收件地址' }),
  })])

  resolvedRecord = { ...pending, status: 'returned', canReturn: false }
  await act(async () => finishReturn(Response.json({ id: orderId, status: 'returned' })))
  expect(await screen.findByText('工单已退回')).toBeVisible()
  expect(screen.getByText('工单已退回并记录原因。')).toBeVisible()
  expect(screen.getByRole('combobox', { name: '查看部门' })).toHaveValue(parent)
  expect(screen.getByRole('checkbox', { name: '含下级部门' })).toBeChecked()
  expect(await screen.findByRole('region', { name: '寄件详情' })).toBeVisible()
  expect(screen.queryByRole('button', { name: '退回工单' })).not.toBeInTheDocument()
  const scope = `departmentId=${parent}&includeSubdepartments=true`
  expect(fetcher.mock.calls.slice(-2).map(([url]) => String(url))).toEqual([
    `/api/shipping/ledger?${scope}&page=1&limit=50`, `/api/shipping/ledger/${orderId}?${scope}`,
  ])
})

it('reports a server refusal and loses the action after permission disappears from the reread', async () => {
  fetcher.mockResolvedValueOnce(ledgerPage([pendingRecord(true)]))
    .mockResolvedValueOnce(Response.json({ error: '当前账号没有退回权限。' }, { status: 403 }))
    .mockResolvedValueOnce(ledgerPage([pendingRecord(false)]))
  prepareLedger()
  fireEvent.click(await screen.findByRole('button', { name: '退回工单' }))
  fireEvent.change(screen.getByLabelText('退回原因'), { target: { value: '补充资料' } })
  fireEvent.click(screen.getByRole('button', { name: '确认退回' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('当前账号没有退回权限。')
  expect(await screen.findByText('客户 SO-RETURN')).toBeVisible()
  expect(screen.queryByRole('button', { name: '退回工单' })).not.toBeInTheDocument()
  expect(screen.queryByRole('form')).not.toBeInTheDocument()
  expect(screen.queryByText('工单已退回并记录原因。')).not.toBeInTheDocument()
})

it('refreshes records when the server supplies a narrower authorization tree', async () => {
  fetcher.mockResolvedValueOnce(ledgerPage([record('SO-BEFORE')]))
    .mockResolvedValueOnce(ledgerPage([record('SO-AFTER')]))
  const view = prepareLedger()
  await screen.findByText('客户 SO-BEFORE')
  view.rerender(<DepartmentLedger departments={departments.filter(department => department.id === other)}
    canViewOwn={false} canManageConnections={false} />)
  expect(screen.queryByText('客户 SO-BEFORE')).not.toBeInTheDocument()
  expect(screen.queryByRole('option', { name: '华南' })).not.toBeInTheDocument()
  expect(await screen.findByText('客户 SO-AFTER')).toBeInTheDocument()
})

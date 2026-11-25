// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import HomePage from './page'

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  router: { push: vi.fn(), replace: vi.fn() },
}))

vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }))
vi.mock('@/lib/home-data-client', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/home-data-client')>(),
  loadHomeInitialData: mocks.load,
}))
vi.mock('@/lib/scoped-access', () => ({ normalizeSalesSpaceName: (name: string) => name }))

const departments = [
  { department_id: 'east', name: '华东销售', parent_department_id: null, sales_space_ids: ['space-east'] },
  { department_id: 'east-team', name: '业务一组', parent_department_id: 'east', sales_space_ids: [] },
  { department_id: 'north', name: '华北销售', parent_department_id: null, sales_space_ids: ['space-north'] },
  { department_id: 'south', name: '华南销售', parent_department_id: null, sales_space_ids: ['space-south'] },
]

const profile = { id: 'user', display_name: '操作员', org_id: 'org', roles: [] }
const legacyDashboard = {
  spaces: [],
  activeSpace: null,
  opportunities: [{ id: 'old', name: '旧销售空间的机会', status: 'LEAD' }],
  milestones: [],
  reminders: [],
  agenda: [{ id: 'personal', title: '个人日程', start_time: '2026-11-25T06:00:00Z' }],
}
const request = vi.fn<typeof fetch>()
const rosterRequest = vi.fn<typeof fetch>()

function dashboard(departmentId: string | null, includeSubdepartments: boolean, opportunity = '汇总机会') {
  return Response.json({
    departmentSpaces: departments,
    selection: { departmentId, includeSubdepartments },
    opportunities: [{ id: departmentId ?? 'summary', name: opportunity, status: 'LEAD' }],
    milestones: [],
  })
}

function deferredResponse() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>(settle => { resolve = settle })
  return { promise, resolve }
}

describe('department views in the sales dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    request.mockReset()
    rosterRequest.mockReset()
    localStorage.clear()
    sessionStorage.clear()
    mocks.load.mockResolvedValue({ profile, dashboard: { ...legacyDashboard, opportunities: [] } })
    rosterRequest.mockImplementation(async () => Response.json({
      status: 'ready', members: [], total: 0, page: 1, pageSize: 20, asOf: '2026-11-25T00:00:00Z',
    }))
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
      url.startsWith('/api/dashboard/department/roster?') ? rosterRequest(url, init) : request(url, init))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('lets an administrator select every granted department and re-queries records for exact and subtree views', async () => {
    request.mockResolvedValueOnce(dashboard(null, true))
      .mockResolvedValueOnce(dashboard('east', true, '华东含下级机会'))
      .mockResolvedValueOnce(dashboard('east', false, '华东直属机会'))
      .mockResolvedValueOnce(dashboard('east-team', false, '业务一组机会'))
      .mockResolvedValueOnce(dashboard('south', false, '华南直属机会'))
    render(<HomePage />)

    const view = await screen.findByLabelText('当前部门空间')
    expect(view).toHaveValue('')
    for (const name of ['华东销售', '华东销售 / 业务一组', '华北销售', '华南销售']) {
      expect(screen.getByRole('option', { name })).toBeInTheDocument()
    }
    expect(screen.getByText('汇总机会')).toBeInTheDocument()
    expect(screen.queryByText('旧销售空间的机会')).not.toBeInTheDocument()

    fireEvent.change(view, { target: { value: 'east' } })
    expect(await screen.findByText('华东含下级机会')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('部门数据范围'), { target: { value: 'direct' } })
    expect(await screen.findByText('华东直属机会')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /华东直属机会/ })).toHaveAttribute(
      'href', '/opportunities/east',
    )
    expect(screen.queryByText('华东含下级机会')).not.toBeInTheDocument()

    fireEvent.change(view, { target: { value: 'east-team' } })
    expect(await screen.findByText('业务一组机会')).toBeInTheDocument()
    fireEvent.change(view, { target: { value: 'south' } })
    expect(await screen.findByText('华南直属机会')).toBeInTheDocument()
    expect(screen.queryByText('业务一组机会')).not.toBeInTheDocument()
    expect(screen.getByText('个人日程')).toBeInTheDocument()
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      '/api/dashboard/department',
      '/api/dashboard/department?departmentId=east&includeSubdepartments=true',
      '/api/dashboard/department?departmentId=east&includeSubdepartments=false',
      '/api/dashboard/department?departmentId=east-team&includeSubdepartments=false',
      '/api/dashboard/department?departmentId=south&includeSubdepartments=false',
    ])
  })

  it('keeps the last confirmed data until a switch succeeds and ignores an older response', async () => {
    const east = deferredResponse()
    const north = deferredResponse()
    request.mockResolvedValueOnce(dashboard(null, true))
      .mockReturnValueOnce(east.promise)
      .mockReturnValueOnce(north.promise)
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
    render(<HomePage />)
    const view = await screen.findByLabelText('当前部门空间')

    fireEvent.change(view, { target: { value: 'east' } })
    fireEvent.change(view, { target: { value: 'north' } })
    expect(screen.getByText('汇总机会')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('正在切换部门空间')
    expect(request.mock.calls[1][1]?.signal?.aborted).toBe(true)
    await act(async () => north.resolve(dashboard('north', true, '华北机会')))
    await act(async () => east.resolve(dashboard('east', true, '华东迟到机会')))
    expect(screen.getByText('华北机会')).toBeInTheDocument()
    expect(screen.queryByText('华东迟到机会')).not.toBeInTheDocument()

    fireEvent.change(view, { target: { value: 'south' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法切换部门空间')
    expect(view).toHaveValue('north')
    expect(screen.getByText('华北机会')).toBeInTheDocument()
  })

  it('revalidates a restored view and drops old business rows when the grant is removed', async () => {
    sessionStorage.setItem('dashboard:department:user:org', 'north:direct')
    request.mockResolvedValueOnce(Response.json({ code: 'DEPARTMENT_SELECTION_FORBIDDEN' }, { status: 403 }))
      .mockResolvedValueOnce(dashboard(null, true))
      .mockResolvedValueOnce(Response.json({ code: 'DEPARTMENT_SELECTION_FORBIDDEN' }, { status: 403 }))
    render(<HomePage />)

    const view = await screen.findByLabelText('当前部门空间')
    expect(request.mock.calls[0][0]).toBe('/api/dashboard/department?departmentId=north&includeSubdepartments=false')
    expect(view).toHaveValue('')
    fireEvent.change(view, { target: { value: 'east' } })
    await waitFor(() => expect(screen.queryByLabelText('当前部门空间')).not.toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent('该部门空间已不可访问')
    expect(screen.queryByText('汇总机会')).not.toBeInTheDocument()
    expect(screen.queryByText('旧销售空间的机会')).not.toBeInTheDocument()
    expect(screen.getByText('个人日程')).toBeInTheDocument()
  })

  it('keeps the existing workbench for users without department grants', async () => {
    request.mockResolvedValueOnce(Response.json({ code: 'DEPARTMENT_SCOPE_REQUIRED' }, { status: 403 }))
      .mockResolvedValueOnce(Response.json(legacyDashboard))
    render(<HomePage />)
    expect(await screen.findByText('旧销售空间的机会')).toBeInTheDocument()
    expect(screen.queryByLabelText('当前部门空间')).not.toBeInTheDocument()
    expect(mocks.load).toHaveBeenCalledWith(null, expect.objectContaining({ view: 'personal' }))
  })

  it('does not request the legacy workspace when the active organization can no longer be verified', async () => {
    request.mockResolvedValueOnce(Response.json({ code: 'DEPARTMENT_MEMBERSHIP_REQUIRED' }, { status: 403 }))
    render(<HomePage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('当前组织成员权限已变化')
    expect(request).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('个人日程')).not.toBeInTheDocument()
  })

  it('queries synchronized staff for the confirmed department and resets the roster when scope changes', async () => {
    request.mockResolvedValueOnce(dashboard(null, true)).mockResolvedValueOnce(dashboard('east', true))
    rosterRequest
      .mockResolvedValueOnce(Response.json({
        status: 'ready', asOf: '2026-11-25T00:00:00Z', total: 2, page: 1, pageSize: 20,
        members: [{ id: 'north-person', displayName: '华北成员', departmentIds: ['north'] }],
      }))
      .mockResolvedValueOnce(Response.json({
        status: 'ready', asOf: '2026-11-25T00:00:00Z', total: 1, page: 1, pageSize: 20,
        members: [{ id: 'east-person', displayName: '华东成员', departmentIds: ['east-team'] }],
      }))
    render(<HomePage />)
    expect(await screen.findByText('华北成员')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('当前部门空间'), { target: { value: 'east' } })
    expect(await screen.findByText('华东成员')).toBeInTheDocument()
    expect(screen.queryByText('华北成员')).not.toBeInTheDocument()
    expect(rosterRequest.mock.calls.map(([url]) => url)).toEqual([
      '/api/dashboard/department/roster?page=1',
      '/api/dashboard/department/roster?departmentId=east&includeSubdepartments=true&page=1',
    ])
  })
})

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

const departments = [
  { department_id: 'east', name: '华东销售', parent_department_id: null },
  { department_id: 'east-team', name: '业务一组', parent_department_id: 'east' },
  { department_id: 'north', name: '华北销售', parent_department_id: null },
  { department_id: 'south', name: '华南销售', parent_department_id: null },
]

const profile = { id: 'user', display_name: '操作员', org_id: 'org', roles: [] }
const personalDashboard = {
  organizationId: 'org',
  reminders: [],
  agenda: [{ id: 'personal', title: '个人日程', start_time: '2026-11-25T06:00:00Z' }],
}
const request = vi.fn<typeof fetch>()
const rosterRequest = vi.fn<typeof fetch>()
const personalRequest = vi.fn<typeof fetch>()

function dashboard(
  departmentId: string | null, includeSubdepartments: boolean, opportunity = '汇总机会',
  options = departments, organizationId = 'org',
) {
  return Response.json({
    organizationId,
    departmentSpaces: options,
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
    personalRequest.mockReset()
    personalRequest.mockImplementation(async () => Response.json(personalDashboard))
    localStorage.clear()
    sessionStorage.clear()
    mocks.load.mockResolvedValue({ profile, dashboard: personalDashboard })
    rosterRequest.mockImplementation(async () => Response.json({
      status: 'ready', organizationId: 'org', members: [], total: 0, page: 1, pageSize: 20, asOf: '2026-11-25T00:00:00Z',
    }))
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      if (url === '/api/dashboard?view=personal') return personalRequest(url, init)
      if (url.startsWith('/api/dashboard/department/roster?')) return rosterRequest(url, init)
      return request(url, init)
    })
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

    const view = await screen.findByLabelText('当前部门')
    expect(view).toHaveValue('')
    for (const name of ['华东销售', '华东销售 / 业务一组', '华北销售', '华南销售']) {
      expect(screen.getByRole('option', { name })).toBeInTheDocument()
    }
    expect(screen.getByText('汇总机会')).toBeInTheDocument()

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

  it('shows a South GM only the authorized parent and subdepartment, with independent data selection', async () => {
    const south = departments.find(department => department.department_id === 'south')!
    const subtree = [south, { department_id: 'south-one', name: '华南一组', parent_department_id: 'south' }]
    request.mockResolvedValueOnce(dashboard(null, true, '华南范围汇总', subtree))
      .mockResolvedValueOnce(dashboard('south', true, '华南含下级数据', subtree))
      .mockResolvedValueOnce(dashboard('south', false, '华南直属数据', subtree))
      .mockResolvedValueOnce(dashboard('south-one', false, '华南一组数据', subtree))
    render(<HomePage />)

    const select = await screen.findByLabelText('当前部门')
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual([
      '授权范围汇总', '华南销售', '华南销售 / 华南一组',
    ])
    expect(screen.queryByRole('option', { name: /平台部/ })).not.toBeInTheDocument()
    fireEvent.change(select, { target: { value: 'south' } })
    expect(await screen.findByText('华南含下级数据')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('部门数据范围'), { target: { value: 'direct' } })
    expect(await screen.findByText('华南直属数据')).toBeInTheDocument()
    fireEvent.change(select, { target: { value: 'south-one' } })
    expect(await screen.findByText('华南一组数据')).toBeInTheDocument()
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      '/api/dashboard/department',
      '/api/dashboard/department?departmentId=south&includeSubdepartments=true',
      '/api/dashboard/department?departmentId=south&includeSubdepartments=false',
      '/api/dashboard/department?departmentId=south-one&includeSubdepartments=false',
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
    const view = await screen.findByLabelText('当前部门')

    fireEvent.change(view, { target: { value: 'east' } })
    fireEvent.change(view, { target: { value: 'north' } })
    expect(screen.getByText('汇总机会')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('正在切换部门')
    expect(request.mock.calls[1][1]?.signal?.aborted).toBe(true)
    await act(async () => north.resolve(dashboard('north', true, '华北机会')))
    await act(async () => east.resolve(dashboard('east', true, '华东迟到机会')))
    expect(screen.getByText('华北机会')).toBeInTheDocument()
    expect(screen.queryByText('华东迟到机会')).not.toBeInTheDocument()

    fireEvent.change(view, { target: { value: 'south' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法切换部门')
    expect(view).toHaveValue('north')
    expect(screen.getByText('华北机会')).toBeInTheDocument()
  })

  it('revalidates a restored view and drops old business rows when the grant is removed', async () => {
    sessionStorage.setItem('dashboard:department:user:org', 'north:direct')
    request.mockResolvedValueOnce(Response.json({ code: 'DEPARTMENT_SELECTION_FORBIDDEN' }, { status: 403 }))
      .mockResolvedValueOnce(dashboard(null, true))
      .mockResolvedValueOnce(Response.json({ code: 'DEPARTMENT_SELECTION_FORBIDDEN' }, { status: 403 }))
    render(<HomePage />)

    const view = await screen.findByLabelText('当前部门')
    expect(request.mock.calls[0][0]).toBe('/api/dashboard/department?departmentId=north&includeSubdepartments=false')
    expect(view).toHaveValue('')
    fireEvent.change(view, { target: { value: 'east' } })
    await waitFor(() => expect(screen.queryByLabelText('当前部门')).not.toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent('该部门已不可访问')
    expect(screen.queryByText('汇总机会')).not.toBeInTheDocument()
    expect(screen.getByText('个人日程')).toBeInTheDocument()
  })

  it('revalidates the same exact department and roster on focus, then clears them on a confirmed revoke', async () => {
    sessionStorage.setItem('dashboard:department:user:org', 'east:direct')
    request.mockResolvedValueOnce(dashboard('east', false, '旧华东机会'))
      .mockResolvedValueOnce(dashboard('east', false, '新华东机会'))
      .mockResolvedValueOnce(Response.json({ code: 'DEPARTMENT_SELECTION_FORBIDDEN' }, { status: 403 }))
    const roster = (name: string) => Response.json({
      status: 'ready', organizationId: 'org', asOf: '2026-11-25T00:00:00Z', total: 1, page: 1, pageSize: 20,
      members: [{ id: 'east-person', displayName: name, departmentIds: ['east'] }],
    })
    rosterRequest.mockResolvedValueOnce(roster('旧在职成员')).mockResolvedValueOnce(roster('新在职成员'))
    render(<HomePage />)
    expect(await screen.findByText('旧在职成员')).toBeInTheDocument()
    expect(screen.getByText('旧华东机会')).toBeInTheDocument()

    fireEvent.focus(window)
    expect(await screen.findByText('新在职成员')).toBeInTheDocument()
    expect(screen.getByText('新华东机会')).toBeInTheDocument()
    expect(screen.queryByText('旧在职成员')).not.toBeInTheDocument()
    expect(rosterRequest.mock.calls.map(([url]) => url)).toEqual(
      Array(2).fill('/api/dashboard/department/roster?departmentId=east&includeSubdepartments=false&page=1'),
    )

    fireEvent.focus(window)
    expect(await screen.findByRole('alert')).toHaveTextContent('该部门已不可访问')
    expect(screen.queryByText('新华东机会')).not.toBeInTheDocument()
    expect(screen.queryByText('新在职成员')).not.toBeInTheDocument()
    expect(request.mock.calls.map(([url]) => url)).toEqual(
      Array(3).fill('/api/dashboard/department?departmentId=east&includeSubdepartments=false'),
    )
  })

  it('clears the previous workbench on token change and ignores a late response from that session', async () => {
    localStorage.setItem('token', 'old-session')
    const previousSelection = deferredResponse()
    const newSelection = deferredResponse()
    mocks.load.mockImplementation(async (token: string) => ({
      profile: token === 'new-session' ? { ...profile, id: 'new-user', org_id: 'new-org', display_name: '新账号' } : profile,
      dashboard: token === 'new-session' ? { ...personalDashboard, organizationId: 'new-org', agenda: [] } : personalDashboard,
    }))
    request.mockResolvedValueOnce(dashboard(null, true, '旧账号的机会'))
      .mockReturnValueOnce(previousSelection.promise)
      .mockReturnValueOnce(newSelection.promise)
    render(<HomePage />)

    const select = await screen.findByLabelText('当前部门')
    expect(screen.getByText('旧账号的机会')).toBeInTheDocument()
    fireEvent.change(select, { target: { value: 'east' } })
    expect(request.mock.calls[1][1]?.signal?.aborted).toBe(false)

    localStorage.setItem('token', 'new-session')
    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: 'token' })) })
    expect(request.mock.calls[1][1]?.signal?.aborted).toBe(true)
    expect(screen.queryByText('旧账号的机会')).not.toBeInTheDocument()
    expect(screen.queryByText('个人日程')).not.toBeInTheDocument()
    await act(async () => { previousSelection.resolve(dashboard('east', true, '旧账号迟到的机会')) })
    expect(screen.queryByText('旧账号迟到的机会')).not.toBeInTheDocument()

    await act(async () => { newSelection.resolve(dashboard(null, true, '新账号的机会', departments, 'new-org')) })
    expect(await screen.findByText('新账号的机会')).toBeInTheDocument()
    expect(mocks.load).toHaveBeenLastCalledWith('new-session', expect.objectContaining({ view: 'personal' }))
    expect(new Headers(request.mock.calls[2][1]?.headers).get('Authorization')).toBe('Bearer new-session')
  })

  it('clears old personal and department data when the organization changes under the same session', async () => {
    localStorage.setItem('token', 'same-session')
    sessionStorage.setItem('dashboard:department:user:org', 'east:direct')
    sessionStorage.setItem('dashboard:department:user:new-org', 'south:subtree')
    const nextPersonal = { ...personalDashboard, organizationId: 'new-org', agenda: [] }
    const nextBootstrap = deferredResponse()
    mocks.load.mockResolvedValueOnce({ profile, dashboard: personalDashboard })
      .mockImplementationOnce(async () => ({ profile, dashboard: await (await nextBootstrap.promise).json() }))
    request.mockResolvedValueOnce(dashboard('east', false, '原组织部门机会'))
      .mockResolvedValueOnce(dashboard('south', true, '当前组织部门机会', departments, 'new-org'))
    personalRequest.mockResolvedValueOnce(Response.json(nextPersonal))
    render(<HomePage />)

    expect(await screen.findByText('原组织部门机会')).toBeInTheDocument()
    expect(screen.getByText('个人日程')).toBeInTheDocument()
    await act(async () => { fireEvent.focus(window) })
    expect(screen.queryByText('原组织部门机会')).not.toBeInTheDocument()
    expect(screen.queryByText('个人日程')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('当前部门')).not.toBeInTheDocument()

    await act(async () => { nextBootstrap.resolve(Response.json(nextPersonal)) })
    expect(await screen.findByText('当前组织部门机会')).toBeInTheDocument()
    expect(screen.getByLabelText('当前部门')).toHaveValue('south')
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      '/api/dashboard/department?departmentId=east&includeSubdepartments=false',
      '/api/dashboard/department?departmentId=south&includeSubdepartments=true',
    ])
    expect(mocks.load).toHaveBeenLastCalledWith('same-session', expect.objectContaining({ view: 'personal' }))
  })

  it('shows only personal data for a user without any authorized department', async () => {
    mocks.load.mockResolvedValue({
      profile,
      dashboard: {
        ...personalDashboard,
        spaces: [{ id: 'legacy', name: '旧空间' }],
        opportunities: [{ id: 'old', name: '旧空间的机会', status: 'LEAD' }],
      },
    })
    request.mockResolvedValueOnce(Response.json({ code: 'DEPARTMENT_SCOPE_REQUIRED' }, { status: 403 }))
    render(<HomePage />)
    expect(await screen.findByText('个人日程')).toBeInTheDocument()
    expect(screen.queryByLabelText('当前部门')).not.toBeInTheDocument()
    expect(screen.queryByText('旧空间')).not.toBeInTheDocument()
    expect(screen.queryByText('旧空间的机会')).not.toBeInTheDocument()
    expect(screen.queryByText('今日优先队列')).not.toBeInTheDocument()
    expect(request.mock.calls.map(([url]) => url)).toEqual(['/api/dashboard/department'])
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
        status: 'ready', organizationId: 'org', asOf: '2026-11-25T00:00:00Z', total: 2, page: 1, pageSize: 20,
        members: [{ id: 'north-person', displayName: '华北成员', departmentIds: ['north'] }],
      }))
      .mockResolvedValueOnce(Response.json({
        status: 'ready', organizationId: 'org', asOf: '2026-11-25T00:00:00Z', total: 1, page: 1, pageSize: 20,
        members: [{ id: 'east-person', displayName: '华东成员', departmentIds: ['east-team'] }],
      }))
    render(<HomePage />)
    expect(await screen.findByText('华北成员')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('当前部门'), { target: { value: 'east' } })
    expect(await screen.findByText('华东成员')).toBeInTheDocument()
    expect(screen.queryByText('华北成员')).not.toBeInTheDocument()
    expect(rosterRequest.mock.calls.map(([url]) => url)).toEqual([
      '/api/dashboard/department/roster?page=1',
      '/api/dashboard/department/roster?departmentId=east&includeSubdepartments=true&page=1',
    ])
  })

  it('withholds a roster returned for a different organization', async () => {
    request.mockResolvedValueOnce(dashboard(null, true))
    rosterRequest.mockResolvedValueOnce(Response.json({
      status: 'ready', organizationId: 'foreign-org', asOf: '2026-11-25T00:00:00Z', total: 1, page: 1, pageSize: 20,
      members: [{ id: 'foreign-person', displayName: '其他组织成员', departmentIds: ['east'] }],
    }))
    render(<HomePage />)
    expect(await screen.findByText('暂时无法核对同步名单')).toBeInTheDocument()
    expect(screen.queryByText('其他组织成员')).not.toBeInTheDocument()
  })
})

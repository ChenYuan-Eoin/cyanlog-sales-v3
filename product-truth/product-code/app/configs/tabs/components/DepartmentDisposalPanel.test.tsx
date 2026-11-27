import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ArchivedDepartmentsPanel, DepartmentDisposalPanel } from './DepartmentDisposalPanel'
import OrgStructureTab from '../OrgStructureTab'
import type { OrgSummaryPayload } from '../../types'

const mocks = vi.hoisted(() => ({ confirmAction: vi.fn(), success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/toast', () => ({ confirmAction: mocks.confirmAction }))

const summary = { departmentCount: 2, memberCount: 18, visibleMemberCount: 17, relationCount: 18 }
const departments = [
  { id: 'company', name: '公司', parent_name: null, parent_id: null, source: 'manual', status: 'active' },
  { id: 'old', name: '待处置部门', parent_name: '公司', parent_id: 'company', source: 'manual', status: 'active' },
  { id: 'child', name: '自建子部门', parent_name: '待处置部门', parent_id: 'old', source: 'manual', status: 'active' },
  { id: 'protected', name: '纷享子部门', parent_name: '待处置部门', parent_id: 'old', source: 'fxiaoke', status: 'active' },
  { id: 'target', name: '承接部门甲', parent_name: '公司', parent_id: 'company', source: 'manual', status: 'active' },
]
const base = {
  planId: 'selection', planHash: 'signature', expiresAt: '2099-11-27T10:00:00+08:00',
  summary, hiddenMemberCount: 1,
  departments: [
    { departmentId: 'old', parentDepartmentId: 'company', name: '待处置部门', source: 'manual', status: 'active',
      selected: true, activeChildIds: ['child', 'protected'], memberCount: 18, blockedReason: 'DEPARTMENT_HAS_MEMBER_BINDINGS' },
    { departmentId: 'child', parentDepartmentId: 'old', name: '自建子部门', source: 'manual', status: 'active',
      selected: true, activeChildIds: [], memberCount: 0, blockedReason: null },
    { departmentId: 'protected', parentDepartmentId: 'old', name: '纷享子部门', source: 'fxiaoke', status: 'active',
      selected: true, activeChildIds: [], memberCount: 0, blockedReason: 'DEPARTMENT_SOURCE_PROTECTED' },
  ],
  members: Array.from({ length: 17 }, (_, index) => ({
    userId: `member-${index + 1}`, displayName: `员工 ${index + 1}`, employmentStatus: 'active', accountStatus: 'active',
    loginEnabled: true, primaryDepartmentId: 'old', canTransfer: true, canSuspend: true, canOffboard: true,
    relations: [{ departmentId: 'old', name: '待处置部门', source: 'manual', kind: 'primary', manageable: true, blockedReason: null }],
  })),
}
const archive = { archiveId: 'archive-1', departmentId: 'old', name: '已归档甲', parentDepartmentId: 'company', code: 'OLD', archivedAt: '2026-11-27T10:00:00+08:00' }
const authHeaders = () => ({ 'x-fixture': 'actor' })
const result = (data: unknown) => Response.json({ data })
const parse = (init?: RequestInit) => init?.body ? JSON.parse(String(init.body)) : null

beforeEach(() => { mocks.confirmAction.mockReset().mockResolvedValue(true) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('DepartmentDisposalPanel', () => {
  it('keeps member selection across pages, shows hidden relations and sends exact transfer scope', async () => {
    const calls = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = parse(init)
      if (body.action === 'apply') return result({ ...base, memberResults: [{ userId: 'member-1', action: 'transfer', status: 'applied' }] })
      if (body.command.transfers) return result({ ...base, planId: 'transfer-plan',
        memberResults: [{ userId: 'member-1', action: 'transfer', status: 'ready' }] })
      return result(body.employmentFilter === 'all' ? {
        ...base, hiddenMemberCount: 0, members: [...base.members, {
          ...base.members[0], userId: 'hidden', displayName: '隐藏成员', loginEnabled: false,
        }],
      } : base)
    })
    vi.stubGlobal('fetch', calls)
    const refreshed = vi.fn()
    render(<DepartmentDisposalPanel orgId="org-1" departmentIds={['old', 'child']} departments={departments}
      initialEmploymentFilter="active" authHeaders={authHeaders} canArchive canReparent onArchived={vi.fn()} onRefresh={refreshed} />)

    expect(await screen.findByText(/当前筛选隐藏 1 名关联成员/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '查看全部关联成员' }))
    await screen.findByLabelText(/全选当前范围 \(18 人，含全部页\)/)
    fireEvent.change(screen.getByLabelText('关系范围'), { target: { value: 'descendants' } })
    const fullScope = await screen.findByRole('checkbox', { name: /全选当前范围/ })
    fireEvent.click(fullScope)
    expect(screen.getByText('已选 18 人')).toBeVisible()
    fireEvent.click(fullScope)
    fireEvent.click(await screen.findByRole('checkbox', { name: '选择员工 员工 1' }))
    fireEvent.click(screen.getByRole('button', { name: '下一页关系' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '选择员工 员工 17' }))
    expect(screen.getByText('已选 2 人')).toBeVisible()
    expect(screen.getByText('账号已停用')).toBeVisible()

    fireEvent.change(screen.getByLabelText('人员处置'), { target: { value: 'transfer' } })
    fireEvent.change(screen.getByLabelText('承接部门'), { target: { value: 'target' } })
    fireEvent.click(screen.getByRole('button', { name: '核对处置方案' }))
    await screen.findByText('待确认处置方案')
    const request = calls.mock.calls.map(([, init]) => parse(init)).find(body => body?.command?.transfers)
    expect(request).toMatchObject({
      action: 'preview', expectedOrgId: 'org-1', departmentIds: ['old', 'child'], includeChildren: true, employmentFilter: 'all',
      command: { transfers: [{ userId: 'member-1', departmentId: 'target' }, { userId: 'member-17', departmentId: 'target' }] },
    })
    fireEvent.click(screen.getByRole('button', { name: '确认应用可执行项' }))
    await screen.findByText('上次处置结果')
    expect(screen.getByText(/已执行/)).toBeVisible()
    expect(refreshed).toHaveBeenCalledOnce()
  })

  it('submits only the selected secondary relationship and displays provider protection', async () => {
    const member = {
      ...base.members[0], relations: [
        { departmentId: 'child', name: '自建子部门', source: 'manual', kind: 'secondary', manageable: true, blockedReason: null },
        { departmentId: 'protected', name: '纷享子部门', source: 'fxiaoke', kind: 'secondary', manageable: false, blockedReason: 'DEPARTMENT_SOURCE_PROTECTED' },
      ],
    }
    const calls = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => result({ ...base, members: [member] }))
    vi.stubGlobal('fetch', calls)
    render(<DepartmentDisposalPanel orgId="org-1" departmentIds={['old', 'child', 'protected']} departments={departments}
      initialEmploymentFilter="all" authHeaders={authHeaders} canArchive canReparent onArchived={vi.fn()} />)

    fireEvent.click(await screen.findByRole('checkbox', { name: '选择员工 员工 1' }))
    fireEvent.change(screen.getByLabelText('人员处置'), { target: { value: 'secondary' } })
    expect(screen.getByRole('checkbox', { name: '解除 员工 1 的 纷享子部门 兼岗' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: '解除 员工 1 的 自建子部门 兼岗' }))
    const preview = screen.getByRole('button', { name: '核对处置方案' })
    fireEvent.click(preview)
    await waitFor(() => expect(preview).toBeEnabled())
    const request = parse(calls.mock.calls.at(-1)?.[1])
    expect(request.command.secondaryRemovals).toEqual([{ userId: 'member-1', departmentIds: ['child'] }])
  })

  it('confirms eligible archive items and reports a named protected descendant without hiding its parent', async () => {
    const departmentResults = [
      { departmentId: 'old', action: 'archive', status: 'blocked', code: 'DEPARTMENT_HAS_ACTIVE_CHILDREN',
        details: { activeChildren: [{ name: '纷享子部门' }] } },
      { departmentId: 'child', action: 'archive', status: 'ready' },
    ]
    const onArchived = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = parse(init)
      if (body.action === 'apply') return result({ ...base, departmentResults: [departmentResults[0], { ...departmentResults[1], status: 'applied' }] })
      return result(body.command.archiveDepartmentIds?.length ? { ...base, departmentResults } : base)
    }))
    render(<DepartmentDisposalPanel orgId="org-1" departmentIds={['old', 'child', 'protected']} departments={departments}
      initialEmploymentFilter="all" authHeaders={authHeaders} canArchive canReparent onArchived={onArchived} />)
    fireEvent.click(await screen.findByRole('checkbox', { name: '归档 待处置部门' }))
    expect(screen.getByRole('checkbox', { name: '归档 纷享子部门' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: '归档 自建子部门' }))
    fireEvent.click(screen.getByRole('button', { name: '核对处置方案' }))
    expect(await screen.findByText('有效下级 纷享子部门')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '确认应用可执行项' }))
    await screen.findByText('上次处置结果')
    expect(onArchived).toHaveBeenCalledWith(['child'])
    expect(screen.getByText('有效下级 纷享子部门')).toBeVisible()
  })

  it('keeps a picked transfer visible and in preview when its receiving department is selected for archive', async () => {
    const calls = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = parse(init)
      if (!body.command.archiveDepartmentIds?.length) return result(base)
      return result({ ...base, planId: 'mixed-transfer',
        memberResults: (body.command.transfers || []).map(({ userId }: { userId: string }) => ({
          userId, action: 'transfer', status: 'blocked', code: 'DEPARTMENT_TRANSFER_INVALID_TARGET',
        })),
        departmentResults: [{ departmentId: 'child', action: 'archive', status: 'ready' }],
      })
    })
    vi.stubGlobal('fetch', calls)
    mocks.confirmAction.mockResolvedValueOnce(false)
    render(<DepartmentDisposalPanel orgId="org-1" departmentIds={['old', 'child']} departments={departments}
      initialEmploymentFilter="all" authHeaders={authHeaders} canArchive canReparent onArchived={vi.fn()} />)

    fireEvent.click(await screen.findByRole('checkbox', { name: '选择员工 员工 1' }))
    fireEvent.change(screen.getByLabelText('人员处置'), { target: { value: 'transfer' } })
    const target = screen.getByLabelText('承接部门')
    fireEvent.change(target, { target: { value: 'child' } })
    fireEvent.click(screen.getByRole('checkbox', { name: '归档 自建子部门' }))

    expect(target).toHaveValue('child')
    expect(screen.getByText(/已选承接部门「自建子部门」当前不可用/)).toBeVisible()
    const preview = screen.getByRole('button', { name: '核对处置方案' })
    expect(preview).toBeEnabled()
    fireEvent.click(preview)
    expect(await screen.findByText('承接部门已停用或在待归档子树内，请重新选择。')).toBeVisible()
    expect(parse(calls.mock.calls.at(-1)?.[1]).command).toMatchObject({
      transfers: [{ userId: 'member-1', departmentId: 'child' }],
      archiveDepartmentIds: ['child'],
    })
    fireEvent.click(screen.getByRole('button', { name: '确认应用可执行项' }))
    await waitFor(() => expect(preview).toBeEnabled())
    expect(mocks.confirmAction).toHaveBeenCalledWith(
      expect.stringMatching(/归档部门 自建子部门.*保留以下仍需处理的项目：转移主部门 员工 1/s),
      expect.objectContaining({ danger: true }),
    )
    expect(calls.mock.calls.map(([, init]) => parse(init).action)).toEqual(['preview', 'preview'])
    fireEvent.change(target, { target: { value: '' } })
    expect(screen.getByText('请为已选员工选择承接部门，或取消转岗操作。')).toBeVisible()
    expect(preview).toBeDisabled()
    fireEvent.change(screen.getByLabelText('人员处置'), { target: { value: '' } })
    expect(preview).toBeEnabled()
  })

  it('keeps a picked reparent visible and in preview after its target and original context change', async () => {
    const scope = { ...base, departments: [base.departments[0], {
      departmentId: 'target', parentDepartmentId: 'company', name: '承接部门甲', source: 'manual', status: 'active',
      selected: true, activeChildIds: [], memberCount: 0, blockedReason: null,
    }] }
    const calls = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = parse(init)
      if (!body.command.archiveDepartmentIds?.length) return result(scope)
      return result({ ...scope, planId: 'mixed-reparent', departmentResults: [
        ...(body.command.reparent || []).map(({ departmentId }: { departmentId: string }) => ({
          departmentId, action: 'reparent', status: 'blocked', code: 'DEPARTMENT_PARENT_INVALID',
        })),
        { departmentId: 'target', action: 'archive', status: 'ready' },
      ] })
    })
    vi.stubGlobal('fetch', calls)
    render(<DepartmentDisposalPanel orgId="org-1" departmentIds={['old', 'target']} departments={departments}
      initialEmploymentFilter="all" authHeaders={authHeaders} canArchive canReparent onArchived={vi.fn()} />)

    const parentArchive = await screen.findByRole('checkbox', { name: '归档 待处置部门' })
    fireEvent.click(parentArchive)
    fireEvent.change(screen.getByLabelText(/为 自建子部门 改挂上级/), { target: { value: 'target' } })
    fireEvent.click(screen.getByRole('checkbox', { name: '归档 承接部门甲' }))
    fireEvent.click(parentArchive)

    expect(screen.getByLabelText(/为 自建子部门 改挂上级/)).toHaveValue('target')
    expect(screen.getByText(/「自建子部门」已选上级「承接部门甲」当前不可用/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '核对处置方案' }))
    expect(await screen.findByText('所选上级无效、在待归档子树内或会形成循环。')).toBeVisible()
    expect(parse(calls.mock.calls.at(-1)?.[1]).command).toMatchObject({
      reparent: [{ departmentId: 'child', parentDepartmentId: 'target' }],
      archiveDepartmentIds: ['target'],
    })
    expect(screen.getByRole('button', { name: '确认应用可执行项' })).toBeEnabled()
    fireEvent.change(screen.getByLabelText(/为 自建子部门 改挂上级/), { target: { value: '' } })
    expect(screen.queryByText('待确认处置方案')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '核对处置方案' })).toBeEnabled()
  })
})

describe('ArchivedDepartmentsPanel', () => {
  it('shows archival and legacy history, then restores only a selected department under an active parent', async () => {
    const onRestored = vi.fn()
    const calls = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body) return result({ departmentId: 'old', status: 'restored' })
      return result({
        archivedDepartments: [archive],
        archiveHistory: [{ ...archive, archiveId: 'restored-history', name: '已恢复旧部门',
          restoredAt: '2026-11-27T12:00:00+08:00' }],
        legacyInactive: [{ departmentId: 'legacy', name: '旧停用部门', source: 'fxiaoke', blockedReason: 'DEPARTMENT_SOURCE_PROTECTED' }],
      })
    })
    vi.stubGlobal('fetch', calls)
    render(<ArchivedDepartmentsPanel orgId="org-1" departments={departments} authHeaders={authHeaders}
      canRestore onRestored={onRestored} />)
    await screen.findByText('历史停用部门')
    expect(screen.getByText('已恢复的归档记录')).toBeVisible()
    expect(screen.getByText('已恢复旧部门')).toBeVisible()
    const history = (await screen.findByText('已归档甲')).closest('details')
    expect(history).not.toBeNull()
    const group = within(history!)
    fireEvent.click(group.getByText('已归档甲'))
    expect(group.getByText(/归档时间/)).toBeInTheDocument()
    fireEvent.click(group.getByRole('button', { name: '恢复 已归档甲' }))
    fireEvent.change(group.getByLabelText('恢复到有效上级'), { target: { value: 'company' } })
    fireEvent.click(group.getByRole('button', { name: '确认恢复' }))
    await waitFor(() => expect(onRestored).toHaveBeenCalledWith('old'))
    expect(calls).toHaveBeenCalledWith('/api/admin/departments/disposal', expect.objectContaining({
      body: JSON.stringify({ action: 'restore', expectedOrgId: 'org-1', departmentId: 'old', archiveId: 'archive-1', parentDepartmentId: 'company' }),
    }))
  })
})


it('uses the department tree to select the batch, removes finished archive rows immediately, and keeps readable archive history', async () => {
  const rootSummary: OrgSummaryPayload = {
    organization: { id: 'org-1', name: '公司' },
    departments: [...departments, { id: 'paused', name: '历史停用原部门', parent_name: null, status: 'inactive' }],
    users: [{
      id: 'actor', email: '', display_name: '管理员', title: '', primary_dept_name: '', role_names: '系统超管',
      status: 'active', login_enabled: true, scoped_roles: [{
        roleId: 'super', roleName: '系统超管', roleCode: 'SUPER_ADMIN', scopeType: 'org',
        scopeId: 'org-1', scopeName: '公司', grantedAt: null,
      }],
    }],
    roles: [], spaces: [], department_access: { canRead: true, canEdit: true, canDelete: true },
    directory_roster: { status: 'ready', asOf: '2026-11-27T10:00:00+08:00', members: [] },
  }
  const scoped = { ...base, departments: base.departments.slice(0, 2), members: [], hiddenMemberCount: 0 }
  const calls = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = parse(init)
    if (body?.action === 'apply') return result({ ...scoped, departmentResults: [
      { departmentId: 'child', action: 'archive', status: 'applied' },
    ] })
    if (body?.action === 'preview') return result(body.command.archiveDepartmentIds?.length ? { ...scoped,
      departmentResults: [{ departmentId: 'child', action: 'archive', status: 'ready' }],
    } : scoped)
    if (String(input).includes('disposal?')) return result({ archivedDepartments: [{ ...archive, name: '自建子部门' }], legacyInactive: [] })
    return result({})
  })
  vi.stubGlobal('fetch', calls)
  const props = { orgSummary: rootSummary, currentUserId: 'actor', onRefresh: vi.fn() }
  render(<OrgStructureTab {...props} />)
  expect(screen.queryByText('历史停用原部门')).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: '批量处置' }))
  fireEvent.click(screen.getByRole('button', { name: /^公司/ }))
  fireEvent.click(screen.getByRole('button', { name: /^待处置部门/ }))
  fireEvent.click(screen.getByRole('checkbox', { name: '纳入处置 待处置部门' }))
  fireEvent.click(screen.getByRole('checkbox', { name: '纳入处置 自建子部门' }))
  const archiveChild = await screen.findByRole('checkbox', { name: '归档 自建子部门' })
  fireEvent.click(archiveChild)
  fireEvent.click(screen.getByRole('button', { name: '核对处置方案' }))
  fireEvent.click(await screen.findByRole('button', { name: '确认应用可执行项' }))
  await screen.findByText('上次处置结果')
  expect(screen.queryByRole('checkbox', { name: '纳入处置 自建子部门' })).not.toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: '纳入处置 待处置部门' })).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: '已归档部门' }))
  expect(await screen.findByText('自建子部门')).toBeVisible()
  expect(calls).toHaveBeenCalledWith('/api/admin/departments/disposal?query=', expect.any(Object))
})

it('opens the archive history for a department reader with only the current organization id', async () => {
  const calls = vi.fn(async () => result({ archivedDepartments: [archive], archiveHistory: [], legacyInactive: [] }))
  vi.stubGlobal('fetch', calls)
  const structureOnly: OrgSummaryPayload = {
    organization: { id: 'org-1' },
    users: [], roles: [], spaces: [], departments,
    member_access: false,
    department_access: { canRead: true, canEdit: false, canDelete: false },
  }
  render(<OrgStructureTab orgSummary={structureOnly} currentUserId="reader" />)

  fireEvent.click(screen.getByRole('button', { name: '已归档部门' }))
  expect(await screen.findByText('已归档甲')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^恢复 / })).not.toBeInTheDocument()
  expect(calls).toHaveBeenCalledWith('/api/admin/departments/disposal?query=', expect.any(Object))
})

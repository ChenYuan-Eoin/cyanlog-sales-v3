import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthError, requireAuth } from '@/lib/auth'
import { GET } from './route'
import { GET as getCompatibilityDashboard } from '../route'

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from, rpc: mocks.rpc } }))
vi.mock('@/lib/auth', () => ({
  AuthError: class extends Error {},
  requireAuth: vi.fn(),
}))

type Row = Record<string, unknown>
let tables: Record<string, Row[]>
let failedTable: string | null
let failureCode: string | null
const orgId = 'org-local'
const userId = 'actor'

function column(row: Row, key: string) {
  const [property, nested] = key.split('.')
  const value = row[property]
  return nested && value && typeof value === 'object' ? (value as Row)[nested] : value
}

function query(table: string) {
  const predicates: Array<(row: Row) => boolean> = []
  let maxRows = Infinity
  let select: string[] = []
  const result = () => ({
    data: (tables[table] ?? []).filter(row => predicates.every(predicate => predicate(row))).slice(0, maxRows)
      .map(row => Object.fromEntries(select.map(key => [key, row[key]]))),
    error: failedTable === table ? { code: failureCode, message: 'database unavailable' } : null,
  })
  const builder = {
    select(fields: string) {
      select = fields.split(/,(?![^()]*\))/).map(field => field.split(':')[0].trim())
      return builder
    },
    eq(key: string, value: unknown) { predicates.push(row => column(row, key) === value); return builder },
    is(key: string, value: unknown) { return builder.eq(key, value) },
    or(filters: string) {
      predicates.push(row => filters.split(',').some(filter => {
        const [field, operator, ...parts] = filter.split('.')
        const value = parts.join('.')
        if (operator === 'is' && value === 'null') return row[field] === null
        if (operator === 'lte') return typeof row[field] === 'string' && row[field] <= value
        return row[field] === value
      }))
      return builder
    },
    in(key: string, values: unknown[]) { predicates.push(row => values.includes(row[key])); return builder },
    lte(key: string, value: string) { predicates.push(row => typeof row[key] === 'string' && row[key] <= value); return builder },
    order() { return builder },
    limit(limit: number) { maxRows = limit; return builder },
    maybeSingle: async () => ({ ...result(), data: result().data[0] ?? null }),
    then(resolve: (value: ReturnType<typeof result>) => unknown) { return Promise.resolve(result()).then(resolve) },
  }
  return builder
}

const department = (id: string, parentId: string | null, status = 'active', org = orgId) => ({
  id, name: id, parent_id: parentId, org_id: org, status,
})

const space = (id: string, departmentId: string, status = 'active', org = orgId) => ({
  id, department_id: departmentId, org_id: org, name: id, description: null, owner_id: userId, status,
})

const role = (id: string, permissions: string[], code = id) => ({ id, code, permissions })
const grant = (scopeType: string, scopeId: string, assignedRole: ReturnType<typeof role>, org = orgId) => ({
  user_id: userId, org_id: org, scope_type: scopeType, scope_id: scopeId, role: assignedRole,
})

const opportunity = (id: string, spaceId: string, ownerId = userId, org = orgId) => ({
  id, space_id: spaceId, org_id: org, owner_id: ownerId, customer_id: 'local-customer',
  name: id, amount: 100, status: 'LEAD', stage: null, probability: 20, expected_close_date: '2026-11-26',
})

const milestone = (id: string, opportunityId: string, org = orgId) => ({
  id, opportunity_id: opportunityId, org_id: org, name: id, type: 'REVIEW', status: 'PENDING',
  priority: 'HIGH', due_date: '2000-01-01T00:00:00Z',
})

function request(search = '') {
  return GET(new NextRequest('https://example.test/api/dashboard/department' + search))
}

function compatibilityRequest(search = '') {
  return getCompatibilityDashboard(new NextRequest('https://example.test/api/dashboard' + search))
}

beforeEach(() => {
  failedTable = null
  failureCode = null
  mocks.from.mockReset().mockImplementation(query)
  mocks.rpc.mockReset()
  vi.mocked(requireAuth).mockReset().mockResolvedValue({
    id: userId, email: null, phone: null, display_name: null, org_id: 'stale-token-org',
  })
  tables = {
    user_organizations: [{
      user_id: userId, org_id: orgId, is_default: true, status: 'active', employment_status: 'active', left_at: null,
    }],
    organizations: [{ id: orgId, status: 'active', settings: {} }],
    department_lead_access: [],
    user_roles: [
      grant('department', 'sales-a', role('lead-a', ['dept:view', 'opportunity:*'])),
      grant('department', 'sales-a-child', role('lead-child', ['report:dept'])),
      grant('department', 'sales-b', role('lead-b', ['dept:view', 'opportunity:own'])),
      grant('department', 'sales-c', role('quote', ['quote:view'])),
      grant('org', 'foreign-org', role('foreign-root', [], 'SUPER_ADMIN'), 'foreign-org'),
    ],
    departments: [
      department('parent', null), department('sales-a', 'parent'), department('sales-a-child', 'sales-a'),
      department('sales-b', 'parent'), department('sales-c', 'parent'), department('new-department', 'sales-a'),
      department('inactive-department', 'sales-a', 'inactive'), department('foreign-department', 'sales-a', 'active', 'foreign-org'),
    ],
    sales_spaces: [
      space('space-a', 'sales-a'), space('space-child', 'sales-a-child'), space('space-b', 'sales-b'),
      space('space-c', 'sales-c'), space('disabled-space', 'sales-a', 'inactive'),
      space('foreign-space', 'sales-a', 'active', 'foreign-org'), space('inactive-dept-space', 'inactive-department'),
    ],
    opportunities: [
      opportunity('a-opp', 'space-a', 'teammate'), opportunity('child-opp', 'space-child', 'teammate'),
      opportunity('b-owned', 'space-b'), opportunity('b-teammate', 'space-b', 'teammate'),
      opportunity('c-opp', 'space-c'), opportunity('outside-org', 'space-a', userId, 'foreign-org'),
      opportunity('outside-space', 'foreign-space'), opportunity('disabled-space-opp', 'disabled-space'),
      opportunity('inactive-department-opp', 'inactive-dept-space'),
      { ...opportunity('b-foreign-customer', 'space-b'), customer_id: 'foreign-customer' },
    ],
    customers: [
      { id: 'local-customer', org_id: orgId, name: '本组织客户', short_name: null },
      { id: 'foreign-customer', org_id: 'foreign-org', name: '外组织客户', short_name: null },
    ],
    milestones: [
      milestone('own-milestone', 'b-owned'), milestone('teammate-milestone', 'b-teammate'),
      milestone('foreign-milestone', 'b-owned', 'foreign-org'),
      milestone('foreign-customer-milestone', 'b-foreign-customer'),
    ],
  }
})

describe('GET /api/dashboard/department', () => {
  it('组合部门授权并去重，只返回同组织启用部门、分配范围机会和对应节点', async () => {
    const response = await request()
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const data = await response.json()
    expect(data.organizationId).toBe(orgId)
    expect(data.selection).toEqual({ departmentId: null, includeSubdepartments: true })
    expect(data.departmentSpaces).toEqual([
      { department_id: 'sales-a', parent_department_id: null, name: 'sales-a' },
      { department_id: 'sales-a-child', parent_department_id: 'sales-a', name: 'sales-a-child' },
      { department_id: 'sales-b', parent_department_id: null, name: 'sales-b' },
      { department_id: 'new-department', parent_department_id: 'sales-a', name: 'new-department' },
    ])
    expect(data.opportunities.map((row: Row) => row.id)).toEqual(['a-opp', 'b-owned', 'child-opp'])
    expect(data.opportunities[0].customer).toMatchObject({ name: '本组织客户' })
    expect(data.milestones).toEqual([{
      id: 'own-milestone', opportunity_id: 'b-owned', name: 'own-milestone', type: 'REVIEW', status: 'PENDING',
      priority: 'HIGH', due_date: '2000-01-01T00:00:00Z',
      opportunity: { name: 'b-owned', customer_id: 'local-customer' },
    }])
  })

  it.each([
    ['sales-a', 'false', ['a-opp']],
    ['sales-a', 'true', ['a-opp', 'child-opp']],
    ['sales-a-child', 'false', ['child-opp']],
    ['sales-b', 'false', ['b-owned']],
    ['new-department', 'false', []],
  ])('切换到 %s，含下级为 %s', async (id, include, expected) => {
    const response = await request(`?departmentId=${id}&includeSubdepartments=${include}`)
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.selection).toEqual({ departmentId: id, includeSubdepartments: include === 'true' })
    expect(data.opportunities.map((row: Row) => row.id)).toEqual(expected)
  })

  it.each(['parent', 'sales-c', 'inactive-department', 'foreign-department', 'unknown-dept'])('拒绝查看范围外部门 %s', async (id) => {
    const response = await request(`?departmentId=${id}`)
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'DEPARTMENT_SELECTION_FORBIDDEN' })
    expect(mocks.from).not.toHaveBeenCalledWith('opportunities')
    expect(mocks.from).not.toHaveBeenCalledWith('sales_spaces')
  })

  it('华南负责人可独立选择大部门和下级部门，组织改隶后平台部分支立即离开授权树', async () => {
    tables.departments[1].name = '华南'
    tables.departments[2].name = '华南一组'
    tables.departments[3].name = '平台部'
    tables.user_roles = [
      grant('department', 'sales-a', role('south-gm', ['dept:view', 'opportunity:*'])),
      grant('space', 'space-b', role('historical-binding', ['opportunity:*'])),
    ]
    const summary = await (await request()).json()
    expect(summary.departmentSpaces.map((row: Row) => row.name)).toEqual(['华南', '华南一组', 'new-department'])
    expect(summary.opportunities.map((row: Row) => row.id)).toEqual(['a-opp', 'child-opp'])
    expect((await request('?departmentId=sales-b')).status).toBe(403)
    expect((await request('?departmentId=sales-a-child&includeSubdepartments=false')).status).toBe(200)

    tables.departments[2].parent_id = 'sales-b'
    tables.departments[5].name = '新建部门'
    const refreshed = await (await request()).json()
    expect(refreshed.departmentSpaces.map((row: Row) => row.name)).toEqual(['华南', '新建部门'])
    expect(refreshed.opportunities.map((row: Row) => row.id)).toEqual(['a-opp'])
    expect((await request('?departmentId=sales-a-child')).status).toBe(403)
    expect((await request('?departmentId=new-department')).status).toBe(200)
  })

  it('有效系统超管按部门读取数据，历史角色覆盖不改变系统权限', async () => {
    tables.user_roles = [grant('org', orgId, role('root', [], 'SUPER_ADMIN'))]
    const unrestricted = await request('?departmentId=sales-c')
    expect(unrestricted.status).toBe(200)
    expect((await unrestricted.json()).opportunities).toMatchObject([{ id: 'c-opp' }])

    tables.organizations[0].settings = { role_permission_overrides: { root: ['role:manage'] } }
    const withLegacyOverride = await request('?departmentId=sales-c')
    expect(await withLegacyOverride.json()).toMatchObject({
      departmentSpaces: expect.arrayContaining([expect.objectContaining({ department_id: 'sales-c' })]),
      opportunities: [expect.objectContaining({ id: 'c-opp' })],
    })
  })

  it('组织超级管理员可切换各启用部门并仅查看所选部门范围的业务总览', async () => {
    tables.user_roles = [grant('org', orgId, role('tenant-admin', [], 'ORG_SUPER_ADMIN'))]
    const parent = await request('?departmentId=sales-a&includeSubdepartments=false')
    expect(parent.status).toBe(200)
    expect(await parent.json()).toMatchObject({
      departmentSpaces: [
        expect.objectContaining({ department_id: 'parent' }),
        expect.objectContaining({ department_id: 'sales-a' }),
        expect.objectContaining({ department_id: 'sales-a-child' }),
        expect.objectContaining({ department_id: 'sales-b' }),
        expect.objectContaining({ department_id: 'sales-c' }),
        expect.objectContaining({ department_id: 'new-department' }),
      ],
      opportunities: [expect.objectContaining({ id: 'a-opp' })],
      milestones: [],
    })
    const otherBranch = await request('?departmentId=sales-b')
    expect(otherBranch.status).toBe(200)
    expect((await otherBranch.json()).opportunities.map((row: Row) => row.id)).toEqual(['b-owned', 'b-teammate'])
    expect((await request('?departmentId=inactive-department')).status).toBe(403)
    expect((await request('?departmentId=foreign-department')).status).toBe(403)

    tables.user_roles = []
    expect((await request('?departmentId=sales-b')).status).toBe(403)
  })

  it('拒绝其他组织、非组织级或非当前活跃成员的组织超级管理员任命', async () => {
    const tenantAdmin = role('tenant-admin', [], 'ORG_SUPER_ADMIN')
    tables.user_roles = [
      grant('department', 'sales-a', tenantAdmin),
      grant('space', 'space-b', tenantAdmin),
      grant('org', 'foreign-org', tenantAdmin),
      grant('org', 'foreign-org', tenantAdmin, 'foreign-org'),
    ]
    expect((await request('?departmentId=sales-a')).status).toBe(403)
    expect(mocks.from).not.toHaveBeenCalledWith('opportunities')

    tables.user_roles = [grant('org', orgId, tenantAdmin)]
    tables.user_organizations[0].employment_status = 'ended'
    const departed = await request('?departmentId=sales-a')
    expect(departed.status).toBe(403)
    expect(await departed.json()).toMatchObject({ code: 'DEPARTMENT_MEMBERSHIP_REQUIRED' })
  })

  it('只授予部门查看以及跨组织或非组织级超管时，不授予范围外或商机访问权限', async () => {
    tables.user_roles = [
      grant('department', 'sales-a', role('team', ['dept:view', 'opportunity:*:unrecognized'])),
      grant('department', 'sales-b', role('scoped-root', [], 'SUPER_ADMIN')),
      grant('department', 'sales-c', role('draft-wildcard', ['dept:*', 'report:*', 'opportunity:*'])),
      grant('org', 'foreign-org', role('wrong-scope', [], 'SUPER_ADMIN')),
      grant('org', 'foreign-org', role('foreign-role', [], 'SUPER_ADMIN'), 'foreign-org'),
    ]
    const response = await request()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      departmentSpaces: [
        expect.objectContaining({ department_id: 'sales-a' }),
        expect.objectContaining({ department_id: 'sales-a-child' }),
        expect.objectContaining({ department_id: 'new-department' }),
      ],
      opportunities: [],
    })
    expect(mocks.from).not.toHaveBeenCalledWith('opportunities')
  })

  it('历史寄件操作员绑定不授予部门或商机权限，普通混合角色按部门继续生效', async () => {
    const shippingOperator = role('shipping-operator', ['shipping:operate'], 'SHIPPING_OPERATOR')
    const mixedRole = role('sales-team', ['dept:view', 'opportunity:own', 'shipping:operate'])
    tables.organizations[0].settings = {
      role_permission_overrides: { [shippingOperator.id]: ['shipping:operate', 'dept:view', 'opportunity:*'] },
    }
    tables.user_roles = [
      grant('department', 'sales-a', mixedRole),
      grant('department', 'sales-b', shippingOperator),
      grant('space', 'space-a', shippingOperator),
    ]
    tables.opportunities.push(opportunity('a-owned', 'space-a'))

    const outside = await request('?departmentId=sales-b')
    expect.soft(outside.status).toBe(403)
    expect.soft(await outside.json()).toMatchObject({ code: 'DEPARTMENT_SELECTION_FORBIDDEN' })

    const inside = await request('?departmentId=sales-a&includeSubdepartments=false')
    expect(inside.status).toBe(200)
    const data = await inside.json()
    expect(data.departmentSpaces.map((row: Row) => row.department_id)).toEqual(['sales-a', 'sales-a-child', 'new-department'])
    expect(data.opportunities.map((row: Row) => row.id)).toEqual(['a-owned'])
  })

  it('后续请求读取最新角色和权限覆盖', async () => {
    expect((await request('?departmentId=sales-a')).status).toBe(200)
    tables.organizations[0].settings = { role_permission_overrides: { 'lead-a': [] } }
    expect((await request('?departmentId=sales-a')).status).toBe(403)
    tables.user_roles = []
    const noScope = await request()
    expect(noScope.status).toBe(403)
    expect(await noScope.json()).toMatchObject({ code: 'DEPARTMENT_SCOPE_REQUIRED' })
  })

  it('合并两个已经批准且仍担任负责人的部门，商机权限和查看部门权限分别计算', async () => {
    const lead = (departmentId: string, org = orgId, user = userId) => ({
      org_id: org, user_id: user, department_id: departmentId,
    })
    tables.user_roles = []
    tables.departments = tables.departments.map(row => ({
      ...row,
      leader_id: row.id === 'sales-c' ? 'current-lead' : userId,
    }))
    tables.department_lead_access = [
      lead('sales-a'), lead('sales-b'), lead('sales-c'), lead('inactive-department'),
      lead('parent', 'foreign-org'), lead('parent', orgId, 'another-user'),
    ]
    const withoutAction = await request()
    expect(withoutAction.status).toBe(200)
    expect(await withoutAction.json()).toMatchObject({
      departmentSpaces: [
        expect.objectContaining({ department_id: 'sales-a' }),
        expect.objectContaining({ department_id: 'sales-a-child' }),
        expect.objectContaining({ department_id: 'sales-b' }),
        expect.objectContaining({ department_id: 'new-department' }),
      ],
      opportunities: [],
      milestones: [],
    })
    expect(mocks.from).not.toHaveBeenCalledWith('opportunities')
    expect(mocks.from).not.toHaveBeenCalledWith('sales_spaces')
    expect((await request('?departmentId=sales-c')).status).toBe(403)
    expect((await request('?departmentId=parent')).status).toBe(403)
    expect((await request('?departmentId=inactive-department')).status).toBe(403)

    tables.user_roles = [
      grant('org', orgId, role('own', ['opportunity:own'])),
      grant('department', 'sales-a', role('a-action', ['opportunity:*'])),
      grant('department', 'sales-a-child', role('child-view', ['dept:view'])),
    ]
    const summary = await request()
    expect((await summary.json()).opportunities.map((row: Row) => row.id)).toEqual(['a-opp', 'b-owned', 'child-opp'])
    const branchB = await request('?departmentId=sales-b&includeSubdepartments=false')
    expect((await branchB.json()).opportunities.map((row: Row) => row.id)).toEqual(['b-owned'])

    tables.departments = tables.departments.map(row => row.id === 'sales-a' ? { ...row, leader_id: 'new-lead' } : row)
    expect((await request('?departmentId=sales-a')).status).toBe(403)
    tables.department_lead_access = []
    const existingGrant = await request()
    expect(await existingGrant.json()).toMatchObject({
      departmentSpaces: [expect.objectContaining({ department_id: 'sales-a-child', parent_department_id: null })],
      opportunities: [expect.objectContaining({ id: 'child-opp' })],
    })
    tables.user_roles = []
    expect((await request()).status).toBe(403)
  })

  it.each(['PGRST205', '42P01'])('负责人权限表尚未上线 (%s) 时保留已有授权', async (code) => {
    failedTable = 'department_lead_access'
    failureCode = code
    expect((await request('?departmentId=sales-a')).status).toBe(200)
    tables.user_roles = []
    expect((await request()).status).toBe(403)
  })

  it('负责人权限读取异常时拒绝普通请求，组织超管走自身授权', async () => {
    failedTable = 'department_lead_access'
    failureCode = '42501'
    expect((await request()).status).toBe(500)
    mocks.from.mockClear()
    tables.user_roles = [grant('org', orgId, role('root', [], 'SUPER_ADMIN'))]
    expect((await request()).status).toBe(200)
    expect(mocks.from).not.toHaveBeenCalledWith('department_lead_access')
  })

  it.each(['absent', 'ambiguous', 'ended'])('要求唯一有效组织成员关系，拒绝 %s', async (state) => {
    const original = tables.user_organizations[0]
    tables.user_organizations = state === 'absent' ? []
      : state === 'ambiguous' ? [original, { ...original, org_id: 'another-org' }]
        : [{ ...original, left_at: '2026-11-20T00:00:00Z' }]
    const response = await request()
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'DEPARTMENT_MEMBERSHIP_REQUIRED' })
    expect(mocks.from).not.toHaveBeenCalledWith('user_roles')
  })

  it('区分无会话、非法选项和读取失败', async () => {
    vi.mocked(requireAuth).mockRejectedValueOnce(new AuthError())
    expect((await request()).status).toBe(401)
    expect((await request('?departmentId=sales-a&includeSubdepartments=1')).status).toBe(400)
    failedTable = 'departments'
    const failure = await request()
    expect(failure.status).toBe(500)
    expect(await failure.json()).toMatchObject({ code: 'INTERNAL_ERROR' })
  })
})

describe('GET /api/dashboard personal view', () => {
  it('拒绝旧空间选择，部门选择只由部门接口授权', async () => {
    tables.user_roles = [grant('org', orgId, role('tenant-admin', [], 'ORG_SUPER_ADMIN'))]
    for (const id of ['space-c', 'foreign-space', 'unmapped-space']) {
      const response = await compatibilityRequest(`?spaceId=${id}`)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ code: 'DEPARTMENT_SELECTION_REQUIRED' })
    }
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('无选择参数时兼容个人视图，避免旧空间覆盖当前授权范围', async () => {
    const empty = await compatibilityRequest()
    expect(empty.status).toBe(200)
    expect(await empty.json()).toMatchObject({
      organizationId: orgId, spaces: [], activeSpace: null, opportunities: [], milestones: [],
    })
    expect(mocks.from).not.toHaveBeenCalledWith('sales_spaces')
  })

  it('个人视图只读取当前组织内与本人关联的提醒和日程', async () => {
    const agendaDate = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date())
    tables.reminders = [
      { id: 'personal-reminder', org_id: orgId, user_id: userId, dismissed_at: null, agenda_id: null },
      { id: 'dismissed', org_id: orgId, user_id: userId, dismissed_at: '2026-11-25', agenda_id: null },
      { id: 'someone-else', org_id: orgId, user_id: 'somebody', dismissed_at: null, agenda_id: null },
      { id: 'other-org-reminder', org_id: 'foreign-org', user_id: userId, dismissed_at: null, agenda_id: null },
    ]
    tables.agenda_items = [
      { id: 'personal-agenda', org_id: orgId, assignee_id: userId, agenda_date: agendaDate },
      { id: 'someone-else-agenda', org_id: orgId, user_id: 'somebody', agenda_date: agendaDate },
      { id: 'other-org-agenda', org_id: 'foreign-org', user_id: userId, agenda_date: agendaDate },
    ]
    const response = await compatibilityRequest('?view=personal')
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toMatchObject({
      organizationId: orgId, spaces: [], activeSpace: null, opportunities: [], milestones: [],
      reminders: [expect.objectContaining({ id: 'personal-reminder' })],
      agenda: [expect.objectContaining({ id: 'personal-agenda' })],
    })
    expect(mocks.from).not.toHaveBeenCalledWith('user_roles')
    expect(mocks.from).not.toHaveBeenCalledWith('opportunities')
  })

  it('个人视图仍要求有效的当前组织成员资格', async () => {
    const membership = tables.user_organizations
    tables.user_organizations = []
    const invalidMember = await compatibilityRequest()
    expect(invalidMember.status).toBe(403)
    expect(await invalidMember.json()).toMatchObject({ code: 'DEPARTMENT_MEMBERSHIP_REQUIRED' })

    tables.user_organizations = membership
    tables.organizations[0].status = 'disabled'
    const invalidOrg = await compatibilityRequest('?view=personal')
    expect(invalidOrg.status).toBe(403)
    expect(await invalidOrg.json()).toMatchObject({ code: 'DEPARTMENT_MEMBERSHIP_REQUIRED' })
  })
})

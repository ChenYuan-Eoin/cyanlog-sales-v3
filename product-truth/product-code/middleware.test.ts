import { afterEach, describe, expect, it, vi } from 'vitest'

import type { NextRequest } from 'next/server'
import { middleware } from './middleware'

function makeRequest(url: string, headers: Record<string, string> = {}, method = 'GET'): NextRequest {
  const nextUrl = new URL(url) as URL & { clone: () => URL }
  nextUrl.clone = () => new URL(nextUrl.toString())
  const request = {
    nextUrl,
    headers: new Headers(headers),
    cookies: {
      get: vi.fn(),
    },
    url,
    method,
  } as unknown as NextRequest

  return request
}

const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  if (originalServiceRoleKey === undefined) {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
  } else {
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey
  }

  if (originalSupabaseUrl === undefined) {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
  } else {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl
  }
})

type TestDepartment = { id: string; org_id: string; status: string; leader_id?: string }
type TestDepartmentAccess = { org_id: string; user_id: string; department_id: string; department: TestDepartment }

function mockExactOrgAuth(options: {
  token: string
  orgId: string
  roles: Array<{ org_id?: string; user_id?: string; scope_type?: string; scope_id?: string; roles: { id?: string; code: string; permissions: string[] } }>
  departments?: TestDepartment[]
  departmentLeads?: TestDepartmentAccess[]
  departmentLeadsStatus?: number
  memberships?: Array<{ org_id: string; employment_status: string; left_at?: string | null }>
  settings?: unknown
  settingsError?: unknown
  status?: string
  loginEnabled?: boolean
  authMethod?: 'local' | 'fxiaoke'
  employmentStatus?: string
  sourceIdentity?: 'authoritative' | 'evidence'
  sourceConnectionState?: string
  shippingOperatorStatus?: string
  shippingOperatorScopes?: string[]
  shippingActions?: Record<string, { status: string; dependencies: string[] }>
  organizationStatus?: string
  sessionCreatedAt?: string
  sessionExpiresAt?: string
}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    const table = url.pathname.split('/').pop()
    if (table === 'auth_tokens') {
      expect(url.searchParams.get('user.memberships.status')).toBe('eq.active')
      expect(url.searchParams.get('user.memberships.is_default')).toBe('eq.true')
      expect(url.searchParams.get('select')).toContain('memberships:user_organizations!user_organizations_user_id_fkey')
      return Response.json([{
        user_id: 'user-1',
        created_at: options.sessionCreatedAt ?? new Date().toISOString(),
        expires_at: options.sessionExpiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString(),
        auth_method: options.authMethod ?? 'local',
        user: {
          id: 'user-1',
          status: options.status ?? 'active',
          login_enabled: options.loginEnabled ?? true,
          memberships: (options.memberships ?? [{ org_id: options.orgId, employment_status: options.employmentStatus ?? 'active' }])
            .map(member => ({ left_at: null, ...member })),
        },
      }])
    }
    if (table === 'user_roles') {
      expect(url.searchParams.get('org_id')).toBe(`eq.${options.orgId}`)
      expect(url.searchParams.get('user_id')).toBe('eq.user-1')
      return Response.json(options.roles.map(role => ({ org_id: options.orgId, user_id: 'user-1', scope_type: 'org', scope_id: options.orgId, ...role })))
    }
    if (table === 'departments') {
      expect(url.searchParams.get('org_id')).toBe(`eq.${options.orgId}`)
      expect(url.searchParams.get('status')).toBe('eq.active')
      return Response.json((options.departments ?? []).filter(department => url.searchParams.get('id') === `eq.${department.id}`))
    }
    if (table === 'department_lead_access') {
      expect(url.searchParams.get('org_id')).toBe(`eq.${options.orgId}`)
      expect(url.searchParams.get('user_id')).toBe('eq.user-1')
      expect(url.searchParams.get('department.org_id')).toBe(`eq.${options.orgId}`)
      expect(url.searchParams.get('department.status')).toBe('eq.active')
      expect(url.searchParams.get('department.leader_id')).toBe('eq.user-1')
      expect(url.searchParams.get('select')).toContain('department:departments!department_lead_access_department_id_fkey!inner(')
      if (options.departmentLeadsStatus !== undefined) return new Response('department access unavailable', { status: options.departmentLeadsStatus })
      return Response.json(options.departmentLeads ?? [])
    }
    if (table === 'organizations') {
      if (options.settingsError) {
        return new Response('settings unavailable', { status: 503 })
      }
      return Response.json([{ status: options.organizationStatus ?? 'active', settings: options.settings ?? {} }])
    }
    if (table === 'organization_sources') {
      return Response.json([{
        authority_scope: { identity: options.sourceIdentity ?? 'authoritative' },
        connection_state: options.sourceConnectionState ?? 'verified', effective_revision: 'revision-1',
      }])
    }
    if (table === 'permission_points') {
      const code = url.searchParams.get('code')?.slice(3)
      if (code?.startsWith('shipping:owner_')) return Response.json([{
        code, kind: 'atomic', category: 'shipping', resource: 'shipping', action: code.slice('shipping:'.length),
        supported_scope_types: ['self'], enforcement_consumer: 'lib/shipping/http.ts',
        status: 'published', dependencies: code === 'shipping:owner_view' ? [] : ['shipping:owner_view'],
        ...(options.shippingActions?.[code] ?? {}),
      }])
      if (code && options.shippingActions?.[code]) return Response.json([{
        code, kind: 'atomic', category: 'shipping', resource: 'shipping', action: code.slice('shipping:'.length),
        supported_scope_types: ['org'], enforcement_consumer: 'lib/shipping/http.ts', ...options.shippingActions[code],
      }])
      if (code !== 'shipping:operate' && code !== 'shipping:manage_connections') return Response.json([])
      const operator = code === 'shipping:operate'
      return Response.json([{
        code, kind: 'atomic', category: 'shipping', resource: 'shipping', dependencies: [],
        action: operator ? 'operate' : 'manage_connections', status: operator ? options.shippingOperatorStatus ?? 'published' : 'published',
        supported_scope_types: operator ? options.shippingOperatorScopes ?? ['org'] : ['org'],
        enforcement_consumer: operator ? 'lib/shipping/operator-access.ts#requireShippingOperator' : 'lib/shipping/connection-authorization.ts',
      }])
    }
    return new Response(`unexpected table ${table}`, { status: 500 })
  })

  vi.stubGlobal('fetch', fetchMock)
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example.test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test'

  return { fetchMock }
}

describe('middleware host routing', () => {
  it('keeps an existing ICU session valid when the CRM connector is temporarily unavailable', async () => {
    mockExactOrgAuth({ token: 'existing', orgId: 'org-a', roles: [], authMethod: 'fxiaoke', sourceConnectionState: 'failed' })
    expect((await middleware(makeRequest('https://sales.cyanlog.icu/api/auth/activity', { authorization: 'Bearer existing' }))).status).toBe(200)
  })
  it('allows session management for a role-free SSO member without allowing business writes', async () => {
    mockExactOrgAuth({ token: 'activity-token', orgId: 'org-a', roles: [], authMethod: 'fxiaoke' })
    for (const method of ['GET', 'POST']) {
      expect((await middleware(makeRequest('https://sales.cyanlog.icu/api/auth/activity', { authorization: 'Bearer activity-token' }, method))).status).toBe(200)
    }
    expect((await middleware(makeRequest('https://sales.cyanlog.icu/api/quotes', { authorization: 'Bearer activity-token' }, 'POST'))).status).toBe(403)
  })

  it.each(['local', 'fxiaoke'] as const)('keeps %s sessions valid for seven days and rejects the thirty-day absolute expiry', async authMethod => {
    mockExactOrgAuth({ token: 'active-token', orgId: 'org-a', roles: [], authMethod,
      sessionExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString() })
    expect((await middleware(makeRequest('https://sales.cyanlog.icu/api/auth/activity', { authorization: 'Bearer active-token' }))).status).toBe(200)
    const page = await middleware(makeRequest('https://sales.cyanlog.icu/shipping', { authorization: 'Bearer active-token' }))
    expect(page.headers.get('location')).not.toBe('https://sales.cyanlog.icu/login')
    mockExactOrgAuth({ token: 'old-token', orgId: 'org-a', roles: [], authMethod,
      sessionCreatedAt: new Date(Date.now() - 31 * 24 * 60 * 60_000).toISOString(),
      sessionExpiresAt: new Date(Date.now() + 60_000).toISOString() })
    expect((await middleware(makeRequest('https://sales.cyanlog.icu/api/auth/activity', { authorization: 'Bearer old-token' }))).status).toBe(401)
  })

  it('redirects quote subdomain to sales quotes entry', async () => {
    const res = await middleware(
      makeRequest('https://quote.cyanlog.icu/', { host: 'quote.cyanlog.icu' }),
    )

    expect(res.status).toBe(308)
    expect(res.headers.get('location')).toBe('https://sales.cyanlog.icu/quotes')
  })

  it('redirects contract subdomain to sales contracts entry', async () => {
    const res = await middleware(
      makeRequest('https://contract.cyanlog.icu/anything', { host: 'contract.cyanlog.icu' }),
    )

    expect(res.status).toBe(308)
    expect(res.headers.get('location')).toBe('https://sales.cyanlog.icu/anything')
  })

  it('redirects apex domain to sales home', async () => {
    const res = await middleware(
      makeRequest('https://cyanlog.icu/', { host: 'cyanlog.icu' }),
    )

    expect(res.status).toBe(308)
    expect(res.headers.get('location')).toBe('https://sales.cyanlog.icu/')
  })

  it('redirects the exact production Git domain to the canonical sales origin and preserves the request target', async () => {
    const res = await middleware(makeRequest(
      'https://cyanlog-sales-v3-git-production-eoins-projects-94b17ece.vercel.app/api/auth/providers?from=git&next=%2Fsales-portal',
      { host: 'cyanlog-sales-v3-git-production-eoins-projects-94b17ece.vercel.app' },
    ))

    expect(res.status).toBe(308)
    expect(res.headers.get('location')).toBe('https://sales.cyanlog.icu/api/auth/providers?from=git&next=%2Fsales-portal')
  })

  it('returns 503 for protected pages when service role key is missing', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY

    const req = makeRequest('https://sales.cyanlog.icu/configs', { host: 'sales.cyanlog.icu' })
    req.cookies.get = vi.fn().mockReturnValue({ value: 'token-1' })

    const res = await middleware(req)

    expect(res.status).toBe(503)
  })
})

describe('role-free federated session boundary', () => {
  it('lets a baseline member read business pages and self-submit while denying writes and configuration', async () => {
    mockExactOrgAuth({ token: 'baseline-token', orgId: 'org-a', authMethod: 'fxiaoke', roles: [{ roles: { id: 'baseline', code: 'FXIAOKE_BASELINE', permissions: ['quote:view', 'contract:view', 'customer:view'] } }] })
    const request = (path: string, method = 'GET') => {
      const req = makeRequest(`https://sales.cyanlog.icu${path}`, { host: 'sales.cyanlog.icu' }, method)
      req.cookies.get = vi.fn().mockReturnValue({ value: 'baseline-token' })
      return req
    }
    expect((await middleware(request('/shipping'))).status).toBe(200)
    expect((await middleware(request('/sales-portal'))).status).toBe(200)
    expect((await middleware(request('/api/quotes'))).status).toBe(200)
    expect((await middleware(request('/api/contracts/drafts'))).status).toBe(200)
    expect((await middleware(request('/api/knowledge/tree'))).status).toBe(200)
    expect((await middleware(request('/api/cases'))).status).toBe(403)
    expect((await middleware(request('/api/tech-documents'))).status).toBe(403)
    const changes = '/api/shipping/owner/orders/SO-20261118-ABCD1234/carrier-changes'
    expect((await middleware(request(changes))).status).toBe(200)
    expect((await middleware(request(changes, 'POST'))).status).toBe(200)
    expect((await middleware(request(changes + '/other', 'POST'))).status).toBe(403)
    expect((await middleware(request('/api/shipping/ledger/sample/carrier-changes'))).status).toBe(403)
    expect((await middleware(request('/api/shipping/ledger/sample/carrier-changes', 'POST'))).status).toBe(403)
    const returnedOrder = '/api/shipping/owner/orders/SO-20261118-1111AAAA/resubmit'
    expect((await middleware(request(returnedOrder))).status).toBe(200)
    expect((await middleware(request(returnedOrder, 'POST'))).status).toBe(200)
    expect((await middleware(request(returnedOrder, 'DELETE'))).status).toBe(403)
    expect((await middleware(request(returnedOrder + '/other', 'POST'))).status).toBe(403)
    expect((await middleware(request('/api/shipping/owner/orders', 'POST'))).status).toBe(200)
    expect((await middleware(request('/api/shipping/owner/orders/SO-20261118-1234ABCD/cancel', 'POST'))).status).toBe(200)
    expect((await middleware(request('/api/shipping/owner/orders/SO-20261118-1234ABCD/tracking', 'POST'))).status).toBe(200)
    expect((await middleware(request('/api/shipping/owner/orders/SO-20261118-1234ABCD/tracking/other', 'POST'))).status).toBe(403)
    expect((await middleware(request('/api/shipping/tracking', 'POST'))).status).toBe(403)
    expect((await middleware(request('/api/shipping/owner/orders/SO-20261118-1234ABCD/confirm', 'POST'))).status).toBe(403)
    expect((await middleware(request('/api/shipping/owner/orders'))).status).toBe(200)
    expect((await middleware(request('/api/shipping/owner/profile'))).status).toBe(200)
    expect((await middleware(request('/api/shipping/owner/profile', 'POST'))).status).toBe(200)
    expect((await middleware(request('/api/shipping/public/orders/' + 'a'.repeat(43)))).status).toBe(200)
    expect((await middleware(request('/api/shipping/public/orders'))).status).toBe(403)
    expect((await middleware(request('/api/quotes', 'POST'))).status).toBe(403)
    expect((await middleware(request('/api/shipping/orders', 'POST'))).status).toBe(403)
    expect((await middleware(request('/api/admin/users'))).status).toBe(403)
    expect((await middleware(request('/api/configs'))).status).toBe(403)
    expect((await middleware(request('/configs'))).status).toBe(307)
  })

  it('limits the live operator grant to the current organization and to actual shipping actions', async () => {
    const token = 'operator-token'
    const baseline = { roles: { id: 'baseline', code: 'FXIAOKE_BASELINE', permissions: ['quote:view'] } }
    const operator = { roles: { id: 'operator', code: 'SHIPPING_OPERATOR', permissions: ['shipping:operate'] } }
    const bind = (overrides: Partial<Parameters<typeof mockExactOrgAuth>[0]> = {}) => mockExactOrgAuth({
      token, orgId: 'org-a', authMethod: 'fxiaoke', roles: [baseline, operator], ...overrides,
    })
    const request = (path: string, method = 'GET') => middleware(makeRequest(
      `https://sales.cyanlog.icu${path}`, { authorization: `Bearer ${token}` }, method,
    ))

    bind()
    expect((await request('/api/navigation')).status).toBe(200)
    expect((await request('/api/shipping/settings?workspace=1')).status).toBe(200)
    expect((await request('/api/shipping/ledger')).status).toBe(200)
    expect((await request('/api/shipping/ledger/example/confirm', 'POST')).status).toBe(200)
    expect((await request('/api/shipping/ledger/example/carrier-changes', 'POST')).status).toBe(200)
    expect((await request('/api/shipping/settings')).status).toBe(403)
    expect((await request('/api/quotes', 'POST')).status).toBe(403)
    expect((await request('/api/shipping/orders', 'POST')).status).toBe(403)

    for (const state of [
      { roles: [baseline] },
      { roles: [baseline, { ...operator, org_id: 'other-org' }] },
      { roles: [baseline, { ...operator, scope_type: 'department' }] },
      { shippingOperatorStatus: 'disabled' },
      { shippingOperatorScopes: ['org', 'department'] },
    ]) {
      bind(state)
      expect((await request('/api/shipping/ledger')).status).toBe(403)
      expect((await request('/api/shipping/ledger/example/confirm', 'POST')).status).toBe(403)
      expect((await request('/api/shipping/ledger/example/carrier-changes', 'POST')).status).toBe(403)
      expect((await request('/api/shipping/owner/orders', 'POST')).status).toBe(200)
    }
  })

  it.each(['local', 'fxiaoke'] as const)('allows a %s shipping operator to create a workbench order within the current organization', async authMethod => {
    const token = 'operator-create-token'
    const operator = { roles: { id: 'operator', code: 'SHIPPING_OPERATOR', permissions: ['shipping:operate'] } }
    const baseline = { roles: { id: 'baseline', code: 'FXIAOKE_BASELINE', permissions: ['quote:view'] } }
    const readonly = { roles: { id: 'readonly', code: 'READONLY', permissions: ['quote:view'] } }
    const bind = (overrides: Partial<Parameters<typeof mockExactOrgAuth>[0]> = {}) => mockExactOrgAuth({
      token, orgId: 'org-a', authMethod, roles: [operator], ...overrides,
    })
    const post = (path: string) => middleware(makeRequest(
      `https://sales.cyanlog.icu${path}`, { authorization: `Bearer ${token}` }, 'POST',
    ))

    bind()
    expect((await post('/api/shipping/ledger')).status).toBe(200)
    expect((await post('/api/shipping/owner/orders')).status).toBe(403)
    expect((await post('/api/shipping/owner/profile')).status).toBe(403)
    expect((await post('/api/quotes')).status).toBe(403)

    for (const deniedOperator of [
      { roles: [readonly, { ...operator, scope_type: 'department', scope_id: 'dept-a' }] },
      { roles: [readonly, { ...operator, org_id: 'other-org', scope_id: 'other-org' }] },
      { roles: [readonly], authMethod: 'fxiaoke' as const },
      { shippingOperatorStatus: 'disabled' },
    ]) {
      bind(deniedOperator)
      expect((await post('/api/shipping/ledger')).status).toBe(403)
    }

    bind({ roles: [baseline], authMethod: 'fxiaoke', shippingOperatorStatus: 'disabled' })
    expect((await post('/api/shipping/owner/orders')).status).toBe(200)

    bind({ roles: [{ roles: { id: 'sales', code: 'SALES', permissions: ['quote:view'] } }], authMethod: 'fxiaoke', shippingOperatorStatus: 'disabled' })
    expect((await post('/api/shipping/owner/orders')).status).toBe(200)
  })

  it('admits the department directory only to the exact configuration and department paths', async () => {
    const token = 'directory-viewer'
    const role = { id: 'directory-role', code: 'READONLY', permissions: ['dept:directory_view'] }
    const id = '4cf0681d-dcb2-45f2-bfa2-71c1bc253213'
    mockExactOrgAuth({ token, orgId: 'org-a', authMethod: 'fxiaoke', roles: [{ roles: role }] })
    const request = (path: string, method = 'GET') => middleware(makeRequest(
      `https://sales.cyanlog.icu${path}`, { authorization: `Bearer ${token}` }, method,
    ))
    expect((await request('/configs?tab=org-structure')).status).toBe(200)
    expect((await request('/api/admin/org')).status).toBe(200)
    expect((await request('/api/admin/org', 'HEAD')).status).toBe(200)
    expect((await request('/api/admin/departments')).status).toBe(200)
    // Authorized department paths reach the dedicated handler's action checks.
    expect((await request('/api/admin/departments', 'POST')).status).toBe(200)
    expect((await request(`/api/admin/departments/${id}`, 'PATCH')).status).toBe(200)
    expect((await request(`/api/admin/departments/${id}`, 'DELETE')).status).toBe(200)
    for (const [path, method] of [
      ['/api/admin/org', 'POST'], ['/api/admin/users', 'GET'], ['/api/configs', 'GET'],
      ['/api/admin/departments/leader-access', 'GET'], ['/api/admin/departments/leader-access', 'PUT'],
      [`/api/admin/departments/${id}/other`, 'PATCH'], ['/api/admin/departments/invalid-id', 'PATCH'],
    ]) {
      expect((await request(path, method)).status, path).toBe(403)
    }
    mockExactOrgAuth({ token, orgId: 'org-a', authMethod: 'fxiaoke', roles: [{ roles: { ...role, permissions: ['dept:view'] } }] })
    expect((await request('/api/admin/org')).status).toBe(403)
    expect((await request('/api/admin/departments')).status).toBe(403)
    expect((await request('/configs?tab=org-structure')).status).toBe(307)
  })

  it('keeps member reads available while reserving authorization routes to the system super administrator', async () => {
    const token = 'role-assignment-boundary'
    const id = '4cf0681d-dcb2-45f2-bfa2-71c1bc253213'
    const role = { id: 'member-role', code: 'READONLY', permissions: ['user:view', 'user:assign_roles'] }
    const request = (path: string, method = 'GET') => middleware(makeRequest(
      `https://sales.cyanlog.icu${path}`, { authorization: `Bearer ${token}` }, method,
    ))
    const authorizationPaths = [
      ['/api/roles?view=assignable', 'GET'], ['/api/roles/role-id', 'PATCH'],
      [`/api/admin/users/${id}/roles`, 'POST'], [`/api/admin/users/${id}/role-scopes`, 'DELETE'],
      [`/api/admin/users/${id}/system-super-admin`, 'PATCH'],
      [`/api/admin/users/${id}/org-super-admin`, 'PATCH'],
      ['/api/admin/departments/leader-access', 'PUT'], ['/api/admin/departments/shipping-intake', 'PATCH'],
    ]
    mockExactOrgAuth({ token, orgId: 'org-a', authMethod: 'fxiaoke', roles: [{ roles: role }] })
    expect((await request('/configs?tab=org-structure')).status).toBe(200)
    expect((await request('/api/admin/org')).status).toBe(200)
    expect((await request('/api/roles')).status).toBe(403)
    expect((await request(`/api/admin/users/${id}/login-enabled`, 'PATCH')).status).toBe(403)
    expect((await request('/api/configs')).status).toBe(403)
    for (const [path, method] of authorizationPaths) expect((await request(path, method)).status, path).toBe(403)

    const root = { id: 'root-role', code: 'SUPER_ADMIN', permissions: ['*'] }
    mockExactOrgAuth({ token, orgId: 'org-a', roles: [{ roles: root }] })
    for (const [path, method] of authorizationPaths) expect((await request(path, method)).status, path).toBe(200)

    mockExactOrgAuth({ token, orgId: 'org-a', roles: [{ roles: root }, { roles: { ...role, permissions: ['role:manage'] } }],
      settings: { role_permission_overrides: { 'root-role': ['admin:access'] } } })
    for (const [path, method] of authorizationPaths) expect((await request(path, method)).status, path).toBe(403)
  })

  it('admits settings-only viewers to both settings entries while preserving the generic config boundary', async () => {
    const token = 'shipping-settings-viewer'
    mockExactOrgAuth({
      token, orgId: 'org-a', roles: [{ roles: { id: 'settings-reader', code: 'SETTINGS_READER', permissions: ['shipping:settings_view'] } }],
      shippingActions: { 'shipping:settings_view': { status: 'published', dependencies: [] } },
    })
    const request = (path: string, method = 'GET') => middleware(makeRequest(
      `https://sales.cyanlog.icu${path}`, { authorization: `Bearer ${token}`, 'x-user-shipping-settings-view': 'forged' }, method,
    ))
    const shell = await request('/configs?tab=shipping')
    expect(shell.status).toBe(200)
    expect(shell.headers.get('x-middleware-request-x-user-shipping-settings-view')).toBe('1')
    const direct = await request('/shipping/settings')
    expect(direct.status).toBe(200)
    expect(direct.headers.get('x-middleware-request-x-user-shipping-settings-view')).toBeNull()
    expect((await request('/api/configs')).status).toBe(403)
    expect((await request('/api/shipping/settings', 'POST')).status).toBe(403)
  })

  it('allows only explicitly authorized readers to open the full role directory', async () => {
    const token = 'configuration-reader'
    const role = { id: 'config-viewer', code: 'READONLY', permissions: ['config:read'] }
    const auth = { authorization: `Bearer ${token}` }
    mockExactOrgAuth({ token, orgId: 'org-a', authMethod: 'fxiaoke', roles: [{ roles: role }] })
    expect((await middleware(makeRequest('https://sales.cyanlog.icu/configs', auth))).status).toBe(200)
    expect((await middleware(makeRequest('https://sales.cyanlog.icu/api/roles', auth))).status).toBe(403)

    mockExactOrgAuth({ token, orgId: 'org-a', authMethod: 'fxiaoke',
      roles: [{ roles: { ...role, permissions: ['user:view', 'role:view'] } }] })
    expect((await middleware(makeRequest('https://sales.cyanlog.icu/api/roles', auth))).status).toBe(200)
    expect((await middleware(makeRequest('https://sales.cyanlog.icu/api/roles?view=assignable', auth))).status).toBe(403)
    expect((await middleware(makeRequest('https://sales.cyanlog.icu/api/roles/role-id', auth, 'PATCH'))).status).toBe(403)
  })

  it.each([
    {
      description: 'confirming a workbench order',
      view: 'shipping:ledger_view',
      action: 'shipping:order_confirm',
      readPath: '/api/shipping/ledger',
      writePaths: ['/api/shipping/ledger/example/confirm'],
    },
    {
      description: 'changing intake settings',
      view: 'shipping:settings_view',
      action: 'shipping:intake_write',
      readPath: '/api/shipping/settings',
      writePaths: ['/api/shipping/intake-settings', '/api/shipping/settings'],
    },
  ])('requires the published view permission for $description', async ({ view, action, readPath, writePaths }) => {
    const token = 'shipping-granular-action'
    const bind = (viewStatus: 'published' | 'disabled') => mockExactOrgAuth({
      token, orgId: 'org-a', authMethod: 'fxiaoke',
      roles: [{ roles: { id: 'shipping-role', code: 'SHIPPING_OPERATOR', permissions: [view, action] } }],
      shippingActions: {
        [view]: { status: viewStatus, dependencies: [] },
        [action]: { status: 'published', dependencies: [view] },
      },
    })
    const request = (path: string, method = 'GET') => middleware(makeRequest(
      `https://sales.cyanlog.icu${path}`, { authorization: `Bearer ${token}` }, method,
    ))

    bind('published')
    expect((await request(readPath)).status).toBe(200)
    for (const path of writePaths) {
      expect((await request(path, 'POST')).status).toBe(200)
    }

    bind('disabled')
    expect((await request(readPath)).status).toBe(403)
    for (const path of writePaths) {
      expect((await request(path, 'POST')).status).toBe(403)
    }
  })

  it('does not use the legacy grant to bypass a disabled granular action', async () => {
    const token = 'legacy-operator-disabled-confirm'
    mockExactOrgAuth({
      token, orgId: 'org-a', roles: [{ roles: { id: 'operator', code: 'SHIPPING_OPERATOR', permissions: ['shipping:operate'] } }],
      shippingActions: { 'shipping:order_confirm': { status: 'disabled', dependencies: ['shipping:ledger_view'] } },
    })
    const request = (path: string, method = 'GET') => middleware(makeRequest(
      `https://sales.cyanlog.icu${path}`, { authorization: `Bearer ${token}` }, method,
    ))
    expect((await request('/api/shipping/ledger')).status).toBe(200)
    expect((await request('/api/shipping/ledger/example/confirm', 'POST')).status).toBe(403)
  })

  it('keeps the shipping connection manager separate from ledger operations', async () => {
    const token = 'connection-manager'
    mockExactOrgAuth({ token, orgId: 'org-a', roles: [
      { roles: { id: 'manager-role', code: 'CONNECTION_MANAGER', permissions: ['shipping:manage_connections'] } },
    ] })
    const request = (path: string, method = 'GET') => middleware(makeRequest(
      `https://sales.cyanlog.icu${path}`, { authorization: `Bearer ${token}` }, method,
    ))
    expect((await request('/shipping/settings')).status).toBe(200)
    expect((await request('/api/shipping/settings')).status).toBe(200)
    expect((await request('/api/shipping/intake-settings', 'POST')).status).toBe(200)
    expect((await request('/api/shipping/settings?workspace=1')).status).toBe(403)
    expect((await request('/api/shipping/ledger/example/confirm', 'POST')).status).toBe(403)
    expect((await request('/api/shipping/ledger/example/carrier-changes', 'POST')).status).toBe(403)
  })

  it.each([
    { roleCodes: ['READONLY'], ownerWriteStatus: 403 },
    { roleCodes: ['FXIAOKE_BASELINE'], ownerWriteStatus: 200 },
    { roleCodes: ['FXIAOKE_BASELINE', 'READONLY'], ownerWriteStatus: 200 },
  ])('applies the exact federated owner permission to $roleCodes', async ({ roleCodes, ownerWriteStatus }) => {
    const token = 'viewer-token'
    mockExactOrgAuth({
      token, orgId: 'org-a', authMethod: 'fxiaoke', shippingOperatorStatus: 'disabled',
      roles: roleCodes.map(code => ({ roles: {
        id: code, code, permissions: ['quote:view', 'contract:view', 'customer:view'],
      } })),
    })
    const request = (path: string, method = 'GET') => middleware(makeRequest(
      `https://sales.cyanlog.icu${path}`, { authorization: `Bearer ${token}` }, method,
    ))
    const orders = '/api/shipping/owner/orders'
    const order = `${orders}/SO-20261118-1234ABCD`
    const profile = '/api/shipping/owner/profile'
    const receipt = `/api/shipping/public/orders/${'a'.repeat(43)}`

    for (const path of [orders, profile, receipt]) {
      expect((await request(path)).status, path).toBe(200)
    }
    for (const path of [`${order}/resubmit`, `${order}/carrier-changes`]) {
      expect((await request(path)).status, path).toBe(ownerWriteStatus)
    }
    for (const path of [
      orders, profile, `${order}/resubmit`, `${order}/cancel`, `${order}/carrier-changes`, `${order}/tracking`,
    ]) {
      expect((await request(path, 'POST')).status, path).toBe(ownerWriteStatus)
    }

    expect((await request('/api/quotes')).status).toBe(200)
    expect((await request('/api/cases')).status).toBe(403)
    expect((await request('/api/quotes', 'POST')).status).toBe(403)
    expect((await request('/api/contracts/example', 'PATCH')).status).toBe(403)
    expect((await request('/api/shipping/orders', 'POST')).status).toBe(403)
    expect((await request(`${order}/tracking/unrelated`, 'POST')).status).toBe(403)
  })

  it('revokes owner submission while keeping a separately granted workbench intake for the same employee', async () => {
    const token = 'employee-and-operator'
    mockExactOrgAuth({
      token, orgId: 'org-a', authMethod: 'fxiaoke',
      roles: [
        { roles: { id: 'baseline', code: 'FXIAOKE_BASELINE', permissions: [] } },
        { roles: { id: 'operator', code: 'SHIPPING_OPERATOR', permissions: ['shipping:*'] } },
      ],
      settings: { shipping_owner_permission_overrides: { baseline: ['shipping:owner_view'], operator: ['shipping:owner_view'] } },
    })
    const request = (path: string, method = 'GET') => middleware(makeRequest(
      `https://sales.cyanlog.icu${path}`, { authorization: `Bearer ${token}` }, method,
    ))
    expect((await request('/api/shipping/owner/orders')).status).toBe(200)
    expect((await request('/api/shipping/owner/orders', 'POST')).status).toBe(403)
    expect((await request('/api/shipping/owner/profile', 'POST')).status).toBe(403)
    expect((await request('/api/shipping/ledger', 'POST')).status).toBe(200)
  })

  it('preserves separately assigned administrator access alongside the baseline role', async () => {
    mockExactOrgAuth({
      token: 'admin-token', orgId: 'org-a', authMethod: 'fxiaoke',
      roles: [
        { roles: { id: 'baseline', code: 'FXIAOKE_BASELINE', permissions: ['quote:view'] } },
        { roles: { id: 'admin', code: 'ADMIN', permissions: ['org:*', 'config:*'] } },
      ],
    })
    const req = makeRequest('https://sales.cyanlog.icu/configs', { host: 'sales.cyanlog.icu' })
    req.cookies.get = vi.fn().mockReturnValue({ value: 'admin-token' })
    expect((await middleware(req)).status).toBe(200)
  })
  it('allows the waiting page, self profile and sign-out while blocking business access until an explicit grant', async () => {
    mockExactOrgAuth({ token: 'role-free-token', orgId: 'org-a', roles: [], authMethod: 'fxiaoke' })
    const headers = { host: 'sales.cyanlog.icu' }
    const makeAuthed = (path: string, method = 'GET') => {
      const req = makeRequest(`https://sales.cyanlog.icu${path}`, headers, method)
      req.cookies.get = vi.fn().mockReturnValue({ value: 'role-free-token' })
      return req
    }

    expect((await middleware(makeAuthed('/pending-access'))).status).toBe(200)
    expect((await middleware(makeAuthed('/api/auth/logout'))).status).toBe(200)
    expect((await middleware(makeAuthed('/api/auth/activity', 'POST'))).status).toBe(200)
    expect((await middleware(makeAuthed('/api/profile'))).status).toBe(200)
    expect((await middleware(makeAuthed('/api/profile', 'PATCH'))).status).toBe(403)
    const page = await middleware(makeAuthed('/quotes'))
    expect(page.status).toBe(307)
    expect(page.headers.get('location')).toBe('https://sales.cyanlog.icu/pending-access')
    const api = await middleware(makeAuthed('/api/quotes'))
    expect(api.status).toBe(403)
    expect((await api.json()).code).toBe('ROLE_REQUIRED')
    mockExactOrgAuth({ token: 'role-free-token', orgId: 'org-a', authMethod: 'fxiaoke', roles: [
      { roles: { id: 'sales-viewer', code: 'SALES_VIEWER', permissions: ['quote:view'] } },
    ] })
    expect((await middleware(makeAuthed('/quotes'))).status).toBe(200)
  })

  it('rejects an SSO token immediately when identity authority is disabled', async () => {
    mockExactOrgAuth({ token: 'sso-token', orgId: 'org-a', roles: [], authMethod: 'fxiaoke', sourceIdentity: 'evidence' })
    const req = makeRequest('https://sales.cyanlog.icu/pending-access', { host: 'sales.cyanlog.icu' })
    req.cookies.get = vi.fn().mockReturnValue({ value: 'sso-token' })
    const response = await middleware(req)
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://sales.cyanlog.icu/login')
  })

  it('rejects an existing SSO session after directory employment is suspended', async () => {
    mockExactOrgAuth({ token: 'sso-token', orgId: 'org-a', roles: [{ roles: { id: 'baseline', code: 'FXIAOKE_BASELINE', permissions: ['quote:view'] } }],
      authMethod: 'fxiaoke', employmentStatus: 'suspended' })
    const req = makeRequest('https://sales.cyanlog.icu/api/quotes', { host: 'sales.cyanlog.icu' })
    req.cookies.get = vi.fn().mockReturnValue({ value: 'sso-token' })
    const response = await middleware(req)
    expect(response.status).toBe(401)
  })
})


describe('department-scoped workspace admission', () => {
  const department = { id: 'dept-a', org_id: 'org-a', status: 'active', leader_id: 'user-1' }
  const leaderGrant = { org_id: 'org-a', user_id: 'user-1', department_id: department.id, department }
  const departmentRole = {
    org_id: 'org-a', user_id: 'user-1', scope_type: 'department', scope_id: department.id,
    roles: { id: 'dept-viewer', code: 'DEPARTMENT_VIEWER', permissions: ['dept:view', 'shipping:*', 'config:read'] },
  }
  const token = 'department-workspace-token'
  function bind(overrides: Partial<Parameters<typeof mockExactOrgAuth>[0]> = {}) {
    return mockExactOrgAuth({ token, orgId: 'org-a', roles: [], authMethod: 'fxiaoke', ...overrides })
  }
  const request = (path: string, method = 'GET') => middleware(makeRequest(
    `https://sales.cyanlog.icu${path}`, { authorization: `Bearer ${token}` }, method,
  ))

  it.each([
    { name: 'confirmed department leader', departmentLeads: [leaderGrant] },
    { name: 'active department view role', roles: [departmentRole], departments: [department] },
    {
      name: 'active department report role even before the lead confirmation table is available',
      roles: [{ ...departmentRole, roles: { ...departmentRole.roles, permissions: ['report:dept'] } }],
      departments: [department],
      departmentLeadsStatus: 404,
    },
  ])('allows the exact workspace reads for an authoritative session with a $name and no organization role', async ({ name: _name, ...proof }) => {
    bind(proof)
    for (const path of ['/', '/api/auth/me', '/api/navigation', '/api/dashboard?view=personal', '/api/dashboard/department', '/api/dashboard/department/roster']) {
      const response = await request(path)
      expect(response.status, path).toBe(200)
      expect(response.headers.get('x-middleware-request-x-user-id')).toBe('user-1')
      expect(response.headers.get('x-middleware-request-x-org-id')).toBe('org-a')
      expect(response.headers.get('x-middleware-request-x-user-role-codes')).toBe('')
      expect(response.headers.get('x-middleware-request-x-user-permissions')).toBe('')
      expect((await request(path, 'HEAD')).status, path).toBe(200)
    }
    for (const path of [
      '/api/quotes', '/api/configs', '/api/admin/users', '/api/shipping/ledger', '/api/shipping/owner/orders',
      '/api/shipping/settings', '/api/dashboard/department/other',
    ]) {
      const response = await request(path)
      expect(response.status, path).toBe(403)
      expect((await response.json()).code).toBe('ROLE_REQUIRED')
    }
    for (const path of ['/api/dashboard/department', '/api/shipping/owner/orders', '/api/auth/me']) {
      expect((await request(path, 'POST')).status, path).toBe(403)
    }
    for (const path of ['/shipping', '/shipping/settings', '/configs']) {
      expect((await request(path)).headers.get('location'), path).toBe('https://sales.cyanlog.icu/pending-access')
    }
  })

  it.each([
    { name: 'actual roleless member' },
    { name: 'roleless member before the lead migration', departmentLeadsStatus: 404 },
    { name: 'unconfirmed department leader', departments: [department] },
    { name: 'revoked department role', roles: [departmentRole], settings: { role_permission_overrides: { 'dept-viewer': [] } }, departments: [department] },
    { name: 'foreign department role binding', roles: [{ ...departmentRole, org_id: 'org-b' }], departments: [department] },
    { name: 'foreign department', roles: [departmentRole], departments: [{ ...department, org_id: 'org-b' }] },
    { name: 'disabled department role scope', roles: [departmentRole], departments: [{ ...department, status: 'inactive' }] },
    { name: 'invalid department role', roles: [{ ...departmentRole, roles: { ...departmentRole.roles, code: 'SHIPPING_OPERATOR' } }], departments: [department] },
    { name: 'inactive leader department', departmentLeads: [{ ...leaderGrant, department: { ...department, status: 'inactive' } }] },
    { name: 'no longer the leader', departmentLeads: [{ ...leaderGrant, department: { ...department, leader_id: 'user-2' } }] },
    { name: 'foreign leader department', departmentLeads: [{ ...leaderGrant, department: { ...department, org_id: 'org-b' } }] },
    { name: 'ended membership', departmentLeads: [leaderGrant], memberships: [{ org_id: 'org-a', employment_status: 'active', left_at: '2026-11-01T00:00:00Z' }] },
    { name: 'disabled organization', departmentLeads: [leaderGrant], organizationStatus: 'inactive' },
  ])('keeps the pending-access boundary for a $name', async ({ name: _name, ...proof }) => {
    bind(proof)
    expect((await request('/')).headers.get('location')).toBe('https://sales.cyanlog.icu/pending-access')
    const response = await request('/api/dashboard/department')
    expect(response.status).toBe(403)
    expect((await response.json()).code).toBe('ROLE_REQUIRED')
  })

  it('fails closed when checking confirmed department access is unavailable', async () => {
    bind({ departmentLeadsStatus: 503 })
    expect((await request('/api/dashboard/department')).status).toBe(503)
  })

  it.each([
    { loginEnabled: false },
    { status: 'inactive' },
    { employmentStatus: 'suspended' },
    { sourceIdentity: 'evidence' as const },
  ])('keeps invalid sessions out even with department access (%j)', async session => {
    bind({ ...session, departmentLeads: [leaderGrant] })
    expect((await request('/api/dashboard/department')).status).toBe(401)
  })
})

describe('middleware public API routing', () => {
  it('requires login for the proposal page and every former anonymous intake route', async () => {
    const portal = await middleware(makeRequest('https://sales.cyanlog.icu/sales-portal', { host: 'sales.cyanlog.icu' }))
    const workbench = await middleware(makeRequest('https://sales.cyanlog.icu/shipping', { host: 'sales.cyanlog.icu' }))
    expect(portal.status).toBe(307)
    expect(portal.headers.get('location')).toBe('https://sales.cyanlog.icu/login')
    expect(workbench.status).toBe(307)
    expect(workbench.headers.get('location')).toBe('https://sales.cyanlog.icu/login')
    for (const path of ['/api/shipping/public/options', '/api/shipping/public/orders', '/api/shipping/public/orders/' + 'a'.repeat(43)]) {
      expect((await middleware(makeRequest('https://sales.cyanlog.icu' + path, { host: 'sales.cyanlog.icu' }))).status).toBe(401)
    }
  })

  it('serves runtime brand assets without requiring an authenticated session', async () => {
    const brandAsset = await middleware(
      makeRequest('https://sales.cyanlog.icu/brand/ones-symbol-square.svg', { host: 'sales.cyanlog.icu' }),
    )
    const brandNeighbor = await middleware(
      makeRequest('https://sales.cyanlog.icu/branding/private', { host: 'sales.cyanlog.icu' }),
    )

    expect(brandAsset.status).toBe(200)
    expect(brandNeighbor.status).toBe(307)
    expect(brandNeighbor.headers.get('location')).toBe('https://sales.cyanlog.icu/login')
  })

  it('allows invitation activation without opening the rest of member administration', async () => {
    const page = await middleware(makeRequest(
      'https://sales.cyanlog.icu/accept-invitation?token=one-time',
      { host: 'sales.cyanlog.icu' },
    ))
    const api = await middleware(makeRequest(
      'https://sales.cyanlog.icu/api/auth/invitations/accept',
      { host: 'sales.cyanlog.icu' },
    ))
    const adminNeighbor = await middleware(makeRequest(
      'https://sales.cyanlog.icu/api/admin/users',
      { host: 'sales.cyanlog.icu' },
    ))

    expect(page.status).toBe(200)
    expect(api.status).toBe(200)
    expect(adminNeighbor.status).toBe(401)
  })

  it('allows exactly the account admission API while its handler owns the enable switch', async () => {
    const response = await middleware(makeRequest(
      'https://sales.cyanlog.icu/api/auth/login', { host: 'sales.cyanlog.icu' },
    ))
    const neighbor = await middleware(makeRequest(
      'https://sales.cyanlog.icu/api/auth/login-extra', { host: 'sales.cyanlog.icu' },
    ))
    expect(response.status).toBe(200)
    expect(neighbor.status).toBe(401)
  })

  it('returns explicit 404s for retired local password entrypoints', async () => {
    const legacyRegister = await middleware(
      makeRequest('https://sales.cyanlog.icu/api/auth', { host: 'sales.cyanlog.icu' }),
    )
    const registerAlias = await middleware(
      makeRequest('https://sales.cyanlog.icu/api/auth/register', { host: 'sales.cyanlog.icu' }),
    )
    const authProfile = await middleware(
      makeRequest('https://sales.cyanlog.icu/api/auth/me', { host: 'sales.cyanlog.icu' }),
    )
    const authPrefixNeighbor = await middleware(
      makeRequest('https://sales.cyanlog.icu/api/auth/login-extra', { host: 'sales.cyanlog.icu' }),
    )

    const retiredChangePassword = await middleware(
      makeRequest('https://sales.cyanlog.icu/api/auth/change-password', { host: 'sales.cyanlog.icu' }),
    )
    const retiredResetPassword = await middleware(
      makeRequest('https://sales.cyanlog.icu/api/admin/users/user-1/reset-password', { host: 'sales.cyanlog.icu' }),
    )
    expect(legacyRegister.status).toBe(404)
    expect(registerAlias.status).toBe(404)
    expect(retiredChangePassword.status).toBe(404)
    expect(retiredResetPassword.status).toBe(404)
    expect(authProfile.status).toBe(401)
    expect(authPrefixNeighbor.status).toBe(401)
  })

  it('uses exact public API matches for health and cron routes', async () => {
    const health = await middleware(
      makeRequest('https://sales.cyanlog.icu/api/health', { host: 'sales.cyanlog.icu' }),
    )
    const cron = await middleware(
      makeRequest('https://sales.cyanlog.icu/api/cron', { host: 'sales.cyanlog.icu' }),
    )
    const healthNeighbor = await middleware(
      makeRequest('https://sales.cyanlog.icu/api/health-extra', { host: 'sales.cyanlog.icu' }),
    )

    expect(health.status).toBe(200)
    expect(cron.status).toBe(200)
    expect(healthNeighbor.status).toBe(401)
  })

  it('opens only the exact signed CRM intake routes to their handler-level HMAC checks', async () => {
    const preflight = await middleware(
      makeRequest('https://sales.cyanlog.icu/api/shipping/crm/preflight', { host: 'sales.cyanlog.icu' }),
    )
    const orders = await middleware(
      makeRequest('https://sales.cyanlog.icu/api/shipping/crm/orders', { host: 'sales.cyanlog.icu' }),
    )
    const preflightNeighbor = await middleware(
      makeRequest('https://sales.cyanlog.icu/api/shipping/crm/preflight-extra', { host: 'sales.cyanlog.icu' }),
    )
    const ordersNeighbor = await middleware(
      makeRequest('https://sales.cyanlog.icu/api/shipping/crm/orders/extra', { host: 'sales.cyanlog.icu' }),
    )

    expect(preflight.status).toBe(200)
    expect(orders.status).toBe(200)
    expect(preflightNeighbor.status).toBe(401)
    expect(ordersNeighbor.status).toBe(401)
  })
})

describe('middleware exact organization authorization', () => {
  it('uses finite delegated admin authority only for the exact active organization', async () => {
    const token = 'delegated-org-admin'
    const role = { roles: { id: 'org-admin', code: 'ORG_SUPER_ADMIN', permissions: ['*'] } }
    const request = () => middleware(makeRequest('https://sales.cyanlog.icu/configs', { authorization: `Bearer ${token}` }))

    mockExactOrgAuth({ token, orgId: 'org-a', roles: [role] })
    const granted = await request()
    expect(granted.status).toBe(200)
    const permissions = granted.headers.get('x-middleware-request-x-user-permissions')?.split(',')
    expect(permissions).toContain('role:manage')
    expect(permissions).not.toContain('*')

    for (const state of [
      { roles: [{ ...role, org_id: 'org-b' }] },
      { roles: [{ ...role, scope_type: 'department' }] },
      { organizationStatus: 'inactive' },
      { memberships: [{ org_id: 'org-a', employment_status: 'active', left_at: '2026-11-01' }] },
    ]) {
      mockExactOrgAuth({ token, orgId: 'org-a', roles: [role], ...state })
      const denied = await request()
      expect(denied.headers.get('location')).toBe('https://sales.cyanlog.icu/pending-access')
      expect(denied.headers.get('x-middleware-request-x-user-permissions')).toBeNull()
    }
  })

  it('只把 default org 的权限写入可信下游请求头', async () => {
    const { fetchMock } = mockExactOrgAuth({
      token: 'scope-token-a',
      orgId: 'org-a',
      roles: [{ roles: { id: 'role-test', code: 'SALES', permissions: ['config:read'] } }],
    })
    const req = makeRequest('https://sales.cyanlog.icu/configs', { host: 'sales.cyanlog.icu' })
    req.cookies.get = vi.fn().mockReturnValue({ value: 'scope-token-a' })

    const res = await middleware(req)

    expect(res.status).toBe(200)
    const roleCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/rest/v1/user_roles?'))
    const roleUrl = new URL(String(roleCall?.[0]))
    expect(roleUrl.searchParams.getAll('scope_type')).toEqual(['eq.org'])
    expect(roleUrl.searchParams.getAll('scope_id')).toEqual(['eq.org-a'])
    expect(res.headers.get('x-middleware-request-x-user-permissions')).toBe('config:read')
    expect(res.headers.get('x-middleware-request-x-user-permissions')).not.toContain('*')
    expect(res.headers.get('x-middleware-request-x-org-id')).toBe('org-a')
  })

  it('只有其他组织或 null scope 的权限时拒绝访问配置中心', async () => {
    const { fetchMock } = mockExactOrgAuth({
      token: 'scope-token-b',
      orgId: 'org-a',
      roles: [],
    })
    const req = makeRequest('https://sales.cyanlog.icu/configs', { host: 'sales.cyanlog.icu' })
    req.cookies.get = vi.fn().mockReturnValue({ value: 'scope-token-b' })

    const res = await middleware(req)

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('https://sales.cyanlog.icu/pending-access')
    const roleCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/rest/v1/user_roles?'))
    expect(new URL(String(roleCall?.[0])).searchParams.getAll('scope_id')).toEqual(['eq.org-a'])
  })

  it('超管覆盖后的权限和兼容授权头都不重新获得通配符', async () => {
    mockExactOrgAuth({ token:'example-override-token', orgId:'org-a',
      roles:[{roles:{id:'root-role',code:'SUPER_ADMIN',permissions:['*']}}],
      settings:{role_permission_overrides:{'root-role':['config:read']}},
    })
    const req = makeRequest('https://sales.cyanlog.icu/configs', {host:'sales.cyanlog.icu'})
    req.cookies.get = vi.fn().mockReturnValue({value:'example-override-token'})
    const res = await middleware(req)
    expect(res.status).toBe(200)
    expect(res.headers.get('x-middleware-request-x-user-permissions')).toBe('config:read')
    expect(res.headers.get('x-middleware-request-x-user-role-codes')).toBe('SUPER_ADMIN')
    expect(res.headers.get('x-middleware-request-x-user-authorization-role-codes')).toBe('')
  })

  it('缺失角色ID的异常行不会恢复超管通配权限', async () => {
    mockExactOrgAuth({token:'example-missing-role-id',orgId:'org-a',
      roles:[{roles:{code:'SUPER_ADMIN',permissions:['*']}}],
      settings:{role_permission_overrides:{'root-role':[]}},
    })
    const req = makeRequest('https://sales.cyanlog.icu/configs', {host:'sales.cyanlog.icu'})
    req.cookies.get = vi.fn().mockReturnValue({value:'example-missing-role-id'})
    expect((await middleware(req)).headers.get('location')).toBe('https://sales.cyanlog.icu/pending-access')
  })

  it('空覆盖阻止超管访问后台且覆盖读取失败时关闭访问', async () => {
    mockExactOrgAuth({token:'example-empty-override',orgId:'org-a',
      roles:[{roles:{id:'root-role',code:'SUPER_ADMIN',permissions:['*']}}],
      settings:{role_permission_overrides:{'root-role':[]}},
    })
    const req = makeRequest('https://sales.cyanlog.icu/admin', {host:'sales.cyanlog.icu'})
    req.cookies.get = vi.fn().mockReturnValue({value:'example-empty-override'})
    expect((await middleware(req)).headers.get('location')).toContain('denied=admin%3Aaccess')
    mockExactOrgAuth({token:'example-empty-override',orgId:'org-a',roles:[],settingsError:new Error('read failed')})
    expect((await middleware(req)).status).toBe(503)
  })

  it('requires an unambiguous active default membership before reading tenant permissions', async () => {
    for (const memberships of [[], [
      { org_id: 'org-a', employment_status: 'active' },
      { org_id: 'org-b', employment_status: 'active' },
    ]]) {
      const { fetchMock } = mockExactOrgAuth({ token: 'example-membership', orgId: 'org-a', roles: [], memberships })
      const req = makeRequest('https://sales.cyanlog.icu/api/configs', { host: 'sales.cyanlog.icu' })
      req.cookies.get = vi.fn().mockReturnValue({ value: 'example-membership' })
      expect((await middleware(req)).status).toBe(401)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  })

  it('用户停用后旧 token 下一次请求立即失效', async () => {
    const { fetchMock } = mockExactOrgAuth({
      token: 'disabled-token',
      orgId: 'org-a',
      roles: [{ roles: { id: 'role-test', code: 'ADMIN', permissions: ['*'] } }],
      status: 'suspended',
      loginEnabled: false,
    })
    const req = makeRequest('https://sales.cyanlog.icu/api/admin/org', { host: 'sales.cyanlog.icu' })
    req.cookies.get = vi.fn().mockReturnValue({ value: 'disabled-token' })

    const res = await middleware(req)

    expect(res.status).toBe(401)
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/rest/v1/user_roles?'))).toBe(false)
  })
})

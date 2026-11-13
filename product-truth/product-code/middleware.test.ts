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

function mockExactOrgAuth(options: {
  token: string
  orgId: string
  roles: Array<{ roles: { id?: string; code: string; permissions: string[] } }>
  settings?: unknown
  settingsError?: unknown
  status?: string
  loginEnabled?: boolean
  authMethod?: 'local' | 'fxiaoke'
  employmentStatus?: string
  sourceIdentity?: 'authoritative' | 'evidence'
  shippingDirectGrant?: boolean
}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    const table = url.pathname.split('/').pop()
    if (table === 'auth_tokens') {
      return Response.json([{ user_id: 'user-1', expires_at: '2099-01-01T00:00:00.000Z', auth_method: options.authMethod ?? 'local' }])
    }
    if (table === 'users') {
      return Response.json([{
        id: 'user-1',
        org_id: 'legacy-org',
        must_change_password: false,
        status: options.status ?? 'active',
        login_enabled: options.loginEnabled ?? true,
      }])
    }
    if (table === 'user_organizations') {
      return Response.json([{ org_id: options.orgId, employment_status: options.employmentStatus ?? 'active' }])
    }
    if (table === 'user_roles') {
      return Response.json(options.roles)
    }
    if (table === 'organizations') {
      if (options.settingsError) {
        return new Response('settings unavailable', { status: 503 })
      }
      return Response.json([{ settings: options.settings ?? {} }])
    }
    if (table === 'organization_sources') {
      return Response.json([{
        authority_scope: { identity: options.sourceIdentity ?? 'authoritative' },
        connection_state: 'verified', effective_revision: 'revision-1',
      }])
    }
    if (table === 'permission_points') return Response.json([{ id: 'shipping-point' }])
    if (table === 'user_permission_assignments') return Response.json(options.shippingDirectGrant ? [{ id: 'shipping-grant' }] : [])
    return new Response(`unexpected table ${table}`, { status: 500 })
  })

  vi.stubGlobal('fetch', fetchMock)
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example.test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test'

  return { fetchMock }
}

describe('middleware host routing', () => {
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
    expect((await middleware(request('/api/shipping/owner/orders', 'POST'))).status).toBe(200)
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

  it('respects a separate shipping operator grant on the batch API', async () => {
    mockExactOrgAuth({ token: 'operator-token', orgId: 'org-a', authMethod: 'fxiaoke', shippingDirectGrant: true,
      roles: [{ roles: { id: 'baseline', code: 'FXIAOKE_BASELINE', permissions: ['quote:view', 'contract:view', 'customer:view'] } }] })
    const req = makeRequest('https://sales.cyanlog.icu/api/shipping/orders', { host: 'sales.cyanlog.icu' }, 'POST')
    req.cookies.get = vi.fn().mockReturnValue({ value: 'operator-token' })
    expect((await middleware(req)).status).toBe(200)
  })

  it.each([
    [{ id: 'readonly', code: 'READONLY', permissions: ['quote:view', 'contract:view', 'customer:view'] }],
    [
      { id: 'baseline', code: 'FXIAOKE_BASELINE', permissions: ['quote:view', 'contract:view', 'customer:view'] },
      { id: 'readonly', code: 'READONLY', permissions: ['quote:view', 'contract:view', 'customer:view'] },
    ],
  ])('keeps a federated viewer read-only with role set %j', async (...roleRecords) => {
    mockExactOrgAuth({
      token: 'viewer-token', orgId: 'org-a', authMethod: 'fxiaoke',
      roles: roleRecords.map(role => ({ roles: role })),
    })
    const request = (path: string, method = 'GET') => {
      const req = makeRequest(`https://sales.cyanlog.icu${path}`, { host: 'sales.cyanlog.icu' }, method)
      req.cookies.get = vi.fn().mockReturnValue({ value: 'viewer-token' })
      return req
    }
    expect((await middleware(request('/api/quotes'))).status).toBe(200)
    expect((await middleware(request('/api/cases'))).status).toBe(403)
    expect((await middleware(request('/api/quotes', 'POST'))).status).toBe(403)
    expect((await middleware(request('/api/contracts/example', 'PATCH'))).status).toBe(403)
    expect((await middleware(request('/api/shipping/orders', 'POST'))).status).toBe(403)
    expect((await middleware(request('/api/shipping/owner/orders', 'POST'))).status)
      .toBe(roleRecords.some(role => role.code === 'FXIAOKE_BASELINE') ? 200 : 403)
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
  it('allows only the waiting page and sign-out while blocking business pages and APIs', async () => {
    mockExactOrgAuth({ token: 'role-free-token', orgId: 'org-a', roles: [], authMethod: 'fxiaoke' })
    const headers = { host: 'sales.cyanlog.icu' }
    const makeAuthed = (path: string) => {
      const req = makeRequest(`https://sales.cyanlog.icu${path}`, headers)
      req.cookies.get = vi.fn().mockReturnValue({ value: 'role-free-token' })
      return req
    }

    expect((await middleware(makeAuthed('/pending-access'))).status).toBe(200)
    expect((await middleware(makeAuthed('/api/auth/logout'))).status).toBe(200)
    const page = await middleware(makeAuthed('/quotes'))
    expect(page.status).toBe(307)
    expect(page.headers.get('location')).toBe('https://sales.cyanlog.icu/pending-access')
    const api = await middleware(makeAuthed('/api/quotes'))
    expect(api.status).toBe(403)
    expect((await api.json()).code).toBe('ROLE_REQUIRED')
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

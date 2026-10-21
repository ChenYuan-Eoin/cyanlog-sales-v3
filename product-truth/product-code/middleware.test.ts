import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(),
  })),
}))

import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { middleware } from './middleware'

function makeRequest(url: string, headers: Record<string, string> = {}): NextRequest {
  const nextUrl = new URL(url) as URL & { clone: () => URL }
  nextUrl.clone = () => new URL(nextUrl.toString())
  const request = {
    nextUrl,
    headers: new Headers(headers),
    cookies: {
      get: vi.fn(),
    },
    url,
  } as unknown as NextRequest

  return request
}

const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

afterEach(() => {
  vi.clearAllMocks()
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

function queryBuilder(result: { data: unknown; error?: unknown }, terminal: 'single' | 'maybeSingle' | 'await') {
  const query: Record<string, unknown> = {}
  query.select = vi.fn(() => query)
  query.eq = vi.fn(() => query)
  if (terminal === 'single') {
    query.single = vi.fn().mockResolvedValue(result)
  } else if (terminal === 'maybeSingle') {
    query.maybeSingle = vi.fn().mockResolvedValue(result)
  } else {
    query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => (
      Promise.resolve(result).then(resolve, reject)
    )
  }
  return query as Record<string, ReturnType<typeof vi.fn>> & PromiseLike<unknown>
}

function mockExactOrgAuth(options: {
  token: string
  orgId: string
  roles: Array<{ roles: { id?: string; code: string; permissions: string[] } }>
  settings?: unknown
  settingsError?: unknown
  status?: string
  loginEnabled?: boolean
}) {
  const tokenQuery = queryBuilder({
    data: { user_id: 'user-1', expires_at: '2099-01-01T00:00:00.000Z' },
  }, 'single')
  const userQuery = queryBuilder({
    data: {
      id: 'user-1',
      org_id: 'legacy-org',
      must_change_password: false,
      status: options.status ?? 'active',
      login_enabled: options.loginEnabled ?? true,
    },
  }, 'maybeSingle')
  const membershipQuery = queryBuilder({ data: { org_id: options.orgId }, error: null }, 'maybeSingle')
  const rolesQuery = queryBuilder({ data: options.roles }, 'await')
  const organizationQuery = queryBuilder({ data: {settings: options.settings ?? {}}, error: options.settingsError }, 'maybeSingle')
  const from = vi.fn((table: string) => {
    if (table === 'auth_tokens') return tokenQuery
    if (table === 'users') return userQuery
    if (table === 'user_organizations') return membershipQuery
    if (table === 'user_roles') return rolesQuery
    if (table === 'organizations') return organizationQuery
    throw new Error(`unexpected table ${table}`)
  })

  vi.mocked(createClient).mockReturnValue({ from } as never)
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example.test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test'

  return { from, rolesQuery }
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

describe('middleware public API routing', () => {
  it('keeps the sales portal public while protecting the operator workbench', async () => {
    const portal = await middleware(makeRequest('https://sales.cyanlog.icu/sales-portal', { host: 'sales.cyanlog.icu' }))
    const workbench = await middleware(makeRequest('https://sales.cyanlog.icu/shipping', { host: 'sales.cyanlog.icu' }))
    expect(portal.status).toBe(200)
    expect(workbench.status).toBe(307)
    expect(workbench.headers.get('location')).toBe('https://sales.cyanlog.icu/login')
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

  it('allows both registration entrypoints without opening every auth API route', async () => {
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

    expect(legacyRegister.status).toBe(200)
    expect(registerAlias.status).toBe(200)
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
})

describe('middleware exact organization authorization', () => {
  it('只把 default org 的权限写入可信下游请求头', async () => {
    const { rolesQuery } = mockExactOrgAuth({
      token: 'scope-token-a',
      orgId: 'org-a',
      roles: [{ roles: { id: 'role-test', code: 'SALES', permissions: ['config:read'] } }],
    })
    const req = makeRequest('https://sales.cyanlog.icu/configs', { host: 'sales.cyanlog.icu' })
    req.cookies.get = vi.fn().mockReturnValue({ value: 'scope-token-a' })

    const res = await middleware(req)

    expect(res.status).toBe(200)
    expect(rolesQuery.eq).toHaveBeenCalledWith('scope_type', 'org')
    expect(rolesQuery.eq).toHaveBeenCalledWith('scope_id', 'org-a')
    expect(res.headers.get('x-middleware-request-x-user-permissions')).toBe('config:read')
    expect(res.headers.get('x-middleware-request-x-user-permissions')).not.toContain('*')
    expect(res.headers.get('x-middleware-request-x-org-id')).toBe('org-a')
  })

  it('只有其他组织或 null scope 的权限时拒绝访问配置中心', async () => {
    const { rolesQuery } = mockExactOrgAuth({
      token: 'scope-token-b',
      orgId: 'org-a',
      roles: [],
    })
    const req = makeRequest('https://sales.cyanlog.icu/configs', { host: 'sales.cyanlog.icu' })
    req.cookies.get = vi.fn().mockReturnValue({ value: 'scope-token-b' })

    const res = await middleware(req)

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('denied=config%3Aread')
    expect(rolesQuery.eq).toHaveBeenCalledWith('scope_id', 'org-a')
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
    expect((await middleware(req)).headers.get('location')).toContain('denied=config%3Aread')
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
    expect((await middleware(req)).status).toBe(307)
  })

  it('用户停用后旧 token 下一次请求立即失效', async () => {
    const { from } = mockExactOrgAuth({
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
    expect(from).not.toHaveBeenCalledWith('user_organizations')
    expect(from).not.toHaveBeenCalledWith('user_roles')
  })
})

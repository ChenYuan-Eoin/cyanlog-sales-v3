// 认证与权限中间件 — Next.js Edge Runtime
// REQ: F003 自主可控 + RBAC
//
// 【技术选型】
// - Next.js Middleware (Edge Runtime): 请求拦截层
//   备选：API Route内校验（每个路由重复代码，容易遗漏）
//   权衡：
//   1. Middleware在路由匹配前执行，统一拦截所有请求
//   2. Edge Runtime冷启动快（<1ms），适合高频认证检查
//   3. 但Edge有Runtime限制（无Node.js完整API，如fs/crypto部分方法）
//   4. 需要在Edge和Node.js之间平衡：认证逻辑放Edge，复杂业务放API Route
//
// - JWT Token存储: PostgreSQL (auth_tokens表) 而非纯内存
//   备选：Redis（更快，但增加依赖）/ 纯JWT无状态（无法强制失效）
//   权衡：
//   1. 需要支持"强制用户下线"（Token失效）
//   2. 需要支持Token过期自动清理
//   3. PostgreSQL事务一致性，与业务数据同库便于JOIN
//
// - 权限模型: RBAC + 数据范围隔离（org/department/space）
//   备选：ABAC属性权限（更灵活，但复杂度高）
//   权衡：
//   1. 销售系统角色相对固定（销售/经理/管理员），RBAC足够
//   2. 数据范围（org_id/department_id）作为查询条件，而非权限表达式
//   3. 实现简单，查询可优化（加索引），避免规则引擎性能开销
//
// - Host重定向: 多入口架构（quote.cyanlog.icu/contract.cyanlog.icu）
//   原因：不同业务角色有习惯性入口（销售进报价，法务进合同）
//   实现：DNS指向同一服务，Middleware根据Host重定向到对应路径

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getRequestAuthToken } from '@/lib/auth-token'
import { getConfigsTabAccess, hasConfigsTabAccess } from '@/lib/configs/tab-access'
import { createMiddlewareRestClient, type MiddlewareRestClient } from '@/lib/middleware-rest-client'
import {
  canAccessOrgAdmin, canReadRoleDirectory, hasConfigurationReadPermission, hasOrganizationSourcePermission,
  hasOrgDepartmentDirectoryPermission, hasPermission, isSystemAuthorizationGrant, ORG_MEMBER_EDIT,
} from '@/lib/permissions'
import {
  ORG_MEMBER_INVITE, ORG_MEMBER_MANAGE_EMPLOYMENT, ORG_MEMBER_MANAGE_LOGIN, ORG_MEMBER_REMOVE_MEMBERSHIP,
} from '@/lib/admin/member-action-keys'
import { FXIAOKE_BASELINE_ROLE_CODE, isRoleAssignableInScope, ORG_SUPER_ADMIN_ROLE_CODE, resolveOwnerShippingPermissions, resolveRolePermissions, SHIPPING_OPERATOR_ROLE_CODE } from '@/lib/role-permission-resolution'
import {
  getEffectiveOwnerShippingPermissions,
  getEffectiveShippingPermissions,
  getShippingPermissionPublication,
  hasRestrictedShippingRoleSet,
  MODULE_PERMISSION_ROW_FIELDS,
  legacyShippingPermission,
  SHIPPING_MANAGE_CONNECTIONS,
  SHIPPING_SETTINGS_ACTION_KEYS,
  shippingActionViewDependency,
  shippingOwnerPermissionRequirement,
  shippingPermissionRequirement,
  type ShippingPermissionKey,
} from '@/lib/module-access'
import { sessionDeadline } from '@/lib/auth/fxiaoke-session'
import { DEPARTMENT_LEDGER_VIEW, isDepartmentLedgerReadPath, loadDepartmentLedgerScope } from '@/lib/shipping/department-ledger-access'

const PUBLIC_PATHS = ['/login', '/accept-invitation']
const RETIRED_EXACT_PATHS = new Set([
  '/register',
  '/change-password',
  '/api/auth',
  '/api/auth/register',
  '/api/auth/prewarm',
  '/api/auth/change-password',
])
const PRIMARY_HOST = 'sales.cyanlog.icu'
const HOST_REDIRECTS: Record<string, { rootPath: string; preservePath: boolean }> = {
  'cyanlog-sales-v3-git-production-eoins-projects-94b17ece.vercel.app': { rootPath: '/', preservePath: true },
  'quote.cyanlog.icu': { rootPath: '/quotes', preservePath: true },
  'contract.cyanlog.icu': { rootPath: '/contracts', preservePath: true },
  'cyanlog.icu': { rootPath: '/', preservePath: true },
  'www.cyanlog.icu': { rootPath: '/', preservePath: true },
}
const PUBLIC_API_PATHS = new Set([
  '/api/auth/providers',
  '/api/auth/login',
  '/api/auth/fxiaoke/start',
  '/api/auth/fxiaoke/callback',
  '/api/auth/invitations/accept',
  '/api/client-errors',
  '/api/contracts/process',
  '/api/health',
  '/api/health/flight-ready',
  '/api/cron',
  // Exact machine-to-machine CRM intake routes. Authentication and tenant
  // mapping are enforced by the route handlers with an HMAC request contract.
  '/api/shipping/crm/preflight',
  '/api/shipping/crm/orders',
  // Scoped machine credential is checked in the handler; no interactive user session.
  '/api/admin/organization-sources/fxiaoke/egress',
])
// REQ: F003 自主可控 + RBAC
// 路径 → 所需权限（路由级权限，权限可配置于 roles.permissions）
const ROUTE_PERMISSIONS: Record<string, string> = {
  '/configs': 'config:read',
  '/admin': 'admin:access',
  '/api/configs': 'config:read',
  '/api/config-center': 'config:read',
  '/api/admin': 'admin:access',
  '/api/roles': 'config:read',
  '/api/rules': 'config:read',
}

type MiddlewareAuthContext = {
  userId: string
  orgId: string
  authMethod: 'local' | 'fxiaoke'
  roleCodes: string[]
  authorizationRoleCodes: string[]
  allPermissions: string[]
  shippingPermissions: string[]
  ownerShippingPermissions: string[]
  activeMembership: boolean
  departmentWorkspaceAccess: boolean
  departmentLedgerAccess: boolean
  canManageSystemAuthorizations: boolean
}

type FxiaokeSourceRow = {
  authority_scope: { identity?: unknown } | null
  connection_state: string
  effective_revision: string | null
}


function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.some(p => pathname === p)) return true
  if (pathname.startsWith('/api/')) {
    const authenticatedIntakePath = pathname === '/api/shipping/public/options'
      || pathname === '/api/shipping/public/orders'
      || pathname.startsWith('/api/shipping/public/orders/')
    return PUBLIC_API_PATHS.has(pathname)
      || (pathname.startsWith('/api/shipping/public/') && !authenticatedIntakePath)
  }
  return pathname.startsWith('/_next/')
    || pathname.startsWith('/favicon')
    || pathname.startsWith('/brand/')
}

function isRetiredAuthPath(pathname: string): boolean {
  return RETIRED_EXACT_PATHS.has(pathname)
    || /^\/api\/admin\/users\/[^/]+\/reset-password$/.test(pathname)
}

function getRequiredPermission(pathname: string): string | null {
  for (const [prefix, perm] of Object.entries(ROUTE_PERMISSIONS)) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) return perm
  }
  return null
}

const DEPARTMENT_WORKSPACE_READ_PATHS = new Set([
  '/', '/api/auth/me', '/api/navigation', '/api/dashboard', '/api/dashboard/department', '/api/dashboard/department/roster',
])
const DEPARTMENT_LEDGER_ENTRY_PATHS = new Set(['/', '/shipping', '/api/auth/me', '/api/navigation'])
const SHIPPING_ONLY_SESSION_READ_PATHS = new Set([
  '/shipping', '/sales-portal', '/profile', '/pending-access', '/api/auth/me', '/api/auth/context', '/api/navigation',
])

const BASELINE_READ_PATHS = new Set([
  '/api/auth/me', '/api/auth/context', '/api/dashboard', '/api/navigation',
  '/api/dashboard/department', '/api/dashboard/department/roster',
  '/api/quotes', '/api/contracts', '/api/contracts/drafts',
  '/api/tenders', '/api/knowledge/tree', '/api/knowledge/pages',
  '/api/agenda', '/api/opportunities', '/api/products',
  '/api/shipping/owner/profile', '/api/shipping/owner/orders',
])

const departmentDetailPath = /^\/api\/admin\/departments\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const memberDetailPath = /^\/api\/admin\/users\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/([a-z-]+))?$/i
const memberAuthorizationPaths = new Set(['roles', 'role-scopes', 'system-super-admin', 'org-super-admin'])
const memberPathPermissions: Partial<Record<string, readonly string[]>> = {
  'PATCH ': [ORG_MEMBER_EDIT, ORG_MEMBER_MANAGE_LOGIN, ORG_MEMBER_MANAGE_EMPLOYMENT],
  'DELETE ': [ORG_MEMBER_MANAGE_EMPLOYMENT],
  'PATCH report-to': [ORG_MEMBER_EDIT],
  'POST departments': [ORG_MEMBER_EDIT],
  'DELETE departments': [ORG_MEMBER_EDIT],
  'POST invitations': [ORG_MEMBER_INVITE],
  'DELETE invitations': [ORG_MEMBER_INVITE],
  'PATCH login-enabled': [ORG_MEMBER_MANAGE_LOGIN],
  'POST restore': [ORG_MEMBER_MANAGE_EMPLOYMENT],
  'DELETE membership': [ORG_MEMBER_REMOVE_MEMBERSHIP],
}

function isSystemAuthorizationPath(pathname: string, request: NextRequest): boolean {
  if (pathname === '/api/roles') return request.nextUrl.searchParams.get('view') === 'assignable'
  if (pathname.startsWith('/api/roles/') && request.method === 'PATCH') return true
  if (pathname === '/api/admin/departments/leader-access' || pathname === '/api/admin/departments/shipping-intake') return true
  if (pathname.endsWith('/permissions') && departmentDetailPath.test(pathname.slice(0, -'/permissions'.length))) return true
  const memberPath = memberDetailPath.exec(pathname)?.[1]
  return !!memberPath && memberAuthorizationPaths.has(memberPath)
}

function hasMemberRoutePermission(pathname: string, method: string, permissions: string[]): boolean {
  if (!hasPermission(permissions, 'user:view')) return false
  const read = method === 'GET' || method === 'HEAD'
  if (read && (pathname === '/api/admin/org' || pathname === '/api/admin/users')) return true
  if (pathname === '/api/admin/users' && method === 'POST') return hasPermission(permissions, ORG_MEMBER_INVITE)
  const detail = memberDetailPath.exec(pathname)
  return !!detail && (memberPathPermissions[method + ' ' + (detail[1] ?? '')]
    ?.some(permission => hasPermission(permissions, permission)) ?? false)
}

// These read handlers already apply the current organization, owner or
// explicit knowledge-page scope. Other legacy GET handlers may return every
// row through the service client and need a separate scope review first.
const returnedOwnerOrderPath = /^\/api\/shipping\/owner\/orders\/SO-\d{8}-[A-Z0-9]{8}\/resubmit$/
const ownerCarrierChanges = /^\/api\/shipping\/owner\/orders\/SO-\d{8}-[A-Z0-9]{8}\/carrier-changes$/

function baselineReadAllowed(pathname: string): boolean {
  if (BASELINE_READ_PATHS.has(pathname) || returnedOwnerOrderPath.test(pathname) || ownerCarrierChanges.test(pathname)) return true
  return /^\/api\/quotes\/[^/]+$/.test(pathname)
    || /^\/api\/contracts\/[^/]+$/.test(pathname)
    || /^\/api\/knowledge\/pages\/[^/]+$/.test(pathname)
    || /^\/api\/shipping\/public\/orders\/[^/]+$/.test(pathname)
}

function buildRedirectUrl(request: NextRequest, pathname: string, search = ''): URL {
  const url = request.nextUrl.clone()
  const requestHost = request.headers.get('host')

  url.pathname = pathname
  url.search = search

  if (requestHost) {
    url.host = requestHost
    if (requestHost.includes('localhost') || requestHost.startsWith('127.0.0.1')) {
      url.protocol = 'http:'
    }
  }

  return url
}

function roleRecordOf(value: unknown): { id: string; code: string; permissions: string[] | null } | null {
  if (Array.isArray(value)) {
    return value.length === 1 ? roleRecordOf(value[0]) : null
  }
  if (!value || typeof value !== 'object') return null
  return value as { id: string; code: string; permissions: string[] | null }
}

type DepartmentScopeRow = { id: string; org_id: string; status: string; leader_id?: string }

async function canEnterDepartmentWorkspace(
  rest: MiddlewareRestClient,
  userId: string,
  orgId: string,
  organizationSettings: unknown,
): Promise<boolean> {
  const assignments = await rest.selectRows<{
    org_id: string; user_id: string; scope_type: string; scope_id: string | null; roles: unknown
  }>(
    'user_roles', { user_id: userId, org_id: orgId, scope_type: 'department' },
    'org_id,user_id,scope_type,scope_id,roles:roles(id,code,permissions)', 1000,
  )
  const departmentIds = new Set<string>()
  for (const assignment of assignments) {
    if (assignment.org_id !== orgId || assignment.user_id !== userId || assignment.scope_type !== 'department' || !assignment.scope_id) continue
    if (Array.isArray(assignment.roles) && assignment.roles.length !== 1) continue
    const role = roleRecordOf(assignment.roles)
    if (!role?.id || !role.code || ['SUPER_ADMIN', ORG_SUPER_ADMIN_ROLE_CODE, FXIAOKE_BASELINE_ROLE_CODE].includes(role.code)
      || !isRoleAssignableInScope(role.code, 'department')) continue
    const { permissions } = resolveRolePermissions(organizationSettings, role)
    if (permissions.includes('dept:view') || permissions.includes('report:dept')) departmentIds.add(assignment.scope_id)
  }
  for (const departmentId of departmentIds) {
    const [department] = await rest.selectRows<DepartmentScopeRow>(
      'departments', { id: departmentId, org_id: orgId, status: 'active' }, 'id,org_id,status',
    )
    if (department?.id === departmentId && department.org_id === orgId && department.status === 'active') return true
  }

  try {
    const [access] = await rest.selectRows<{
      org_id: string; user_id: string; department_id: string; department: DepartmentScopeRow | null
    }>(
      'department_lead_access',
      { org_id: orgId, user_id: userId, 'department.org_id': orgId, 'department.status': 'active', 'department.leader_id': userId },
      'org_id,user_id,department_id,department:departments!department_lead_access_department_id_fkey!inner(id,org_id,status,leader_id)',
    )
    return !!access?.department && access.org_id === orgId && access.user_id === userId
      && access.department.id === access.department_id && access.department.org_id === orgId
      && access.department.status === 'active' && access.department.leader_id === userId
  } catch (error) {
    // The table may be absent before the department lead migration reaches this environment.
    if (error instanceof Error && error.message === 'auth middleware query failed: department_lead_access returned 404') return false
    throw error
  }
}

async function loadMiddlewareAuthContext(token: string, checkDepartmentWorkspace: boolean, checkDepartmentLedger: boolean): Promise<MiddlewareAuthContext | null> {
  const rest = createMiddlewareRestClient()
  const tokenRows = await rest.selectRows<{
    user_id: string
    created_at?: string
    expires_at: string | null
    auth_method?: string
    user: {
      id: string
      status: string
      login_enabled: boolean | null
      memberships: Array<{ org_id: string; is_default: boolean; status: string; employment_status: string; left_at: string | null }>
    } | null
  }>(
    'auth_tokens',
    { token, 'user.memberships.status': 'active', 'user.memberships.is_default': 'true' },
    'user_id,created_at,expires_at,auth_method,user:users!auth_tokens_user_id_fkey('
      + 'id,status,login_enabled,memberships:user_organizations!user_organizations_user_id_fkey(org_id,is_default,status,employment_status,left_at))',
  )
  const tokenRecord = tokenRows[0]
  if (!tokenRecord || (tokenRecord.expires_at && new Date(tokenRecord.expires_at) < new Date())) return null

  const usesFxiaoke = tokenRecord.auth_method === 'fxiaoke'
  if (['local', 'fxiaoke'].includes(tokenRecord.auth_method || '') && !sessionDeadline(tokenRecord)) return null

  const userId = tokenRecord.user_id
  const user = tokenRecord.user
  if (!user || user.id !== userId || user.status !== 'active' || user.login_enabled !== true) return null
  if (user.memberships?.length !== 1) return null
  const membership = user.memberships[0]
  const orgId = membership.org_id
  if (!orgId || membership.is_default !== true || membership.status !== 'active'
    || (usesFxiaoke && membership.employment_status !== 'active')) return null

  const [userRolesData, organizationRows, sources] = await Promise.all([
    rest.selectRows<{ org_id: string; user_id: string; scope_type: string; scope_id: string | null; roles: unknown }>(
      'user_roles',
      { user_id: userId, org_id: orgId, scope_type: 'org', scope_id: orgId },
      'org_id,user_id,scope_type,scope_id,roles:roles(id,code,permissions)',
      100,
    ),
    rest.selectRows<{ status: string; settings: unknown }>('organizations', { id: orgId }, 'status,settings'),
    usesFxiaoke ? rest.selectRows<FxiaokeSourceRow>(
      'organization_sources',
      { system_org_id: orgId, provider: 'fxiaoke', status: 'active' },
      'authority_scope,connection_state,effective_revision',
      2,
    ) : [],
  ])
  if (usesFxiaoke && (sources.length !== 1 || sources[0].authority_scope?.identity !== 'authoritative'
    || !sources[0].effective_revision)) return null

  const organization = organizationRows[0]
  if (!organization) throw new Error('auth middleware organization permissions unavailable')

  const allPermissions: string[] = []
  const ownerShippingPermissions: string[] = []
  const roleCodes: string[] = []
  const authorizationRoleCodes: string[] = []
  const activeMembership = organization.status === 'active'
    && membership.employment_status === 'active' && membership.left_at === null
  let canManageSystemAuthorizations = false

  for (const ur of userRolesData ?? []) {
    if (ur.org_id !== orgId || ur.user_id !== userId || ur.scope_type !== 'org' || ur.scope_id !== orgId) continue
    const r = roleRecordOf(ur.roles)
    if (r?.id && r.code) {
      if (r.code === FXIAOKE_BASELINE_ROLE_CODE) continue
      if (!activeMembership && ['SUPER_ADMIN', ORG_SUPER_ADMIN_ROLE_CODE, SHIPPING_OPERATOR_ROLE_CODE].includes(r.code)) continue
      const effective = resolveRolePermissions(organization.settings, r)
      const ownerPermissions = usesFxiaoke && activeMembership ? resolveOwnerShippingPermissions(organization.settings, r) : []
      if (!effective.permissions.length && !ownerPermissions.length) continue
      roleCodes.push(r.code)
      canManageSystemAuthorizations ||= activeMembership && isSystemAuthorizationGrant(r.code, effective.permissions)
      allPermissions.push(...effective.permissions)
      ownerShippingPermissions.push(...ownerPermissions)
      if (!effective.overridden) authorizationRoleCodes.push(r.code)
    }
  }

  const departmentWorkspaceAccess = checkDepartmentWorkspace && activeMembership && roleCodes.length === 0
    && await canEnterDepartmentWorkspace(rest, userId, orgId, organization.settings)
  const departmentLedgerAccess = checkDepartmentLedger && activeMembership
    && (await readShippingPermissionPublication(new Set([DEPARTMENT_LEDGER_VIEW]))).departmentLedgerPublished
    && (await loadDepartmentLedgerScope(rest, orgId, userId, organization.settings)).length > 0

  return {
    userId,
    orgId,
    authMethod: tokenRecord.auth_method === 'fxiaoke' ? 'fxiaoke' : 'local',
    roleCodes,
    authorizationRoleCodes,
    allPermissions,
    shippingPermissions: activeMembership ? allPermissions : [],
    ownerShippingPermissions,
    activeMembership,
    departmentWorkspaceAccess,
    departmentLedgerAccess,
    canManageSystemAuthorizations,
  }
}

async function getMiddlewareAuthContext(token: string, checkDepartmentWorkspace: boolean, checkDepartmentLedger: boolean): Promise<MiddlewareAuthContext | null> {
  // A disabled user or revoked token must stop working on the next request;
  // an isolate-local cache cannot provide that guarantee.
  return loadMiddlewareAuthContext(token, checkDepartmentWorkspace, checkDepartmentLedger)
}

async function readShippingPermissionPublication(codes: ReadonlySet<string>) {
  const rest = createMiddlewareRestClient()
  const rows = (await Promise.all(Array.from(codes, code =>
    rest.selectRows<unknown>('permission_points', { code }, MODULE_PERMISSION_ROW_FIELDS, 2)
  ))).flat()
  return getShippingPermissionPublication(rows)
}

async function allowsShippingPermission(grants: string[], required: readonly ShippingPermissionKey[]): Promise<boolean> {
  const relevant = new Set<string>()
  for (const key of required) {
    const legacy = legacyShippingPermission(key)
    const hasLegacy = legacy !== null && hasPermission(grants, legacy)
    if (!hasLegacy && !hasPermission(grants, key)) continue

    relevant.add(key)
    if (hasLegacy) relevant.add(legacy)
    const dependency = shippingActionViewDependency(key)
    if (dependency) relevant.add(dependency)
  }
  if (!relevant.size) return false
  const allowed = getEffectiveShippingPermissions(grants, await readShippingPermissionPublication(relevant))
  return required.some(key => allowed.includes(key))
}

async function allowsShippingOwnerPermission(grants: string[], required: NonNullable<ReturnType<typeof shippingOwnerPermissionRequirement>>) {
  if (!grants.includes(required) || !grants.includes('shipping:owner_view')) return false
  const publication = await readShippingPermissionPublication(new Set([required, 'shipping:owner_view']))
  return getEffectiveOwnerShippingPermissions(grants, publication).includes(required)
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const host = request.headers.get('host')?.toLowerCase()
  const redirectRule = host ? HOST_REDIRECTS[host] : undefined

  if (redirectRule) {
    const url = request.nextUrl.clone()
    url.protocol = 'https:'
    url.host = PRIMARY_HOST
    url.pathname = redirectRule.preservePath && pathname !== '/' ? pathname : redirectRule.rootPath
    return NextResponse.redirect(url, 308)
  }

  if (isRetiredAuthPath(pathname)) {
    return pathname.startsWith('/api/')
      ? NextResponse.json({ error: 'Not Found' }, { status: 404 })
      : new NextResponse('Not Found', { status: 404 })
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next()
  }

  const token = getRequestAuthToken(request)

  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.redirect(buildRedirectUrl(request, '/login'))
  }

  try {
    const required = getRequiredPermission(pathname)
    // Authorization always comes from the exact current-org database context.
    // The signed cookie remains a login warmup artifact, but is not a permission
    // source until default-org changes can invalidate it atomically.
    const read = request.method === 'GET' || request.method === 'HEAD'
    const ledgerPath = read && isDepartmentLedgerReadPath(pathname)
    const checkDepartmentWorkspace = read && DEPARTMENT_WORKSPACE_READ_PATHS.has(pathname)
    const checkDepartmentLedger = ledgerPath || (read && DEPARTMENT_LEDGER_ENTRY_PATHS.has(pathname))
    const authContext = await getMiddlewareAuthContext(token, checkDepartmentWorkspace, checkDepartmentLedger)

    if (!authContext) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      return NextResponse.redirect(buildRedirectUrl(request, '/login'))
    }

    // Session management is authenticated but does not require a business role.
    if (pathname === '/api/auth/activity' && ['GET', 'POST'].includes(request.method)) return NextResponse.next()

    // A role-free member can wait for authorization and read their own profile.
    if (pathname === '/' && authContext.roleCodes.length === 0
      && authContext.departmentLedgerAccess && !authContext.departmentWorkspaceAccess) {
      return NextResponse.redirect(buildRedirectUrl(request, '/shipping'))
    }
    if (authContext.roleCodes.length === 0 && !authContext.departmentWorkspaceAccess && !authContext.departmentLedgerAccess) {
      if (pathname === '/pending-access' || pathname === '/api/auth/logout') return NextResponse.next()
      if (pathname === '/api/profile' && ['GET', 'HEAD'].includes(request.method)) return NextResponse.next()
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: '尚未分配业务权限', code: 'ROLE_REQUIRED' }, { status: 403 })
      }
      return NextResponse.redirect(buildRedirectUrl(request, '/pending-access'))
    }

    // An operational shipping role adds only the matching shipping actions.
    const restrictedMember = (authContext.authMethod === 'fxiaoke' || authContext.roleCodes.includes(SHIPPING_OPERATOR_ROLE_CODE))
      && hasRestrictedShippingRoleSet(authContext.roleCodes)
    const shippingOnly = authContext.roleCodes.length > 0
      && authContext.allPermissions.every(permission => permission.startsWith('shipping:'))
    const ownerPermission = shippingOwnerPermissionRequirement(pathname, request.method)
    const receiptLookup = read && /^\/api\/shipping\/public\/orders\/[^/]+$/.test(pathname)
    // The receipt handler distinguishes actor-owned orders from old anonymous bearer receipts.
    if (ownerPermission && !await allowsShippingOwnerPermission(authContext.ownerShippingPermissions, ownerPermission)
      && !(receiptLookup && authContext.activeMembership
        && await allowsShippingPermission(authContext.shippingPermissions, ['shipping:ledger_view']))) {
      return NextResponse.json({ error: 'Forbidden', required: ownerPermission }, {
        status: 403, headers: { 'Cache-Control': 'private, no-store' },
      })
    }
    const shippingPermission = ledgerPath ? DEPARTMENT_LEDGER_VIEW
      : shippingPermissionRequirement(pathname, request.method, request.nextUrl.searchParams.get('workspace') === '1')
    const shippingSettingsWrite = request.method === 'POST' && pathname === '/api/shipping/settings'
    const requiredShipping: readonly ShippingPermissionKey[] = shippingSettingsWrite
      ? [...SHIPPING_SETTINGS_ACTION_KEYS.slice(1), SHIPPING_MANAGE_CONNECTIONS]
      : shippingPermission ? [shippingPermission] : []
    if (requiredShipping.length && !(ledgerPath && authContext.departmentLedgerAccess)
      && !await allowsShippingPermission(authContext.shippingPermissions, requiredShipping)) {
      return pathname.startsWith('/api/')
        ? NextResponse.json({ error: 'Forbidden', required: requiredShipping[0] }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } })
        : NextResponse.redirect(buildRedirectUrl(request, '/', '?denied=shipping'))
    }

    const configurationTabs = pathname === '/configs' ? getConfigsTabAccess({
      permissions: authContext.allPermissions,
      roleCodes: authContext.roleCodes,
      authorizationRoleCodes: authContext.authorizationRoleCodes,
    }) : null
    const shippingSettingsView = configurationTabs !== null
      && await allowsShippingPermission(authContext.shippingPermissions, ['shipping:settings_view']).catch(error => {
        if (hasConfigsTabAccess(configurationTabs)) return false
        throw error
      })
    const configurationShell = configurationTabs !== null
      && hasConfigsTabAccess({ ...configurationTabs, shipping: shippingSettingsView })
    const organizationSourcePath = pathname === '/api/admin/organization-sources'
      || pathname.startsWith('/api/admin/organization-sources/')
    const organizationSourceAccess = organizationSourcePath && hasOrganizationSourcePermission(authContext.allPermissions)
    const systemAuthorizationPath = isSystemAuthorizationPath(pathname, request)
    if (systemAuthorizationPath && !authContext.canManageSystemAuthorizations) {
      return NextResponse.json({ error: '仅系统超级管理员可管理授权', code: 'NO_PERMISSION' }, { status: 403 })
    }
    const rolesIndexAccess = read && pathname === '/api/roles'
      && (systemAuthorizationPath || canReadRoleDirectory(authContext.allPermissions, authContext.authorizationRoleCodes))
    // Department write handlers independently enforce the exact edit/delete action.
    const departmentDirectoryPath = (read && pathname === '/api/admin/org')
      || (pathname === '/api/admin/departments' && (read || request.method === 'POST'))
      || (departmentDetailPath.test(pathname) && (request.method === 'PATCH' || request.method === 'DELETE'))
    const departmentDirectoryAccess = departmentDirectoryPath && hasOrgDepartmentDirectoryPermission(authContext.allPermissions)
    const memberAccess = hasMemberRoutePermission(pathname, request.method, authContext.allPermissions)
    const specificConfigurationAccess = configurationShell || organizationSourceAccess || rolesIndexAccess
      || departmentDirectoryAccess || memberAccess || systemAuthorizationPath
    if (shippingOnly && !specificConfigurationAccess && !ownerPermission && !requiredShipping.length
      && !(read && SHIPPING_ONLY_SESSION_READ_PATHS.has(pathname))
      && pathname !== '/api/profile' && pathname !== '/api/auth/logout') {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: '此操作超出当前寄件授权', code: 'SHIPPING_SCOPE_REQUIRED' }, { status: 403 })
      }
      const [ledger, owner, settings] = await Promise.all([
        allowsShippingPermission(authContext.shippingPermissions, ['shipping:ledger_view']),
        allowsShippingOwnerPermission(authContext.ownerShippingPermissions, 'shipping:owner_view'),
        allowsShippingPermission(authContext.shippingPermissions, ['shipping:settings_view']),
      ])
      const landingPage = ledger || owner ? '/shipping' : settings ? '/shipping/settings' : '/pending-access'
      return NextResponse.redirect(buildRedirectUrl(request, landingPage))
    }
    if (restrictedMember && !specificConfigurationAccess && required && (required === 'config:read' || required === 'admin:access')) {
      return pathname.startsWith('/api/')
        ? NextResponse.json({ error: 'Forbidden', required }, { status: 403 })
        : NextResponse.redirect(buildRedirectUrl(request, '/'))
    }
    if (restrictedMember && pathname.startsWith('/api/') && ['GET', 'HEAD'].includes(request.method)
      && !specificConfigurationAccess && !ownerPermission && !requiredShipping.length && !baselineReadAllowed(pathname)) {
      return NextResponse.json({ error: '此数据尚未开放基础查看范围', code: 'READ_SCOPE_REQUIRED' }, { status: 403 })
    }
    if (restrictedMember
      && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
      && pathname !== '/api/auth/logout'
      && !ownerPermission
      && !specificConfigurationAccess
      && !requiredShipping.length) {
      return NextResponse.json({ error: '基础查看账号不能执行此操作', code: 'READ_ONLY' }, { status: 403 })
    }

    // 路径级权限校验
    const allowed = pathname === '/api/roles' ? rolesIndexAccess
      : specificConfigurationAccess || (required === 'admin:access'
      ? canAccessOrgAdmin(authContext.allPermissions, authContext.authorizationRoleCodes)
      : required === 'config:read' ? (pathname !== '/configs' && hasConfigurationReadPermission(authContext.allPermissions))
        : (!required || hasPermission(authContext.allPermissions, required)))

    if (required && !allowed) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Forbidden', required }, { status: 403 })
      }
      return NextResponse.redirect(buildRedirectUrl(request, '/', `?denied=${encodeURIComponent(required)}`))
    }

    // 透传 user context 到下游 route handler / page
    const requestHeaders = new Headers(request.headers)
    requestHeaders.delete('x-user-shipping-settings-view')
    if (shippingSettingsView) requestHeaders.set('x-user-shipping-settings-view', '1')
    requestHeaders.delete('x-user-navigation-scope')
    if (pathname === '/api/navigation') {
      if (shippingOnly) requestHeaders.set('x-user-navigation-scope', 'shipping-only')
      if (authContext.roleCodes.length === 0 && authContext.departmentLedgerAccess) {
        requestHeaders.set('x-user-navigation-scope', authContext.departmentWorkspaceAccess ? 'workbench-and-ledger' : 'department-ledger')
      }
    }
    requestHeaders.set('x-user-id', authContext.userId)
    requestHeaders.set('x-org-id', authContext.orgId)
    requestHeaders.set('x-user-roles', authContext.roleCodes.join(','))
    requestHeaders.set('x-user-role-codes', authContext.roleCodes.join(','))
    requestHeaders.set('x-user-authorization-role-codes', authContext.authorizationRoleCodes.join(','))
    requestHeaders.set('x-user-permissions', authContext.allPermissions.join(','))

    return NextResponse.next({ request: { headers: requestHeaders } })
  } catch (error) {
    if (error instanceof Error && error.message.includes('auth middleware')) {
      console.error('Auth middleware misconfigured:', error.message)
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Authentication unavailable' }, { status: 503 })
      }
      return new NextResponse('Authentication unavailable', { status: 503 })
    }

    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.redirect(buildRedirectUrl(request, '/login'))
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}

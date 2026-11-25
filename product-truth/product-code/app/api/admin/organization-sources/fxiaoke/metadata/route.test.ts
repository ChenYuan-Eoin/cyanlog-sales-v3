import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  org: vi.fn(),
  roles: vi.fn(),
  credentials: vi.fn(),
  inspect: vi.fn(),
  transport: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth }))
vi.mock('@/lib/scoped-access', () => ({
  getFreshDefaultOrgId: mocks.org,
  getFreshUserScopedRoleAssignments: mocks.roles,
}))
vi.mock('@/lib/fxiaoke/settings', () => ({ loadSavedCredentialsForMetadataInspection: mocks.credentials }))
vi.mock('@/lib/fxiaoke/client', () => ({ inspectObjectMetadata: mocks.inspect }))
vi.mock('@/lib/fxiaoke/egress/directory-transport', () => ({ directoryTransportForOrganization: mocks.transport }))

import { GET } from './route'

const credentials = {
  appId: 'FSAID_test',
  appSecret: 'test-only-secret',
  permanentCode: 'test-only-code',
  expectedEa: 'ea-test',
  apiUserId: '1093',
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ id: 'admin' })
  mocks.org.mockResolvedValue('org-a')
  mocks.roles.mockResolvedValue([{ scopeType: 'org', scopeId: 'org-a', roleCode: 'ADMIN', permissions: [] }])
  mocks.credentials.mockResolvedValue(credentials)
  mocks.transport.mockReturnValue('fixed-transport')
  mocks.inspect.mockResolvedValue({
    ea: 'ea-test',
    operation: 'list',
    objects: [{ apiName: 'ApprovalObj', displayName: '寄件审批', defineType: 'custom', active: true }],
  })
})

function request(path = '/api/admin/organization-sources/fxiaoke/metadata', orgId = 'org-a') {
  return new NextRequest(`https://sales.cyanlog.icu${path}`, { headers: { 'x-org-id': orgId } })
}

it('returns a no-store object catalog to a fresh organization manager', async () => {
  const response = await GET(request())
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).toEqual({
    data: {
      ea: 'ea-test',
      operation: 'list',
      objects: [{ apiName: 'ApprovalObj', displayName: '寄件审批', defineType: 'custom', active: true }],
    },
  })
  expect(mocks.credentials).toHaveBeenCalledWith('org-a')
  expect(mocks.inspect).toHaveBeenCalledWith(credentials, { operation: 'list' }, 'fixed-transport')
})

it('validates the object API name before loading credentials', async () => {
  const response = await GET(request('/api/admin/organization-sources/fxiaoke/metadata?operation=describe&objectApiName=../../secret'))
  expect(response.status).toBe(400)
  expect(mocks.credentials).not.toHaveBeenCalled()
  expect(mocks.inspect).not.toHaveBeenCalled()
})

it('rejects another organization before decrypting saved credentials', async () => {
  const response = await GET(request(undefined, 'org-b'))
  expect(response.status).toBe(403)
  expect(mocks.credentials).not.toHaveBeenCalled()
})

it.each(['org:source_view', 'org:source_connect', 'org:source_preview', 'org:source_apply', 'user:view'])(
  'denies CRM metadata to an actor with only %s before accessing the provider',
  async (permission) => {
    mocks.roles.mockResolvedValue([{ scopeType: 'org', scopeId: 'org-a', permissions: [permission] }])
    expect((await GET(request())).status).toBe(403)
    expect(mocks.credentials).not.toHaveBeenCalled()
    expect(mocks.transport).not.toHaveBeenCalled()
    expect(mocks.inspect).not.toHaveBeenCalled()
  },
)

it.each(['ADMIN', 'SALES_OPS'])('honors overridden %s permissions', async (roleCode) => {
  mocks.roles.mockResolvedValue([{
    scopeType: 'org', scopeId: 'org-a', roleCode, permissionsOverridden: true, permissions: ['org:source_preview'],
  }])
  expect((await GET(request())).status).toBe(403)
  expect(mocks.credentials).not.toHaveBeenCalled()
})

it('does not use a department management grant for its organization', async () => {
  mocks.roles.mockResolvedValue([{ scopeType: 'department', scopeId: 'org-a', permissions: ['admin:access'] }])
  expect((await GET(request())).status).toBe(403)
  expect(mocks.credentials).not.toHaveBeenCalled()
})

it('lets an existing sales operations role describe an object through fixed egress', async () => {
  mocks.roles.mockResolvedValue([{ scopeType: 'org', scopeId: 'org-a', roleCode: 'SALES_OPS', permissions: [] }])
  mocks.inspect.mockResolvedValue({
    ea: 'ea-test',
    operation: 'describe',
    object: { apiName: 'ApprovalObj', displayName: '寄件审批', defineType: 'custom', active: true },
    fields: [{ apiName: 'recipient_name__c', label: '收件人' }],
  })
  const response = await GET(request('/api/admin/organization-sources/fxiaoke/metadata?operation=describe&objectApiName=ApprovalObj'))
  expect(response.status).toBe(200)
  expect(mocks.inspect).toHaveBeenCalledWith(
    credentials,
    { operation: 'describe', objectApiName: 'ApprovalObj' },
    'fixed-transport',
  )
})

it('does not reflect unexpected errors or saved secrets', async () => {
  mocks.inspect.mockRejectedValue(new Error('sensitive provider response'))
  const response = await GET(request())
  expect(response.status).toBe(500)
  const body = await response.text()
  expect(body).not.toContain('sensitive')
  expect(body).not.toContain(credentials.appSecret)
})

it('rejects anonymous access', async () => {
  mocks.auth.mockRejectedValue(Object.assign(new Error('denied'), { name: 'AuthError' }))
  expect((await GET(request())).status).toBe(401)
})

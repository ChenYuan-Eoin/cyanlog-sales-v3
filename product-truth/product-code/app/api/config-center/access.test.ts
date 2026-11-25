import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  freshOrg: vi.fn(),
  assignments: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth }))
vi.mock('@/lib/scoped-access', () => ({
  getFreshDefaultOrgId: mocks.freshOrg,
  getFreshUserScopedRoleAssignments: mocks.assignments,
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))

import { GET as list, POST as create } from './[domain]/route'
import { GET as getItem, PUT as update, DELETE as deleteDraft } from './[domain]/[id]/route'
import { POST as publish } from './[domain]/[id]/publish/route'
import { POST as rollback } from './[domain]/[id]/rollback/route'
import { GET as versions } from './[domain]/[id]/versions/route'
import { POST as importPriceMatrix } from './price-matrix/import/route'

const orgId = 'org-1'
const itemId = 'config-1'
const domain = { params: Promise.resolve({ domain: 'business-params', id: itemId }) }
const taxDomain = { params: Promise.resolve({ domain: 'regional-tax-rates', id: itemId }) }
const versionRow = { version: 1, value: { name: '历史名称' } }
const item = { id: itemId, org_id: orgId, status: 'DRAFT', version: 3 }
const taxPayload = { region: 'CN', software_rate: 0.12, service_rate: 0.06 }

function request(method: string, body?: object) {
  return new NextRequest('http://localhost/api/config-center/business-params', {
    method,
    ...(body && { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  })
}

function allow(permissions: string[], scopeType = 'org', scopeId = orgId) {
  mocks.assignments.mockResolvedValue([{ scopeType, scopeId, permissions }])
}

function dbQuery(data: unknown) {
  const result = { data, error: null, count: null }
  const chain = Object.assign(Promise.resolve(result), {
    select: vi.fn(),
    eq: vi.fn(),
    range: vi.fn(),
    order: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  })
  for (const method of ['select', 'eq', 'range', 'order', 'update', 'insert'] as const) {
    chain[method].mockReturnValue(chain)
  }
  return chain
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.requireAuth.mockResolvedValue({ id: 'actor-1' })
  mocks.freshOrg.mockResolvedValue(orgId)
  allow(['config:read'])
})

describe('legacy configuration actions', () => {
  it.each([
    ['create', () => create(request('POST', {}), domain)],
    ['update', () => update(request('PUT', {}), domain)],
    ['delete', () => deleteDraft(request('DELETE'), domain)],
    ['publish', () => publish(request('POST'), domain)],
    ['rollback', () => rollback(request('POST', { version: 1 }), domain)],
  ])('denies %s to read-only actors before touching data', async (_name, action) => {
    expect((await action()).status).toBe(403)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it.each([['org', 'another-org'], ['department', orgId]])(
    'rejects an assignment with scope %s and id %s for read',
    async (scopeType, scopeId) => {
      allow(['config:*'], scopeType, scopeId)
      expect((await getItem(request('GET'), domain)).status).toBe(403)
      expect(mocks.from).not.toHaveBeenCalled()
    },
  )

  it('reads only in the selected organization', async () => {
    const read = dbQuery([item])
    mocks.from.mockReturnValueOnce(read)

    const response = await list(request('GET'), domain)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toEqual([item])
    expect(body.meta.access).toEqual({ canWrite: false, canPublish: false })
    expect(read.eq).toHaveBeenCalledWith('org_id', orgId)
  })

  it('does not treat a draft edit or import as a release', async () => {
    allow(['config:write'])
    mocks.from.mockReturnValueOnce(dbQuery(item))
    const change = dbQuery(item)
    mocks.from.mockReturnValueOnce(change)

    expect((await update(request('PUT', taxPayload), taxDomain)).status).toBe(200)
    expect(change.update.mock.calls[0][0]).not.toHaveProperty('status')
    expect(change.eq).toHaveBeenCalledWith('status', 'DRAFT')
    expect((await publish(request('POST'), taxDomain)).status).toBe(403)
  })

  it('rejects editing or rolling back a live config without publish permission', async () => {
    allow(['config:write'])
    mocks.from.mockReturnValue(dbQuery({ ...item, status: 'PUBLISHED' }))

    expect((await update(request('PUT', taxPayload), taxDomain)).status).toBe(403)
    expect((await rollback(request('POST', { version: 1 }), domain)).status).toBe(403)
    expect(mocks.from.mock.calls).toEqual([['regional_tax_rates'], ['business_params']])
  })

  it('allows a publisher to release an authorized draft without granting draft edits', async () => {
    allow(['config:publish'])
    mocks.from.mockReturnValueOnce(dbQuery(item))
    mocks.from.mockReturnValueOnce(dbQuery(null))
    const change = dbQuery(null)
    mocks.from.mockReturnValueOnce(change)

    expect((await publish(request('POST'), domain)).status).toBe(200)
    expect(change.update).toHaveBeenCalledWith({ status: 'PUBLISHED', version: 4 })
    expect(change.eq).toHaveBeenCalledWith('org_id', orgId)
    expect((await update(request('PUT', taxPayload), taxDomain)).status).toBe(403)
  })

  it('allows input validation previews but denies import commits with read only', async () => {
    const rows = [{
      product_id: '11111111-1111-4111-8111-111111111111',
      version_code: 'STANDARD',
      deployment: 'PRIVATE',
      auth_mode: 'SUB_YEAR',
      qty_from: 1,
    }]
    expect((await importPriceMatrix(request('POST', { rows }))).status).toBe(200)
    expect((await importPriceMatrix(request('POST', { rows, commit: true }))).status).toBe(403)
    expect(mocks.from).not.toHaveBeenCalled()
  })
})

describe('legacy configuration version ownership', () => {
  it('verifies parent ownership before an authorized history lookup', async () => {
    const parent = dbQuery(item)
    mocks.from.mockReturnValueOnce(parent)
    const history = dbQuery([versionRow])
    mocks.from.mockReturnValueOnce(history)

    const response = await versions(request('GET'), domain)
    expect(response.status).toBe(200)
    expect((await response.json()).data).toEqual([versionRow])
    expect(parent.eq).toHaveBeenCalledWith('org_id', orgId)
    expect(history.eq).toHaveBeenCalledWith('param_id', itemId)
  })

  it('hides foreign or missing config history and never fetches the snapshots', async () => {
    const missingParent = dbQuery(null)
    mocks.from.mockReturnValue(missingParent)

    expect((await versions(request('GET'), domain)).status).toBe(404)
    allow(['config:write', 'config:publish'])
    expect((await rollback(request('POST', { version: 1 }), domain)).status).toBe(404)
    expect(mocks.from.mock.calls).toEqual([['business_params'], ['business_params']])
    expect(missingParent.eq).toHaveBeenCalledWith('org_id', orgId)
  })

  it('restores draft values without restoring identity, ownership, or version counters', async () => {
    allow(['config:write'])
    mocks.from.mockReturnValueOnce(dbQuery(item))
    mocks.from.mockReturnValueOnce(dbQuery({
      value: { ...item, org_id: 'archived-snapshot-org', version: 1, name: '历史名称' },
    }))
    const change = dbQuery({ id: itemId })
    mocks.from.mockReturnValueOnce(change)

    expect((await rollback(request('POST', { version: 1 }), domain)).status).toBe(200)
    expect(change.update).toHaveBeenCalledWith({ name: '历史名称', status: 'DRAFT' })
    expect(change.eq).toHaveBeenCalledWith('org_id', orgId)
    expect(change.eq).toHaveBeenCalledWith('version', 3)
  })

  it('reports a concurrent rollback conflict rather than success', async () => {
    allow(['config:write'])
    mocks.from.mockReturnValueOnce(dbQuery(item))
    mocks.from.mockReturnValueOnce(dbQuery(versionRow))
    mocks.from.mockReturnValueOnce(dbQuery(null))

    expect((await rollback(request('POST', { version: 1 }), domain)).status).toBe(409)
  })
})

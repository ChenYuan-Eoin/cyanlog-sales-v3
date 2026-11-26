// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ access: vi.fn(), operator: vi.fn(), list: vi.fn(), detail: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { rpc: mocks.rpc } }))
vi.mock('@/lib/shipping/entry-access', () => ({ loadShippingLedgerAccess: mocks.access }))
vi.mock('@/lib/auth', () => ({ requireAuth: async () => ({ id: 'operator' }), AuthError: class extends Error {} }))
vi.mock('@/lib/shipping/operator-access', () => ({ requireShippingOperator: mocks.operator }))
vi.mock('@/lib/shipping/collaboration', () => ({ listShipmentLedger: mocks.list, getScopedShipmentLedgerRecord: mocks.detail }))
import { GET, POST } from './route'
import { GET as getRecord } from './[id]/route'
import { ShippingError } from '@/lib/shipping/config'

const noReturn = { organizationWide: false, departmentIds: new Set() }
const orgWide = { orgId: 'org-authorized', organizationWide: true, departments: [] }
const parent = 'c4a05f87-2940-4991-a409-634ce320640b'
const child = 'b3462c70-d6f1-4448-9d80-cddc7b03b0a1'
const second = 'a46e949a-0f41-404a-828b-f6bade6bbd19'
const unrelated = 'bbc82089-f5bc-4d75-b16a-3ca45e9a2835'
const deptAccess = { ...orgWide, organizationWide: false, departments: [
  { id: parent, name: '华南', parentId: null },
  { id: child, name: '华南一部', parentId: parent },
  { id: second, name: '华北二部', parentId: null },
] }
const ledgerUrl = 'https://example.test/api/shipping/ledger'

beforeEach(() => {
  mocks.rpc.mockReset()
  mocks.access.mockReset().mockResolvedValue(orgWide)
  mocks.operator.mockReset()
  mocks.list.mockReset().mockResolvedValue([])
  mocks.detail.mockReset().mockResolvedValue(null)
})
describe('ledger route uses the authorized organization', () => {
  it('passes the server-authorized organization to the data query', async () => {
    expect((await GET(new NextRequest('https://example.test/api/shipping/ledger?limit=50'))).status).toBe(200)
    expect(mocks.list).toHaveBeenCalledWith('org-authorized', { limit: 50 }, undefined, noReturn)
  })
  it('filters authorized pages by both time bounds and returns only the requested page size', async () => {
    mocks.list.mockResolvedValue([{ id: 'first' }, { id: 'lookahead' }])
    const result = await GET(new NextRequest(
      'https://example.test/api/shipping/ledger?limit=1&page=0&submittedFrom=2026-11-17T16:00:00Z&submittedBefore=2026-11-18T16:00:00Z',
    ))
    expect(await result.json()).toEqual({ records: [{ id: 'first' }], nextPage: 1 })
    expect(mocks.list).toHaveBeenCalledWith('org-authorized', {
      limit: 1, page: 0, submittedFrom: '2026-11-17T16:00:00Z', submittedBefore: '2026-11-18T16:00:00Z',
    }, undefined, noReturn)
  })
  it('rejects backwards time bounds without querying orders', async () => {
    const result = await GET(new NextRequest(
      'https://example.test/api/shipping/ledger?submittedFrom=2026-11-18T16:00:00Z&submittedBefore=2026-11-17T16:00:00Z',
    ))
    expect(result.status).toBe(400)
    expect(mocks.list).not.toHaveBeenCalled()
  })
  it('rejects an organization injected in the query string', async () => {
    expect((await GET(new NextRequest('https://example.test/api/shipping/ledger?orgId=org-foreign'))).status).toBe(400)
    expect(mocks.list).not.toHaveBeenCalled()
  })
  it('does not execute any data query without an authorized organization', async () => {
    mocks.access.mockResolvedValue(null)
    expect((await GET(new NextRequest('https://example.test/api/shipping/ledger'))).status).toBe(403)
    expect(mocks.list).not.toHaveBeenCalled()
  })
  it('passes the authorized union or the selected subset before looking up any records', async () => {
    mocks.access.mockResolvedValue(deptAccess)
    expect((await GET(new NextRequest(ledgerUrl))).status).toBe(200)
    expect(mocks.list).toHaveBeenLastCalledWith('org-authorized', { limit: 50 }, [parent, child, second], noReturn)
    expect((await GET(new NextRequest(`${ledgerUrl}?departmentId=${parent}`))).status).toBe(200)
    expect(mocks.list).toHaveBeenLastCalledWith('org-authorized', { limit: 50 }, [parent], noReturn)
    expect((await GET(new NextRequest(`${ledgerUrl}?departmentId=${parent}&includeSubdepartments=true`))).status).toBe(200)
    expect(mocks.list).toHaveBeenLastCalledWith('org-authorized', { limit: 50 }, [parent, child], noReturn)
  })
  it('keeps view selection distinct from the authorized return scope', async () => {
    mocks.access.mockResolvedValue({ ...deptAccess, returnPublished: true })
    mocks.rpc.mockResolvedValue({ data: [child], error: null })
    expect((await GET(new NextRequest(ledgerUrl))).status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('shipping_department_return_scope_v1', {
      p_actor_id: 'operator', p_org_id: 'org-authorized',
    })
    expect(mocks.list).toHaveBeenLastCalledWith('org-authorized', { limit: 50 }, [parent, child, second], {
      organizationWide: false, departmentIds: new Set([child]),
    })

    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } })
    expect((await GET(new NextRequest(ledgerUrl))).status).toBe(200)
    expect(mocks.list).toHaveBeenLastCalledWith('org-authorized', { limit: 50 }, [parent, child, second], noReturn)
  })
  it('does not query records for foreign selections or invalid scope filters', async () => {
    mocks.access.mockResolvedValue(deptAccess)
    expect((await GET(new NextRequest(`${ledgerUrl}?departmentId=${unrelated}`))).status).toBe(403)
    expect((await GET(new NextRequest(`${ledgerUrl}?includeSubdepartments=true`))).status).toBe(400)
    expect(mocks.list).not.toHaveBeenCalled()
  })
  it('uses the same scoped query for detail, including after a scope change', async () => {
    mocks.access.mockResolvedValue(deptAccess)
    mocks.detail.mockResolvedValueOnce({ id: unrelated })
    const req = new NextRequest(`${ledgerUrl}/${unrelated}?departmentId=${second}`)
    const params = Promise.resolve({ id: unrelated })
    expect(await (await getRecord(req, { params })).json()).toEqual({ record: { id: unrelated } })
    expect(mocks.detail).toHaveBeenLastCalledWith('org-authorized', unrelated, [second], noReturn)
    mocks.access.mockResolvedValue({ ...deptAccess, departments: [deptAccess.departments[0]] })
    expect((await getRecord(req, { params })).status).toBe(403)
    expect(mocks.detail).toHaveBeenCalledTimes(1)
    expect((await getRecord(new NextRequest(`${ledgerUrl}/${unrelated}`), { params })).status).toBe(404)
    expect(mocks.detail).toHaveBeenLastCalledWith('org-authorized', unrelated, [parent], noReturn)
  })
  it('does not use department reader authorization for creation', async () => {
    mocks.access.mockResolvedValue(deptAccess)
    mocks.operator.mockRejectedValue(new ShippingError(403, '没有创建权限'))
    expect((await POST(new NextRequest(ledgerUrl, { method: 'POST', body: '{}' }))).status).toBe(403)
    expect(mocks.operator).toHaveBeenCalledWith('operator', 'shipping:record_create')
    expect(mocks.access).not.toHaveBeenCalled()
  })
})

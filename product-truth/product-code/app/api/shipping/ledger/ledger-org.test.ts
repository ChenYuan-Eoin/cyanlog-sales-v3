// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ operator: vi.fn(), list: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: async () => ({ id: 'operator' }), AuthError: class extends Error {} }))
vi.mock('@/lib/shipping/operator-access', () => ({ requireShippingOperator: mocks.operator }))
vi.mock('@/lib/shipping/collaboration', () => ({ listShipmentLedger: mocks.list }))
import { GET } from './route'
beforeEach(() => { mocks.operator.mockReset().mockResolvedValue('org-authorized'); mocks.list.mockReset().mockResolvedValue([]) })
describe('ledger route uses the authorized organization', () => {
  it('passes the server-authorized organization to the data query', async () => {
    expect((await GET(new NextRequest('https://example.test/api/shipping/ledger?limit=50'))).status).toBe(200)
    expect(mocks.list).toHaveBeenCalledWith('org-authorized', { limit: 50 })
  })
  it('filters authorized pages by both time bounds and returns only the requested page size', async () => {
    mocks.list.mockResolvedValue([{ id: 'first' }, { id: 'lookahead' }])
    const result = await GET(new NextRequest(
      'https://example.test/api/shipping/ledger?limit=1&page=0&submittedFrom=2026-11-17T16:00:00Z&submittedBefore=2026-11-18T16:00:00Z',
    ))
    expect(await result.json()).toEqual({ records: [{ id: 'first' }], nextPage: 1 })
    expect(mocks.list).toHaveBeenCalledWith('org-authorized', {
      limit: 1, page: 0, submittedFrom: '2026-11-17T16:00:00Z', submittedBefore: '2026-11-18T16:00:00Z',
    })
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
    mocks.operator.mockResolvedValue('')
    expect((await GET(new NextRequest('https://example.test/api/shipping/ledger'))).status).toBe(403)
    expect(mocks.list).not.toHaveBeenCalled()
  })
})

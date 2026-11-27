// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { OrganizationConnectionError } from '@/lib/organization-connections/errors'

const mocks = vi.hoisted(() => ({ access: vi.fn(), record: vi.fn() }))
vi.mock('@/lib/admin/organization-source-access', () => ({ loadOrganizationSourceAccess: mocks.access }))
vi.mock('@/lib/organization-connections/fxiaoke-directory-scope', () => ({ recordFxiaokeScopeProof: mocks.record }))

import { POST } from './route'

const endpoint = 'https://icu.example/api/admin/organization-sources/fxiaoke/scope-proof'

function request(body: string, headers: HeadersInit = {}) {
  return new NextRequest(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body })
}

describe('Fxiaoke scope evidence submission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.access.mockResolvedValue({ orgId: 'authorized-org', actor: { id: 'admin' }, access: { enterpriseLogin: true } })
  })

  it('rejects delegated source managers, cross-origin and invalid JSON before submitting evidence', async () => {
    expect((await POST(request('{}', { origin: 'https://outside.example' }))).status).toBe(403)
    expect((await POST(request('{}', { 'Content-Type': 'application/jsonp' }))).status).toBe(415)
    expect((await POST(request('{broken'))).status).toBe(400)
    expect((await POST(request('{}', { 'Content-Length': '3000000' }))).status).toBe(413)
    mocks.access.mockResolvedValueOnce({ orgId: 'authorized-org', actor: { id: 'delegated' }, access: { connect: true, preview: true, apply: true, enterpriseLogin: false } })
    expect((await POST(request('{}'))).status).toBe(403)
    expect(mocks.record).not.toHaveBeenCalled()
  })

  it('binds the call to the authenticated organization and returns receipt metadata only', async () => {
    const receipt = { id: 'proof-only', capturedAt: '2026-11-27T09:55:00+08:00', verifiedAt: '2026-11-27T10:00:00+08:00',
      expiresAt: '2026-11-27T10:25:00+08:00', departmentCount: 8, employeeCount: 20 }
    mocks.record.mockResolvedValueOnce(receipt)
    const response = await POST(request(JSON.stringify({ departments: [{ id: 'private-rows' }] })))
    expect(response.status).toBe(201)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({ data: { proof: receipt } })
    expect(mocks.record).toHaveBeenCalledWith('authorized-org', 'admin', { departments: [{ id: 'private-rows' }] })
  })

  it('reports scope mismatch without echoing the submitted manifest', async () => {
    mocks.record.mockRejectedValueOnce(new OrganizationConnectionError('DIRECTORY_SCOPE_MISMATCH', '读取范围不一致，只可预览。', 409))
    const response = await POST(request('{"employees":["private-rows"]}'))
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ code: 'DIRECTORY_SCOPE_MISMATCH', error: '读取范围不一致，只可预览。' })
  })
})

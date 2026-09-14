// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const { auth, query, owns } = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn(), owns: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: auth, AuthError: class AuthError extends Error {} }))
vi.mock('@/lib/shipping/sf-client', () => ({ querySfTracking: query }))
vi.mock('@/lib/shipping/store', () => ({ ownsShippingWaybill: owns }))
import { GET } from './settings/route'
import { POST } from './tracking/route'
import { AuthError } from '@/lib/auth'
beforeEach(() => { vi.stubEnv('SHIPPING_ALLOWED_USER_IDS', 'allowed'); auth.mockReset(); query.mockReset(); owns.mockReset(); owns.mockResolvedValue(false); query.mockResolvedValue({ waybill: 'SF1234567890123', events: [], queriedAt: '2026-09-14T00:00:00Z' }) })
describe('shipping access is server enforced', () => {
  it('denies logged-out requests', async () => { auth.mockRejectedValue(new AuthError()); expect((await GET(new NextRequest('http://localhost/api/shipping/settings'))).status).toBe(401) })
  it('denies other users even with a direct URL', async () => { auth.mockResolvedValue({ id: 'other' }); expect((await GET(new NextRequest('http://localhost/api/shipping/settings'))).status).toBe(403) })
  it('never discloses provider keys in settings', async () => { auth.mockResolvedValue({ id: 'allowed' }); vi.stubEnv('SF_CHECK_WORD','secret-word'); const r = await GET(new NextRequest('http://localhost/api/shipping/settings')); expect(r.status).toBe(200); expect(await r.text()).not.toContain('secret-word') })
  it('rejects cross-origin side effects before calling SF', async () => { auth.mockResolvedValue({ id: 'allowed' }); const r = await POST(new NextRequest('http://localhost/api/shipping/tracking', { method: 'POST', headers: { origin: 'https://evil.example' }, body: JSON.stringify({ waybill: 'SF1234567890123' }) })); expect(r.status).toBe(403); expect(query).not.toHaveBeenCalled() })
  it('rejects malformed or extra fields', async () => { auth.mockResolvedValue({ id: 'allowed' }); const r = await POST(new NextRequest('http://localhost/api/shipping/tracking', { method: 'POST', body: JSON.stringify({ waybill: 'SF1234567890123', created_by: 'other' }) })); expect(r.status).toBe(400); expect(query).not.toHaveBeenCalled() })
  it('queries an owned waybill without exposing other account shipments', async () => { auth.mockResolvedValue({ id: 'allowed' }); owns.mockResolvedValue(true); const r = await POST(new NextRequest('http://localhost/api/shipping/tracking', { method: 'POST', body: JSON.stringify({ waybill: 'SF1234567890123' }) })); expect(r.status).toBe(200); expect(query).toHaveBeenCalledWith('SF1234567890123', undefined) })
  it('requires phone verification for a waybill outside the current user records', async () => { auth.mockResolvedValue({ id: 'allowed' }); const denied = await POST(new NextRequest('http://localhost/api/shipping/tracking', { method: 'POST', body: JSON.stringify({ waybill: 'SF1234567890123' }) })); expect(denied.status).toBe(400); expect(query).not.toHaveBeenCalled(); const verified = await POST(new NextRequest('http://localhost/api/shipping/tracking', { method: 'POST', body: JSON.stringify({ waybill: 'SF1234567890123', phoneSuffix: '1234' }) })); expect(verified.status).toBe(200); expect(query).toHaveBeenCalledWith('SF1234567890123', '1234') })
})

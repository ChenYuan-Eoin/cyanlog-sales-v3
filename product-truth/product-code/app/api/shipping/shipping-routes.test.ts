// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const { auth, query, owns, importedSuffix, recordTracking } = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn(), owns: vi.fn(), importedSuffix: vi.fn(), recordTracking: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: auth, AuthError: class AuthError extends Error {} }))
vi.mock('@/lib/shipping/sf-client', () => ({ querySfTracking: query }))
vi.mock('@/lib/shipping/store', () => ({ ownsShippingWaybill: owns }))
vi.mock('@/lib/shipping/outbound', () => ({ importedOutboundSuffix: importedSuffix }))
vi.mock('@/lib/shipping/tracking-store', () => ({ recordTrackingResult: recordTracking }))
import { GET } from './settings/route'
import { POST } from './tracking/route'
import { AuthError } from '@/lib/auth'
beforeEach(() => { vi.stubEnv('SHIPPING_ALLOWED_USER_IDS', 'allowed'); vi.stubEnv('SF_ENVIRONMENT', 'production'); importedSuffix.mockReset(); importedSuffix.mockResolvedValue(null); auth.mockReset(); query.mockReset(); owns.mockReset(); owns.mockResolvedValue(false); recordTracking.mockReset(); recordTracking.mockResolvedValue({ recorded: 0 }); query.mockResolvedValue({ waybill: 'SF1234567890123', events: [], queriedAt: '2026-09-14T00:00:00Z' }) })
describe('shipping access is server enforced', () => {
  it('denies logged-out requests', async () => { auth.mockRejectedValue(new AuthError()); expect((await GET(new NextRequest('http://localhost/api/shipping/settings'))).status).toBe(401) })
  it('denies other users even with a direct URL', async () => { auth.mockResolvedValue({ id: 'other' }); expect((await GET(new NextRequest('http://localhost/api/shipping/settings'))).status).toBe(403) })
  it('never discloses provider keys in settings', async () => { auth.mockResolvedValue({ id: 'allowed' }); vi.stubEnv('SF_CHECK_WORD','secret-word'); const r = await GET(new NextRequest('http://localhost/api/shipping/settings')); expect(r.status).toBe(200); expect(await r.text()).not.toContain('secret-word') })
  it('rejects cross-origin side effects before calling SF', async () => { auth.mockResolvedValue({ id: 'allowed' }); const r = await POST(new NextRequest('http://localhost/api/shipping/tracking', { method: 'POST', headers: { origin: 'https://evil.example' }, body: JSON.stringify({ waybill: 'SF1234567890123' }) })); expect(r.status).toBe(403); expect(query).not.toHaveBeenCalled() })
  it('rejects malformed or extra fields', async () => { auth.mockResolvedValue({ id: 'allowed' }); const r = await POST(new NextRequest('http://localhost/api/shipping/tracking', { method: 'POST', body: JSON.stringify({ waybill: 'SF1234567890123', created_by: 'other' }) })); expect(r.status).toBe(400); expect(query).not.toHaveBeenCalled() })
  it('queries an owned waybill without exposing other account shipments', async () => { auth.mockResolvedValue({ id: 'allowed' }); owns.mockResolvedValue(true); const r = await POST(new NextRequest('http://localhost/api/shipping/tracking', { method: 'POST', body: JSON.stringify({ waybill: 'SF1234567890123' }) })); expect(r.status).toBe(200); expect(query).toHaveBeenCalledWith('SF1234567890123', undefined) })
  it('records normalized events for platform waybills', async () => { auth.mockResolvedValue({ id: 'allowed' }); owns.mockResolvedValue(true); await POST(new NextRequest('http://localhost/api/shipping/tracking', { method: 'POST', body: JSON.stringify({ waybill: 'SF1234567890123' }) })); expect(recordTracking).toHaveBeenCalledWith(expect.objectContaining({ waybill: 'SF1234567890123' })) })
  it('does not treat four digits as proof that a foreign waybill belongs to the user', async () => { auth.mockResolvedValue({ id: 'allowed' }); const denied = await POST(new NextRequest('http://localhost/api/shipping/tracking', { method: 'POST', body: JSON.stringify({ waybill: 'SF1234567890123', phoneSuffix: '1234' }) })); expect(denied.status).toBe(403); expect(query).not.toHaveBeenCalled() })
  it('looks up the imported waybill under the caller and uses its verified phone suffix', async () => { auth.mockResolvedValue({ id: 'allowed' }); importedSuffix.mockResolvedValue('1410'); const response = await POST(new NextRequest('http://localhost/api/shipping/tracking', { method: 'POST', body: JSON.stringify({ waybill: 'SF1234567890123', phoneSuffix: '0000' }) })); expect(response.status).toBe(200); expect(importedSuffix).toHaveBeenCalledWith('allowed', 'SF1234567890123'); expect(query).toHaveBeenCalledWith('SF1234567890123', '1410') })
})

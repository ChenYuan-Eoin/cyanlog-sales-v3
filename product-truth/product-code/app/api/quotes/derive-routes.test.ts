import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({
  deriveOrder: vi.fn(), deriveSeal: vi.fn(), deriveTender: vi.fn(),
  requireAuth: vi.fn(), loadDeriveContext: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { rpc: vi.fn(async () => ({ data: 'QT-123' })) } }))
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth }))
vi.mock('@/lib/scoped-access', () => ({ getDefaultOrgId: vi.fn(async () => 'org') }))
vi.mock('@/lib/quote/downstream-derive', () => ({ deriveOrder: mocks.deriveOrder, deriveSeal: mocks.deriveSeal, deriveTender: mocks.deriveTender }))
vi.mock('@/lib/quote/derive-route-helpers', async (original) => ({
  ...await original<typeof import('@/lib/quote/derive-route-helpers')>(),
  loadDeriveContext: mocks.loadDeriveContext,
}))
import { POST as order } from './[id]/derive-order/route'
import { POST as seal } from './[id]/derive-seal/route'
import { POST as tender } from './[id]/derive-tender/route'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAuth.mockResolvedValue({ id: 'authenticated-user' })
  mocks.loadDeriveContext.mockResolvedValue({ ok: true, source: { quote_id: 'q1', org_id: 'org' } })
  for (const fn of [mocks.deriveOrder, mocks.deriveSeal, mocks.deriveTender]) fn.mockResolvedValue({ id: 'result' })
})
describe('derived document actor attribution', () => {
  it.each([['order', order, mocks.deriveOrder], ['seal', seal, mocks.deriveSeal], ['tender', tender, mocks.deriveTender]] as const)(
    '%s attributes the write to the authenticated user, ignoring body actor spoofing', async (kind, handler, derive) => {
      const request = new NextRequest(`http://localhost/api/quotes/q1/derive-${kind}`, {
        method: 'POST', body: JSON.stringify({ actor_id: 'attacker', created_by: 'attacker', reason: 'Fixture', title: 'Fixture' }),
      })
      const response = await handler(request, { params: Promise.resolve({ id: 'q1' }) })
      expect(response.status).toBe(200)
      expect(derive).toHaveBeenCalledWith(expect.objectContaining({ actor_id: 'authenticated-user' }))
    },
  )
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: mocks }))
import { deriveOrder, deriveSeal, deriveTender, type DeriveSource } from './downstream-derive'
const source: DeriveSource & { actor_id: string } = {
  quote_id: 'q1', org_id: 'o1', actor_id: 'authenticated-user', quote_no: 'Q1',
  customer_name: 'Test customer', customer_contact: null, currency: 'CNY',
  version: { id: 'v1', version_no: 1, header: { total_amount: 120 }, items: [] },
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.rpc.mockImplementation(async (_name, args) => ({ data: args.p_target.id, error: null }))
})
describe('downstream persistence contract', () => {
  it.each([['order', deriveOrder], ['seal', deriveSeal], ['tender', deriveTender]] as const)(
    '%s binds the authenticated actor and frozen source to one atomic call', async (type, derive) => {
      const result = await derive(source)
      expect(result.type).toBe(type)
      expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('persist_quote_derivation_v1', expect.objectContaining({
        p_actor_id: source.actor_id, p_org_id: source.org_id, p_quote_id: source.quote_id,
        p_version_id: source.version.id, p_type: type,
        p_target: expect.objectContaining({ id: result.id, created_by: source.actor_id }),
      }))
      expect(mocks.from).not.toHaveBeenCalled()
    },
  )
  it('rejects a missing actor before requesting persistence', async () => {
    await expect(deriveOrder({ ...source, actor_id: '' })).rejects.toThrow('DERIVE_ACTOR_REQUIRED')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('propagates a trace failure instead of returning partial success', async () => {
    const error = { code: '23514', message: 'trace insert rejected' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(deriveOrder(source)).rejects.toEqual(error)
  })
  it('reports an unapplied atomic migration as schema not ready', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } })
    await expect(deriveOrder(source)).rejects.toThrow('DERIVE_TABLES_MISSING')
  })
  it('does not report success without a matching database receipt', async () => {
    mocks.rpc.mockResolvedValue({ data: 'different-id', error: null })
    await expect(deriveOrder(source)).rejects.toThrow('DERIVE_RECEIPT_MISMATCH')
  })
})

// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ org: vi.fn(), from: vi.fn(), filters: [] as unknown[][], email: null as unknown, connection: null as unknown }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: m.from } }))
vi.mock('./runtime-config', () => ({ resolvePublicShippingOrgId: m.org }))
import { loadPublicIntakeOptions } from './intake-options'
beforeEach(() => { m.org.mockResolvedValue('org-one'); m.email = null; m.connection = null; m.filters = []; m.from.mockImplementation((table: string) => { const b = { select: () => b, eq: (...args: unknown[]) => { m.filters.push(args); return b }, neq: () => b, maybeSingle: async () => ({ data: table === 'shipping_wecom_settings' ? m.email : table === 'shipping_intake_settings' ? null : m.connection, error: null }) }; return b }) })
it('opens anonymous intake without reading WeCom settings', async () => { const result = await loadPublicIntakeOptions(); expect(result.requireVerification).toBe(false); expect(result.emailAvailable).toBe(false); expect(result.services.map(s => s.id)).toEqual([2, 1]); expect(m.filters.filter(f => f[0] === 'org_id')).toEqual([['org_id', 'org-one'], ['org_id', 'org-one']]) })
it('returns only configured service metadata, not credentials, and excludes unsupported cross-border fields', async () => { m.connection = { credentials_ciphertext: 'secret', authorized_services: [{ id: 6, name: '顺丰即日', preference: 'urgent' }, { id: 99, name: '顺丰国际标快', preference: 'urgent' }] }; m.email = { order_check_mode: 1, directory_synced_at: '2026-10-10' }; const result = await loadPublicIntakeOptions(); expect(result.requireVerification).toBe(false); expect(result.services.map(s => s.id)).toEqual([6]); expect(JSON.stringify(result)).not.toContain('secret') })

it('keeps public intake anonymous regardless of legacy WeCom mode',async()=>{m.email={order_check_mode:1};expect((await loadPublicIntakeOptions()).requireVerification).toBe(false)})

it('does not query the enterprise directory or credentials to render public options',async()=>{await loadPublicIntakeOptions();expect(m.from.mock.calls.map(([table])=>table)).not.toContain('shipping_wecom_settings')})

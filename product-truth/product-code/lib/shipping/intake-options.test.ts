// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ org: vi.fn(), from: vi.fn(), filters: [] as unknown[][], email: null as unknown, connection: null as unknown }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: m.from } }))
vi.mock('./runtime-config', () => ({ resolvePublicShippingOrgId: m.org }))
import { loadPublicIntakeOptions } from './intake-options'
beforeEach(() => { m.org.mockResolvedValue('org-one'); m.email = null; m.connection = null; m.filters = []; m.from.mockImplementation((table: string) => { const b = { select: () => b, eq: (...args: unknown[]) => { m.filters.push(args); return b }, neq: () => b, maybeSingle: async () => ({ data: table === 'shipping_email_access_settings' ? m.email : m.connection, error: null }) }; return b }) })
it('allows anonymous intake with ordinary defaults before any carrier or mailbox setup', async () => { const result = await loadPublicIntakeOptions(); expect(result.requireVerification).toBe(false); expect(result.emailAvailable).toBe(false); expect(result.services.map(s => s.id)).toEqual([2, 1]); expect(m.filters.filter(f => f[0] === 'org_id')).toEqual([['org_id', 'org-one'], ['org_id', 'org-one']]) })
it('returns only configured service metadata, not credentials, and excludes unsupported cross-border fields', async () => { m.connection = { credentials_ciphertext: 'secret', authorized_services: [{ id: 6, name: '顺丰即日', preference: 'urgent' }, { id: 99, name: '顺丰国际标快', preference: 'urgent' }] }; m.email = { enabled: true, require_verification: true }; const result = await loadPublicIntakeOptions(); expect(result.requireVerification).toBe(true); expect(result.services.map(s => s.id)).toEqual([6]); expect(JSON.stringify(result)).not.toContain('secret') })

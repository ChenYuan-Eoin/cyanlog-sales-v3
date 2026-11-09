// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ org: vi.fn(), from: vi.fn(), filters: [] as unknown[][], email: null as unknown, connection: null as unknown, sender: null as unknown, senderError: null as unknown }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: m.from } }))
vi.mock('./runtime-config', () => ({ resolvePublicShippingOrgId: m.org }))
import { loadPublicIntakeOptions } from './intake-options'
beforeEach(() => { m.org.mockResolvedValue('org-one'); m.email = null; m.connection = null; m.sender = null; m.senderError = null; m.filters = []; m.from.mockImplementation((table: string) => { const b = { select: () => b, eq: (...args: unknown[]) => { m.filters.push(args); return b }, neq: () => b, maybeSingle: async () => ({ data: table === 'shipping_wecom_settings' ? m.email : table === 'shipping_intake_settings' ? null : table === 'shipping_sender_profiles' ? m.sender : m.connection, error: table === 'shipping_sender_profiles' ? m.senderError : null }) }; return b }) })
it('opens anonymous intake without reading WeCom settings', async () => { const result = await loadPublicIntakeOptions(); expect(result.requireVerification).toBe(false); expect(result.emailAvailable).toBe(false); expect(result.services.map(s => s.id)).toEqual([2, 1]); expect(m.filters.filter(f => f[0] === 'org_id')).toEqual([['org_id', 'org-one'], ['org_id', 'org-one'], ['org_id', 'org-one']]) })
it('returns only configured service metadata, not credentials, and excludes unsupported cross-border fields', async () => { m.connection = { credentials_ciphertext: 'secret', authorized_services: [{ id: 6, name: '顺丰即日', preference: 'urgent' }, { id: 99, name: '顺丰国际标快', preference: 'urgent' }] }; m.email = { order_check_mode: 1, directory_synced_at: '2026-10-10' }; const result = await loadPublicIntakeOptions(); expect(result.requireVerification).toBe(false); expect(result.services.map(s => s.id)).toEqual([6]); expect(JSON.stringify(result)).not.toContain('secret') })

it('keeps public intake anonymous regardless of legacy WeCom mode',async()=>{m.email={order_check_mode:1};expect((await loadPublicIntakeOptions()).requireVerification).toBe(false)})

it('does not query the enterprise directory or credentials to render public options',async()=>{await loadPublicIntakeOptions();expect(m.from.mock.calls.map(([table])=>table)).not.toContain('shipping_wecom_settings')})

it('returns only the configured company contact scoped to the public organization',async()=>{
 m.sender={name:'公司前台',phone:'13800138000',province:'广东省',city:'深圳市',county:'南山区',address:'公司路88号',org_id:'org-one',secret:'never expose'}
 const result=await loadPublicIntakeOptions()
 expect(result.companySender).toEqual({name:'公司前台',phone:'13800138000',province:'广东省',city:'深圳市',county:'南山区',address:'公司路88号'})
 expect(m.filters).toContainEqual(['is_default',true]);expect(JSON.stringify(result)).not.toContain('never expose')
})
it('keeps manual intake available if company default is missing or unreadable',async()=>{
 expect((await loadPublicIntakeOptions()).companySender).toBeNull()
 m.senderError={message:'unavailable'}
 expect(await loadPublicIntakeOptions()).toMatchObject({companySender:null,requireVerification:false})
})

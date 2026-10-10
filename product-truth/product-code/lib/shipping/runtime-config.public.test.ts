// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ from: vi.fn(), rows: [] as Array<Record<string, unknown>>, error: null as unknown }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))
import { getPublicShippingDefaults, resolvePublicShippingOrgId } from './runtime-config'

beforeEach(() => {
  mocks.rows = []; mocks.error = null
  mocks.from.mockReset().mockImplementation(() => {
    const builder = { select: () => builder, eq: () => builder, limit: async () => ({ data: mocks.rows, error: mocks.error }) }
    return builder
  })
})
describe('public intake organization binding', () => {
  it('reads sender and organization from one server-side configuration snapshot', async () => {
    mocks.rows = [{ org_id: 'org-A', name: '示例前台', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '示例路1号' }]
    expect(await getPublicShippingDefaults()).toEqual({ orgId: 'org-A', sender: { name: '示例前台', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '示例路1号' } })
    expect(mocks.from).toHaveBeenCalledTimes(1)
  })
  it('rejects an ambiguous public destination instead of choosing an organization', async () => {
    mocks.rows = [{ org_id: 'org-A' }, { org_id: 'org-B' }]
    await expect(getPublicShippingDefaults()).rejects.toMatchObject({ status: 503 })
  })
  it('rejects missing and unassigned configuration', async () => {
    await expect(getPublicShippingDefaults()).rejects.toMatchObject({ status: 503 })
    mocks.rows = [{ org_id: null }]
    await expect(getPublicShippingDefaults()).rejects.toMatchObject({ status: 503 })
  })
})

it('resolves anonymous intake without requiring a carrier connection or default sender', async () => {
  mocks.rows = [{ id: 'org-A' }]
  expect(await resolvePublicShippingOrgId()).toBe('org-A')
  expect(mocks.from).toHaveBeenCalledWith('organizations')
  mocks.rows = [{ id: 'org-A' }, { id: 'org-B' }]
  await expect(resolvePublicShippingOrgId()).rejects.toMatchObject({ status: 503 })
})

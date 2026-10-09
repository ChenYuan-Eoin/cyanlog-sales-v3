// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyContact } from './types'
const m = vi.hoisted(() => ({ from: vi.fn(), select: vi.fn(), eq: vi.fn(), single: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: m.from } }))
import { loadDefaultShippingSender } from './sender-profile'
beforeEach(() => {
  vi.resetAllMocks()
  const query = { select: m.select, eq: m.eq, maybeSingle: m.single }
  m.from.mockReturnValue(query); m.select.mockReturnValue(query); m.eq.mockReturnValue(query)
  m.single.mockResolvedValue({ data: null, error: null })
})
describe('organization sender profile read', () => {
  it('reads only the current organization default profile without carrier or account queries', async () => {
    const contact = { ...emptyContact(), name: '测试前台' }
    m.single.mockResolvedValue({ data: { ...contact, internal: 'not public' }, error: null })
    expect(await loadDefaultShippingSender('org-1')).toEqual(contact)
    expect(m.from.mock.calls).toEqual([['shipping_sender_profiles']])
    expect(m.eq.mock.calls).toEqual([['org_id', 'org-1'], ['is_default', true]])
  })
  it('represents missing configuration without inventing a contact', async () => {
    expect(await loadDefaultShippingSender('org-1')).toEqual(emptyContact())
  })
  it('does not silently treat read failure as a missing address', async () => {
    m.single.mockResolvedValue({ data: null, error: { message: 'private diagnostic' } })
    await expect(loadDefaultShippingSender('org-1')).rejects.toMatchObject({ status: 503, message: '默认寄件资料暂时无法读取，请稍后重试。' })
  })
  it('rejects an absent organization before querying', async () => {
    await expect(loadDefaultShippingSender('')).rejects.toMatchObject({ status: 403 })
    expect(m.from).not.toHaveBeenCalled()
  })
})

// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

type Row = { id: string; created_by: string; fingerprint: string; contact: Record<string, unknown>; updated_at: string; label: string }
const m = vi.hoisted(() => ({
  rows: new Map<string, Row>(),
  company: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}))
vi.mock('@/lib/shipping/sender-profile', () => ({ loadDefaultShippingSender: m.company }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: () => {
  const filters = new Map<string, unknown>()
  const query = {
    select: () => query,
    eq: (field: string, value: unknown) => { filters.set(field, value); return query },
    maybeSingle: async () => ({
      data: [...m.rows.values()].find(item => [...filters].every(([field, value]) => item[field as keyof Row] === value)) || null,
      error: null,
    }),
    update: (values: Partial<Row>) => {
      m.update(values)
      const updateQuery = {
        eq: (field: string, value: unknown) => { filters.set(field, value); return updateQuery },
        select: () => updateQuery,
        maybeSingle: async () => {
          const row = [...m.rows.values()].find(item => [...filters].every(([field, value]) => item[field as keyof Row] === value))
          if (!row) return { data: null, error: null }
          m.rows.set(row.created_by + ':' + row.fingerprint, { ...row, ...values })
          return { data: { id: row.id }, error: null }
        },
      }
      return updateQuery
    },
    insert: async (row: Row) => {
      m.insert(row)
      const key = row.created_by + ':' + row.fingerprint
      if (m.rows.has(key)) return { error: { code: '23505' } }
      m.rows.set(key, { ...row, id: 'new-sender' })
      return { error: null }
    },
  }
  return query
} } }))

import { loadFxiaokeSenderChoices, saveFxiaokeCommonSender } from './contacts'
const company = { name: '公司前台', phone: '13800138000', province: '广东省', city: '深圳市', county: '南山区', address: '公司路1号' }
const personal = { ...company, name: '揽收同事', phone: '13900139000', address: '个人路2号' }
const user = { id: 'person-a', display_name: '员工甲', phone: '13700137000', email: null }
const fingerprint = (orgId: string) => `sender:${createHash('sha256').update(orgId).digest('hex')}`
const version = '2026-11-13T01:00:00Z'
beforeEach(() => {
  m.rows.clear()
  m.insert.mockReset()
  m.update.mockReset()
  m.company.mockReset().mockResolvedValue(company)
  m.rows.set('person-a:' + fingerprint('org-current'), { id: 'contact-a', created_by: 'person-a', fingerprint: fingerprint('org-current'), contact: { ...personal, team: '销售部' }, updated_at: version, label: '我的常用寄方' })
})

it('loads only the current employee and organization sender while keeping pickup contacts separate from the login identity', async () => {
  const first = await loadFxiaokeSenderChoices(user, 'org-current')
  const second = await loadFxiaokeSenderChoices({ ...user, id: 'person-b', display_name: '员工乙' }, 'org-current')
  const otherOrg = await loadFxiaokeSenderChoices(user, 'org-other')
  expect(first.senderChoices.personal).toMatchObject({ name: '揽收同事', phone: '13900139000', address: '个人路2号' })
  expect(first.identityName).toBe('员工甲')
  expect(first.team).toBe('销售部')
  expect(second.senderChoices.personal).toBeNull()
  expect(second.senderSource).toBe('company')
  expect(otherOrg.senderChoices.personal).toBeNull()
  expect(second.sender).toMatchObject({ name: '公司前台', address: '公司路1号' })
})

it('saves the common sender without relabeling another address-book entry', async () => {
  const ordinary = { id: 'receiver-1', created_by: user.id, fingerprint: createHash('sha256').update(JSON.stringify(personal)).digest('hex'), contact: personal, updated_at: version, label: '客户地址' }
  m.rows.set(user.id + ':' + ordinary.fingerprint, ordinary)
  const saved = await saveFxiaokeCommonSender(user, 'org-current', personal, version, '市场部')
  expect(saved.team).toBe('市场部')
  expect(m.rows.get(user.id + ':' + ordinary.fingerprint)).toEqual(ordinary)
  expect(m.update).toHaveBeenCalledOnce()
  expect(m.insert).not.toHaveBeenCalled()
})

it('rejects stale or invalid sender changes before writing', async () => {
  await expect(saveFxiaokeCommonSender(user, 'org-current', personal, 'old-version')).rejects.toMatchObject({ status: 409 })
  await expect(saveFxiaokeCommonSender(user, 'org-current', { ...personal, phone: '' }, version)).rejects.toThrow()
  expect(m.update).not.toHaveBeenCalled()
})

it('creates a reserved sender row without touching an identical ordinary contact', async () => {
  m.rows.delete(user.id + ':' + fingerprint('org-current'))
  const ordinary = { id: 'receiver-1', created_by: user.id, fingerprint: createHash('sha256').update(JSON.stringify(personal)).digest('hex'), contact: personal, updated_at: version, label: '客户地址' }
  m.rows.set(user.id + ':' + ordinary.fingerprint, ordinary)
  await saveFxiaokeCommonSender(user, 'org-current', personal, '1970-01-01T00:00:00.000Z', '销售部')
  expect(m.insert).toHaveBeenCalledWith(expect.objectContaining({ created_by: user.id, fingerprint: fingerprint('org-current') }))
  expect(m.rows.get(user.id + ':' + ordinary.fingerprint)).toEqual(ordinary)
})

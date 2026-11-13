import { beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_INTAKE_RULES } from './intake-rules'

const m = vi.hoisted(() => ({ saved: null as unknown, upsert: vi.fn() }))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: { rules: m.saved }, error: null }),
        upsert: m.upsert,
      }
      return query
    },
  },
}))
vi.mock('./department-access', () => ({ validateShippingDepartmentRoots: vi.fn() }))
import { saveIntakeSettings } from './intake-settings'

const root = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
beforeEach(() => {
  m.saved = { ...DEFAULT_INTAKE_RULES, allowedDepartmentIds: [root] }
  m.upsert.mockReset().mockImplementation(async ({ rules }) => {
    m.saved = rules
    return { error: null }
  })
})

it('preserves an existing department restriction when an older settings client omits the new field', async () => {
  const legacyInput = { ...DEFAULT_INTAKE_RULES }
  delete legacyInput.allowedDepartmentIds
  const saved = await saveIntakeSettings('org-1', 'manager-1', legacyInput)
  expect(saved.allowedDepartmentIds).toEqual([root])
  expect(m.upsert.mock.calls[0][0].rules.allowedDepartmentIds).toEqual([root])
})

it('only clears the restriction when the manager explicitly selects all departments', async () => {
  const saved = await saveIntakeSettings('org-1', 'manager-1', DEFAULT_INTAKE_RULES)
  expect(saved.allowedDepartmentIds).toBeNull()
})

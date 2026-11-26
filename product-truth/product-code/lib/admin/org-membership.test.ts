import { beforeEach, expect, it, vi } from 'vitest'
import { supabaseAdmin } from '@/lib/supabase'
import { initializePrimaryDepartmentMembership } from './org-membership'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { rpc: vi.fn() } }))

const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const org = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const person = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const department = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

beforeEach(() => vi.clearAllMocks())

it('initializes the invited member link via its actor and exact organization', async () => {
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: true, error: null } as never)
  await initializePrimaryDepartmentMembership(actor, org, person, department)
  expect(supabaseAdmin.rpc).toHaveBeenCalledWith('admin_change_manual_department_membership_v1', {
    p_actor_id: actor, p_org_id: org, p_user_id: person, p_department_ids: [department], p_action: 'initialize',
  })
})

it('reports unmet target preconditions and keeps the database authorization error', async () => {
  vi.mocked(supabaseAdmin.rpc).mockResolvedValueOnce({ data: false, error: null } as never)
  await expect(initializePrimaryDepartmentMembership(actor, org, person, department))
    .rejects.toThrow('PRIMARY_DEPARTMENT_SYNC_FAILED')
  const error = { code: '42501', details: 'DEPARTMENT_LEDGER_MEMBERSHIP_FORBIDDEN' }
  vi.mocked(supabaseAdmin.rpc).mockResolvedValueOnce({ data: null, error } as never)
  await expect(initializePrimaryDepartmentMembership(actor, org, person, department)).rejects.toEqual(error)
})

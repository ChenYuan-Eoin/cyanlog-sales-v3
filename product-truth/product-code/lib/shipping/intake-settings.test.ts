import { beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_INTAKE_RULES } from './intake-rules'

const m = vi.hoisted(() => ({ saved: null as unknown, writes: [] as unknown[], conflict: false, rpc: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { rpc: m.rpc, from: () => {
 let values: {rules:unknown}|null=null
 let expected: string|undefined
 const query = {
  select: () => query,
  eq: (field:string,value:string) => {if(field==='rules')expected=value;return query},
  update: (next:{rules:unknown}) => {values=next;return query},
  insert: async (next:{rules:unknown}) => {m.saved=next.rules;m.writes.push(next);return {error:null}},
  maybeSingle: async () => {
   if(!values)return {data:m.saved === undefined ? null : {rules:structuredClone(m.saved)},error:null}
   if(m.conflict || expected!==JSON.stringify(m.saved))return {data:null,error:null}
   m.saved=values.rules;m.writes.push(values);return {data:{org_id:'org-1'},error:null}
  },
 }
 return query
} } }))
import { saveIntakeDepartmentScope, saveIntakeSettings } from './intake-settings'

const root = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
beforeEach(() => {
  m.saved = { ...DEFAULT_INTAKE_RULES, allowedDepartmentIds: [root] }
  m.writes=[];m.conflict=false
  m.rpc.mockReset().mockImplementation(async (_method, args) => {
    if (args.p_expected_rules !== null && JSON.stringify(args.p_expected_rules) !== JSON.stringify(m.saved)) {
      return { data: null, error: { code: '40001' } }
    }
    m.saved = { ...(m.saved ?? DEFAULT_INTAKE_RULES) as Record<string, unknown>, allowedDepartmentIds: args.p_allowed_department_ids }
    return { data: m.saved, error: null }
  })
})

it.each([
  { companyName: DEFAULT_INTAKE_RULES.companyName, allowedDepartmentIds: null },
  { companyName: DEFAULT_INTAKE_RULES.companyName, allowedDepartmentIds: [root] },
  { companyName: DEFAULT_INTAKE_RULES.companyName, teamOptions: ['部门 A'] },
  { allowedDepartmentIds: [root] },
  {},
])('rejects a non-business field or missing company rule before writing %j', async input => {
  await expect(saveIntakeSettings('org-1', 'manager-1', input)).rejects.toBeInstanceOf(Error)
  expect(m.writes).toEqual([])
  expect(m.rpc).not.toHaveBeenCalled()
})

it.each([
  { allowedDepartmentIds: null },
  { allowedDepartmentIds: [root], companyName: DEFAULT_INTAKE_RULES.companyName },
  {},
])('rejects an implicit or mixed scope edit before writing %j', async input => {
  await expect(saveIntakeDepartmentScope('org-1', 'root-1', input)).rejects.toBeInstanceOf(Error)
  expect(m.writes).toEqual([])
  expect(m.rpc).not.toHaveBeenCalled()
})

it('updates field rules without overwriting current department authorization', async () => {
  const saved = await saveIntakeSettings('org-1', 'manager-1', { companyName: { enabled: true, required: true, minLength: 8 } })
  expect(saved.allowedDepartmentIds).toEqual([root])
  expect(saved.companyName.minLength).toBe(8)
  expect(m.rpc).not.toHaveBeenCalled()
})

it('updates department authorization without overwriting current field rules', async () => {
  m.saved = { ...DEFAULT_INTAKE_RULES, companyName: { enabled: true, required: true, minLength: 9 } }
  const expected = structuredClone(m.saved)
  const saved = await saveIntakeDepartmentScope('org-1', 'root-1', { allowedDepartmentIds: [root] })
  expect(saved.companyName.minLength).toBe(9)
  expect(saved.allowedDepartmentIds).toEqual([root])
  expect(m.rpc).toHaveBeenCalledExactlyOnceWith('admin_set_shipping_intake_departments_v1', {
    p_actor_id: 'root-1', p_org_id: 'org-1', p_expected_rules: expected, p_allowed_department_ids: [root],
  })
  expect(m.writes).toEqual([])
})

it('rejects a stale overlapping save instead of reopening a restricted department policy', async () => {
 m.conflict=true
 await expect(saveIntakeSettings('org-1','manager',{companyName:{enabled:true,required:true,minLength:8}})).rejects.toMatchObject({status:409})
 expect((m.saved as {allowedDepartmentIds:string[]}).allowedDepartmentIds).toEqual([root])
 expect(m.writes).toEqual([])
})


it('accepts an empty explicit scope and never expands it to all departments', async () => {
  const saved = await saveIntakeDepartmentScope('org-1', 'root-1', { allowedDepartmentIds: [] })
  expect(saved.allowedDepartmentIds).toEqual([])
  expect(m.rpc).toHaveBeenCalledExactlyOnceWith('admin_set_shipping_intake_departments_v1', expect.objectContaining({
    p_allowed_department_ids: [],
  }))
})

it('uses the absent-row snapshot for the first independent scope save', async () => {
  m.saved = undefined
  const saved = await saveIntakeDepartmentScope('org-1', 'root-1', { allowedDepartmentIds: [root] })
  expect(saved).toEqual({ ...DEFAULT_INTAKE_RULES, allowedDepartmentIds: [root] })
  expect(m.rpc).toHaveBeenCalledExactlyOnceWith('admin_set_shipping_intake_departments_v1', expect.objectContaining({ p_expected_rules: null }))
})

it.each([
  ['42501', 403], ['40001', 409], ['22023', 400], ['23514', 400], ['PGRST202', 503],
])('reports guarded database errors without falling back to a direct write (%s)', async (code, status) => {
  const before = structuredClone(m.saved)
  m.rpc.mockResolvedValueOnce({ data: null, error: { code } })
  await expect(saveIntakeDepartmentScope('org-1', 'root-1', { allowedDepartmentIds: [] })).rejects.toMatchObject({ status })
  expect(m.saved).toEqual(before)
  expect(m.writes).toEqual([])
})

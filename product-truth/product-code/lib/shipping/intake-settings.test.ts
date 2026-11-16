import { beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_INTAKE_RULES } from './intake-rules'

const m = vi.hoisted(() => ({ saved: null as unknown, writes: [] as unknown[], conflict: false }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: () => {
 let values: {rules:unknown}|null=null
 let expected: string|undefined
 const query = {
  select: () => query,
  eq: (field:string,value:string) => {if(field==='rules')expected=value;return query},
  update: (next:{rules:unknown}) => {values=next;return query},
  insert: async (next:{rules:unknown}) => {m.saved=next.rules;m.writes.push(next);return {error:null}},
  maybeSingle: async () => {
   if(!values)return {data:{rules:structuredClone(m.saved)},error:null}
   if(m.conflict || expected!==JSON.stringify(m.saved))return {data:null,error:null}
   m.saved=values.rules;m.writes.push(values);return {data:{org_id:'org-1'},error:null}
  },
 }
 return query
} } }))
vi.mock('./department-access', () => ({ validateShippingDepartmentRoots: vi.fn() }))
import { saveIntakeSettings } from './intake-settings'

const root = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
beforeEach(() => {
  m.saved = { ...DEFAULT_INTAKE_RULES, allowedDepartmentIds: [root] }
  m.writes=[];m.conflict=false
})

it('preserves an existing department restriction when an older settings client omits the new field', async () => {
  const legacyInput = { ...DEFAULT_INTAKE_RULES }
  delete legacyInput.allowedDepartmentIds
  const saved = await saveIntakeSettings('org-1', 'manager-1', legacyInput)
  expect(saved.allowedDepartmentIds).toEqual([root])
  expect((m.writes[0] as {rules:{allowedDepartmentIds:string[]}}).rules.allowedDepartmentIds).toEqual([root])
})

it('only clears the restriction when the manager explicitly selects all departments', async () => {
  const saved = await saveIntakeSettings('org-1', 'manager-1', DEFAULT_INTAKE_RULES)
  expect(saved.allowedDepartmentIds).toBeNull()
})

it('updates field rules without overwriting current department authorization', async () => {
  const saved = await saveIntakeSettings('org-1', 'manager-1', { companyName: { enabled: true, required: true, minLength: 8 } })
  expect(saved.allowedDepartmentIds).toEqual([root])
  expect(saved.companyName.minLength).toBe(8)
})

it('updates department authorization without overwriting current field rules', async () => {
  m.saved = { ...DEFAULT_INTAKE_RULES, companyName: { enabled: true, required: true, minLength: 9 } }
  const saved = await saveIntakeSettings('org-1', 'manager-1', { allowedDepartmentIds: [root] })
  expect(saved.companyName.minLength).toBe(9)
  expect(saved.allowedDepartmentIds).toEqual([root])
})

it('rejects a stale overlapping save instead of reopening a restricted department policy', async () => {
 m.conflict=true
 await expect(saveIntakeSettings('org-1','manager',{companyName:{enabled:true,required:true,minLength:8}})).rejects.toMatchObject({status:409})
 expect((m.saved as {allowedDepartmentIds:string[]}).allowedDepartmentIds).toEqual([root])
 expect(m.writes).toEqual([])
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/supabase',()=>({supabaseAdmin:{rpc:vi.fn(),from:vi.fn()}}))
vi.mock('@/lib/scoped-access',()=>({getFreshDefaultOrgId:vi.fn(async()=> 'org-current'),listAccessibleSalesSpaces:vi.fn(async()=>({assignments:[],spaces:[]}))}))
vi.mock('@/lib/org-role-permissions',()=>({loadOrgRolePermissionSettings:vi.fn(async()=>({}))}))
import { supabaseAdmin } from '@/lib/supabase'
import { loadOrgRolePermissionSettings } from '@/lib/org-role-permissions'
import { getFreshDefaultOrgId, listAccessibleSalesSpaces } from '@/lib/scoped-access'
import { getDashboardPayload, getCachedDashboardPayload, cacheDashboardPayload, getPersonalDashboardData, type DashboardPayload } from './dashboard-data'
const payload:DashboardPayload={spaces:[],activeSpace:null,opportunities:[],milestones:[],reminders:[],agenda:[]}
const user={id:'dashboard-role-user',email:null,phone:null,display_name:null,org_id:'org-stale'}

function queryFor(data: unknown[]) {
  const query = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), or: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data, error: null }),
    in: vi.fn().mockResolvedValue({ data, error: null }),
  }
  return query
}

describe('personal workbench organization scope', () => {
  it('queries only current-organization reminders and personal agenda without delegating to another module', async () => {
    const orgId = 'org-current'
    const userId = user.id
    const reminder = { id: 'owned-reminder', org_id: orgId, user_id: userId }
    const item = { id: 'owned-item', org_id: orgId, assignee_id: userId, start_at: '2026-11-25T03:00:00Z' }
    const reminders = queryFor([reminder, { ...reminder, id: 'foreign', org_id: 'foreign-org' }])
    const agenda = queryFor([item, { ...item, id: 'other', assignee_id: 'someone-else' }])
    vi.mocked(supabaseAdmin.from).mockReset()
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(reminders as never).mockReturnValueOnce(agenda as never)
    const result = await getPersonalDashboardData(userId, orgId)
    expect(result.reminders.map(row => row.id)).toEqual(['owned-reminder'])
    expect(result.agenda.map(row => row.id)).toEqual(['owned-item'])
    expect(reminders.eq).toHaveBeenCalledWith('org_id', orgId)
    expect(reminders.eq).toHaveBeenCalledWith('user_id', userId)
    expect(agenda.eq).toHaveBeenCalledWith('org_id', orgId)
    expect(agenda.or).toHaveBeenCalledWith(expect.stringContaining(`assignee_id.eq.${userId}`))
  })
})

describe('dashboard authorization-sensitive cache',()=>{
 beforeEach(()=>{
   vi.clearAllMocks()
   vi.mocked(supabaseAdmin.from).mockReturnValue(queryFor([]) as never)
   vi.mocked(loadOrgRolePermissionSettings).mockResolvedValue({})
   vi.mocked(getFreshDefaultOrgId).mockResolvedValue('org-current')
   vi.mocked(supabaseAdmin.rpc).mockResolvedValue({data:payload,error:null} as never)
 })
 it('覆盖创建后绕过已有RPC缓存并以当前组织重新计算空间',async()=>{
   await getDashboardPayload(user)
   expect(supabaseAdmin.rpc).toHaveBeenCalledWith('get_dashboard_payload_v1',expect.objectContaining({p_org_id:'org-current'}))
   vi.mocked(loadOrgRolePermissionSettings).mockResolvedValue({role_permission_overrides:{root:[]}})
   await getDashboardPayload(user)
   expect(supabaseAdmin.rpc).toHaveBeenCalledTimes(1)
   expect(listAccessibleSalesSpaces).toHaveBeenCalledWith(user.id,'org-current')
 })
 it('覆盖读取失败不会返回缓存中的可见数据',async()=>{
   vi.mocked(loadOrgRolePermissionSettings).mockRejectedValueOnce(new Error('permissions unavailable'))
   await expect(getDashboardPayload(user)).rejects.toThrow('permissions unavailable')
 })
 it('登录响应不读取未经新鲜授权核验的同步预热缓存',()=>{
   cacheDashboardPayload(user,payload)
   expect(getCachedDashboardPayload(user)).toBeNull()
 })
})

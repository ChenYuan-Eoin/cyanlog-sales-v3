import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/supabase',()=>({supabaseAdmin:{rpc:vi.fn(),from:vi.fn()}}))
vi.mock('@/lib/scoped-access',()=>({getFreshDefaultOrgId:vi.fn(async()=> 'org-current'),listAccessibleSalesSpaces:vi.fn(async()=>({assignments:[],spaces:[]}))}))
vi.mock('@/lib/org-role-permissions',()=>({loadOrgRolePermissionSettings:vi.fn(async()=>({}))}))
import { supabaseAdmin } from '@/lib/supabase'
import { loadOrgRolePermissionSettings } from '@/lib/org-role-permissions'
import { getFreshDefaultOrgId, listAccessibleSalesSpaces } from '@/lib/scoped-access'
import { getDashboardPayload, getCachedDashboardPayload, cacheDashboardPayload, type DashboardPayload } from './dashboard-data'
const payload:DashboardPayload={spaces:[],activeSpace:null,opportunities:[],milestones:[],reminders:[],agenda:[]}
const user={id:'dashboard-role-user',email:null,phone:null,display_name:null,org_id:'org-stale'}

describe('dashboard authorization-sensitive cache',()=>{
 beforeEach(()=>{vi.clearAllMocks();vi.mocked(loadOrgRolePermissionSettings).mockResolvedValue({});vi.mocked(getFreshDefaultOrgId).mockResolvedValue('org-current');vi.mocked(supabaseAdmin.rpc).mockResolvedValue({data:payload,error:null} as never)})
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

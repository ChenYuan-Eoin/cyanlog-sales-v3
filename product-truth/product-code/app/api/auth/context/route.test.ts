import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/auth',()=>({requireAuth:vi.fn(async()=>({id:'user-1'}))}))
vi.mock('@/lib/auth-token',()=>({getRequestAuthToken:vi.fn(()=> 'token')}))
vi.mock('@/lib/auth-context-cookie',()=>({AUTH_CONTEXT_COOKIE_MAX_AGE_SECONDS:15,AUTH_CONTEXT_COOKIE_NAME:'auth_context',createAuthContextCookieValue:vi.fn(async()=> 'signed')}))
vi.mock('@/lib/scoped-access',()=>({getDefaultOrgId:vi.fn(async()=> 'org-a'),getUserScopedRoleAssignments:vi.fn(async()=>[]),getOrgRoleCodes:vi.fn(()=>['SUPER_ADMIN']),getOrgAuthorizationRoleCodes:vi.fn(()=>[]),getOrgPermissions:vi.fn(()=>['config:read'])}))
vi.mock('@/lib/supabase',()=>({supabaseAdmin:{from:vi.fn()}}))
import { supabaseAdmin } from '@/lib/supabase'
import { createAuthContextCookieValue } from '@/lib/auth-context-cookie'
import { POST } from './route'
import type { NextRequest } from 'next/server'

describe('auth context role overrides',()=>{
 beforeEach(()=>{
   vi.clearAllMocks()
   const query={select:vi.fn(),eq:vi.fn(),single:vi.fn(async()=>({data:{must_change_password:false},error:null}))}
   query.select.mockReturnValue(query);query.eq.mockReturnValue(query)
   vi.mocked(supabaseAdmin.from).mockReturnValue(query as never)
 })
 it('保留超管身份但签名上下文不能重新补全通配权限',async()=>{
   const response=await POST({} as NextRequest)
   expect(response.status).toBe(200)
   expect(createAuthContextCookieValue).toHaveBeenCalledWith('token',expect.objectContaining({roleCodes:['SUPER_ADMIN'],allPermissions:['config:read']}))
 })
})

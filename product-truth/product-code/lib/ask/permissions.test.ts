import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {from:vi.fn()} }))
import { canManageAllAsks } from './permissions'
import type { ScopedRoleAssignment } from '@/lib/scoped-access'

describe('ask effective role permissions', () => {
  it('覆盖后的管理员身份不能绕过合同权限撤销', () => {
    const assignment:ScopedRoleAssignment = {scopeType:'org',scopeId:'org-a',grantedAt:null,
      roleId:'root',roleCode:'SUPER_ADMIN',roleName:'超管',permissions:[],permissionsOverridden:true}
    expect(canManageAllAsks([assignment],'org-a')).toBe(false)
    expect(canManageAllAsks([{...assignment,permissions:['contract:review']}],'org-a')).toBe(true)
  })
})

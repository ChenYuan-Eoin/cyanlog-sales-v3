import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/scoped-access', () => ({getDefaultOrgId:vi.fn(async()=> 'org-a'),
 getUserScopedRoleAssignments:vi.fn(async()=>[]),getOrgAuthorizationRoleCodes:vi.fn(()=>[]),getOrgPermissions:vi.fn(()=>[])}))
import { getOrgPermissions, getOrgAuthorizationRoleCodes } from '@/lib/scoped-access'
import { requireShippingConnectionManager } from './connection-authorization'

describe('shipping connection effective authority',()=>{
 beforeEach(()=>{vi.clearAllMocks();vi.mocked(getOrgPermissions).mockReturnValue([]);vi.mocked(getOrgAuthorizationRoleCodes).mockReturnValue([])})
 it('覆盖后的管理员必须拥有连接管理权限',async()=>{
   await expect(requireShippingConnectionManager('root')).rejects.toThrow('需要寄件连接管理权限')
   vi.mocked(getOrgPermissions).mockReturnValue(['shipping:manage_connections'])
   await expect(requireShippingConnectionManager('root')).resolves.toBe('org-a')
 })
 it('未覆盖的系统管理员保留既有兼容授权',async()=>{
   vi.mocked(getOrgAuthorizationRoleCodes).mockReturnValue(['ADMIN'])
   await expect(requireShippingConnectionManager('admin')).resolves.toBe('org-a')
 })
})

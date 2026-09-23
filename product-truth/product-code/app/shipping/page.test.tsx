// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const m=vi.hoisted(()=>({token:vi.fn(),user:vi.fn(),redirect:vi.fn()}))
vi.mock('@/lib/server-auth',()=>({getServerAuthToken:m.token}))
vi.mock('@/lib/auth',()=>({getAuthUserByToken:m.user}))
vi.mock('next/navigation',()=>({redirect:m.redirect}))
import ShippingPage from './page'
beforeEach(()=>{m.token.mockReset();m.user.mockReset();m.redirect.mockReset();m.redirect.mockImplementation((path:string)=>{throw new Error(`redirect:${path}`)});vi.stubEnv('SHIPPING_ALLOWED_USER_IDS','owner')})
describe('self-service shipping workbench access',()=>{
 it('requires login for the operator workbench',async()=>{m.token.mockResolvedValue(undefined);await expect(ShippingPage()).rejects.toThrow('redirect:/login')})
 it('rejects a non-allowlisted account',async()=>{m.token.mockResolvedValue('token');m.user.mockResolvedValue({id:'outsider'});await expect(ShippingPage()).rejects.toThrow('redirect:/?denied=shipping:operate')})
 it('renders the three-column workbench for an allowed operator',async()=>{m.token.mockResolvedValue('token');m.user.mockResolvedValue({id:'owner'});const page=await ShippingPage();expect(page.type.name).toBe('ShippingWorkbench')})
})

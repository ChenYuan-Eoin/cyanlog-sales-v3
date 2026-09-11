// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const m=vi.hoisted(()=>({token:vi.fn(),user:vi.fn(),last:vi.fn()}))
vi.mock('@/lib/server-auth',()=>({getServerAuthToken:m.token}))
vi.mock('@/lib/auth',()=>({getAuthUserByToken:m.user}))
vi.mock('@/lib/shipping/contacts',()=>({lastShippingInput:m.last}))
import ShippingPage from './page'
beforeEach(()=>{m.token.mockReset();m.user.mockReset();m.last.mockReset();vi.stubEnv('SHIPPING_ALLOWED_USER_IDS','owner');vi.stubEnv('SF_MONTHLY_CARD','private-card');vi.stubEnv('SHIPPING_SENDER_JSON','{"name":"private sender","phone":"13800000000","address":"private office"}')})
describe('anonymous shipping page privacy',()=>{
 it('is accessible without login but strips private settings',async()=>{m.token.mockResolvedValue(undefined);const page=await ShippingPage();expect(page.props.settings).toMatchObject({guest:true,monthlyTail:'',canSubmit:false,sender:{name:'',phone:'',address:''}});expect(m.last).not.toHaveBeenCalled()})
 it('does not reveal another account defaults to non-allowlisted users',async()=>{m.token.mockResolvedValue('token');m.user.mockResolvedValue({id:'outsider'});const page=await ShippingPage();expect(page.props.settings.guest).toBe(true);expect(m.last).not.toHaveBeenCalled()})
 it('loads remembered input only for the owner',async()=>{m.token.mockResolvedValue('token');m.user.mockResolvedValue({id:'owner'});m.last.mockResolvedValue({cargo:'文件'});const page=await ShippingPage();expect(page.props.settings.lastShipment).toEqual({cargo:'文件'});expect(m.last.mock.calls[0][0]).toBe('owner')})
})

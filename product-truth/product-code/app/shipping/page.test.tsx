// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const m=vi.hoisted(()=>({token:vi.fn(),user:vi.fn(),redirect:vi.fn(),manager:vi.fn(),operator:vi.fn(),settings:vi.fn(),session:vi.fn(),org:vi.fn(),options:vi.fn(),profile:vi.fn()}))
vi.mock('@/lib/server-auth',()=>({getServerAuthToken:m.token}))
vi.mock('@/lib/auth',()=>({getAuthUserByToken:m.user}))
vi.mock('@/lib/shipping/workspace-settings',()=>({loadShippingWorkspaceSettings:m.settings}))
vi.mock('@/lib/shipping/connection-authorization',()=>({requireShippingConnectionManager:async()=>{if(!m.manager())throw new Error('not a manager')}}))
vi.mock('@/lib/shipping/operator-access',()=>({requireShippingOperator:m.operator}))
vi.mock('@/lib/supabase',()=>({supabaseAdmin:{from:()=>({select:()=>({eq:()=>({maybeSingle:m.session})})})}}))
vi.mock('@/lib/scoped-access',()=>({getDefaultOrgId:m.org}))
vi.mock('@/lib/shipping/intake-options',()=>({loadIntakeOptionsForOrg:m.options}))
vi.mock('@/lib/shipping/contacts',()=>({loadFxiaokeSenderChoices:m.profile}))
vi.mock('next/navigation',()=>({redirect:m.redirect}))
import ShippingPage from './page'
import { ShippingError } from '@/lib/shipping/config'
beforeEach(()=>{m.token.mockReset();m.user.mockReset();m.redirect.mockReset();m.manager.mockReset();m.operator.mockReset();m.session.mockReset().mockResolvedValue({data:null,error:null});m.org.mockReset().mockResolvedValue('org-1');m.options.mockReset().mockResolvedValue({rules:{companyName:{enabled:true,required:true,minLength:4},team:{enabled:true,required:true,minLength:1},teamOptions:[]},services:[{id:2,name:'顺丰标快'}]});m.profile.mockReset().mockResolvedValue({id:'member',fxiaoke:true,sender:{name:'李娜',phone:'13800138000',province:'广东省',city:'深圳市',county:'南山区',address:'地址1号'},senderChoices:{company:null,personal:null},senderSource:'custom',team:'',updatedAt:'1970-01-01T00:00:00.000Z'});m.settings.mockReset().mockResolvedValue({environment:'sandbox',ready:false,reason:'',services:[],monthlyTail:'',sender:{name:'',phone:'',province:'',city:'',county:'',address:''},canSubmit:false});m.manager.mockReturnValue(false);m.operator.mockRejectedValue(new ShippingError(403,'denied'));m.redirect.mockImplementation((path:string)=>{throw new Error(`redirect:${path}`)})})
describe('self-service shipping workbench access',()=>{
 it('requires login for the operator workbench',async()=>{m.token.mockResolvedValue(undefined);await expect(ShippingPage()).rejects.toThrow('redirect:/login')})
 it('rejects a member without the database-backed operator permission',async()=>{m.token.mockResolvedValue('token');m.user.mockResolvedValue({id:'outsider'});await expect(ShippingPage()).rejects.toThrow('redirect:/?denied=shipping:operate')})
 it('shows the proposal form to a verified Fxiaoke member without operator access',async()=>{m.token.mockResolvedValue('token');m.user.mockResolvedValue({id:'member',display_name:'李娜',phone:'13800138000'});m.session.mockResolvedValue({data:{user_id:'member',auth_method:'fxiaoke'},error:null});const page=await ShippingPage();expect(page.props.children.type.name).toBe('FxiaokeShippingProposal');expect(page.props.children.props.profile).toMatchObject({id:'member',fxiaoke:true});expect(m.profile).toHaveBeenCalledWith({id:'member',display_name:'李娜',phone:'13800138000'},'org-1');expect(m.options).toHaveBeenCalledWith('org-1');expect(m.settings).not.toHaveBeenCalled()})
 it('keeps a Fxiaoke connection manager on the proposal page when not an operator',async()=>{m.token.mockResolvedValue('token');m.user.mockResolvedValue({id:'manager'});m.manager.mockReturnValue(true);m.session.mockResolvedValue({data:{user_id:'manager',auth_method:'fxiaoke'},error:null});const page=await ShippingPage();expect(page.props.children.type.name).toBe('FxiaokeShippingProposal')})
 it('routes a connection manager without operator access to Config Center',async()=>{m.token.mockResolvedValue('token');m.user.mockResolvedValue({id:'manager'});m.manager.mockReturnValue(true);await expect(ShippingPage()).rejects.toThrow('redirect:/configs?tab=shipping')})
 it('renders the three-column workbench from the same server-authorized organization',async()=>{m.token.mockResolvedValue('token');m.user.mockResolvedValue({id:'operator'});m.operator.mockResolvedValue('org-1');const page=await ShippingPage();expect(page.type.name).toBe('ShippingWorkbench');expect(m.settings).toHaveBeenCalledWith('org-1')})
})

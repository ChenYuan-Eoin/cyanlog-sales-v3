import React from 'react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import EmployeeAccess from './employee-access'
const fetcher=vi.fn()
const profile={id:'staff-1',email:'',wecom:true,companyName:'示例企业',team:'华南组',updatedAt:'2026-10-10T00:00:00Z',phoneSource:'wecom' as const,sender:{name:'陈源',phone:'13800000000',province:'广东省',city:'深圳市',county:'南山区',address:'示例路88号'}}
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status})
beforeEach(()=>{vi.stubGlobal('React',React);vi.stubGlobal('fetch',fetcher);fetcher.mockReset();localStorage.clear();fetcher.mockImplementation(async()=>response({employee:profile,orders:[]}))})
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
function mount(required=true){return render(<EmployeeAccess requireVerification={required}>{({controls,identityControls,canSubmit})=><>{identityControls}{controls}<button disabled={!canSubmit}>提报就绪</button></>}</EmployeeAccess>)}
it('keeps the form hidden before whitelist identity is verified',async()=>{fetcher.mockResolvedValue(response({employee:null}));mount();expect(screen.queryByLabelText('寄件人姓名')).toBeNull();expect(await screen.findByRole('link',{name:'使用企业微信验证身份'})).toBeTruthy();expect(screen.queryByLabelText('公司邮箱')).toBeNull()})
it('locks identity fields and parses only pickup address for a WeCom member',async()=>{
 mount();fireEvent.click(await screen.findByRole('button',{name:'更换揽收地址'}));const name=await screen.findByLabelText('寄件人姓名');expect(name).toHaveProperty('disabled',true);expect(screen.getByLabelText('寄件人联系电话')).toHaveProperty('disabled',true);expect(screen.getByLabelText('所属团队')).toHaveProperty('disabled',true)
 fireEvent.change(screen.getByLabelText('寄方地址文本'),{target:{value:'李四 13900000000 广东省深圳市福田区另一条街99号'}});fireEvent.click(screen.getByRole('button',{name:'解析寄方信息'}))
 expect(name).toHaveProperty('value','陈源');expect(screen.getByLabelText('寄件人联系电话')).toHaveProperty('value','13800000000');expect(screen.getByLabelText('寄件区县')).toHaveProperty('value','福田区')
 fireEvent.click(screen.getByRole('button',{name:'使用此地址'}));expect(screen.getByRole('button',{name:'提报就绪'})).toHaveProperty('disabled',false)
})
it('does not degrade a whitelist identity outage to anonymous intake',async()=>{fetcher.mockResolvedValue(response({error:'身份服务不可用'},503));mount();await screen.findByText('身份服务不可用');expect(screen.queryByLabelText('寄件人姓名')).toBeNull()})
it('revokes and clears identity before allowing a different user',async()=>{
 fetcher.mockImplementation(async(_url:string,init?:RequestInit)=>response(init?.method==='POST'?{employee:null}:{employee:profile,orders:[]}));mount();await screen.findByText('企业微信身份已验证');fireEvent.click(screen.getByText('账号'));fireEvent.click(await screen.findByRole('button',{name:'退出 / 换人'}));await screen.findByRole('link',{name:'使用企业微信验证身份'});expect(screen.queryByLabelText('寄件人姓名')).toBeNull();expect(JSON.parse(fetcher.mock.calls.find(([,init])=>init?.method==='POST')![1].body)).toEqual({action:'logout'})
})
it('keeps administrator-enabled open intake usable without an email verification step',async()=>{
 fetcher.mockResolvedValue(response({employee:null}));render(<EmployeeAccess requireVerification={false} rules={{companyName:{enabled:true,required:true,minLength:4},team:{enabled:false,required:false,minLength:1},teamOptions:[]}}>{({controls,identityControls,canSubmit})=><>{identityControls}{controls}<button disabled={!canSubmit}>提报就绪</button></>}</EmployeeAccess>)
 fireEvent.change(await screen.findByLabelText('寄方地址文本'),{target:{value:'张三 13800000000 广东省深圳市南山区科苑路15号'}});fireEvent.click(screen.getByRole('button',{name:'解析寄方信息'}));fireEvent.click(screen.getByRole('button',{name:'使用此地址'}));await waitFor(()=>expect(screen.getByRole('button',{name:'提报就绪'})).toHaveProperty('disabled',false));expect(screen.queryByLabelText('公司邮箱')).toBeNull();expect(fetcher).not.toHaveBeenCalled()
})

 it('preserves saved pickup details when a new paste is not a complete address',async()=>{
  mount();fireEvent.click(await screen.findByRole('button',{name:'更换揽收地址'}));await screen.findByLabelText('寄方地址文本')
  fireEvent.change(screen.getByLabelText('寄方地址文本'),{target:{value:'这里没有可以识别的地区'}})
  fireEvent.click(screen.getByRole('button',{name:'解析寄方信息'}))
  expect(screen.getByLabelText('寄件省份')).toHaveProperty('value','广东省')
  expect(screen.getByLabelText('详细寄件地址')).toHaveProperty('value','示例路88号')
  expect(screen.getByRole('status').textContent).toContain('现有寄方资料已保留')
 })

it('selects company pickup without overwriting verified identity and cancels unsaved edits',async()=>{
 const company={...profile.sender,address:'公司默认路16号'}
 fetcher.mockImplementation(async()=>response({employee:{...profile,senderChoices:{company,personal:profile.sender},senderSource:'personal'}}))
 render(<EmployeeAccess requireVerification>{({controls,identityControls,sender,canSubmit})=><>{identityControls}{controls}<output aria-label="当前寄件地址">{sender.name}|{sender.phone}|{sender.address}</output><button disabled={!canSubmit}>提报就绪</button></>}</EmployeeAccess>)
 fireEvent.click(await screen.findByRole('radio',{name:/公司默认/}))
 expect(screen.getByLabelText('当前寄件地址').textContent).toBe('陈源|13800000000|公司默认路16号')
 fireEvent.click(screen.getByRole('button',{name:'更换揽收地址'}));fireEvent.change(screen.getByLabelText('详细寄件地址'),{target:{value:'未保存路99号'}})
 expect(screen.getByRole('button',{name:'提报就绪'})).toHaveProperty('disabled',true)
 fireEvent.click(screen.getByRole('button',{name:'取消编辑'}))
 expect(screen.getByLabelText('当前寄件地址').textContent).toContain('公司默认路16号')
 expect(fetcher.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(0)
})
it('refreshes identity without discarding an edited address and preserves draft on save failure',async()=>{
 mount();fireEvent.click(await screen.findByRole('button',{name:'更换揽收地址'}));fireEvent.change(screen.getByLabelText('详细寄件地址'),{target:{value:'待保存路99号'}})
 fireEvent.click(screen.getByText('账号'));fireEvent.click(screen.getByRole('button',{name:'刷新寄件资料'}))
 await screen.findByText('企业资料已刷新，本次地址和未保存内容已保留。')
 expect(screen.getByLabelText('详细寄件地址')).toHaveProperty('value','待保存路99号')
 fetcher.mockResolvedValueOnce(response({error:'资料已变化，请重新读取后保存。'},409))
 fireEvent.click(screen.getByLabelText('同时保存为我的常用地址'));fireEvent.click(screen.getByRole('button',{name:'保存揽收地址'}))
 await screen.findByText('资料已变化，请重新读取后保存。')
 expect(screen.getByLabelText('详细寄件地址')).toHaveProperty('value','待保存路99号')
 expect(screen.getByRole('button',{name:'提报就绪'})).toHaveProperty('disabled',true)
})

it('restores anonymous company, device common and custom choices without employee requests',async()=>{
 const company={...profile.sender,name:'公司前台',address:'公司默认路16号'}
 const renderForm=()=> <EmployeeAccess companySender={company} rules={{companyName:{enabled:true,required:true,minLength:2},team:{enabled:false,required:false,minLength:0},teamOptions:[]}}>{({controls,sender})=><>{controls}<output aria-label="当前寄件地址">{sender.name}|{sender.address}</output></>}</EmployeeAccess>
 const view=render(renderForm())
 expect(screen.getByRole('radio',{name:/公司默认/})).toHaveProperty('checked',true)
 expect(screen.getByLabelText('当前寄件地址').textContent).toBe('公司前台|公司默认路16号')
 expect(screen.getByRole('radio',{name:/我的常用/})).toHaveProperty('disabled',true)
 fireEvent.click(screen.getByRole('radio',{name:/自定义地址/}))
 fireEvent.change(screen.getByLabelText('寄件人姓名'),{target:{value:'我的姓名'}})
 fireEvent.change(screen.getByLabelText('详细寄件地址'),{target:{value:'我的常用路99号'}})
 fireEvent.click(screen.getByLabelText('同时保存为我的常用地址（本设备）'));fireEvent.click(screen.getByRole('button',{name:'使用此地址'}))
 expect(screen.getByRole('radio',{name:/我的常用/})).toHaveProperty('checked',true)
 fireEvent.click(screen.getByRole('radio',{name:/公司默认/}))
 expect(screen.getByLabelText('当前寄件地址').textContent).toBe('公司前台|公司默认路16号')
 expect(JSON.parse(localStorage.getItem('shipping-anonymous-sender-v1')!).sender.address).toBe('我的常用路99号')
 fireEvent.click(screen.getByRole('radio',{name:/我的常用/}))
 expect(screen.getByLabelText('当前寄件地址').textContent).toBe('我的姓名|我的常用路99号')
 fireEvent.click(screen.getByRole('radio',{name:/自定义地址/}));fireEvent.change(screen.getByLabelText('详细寄件地址'),{target:{value:'临时未保存路8号'}})
 fireEvent.click(screen.getByRole('radio',{name:/公司默认/}));fireEvent.click(screen.getByRole('radio',{name:/自定义地址/}))
 expect(screen.getByLabelText('详细寄件地址')).toHaveProperty('value','临时未保存路8号')
 fireEvent.click(screen.getByRole('button',{name:'取消编辑'}))
 expect(screen.getByLabelText('当前寄件地址').textContent).toBe('公司前台|公司默认路16号')
 view.unmount();render(renderForm())
 expect(screen.getByRole('radio',{name:/我的常用/})).toHaveProperty('checked',true)
 expect(screen.getByLabelText('当前寄件地址').textContent).toBe('我的姓名|我的常用路99号')
 fireEvent.click(screen.getByRole('button',{name:'移除本设备常用地址'}))
 expect(localStorage.getItem('shipping-anonymous-sender-v1')).toBeNull()
 expect(screen.getByRole('radio',{name:/我的常用/})).toHaveProperty('disabled',true)
 expect(screen.getByLabelText('当前寄件地址').textContent).toBe('我的姓名|我的常用路99号')
 expect(fetcher).not.toHaveBeenCalled()
})
it('does not overwrite a manual draft when company options arrive late',()=>{
 const renderForm=(companySender:typeof profile.sender|null)=><EmployeeAccess companySender={companySender}>{({controls})=><>{controls}</>}</EmployeeAccess>
 const view=render(renderForm(null));fireEvent.change(screen.getByLabelText('寄件人姓名'),{target:{value:'正在填写'}})
 view.rerender(renderForm(profile.sender))
 expect(screen.getByLabelText('寄件人姓名')).toHaveProperty('value','正在填写')
})

it('restores Fxiaoke company, common and custom pickup with account-bound profile saving', async()=>{
 const fx={...profile,wecom:false,fxiaoke:true,identityName:'陈源',identityPhone:'13800000000',team:'销售部',senderSource:'personal' as const,senderChoices:{company:{...profile.sender,name:'公司前台',phone:'13700000000',address:'公司路1号'},personal:{...profile.sender,name:'揽收同事',phone:'13900000000',address:'常用路2号'}},sender:{...profile.sender,name:'揽收同事',phone:'13900000000',address:'常用路2号'}}
 fetcher.mockImplementation(async(url:string,init?:RequestInit)=>response({employee:init?.method==='POST'?{...fx,sender:{...fx.sender,address:'新常用路3号'},senderChoices:{...fx.senderChoices,personal:{...fx.sender,address:'新常用路3号'}}}:fx}))
 render(<EmployeeAccess mode="fxiaoke" requireVerification initialEmployee={fx} rules={{companyName:{enabled:true,required:true,minLength:4},team:{enabled:true,required:true,minLength:1},teamOptions:['销售部','市场部']}}>{({controls,identityControls,sender,canSubmit})=><>{identityControls}{controls}<output aria-label="当前寄件地址">{sender.address}</output><button disabled={!canSubmit}>提报就绪</button></>}</EmployeeAccess>)
 await screen.findByText('纷享销客已连接')
 expect(fetcher).toHaveBeenCalledWith('/api/shipping/owner/profile',expect.objectContaining({cache:'no-store'}))
 expect(screen.getByRole('radio',{name:/我的常用/})).toHaveProperty('checked',true)
 fireEvent.click(screen.getByRole('radio',{name:/公司默认/}))
 expect(screen.getByLabelText('当前寄件地址')).toHaveProperty('textContent','公司路1号')
 expect(screen.getByText('公司前台')).toBeTruthy()
 expect(screen.getByText('陈源')).toBeTruthy()
 fireEvent.change(screen.getByLabelText('所属团队'),{target:{value:'市场部'}})
 fireEvent.click(screen.getByRole('radio',{name:/自定义地址/}))
 fireEvent.change(screen.getByLabelText('寄件人姓名'),{target:{value:'本次揽收人'}})
 fireEvent.change(screen.getByLabelText('寄件人联系电话'),{target:{value:'13600000000'}})
 fireEvent.change(screen.getByLabelText('详细寄件地址'),{target:{value:'新常用路3号'}})
 fireEvent.click(screen.getByLabelText('同时保存为我的常用地址'))
 fireEvent.click(screen.getByRole('button',{name:'保存揽收地址'}))
 await screen.findByText('揽收地址已保存为我的常用地址，下次自动带入。')
 const post=fetcher.mock.calls.find(([url,init])=>url==='/api/shipping/owner/profile'&&init?.method==='POST')
 expect(JSON.parse(post![1].body)).toMatchObject({action:'save_profile',profile:{team:'市场部',sender:{name:'本次揽收人',phone:'13600000000',address:'新常用路3号'}}})
 expect(localStorage.getItem('shipping-anonymous-sender-v1')).toBeNull()
 expect(screen.getByRole('button',{name:'提报就绪'})).toHaveProperty('disabled',false)
})

it('clears the previous employee form when the authenticated account changed before profile refresh',async()=>{
 const original={...profile,wecom:false,fxiaoke:true,identityName:'员工甲',senderChoices:{company:profile.sender,personal:null},senderSource:'company' as const}
 const replacement={...original,id:'staff-2',identityName:'员工乙',sender:{...profile.sender,name:'员工乙',address:'另一地址66号'}}
 fetcher.mockResolvedValue(response({employee:replacement}))
 render(<EmployeeAccess mode="fxiaoke" requireVerification initialEmployee={original}>{({identityControls,sender,sessionKey})=><>{identityControls}<output aria-label="当前账号与地址">{sessionKey}|{sender.name}|{sender.address}</output></>}</EmployeeAccess>)
 await waitFor(()=>expect(screen.getByLabelText('当前账号与地址').textContent).toBe('1|员工乙|另一地址66号'))
 expect(screen.queryByText('员工甲')).toBeNull()
})

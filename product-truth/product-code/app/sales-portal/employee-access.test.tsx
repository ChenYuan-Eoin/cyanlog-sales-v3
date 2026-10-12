import React from 'react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import EmployeeAccess from './employee-access'
const fetcher=vi.fn()
const profile={id:'staff-1',email:'',wecom:true,companyName:'示例企业',team:'华南组',updatedAt:'2026-10-10T00:00:00Z',phoneSource:'wecom' as const,sender:{name:'陈源',phone:'13800000000',province:'广东省',city:'深圳市',county:'南山区',address:'示例路88号'}}
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status})
beforeEach(()=>{vi.stubGlobal('React',React);vi.stubGlobal('fetch',fetcher);fetcher.mockReset();fetcher.mockResolvedValue(response({employee:profile,orders:[]}))})
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
function mount(required=true){return render(<EmployeeAccess requireVerification={required}>{({controls,canSubmit})=><>{controls}<button disabled={!canSubmit}>提报就绪</button></>}</EmployeeAccess>)}
it('keeps the form hidden before whitelist identity is verified',async()=>{fetcher.mockResolvedValue(response({employee:null}));mount();expect(screen.queryByLabelText('寄件人姓名')).toBeNull();expect(await screen.findByRole('link',{name:'使用企业微信验证身份'})).toBeTruthy();expect(screen.queryByLabelText('公司邮箱')).toBeNull()})
it('locks identity fields and parses only pickup address for a WeCom member',async()=>{
 mount();const name=await screen.findByLabelText('寄件人姓名');expect(name).toHaveProperty('disabled',true);expect(screen.getByLabelText('寄件人联系电话')).toHaveProperty('disabled',true);expect(screen.getByLabelText('所属团队')).toHaveProperty('disabled',true)
 fireEvent.change(screen.getByLabelText('寄方地址文本'),{target:{value:'李四 13900000000 广东省深圳市福田区另一条街99号'}});fireEvent.click(screen.getByRole('button',{name:'解析寄方信息'}))
 expect(name).toHaveProperty('value','陈源');expect(screen.getByLabelText('寄件人联系电话')).toHaveProperty('value','13800000000');expect(screen.getByLabelText('寄件区县')).toHaveProperty('value','福田区')
 expect(screen.getByRole('button',{name:'提报就绪'})).toHaveProperty('disabled',false)
})
it('does not degrade a whitelist identity outage to anonymous intake',async()=>{fetcher.mockResolvedValue(response({error:'身份服务不可用'},503));mount();await screen.findByText('身份服务不可用');expect(screen.queryByLabelText('寄件人姓名')).toBeNull()})
it('revokes and clears identity before allowing a different user',async()=>{
 fetcher.mockImplementation(async(_url:string,init?:RequestInit)=>response(init?.method==='POST'?{employee:null}:{employee:profile,orders:[]}));mount();fireEvent.click(await screen.findByRole('button',{name:'退出 / 换人'}));await screen.findByRole('link',{name:'使用企业微信验证身份'});expect(screen.queryByLabelText('寄件人姓名')).toBeNull();expect(JSON.parse(fetcher.mock.calls.find(([,init])=>init?.method==='POST')![1].body)).toEqual({action:'logout'})
})
it('keeps administrator-enabled open intake usable without an email verification step',async()=>{
 fetcher.mockResolvedValue(response({employee:null}));render(<EmployeeAccess requireVerification={false} rules={{companyName:{enabled:true,required:true,minLength:4},team:{enabled:false,required:false,minLength:1},teamOptions:[]}}>{({controls,canSubmit})=><>{controls}<button disabled={!canSubmit}>提报就绪</button></>}</EmployeeAccess>)
 fireEvent.change(await screen.findByLabelText('寄方地址文本'),{target:{value:'张三 13800000000 广东省深圳市南山区科苑路15号'}});fireEvent.click(screen.getByRole('button',{name:'解析寄方信息'}));await waitFor(()=>expect(screen.getByRole('button',{name:'提报就绪'})).toHaveProperty('disabled',false));expect(screen.queryByLabelText('公司邮箱')).toBeNull()
})

 it('preserves saved pickup details when a new paste is not a complete address',async()=>{
  mount();await screen.findByLabelText('寄方地址文本')
  fireEvent.change(screen.getByLabelText('寄方地址文本'),{target:{value:'这里没有可以识别的地区'}})
  fireEvent.click(screen.getByRole('button',{name:'解析寄方信息'}))
  expect(screen.getByLabelText('寄件省份')).toHaveProperty('value','广东省')
  expect(screen.getByLabelText('详细寄件地址')).toHaveProperty('value','示例路88号')
  expect(screen.getByRole('status').textContent).toContain('现有寄方资料已保留')
 })

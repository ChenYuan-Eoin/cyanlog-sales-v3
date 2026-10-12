// @vitest-environment node
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {inspectWecomApplication,wecomDirectory,wecomIdentity,sendWecomMessage} from './wecom-client'
const fetcher=vi.fn(),credentials={corpId:'ww-example',agentId:7,secret:'example-secret'}
const reply=(data:unknown)=>Response.json(data)
beforeEach(()=>{fetcher.mockReset();vi.stubGlobal('fetch',fetcher)})
afterEach(()=>vi.unstubAllGlobals())
it('keeps app secrets out of error messages',async()=>{fetcher.mockRejectedValue(new Error('https://x?corpsecret=example-secret'));await expect(inspectWecomApplication(credentials)).rejects.toMatchObject({message:'企微接口暂时无法连接，请稍后重试。'})})
it('rejects an external OpenId rather than treating it as employee identity',async()=>{fetcher.mockResolvedValueOnce(reply({errcode:0,access_token:'example-token'})).mockResolvedValueOnce(reply({errcode:0,OpenId:'external'}));await expect(wecomIdentity(credentials,'code')).rejects.toMatchObject({status:403})})
it('rejects incomplete directory responses before a snapshot can revoke members',async()=>{fetcher.mockResolvedValueOnce(reply({errcode:0,access_token:'example-token'})).mockResolvedValueOnce(reply({errcode:0,department:[]})).mockResolvedValueOnce(reply({errcode:0}));await expect(wecomDirectory(credentials)).rejects.toThrow('响应不完整')})
it('normalizes a complete authorized directory snapshot',async()=>{fetcher.mockResolvedValueOnce(reply({errcode:0,access_token:'example-token'})).mockResolvedValueOnce(reply({errcode:0,department:[{id:1,name:'示例企业'}]})).mockResolvedValueOnce(reply({errcode:0,userlist:[{userid:'staff',name:'员工',mobile:'13800000000',department:[1],status:1}]}));expect(await wecomDirectory(credentials)).toEqual({companyName:'示例企业',members:[{userid:'staff',name:'员工',mobile:'13800000000',departments:['示例企业'],active:true}]})})
it('never sends a broadcast or claims an invalid recipient was notified',async()=>{await expect(sendWecomMessage(credentials,'@all','test')).rejects.toMatchObject({status:400});expect(fetcher).not.toHaveBeenCalled();fetcher.mockResolvedValueOnce(reply({errcode:0,access_token:'example-token'})).mockResolvedValueOnce(reply({errcode:0,invaliduser:'staff'}));await expect(sendWecomMessage(credentials,'staff','test')).rejects.toMatchObject({status:502})})

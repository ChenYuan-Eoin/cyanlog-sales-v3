// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mock=vi.hoisted(()=>({manager:vi.fn(),activate:vi.fn(),read:vi.fn(),list:vi.fn(),draft:vi.fn(),sync:vi.fn()}))
vi.mock('@/lib/shipping/http',()=>({shippingManagerHandler:mock.manager,shippingJson:(req:NextRequest)=>req.json()}))
vi.mock('@/lib/shipping/wecom-settings',()=>({readWecomSettings:mock.read,publicWecomSettings:(value:unknown)=>value,listWecomMembers:mock.list,readWecomDraft:mock.draft,activateWecomConfiguration:mock.activate,syncWecomDirectory:mock.sync,prepareWecomConfiguration:vi.fn(),discardWecomConfiguration:vi.fn()}))
import { POST } from './route'
beforeEach(()=>{vi.resetAllMocks();mock.manager.mockImplementation((_req,handler)=>handler({id:'manager'},'trusted-org'));mock.read.mockResolvedValue({});mock.list.mockResolvedValue([])})
const request=(body:unknown)=>new NextRequest('https://example.test/api/shipping/wecom',{method:'POST',body:JSON.stringify(body)})
it.each(['scope','member'])('rejects legacy %s edits without modifying existing grants',async action=>{
 await expect(POST(request({action,departmentIds:[1],member:{allowed:true}}))).rejects.toMatchObject({status:409})
 expect(mock.sync).not.toHaveBeenCalled();expect(mock.activate).not.toHaveBeenCalled()
})
it('derives the organization from the manager session and forwards only activation intent',async()=>{
 await POST(request({action:'activate',draftId:'draft-id',scopeMode:'preserve',orgId:'forged-org',departmentIds:[99]}))
 expect(mock.activate).toHaveBeenCalledWith('trusted-org','manager',{draftId:'draft-id',scopeMode:'preserve'})
})

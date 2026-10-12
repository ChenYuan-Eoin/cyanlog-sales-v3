import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import WecomConfiguration from './wecom-configuration'
import WecomDepartmentPicker from './wecom-department-picker'
const fetcher=vi.fn()
const settings={corpId:'ww-original',agentId:7,hasSecret:true,orderCheckMode:1,fallbackPhone:'13800000000',deniedMessage:'无权限',redirectDomain:'shipping.example',companyName:'原企业',directorySyncedAt:'2026-10-12T00:00:00Z',updatedAt:'2026-10-12T00:00:00Z',departments:[{id:1,parentId:0,name:'原企业',order:0}],allowedDepartmentIds:null}
beforeEach(()=>{vi.stubGlobal('React',React);vi.stubGlobal('fetch',fetcher);fetcher.mockReset();fetcher.mockImplementation(async(url:string)=>Response.json(url.endsWith('/bot')?{bots:[]}:{settings,members:[],draft:null}))})
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
it('keeps active enterprise visible while editing and preparing a different enterprise',async()=>{
 fetcher.mockImplementation(async(url:string,init?:RequestInit)=>{
  if(url.endsWith('/bot'))return Response.json({bots:[]})
  if(init?.method==='POST')return Response.json({settings,members:[],draft:{id:'draft-id',corpId:'ww-new',agentId:8,appName:'新应用',orderCheckMode:1,companyName:'新企业',preparedAt:'2026-10-12',memberCount:2,departments:[{id:1,parentId:0,name:'新企业组织',order:0}]}})
  return Response.json({settings,members:[],draft:null})
 })
 render(<WecomConfiguration/>);await screen.findByText('当前连接：原企业 · 应用 7')
 fireEvent.click(screen.getByText('配置 / 更换企业应用'))
 fireEvent.change(screen.getByLabelText('企业ID（CorpID）'),{target:{value:'ww-new'}})
 expect(screen.getByText('当前连接：原企业 · 应用 7')).toBeTruthy()
 fireEvent.change(screen.getByLabelText('应用ID（AgentID）'),{target:{value:'8'}})
 fireEvent.change(screen.getByLabelText('应用密钥（Secret）'),{target:{value:'example-new-secret'}})
 fireEvent.click(screen.getByRole('button',{name:'测试并准备新配置'}))
 const pending=await screen.findByRole('region',{name:'待启用企业配置'})
 expect(within(pending).getByRole('checkbox',{name:'新企业组织'})).toHaveProperty('checked',false)
 expect(screen.getByText('当前连接：原企业 · 应用 7')).toBeTruthy()
 expect(fetcher.mock.calls.filter(([,init])=>init?.method==='POST').map(([,init])=>JSON.parse(init.body).action)).toEqual(['prepare'])
})
it('selects organizational subtrees and explains inherited scope instead of listing employees',()=>{
 const change=vi.fn(),departments=[{id:1,parentId:0,name:'企业',order:0},{id:2,parentId:1,name:'销售',order:0},{id:3,parentId:2,name:'一组',order:0}]
 render(<WecomDepartmentPicker departments={departments} selected={[2]} onChange={change}/>)
 const nested=screen.getByLabelText('一组（随上级授权）')
 expect(nested).toHaveProperty('checked',true);expect(nested).toHaveProperty('disabled',true)
 fireEvent.click(screen.getByRole('checkbox',{name:'企业'}))
 expect(change).toHaveBeenCalledWith([1])
})

import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import MyWorkorders from './my-workorders'
const fetcher=vi.fn()
const order=(orderNo:string)=>({orderNo,status:'waybill_created',waybill:`SF-${orderNo}`,createdAt:'2026-11-09T08:00:00Z'})
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status})
beforeEach(()=>{vi.stubGlobal('React',React);vi.stubGlobal('fetch',fetcher);fetcher.mockReset()})
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
it('loads shared records anonymously, appends pages and refreshes from the newest page',async()=>{
 fetcher.mockResolvedValueOnce(response({orders:[order('ONE')],nextPage:1}))
  .mockResolvedValueOnce(response({orders:[order('ONE'),order('TWO')],nextPage:null}))
  .mockResolvedValueOnce(response({orders:[order('NEW')],nextPage:null}))
 render(<MyWorkorders/>)
 expect(await screen.findByText('ONE')).toBeTruthy()
 expect(fetcher).toHaveBeenCalledWith('/api/shipping/public/orders?page=0',{cache:'no-store',credentials:'omit'})
 fireEvent.click(screen.getByRole('button',{name:'加载更多快递'}))
 expect(await screen.findByText('TWO')).toBeTruthy();expect(screen.getAllByText('ONE')).toHaveLength(1)
 expect(screen.getByText('已显示 2 条，已加载全部记录')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'刷新提报记录'}))
 expect(await screen.findByText('NEW')).toBeTruthy();expect(screen.queryByText('ONE')).toBeNull()
})
it('keeps existing records when another page fails and lets visitors retry it',async()=>{
 fetcher.mockResolvedValueOnce(response({orders:[order('ONE')],nextPage:1}))
  .mockResolvedValueOnce(response({error:'记录暂不可用'},503))
  .mockResolvedValueOnce(response({orders:[order('TWO')],nextPage:null}))
 render(<MyWorkorders/>);await screen.findByText('ONE')
 fireEvent.click(screen.getByRole('button',{name:'加载更多快递'}));expect(await screen.findByRole('alert')).toHaveProperty('textContent','记录暂不可用')
 expect(screen.getByText('ONE')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'加载更多快递'}));expect(await screen.findByText('TWO')).toBeTruthy()
 expect(fetcher.mock.calls.map(([url])=>url)).toEqual(['/api/shipping/public/orders?page=0','/api/shipping/public/orders?page=1','/api/shipping/public/orders?page=1'])
})
it('explains an empty list and recovers from an initial failure',async()=>{
 fetcher.mockRejectedValueOnce(new Error('连接中断')).mockResolvedValueOnce(response({orders:[],nextPage:null}))
 render(<MyWorkorders/>);await screen.findByRole('alert')
 fireEvent.click(screen.getByRole('button',{name:'刷新提报记录'}));expect(await screen.findByText('尚无提报记录')).toBeTruthy()
 await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull())
})

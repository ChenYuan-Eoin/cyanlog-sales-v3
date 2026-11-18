import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
 fireEvent.click(screen.getByRole('button',{name:'查看更早记录'}))
 fireEvent.click(screen.getByRole('button',{name:'加载更多快递'}))
 expect(await screen.findByText('TWO')).toBeTruthy();expect(screen.getAllByText('ONE')).toHaveLength(1)
 expect(screen.getByText('已显示 2 条，已加载全部记录')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'刷新提报记录'}))
 expect(await screen.findByText('NEW')).toBeTruthy();expect(screen.queryByText('ONE')).toBeNull()
})
it('reads only the authenticated owner endpoint in employee mode', async()=>{
 fetcher.mockResolvedValue(response({orders:[],nextPage:null}))
 render(<MyWorkorders scope="owner"/>)
 expect(await screen.findByText('仅显示本人的提报记录')).toBeTruthy()
 expect(fetcher).toHaveBeenCalledWith('/api/shipping/owner/orders?page=0',{cache:'no-store',credentials:'same-origin'})
 expect(fetcher.mock.calls.some(([url])=>String(url).includes('/public/orders'))).toBe(false)
})
it('shows a returned order’s actual reason in the owner record and labels historical missing reasons', async () => {
  fetcher.mockResolvedValue(response({ orders: [
    { ...order('RETURNED'), status: 'returned', returnedReason: '收件地址缺少楼层' },
    { ...order('HISTORICAL'), status: 'returned' },
    { ...order('SHIPPED'), returnedReason: '旧原因' },
  ], nextPage: null }))
  render(<MyWorkorders scope="owner" />)
  const current = (await screen.findByText('RETURNED')).closest('li')!
  expect(within(current).getByText('已退回')).toBeTruthy()
  expect(within(current).getByText('退回原因：收件地址缺少楼层')).toBeTruthy()
  const old = screen.getByText('HISTORICAL').closest('li')!
  expect(within(old).getByText('退回原因：此记录未保存退回原因')).toBeTruthy()
  expect(screen.queryByText(/旧原因/)).toBeNull()
})
it('does not display a return reason in a shared receipt, even if supplied', async () => {
  fetcher.mockResolvedValue(response({ orders: [{ ...order('SHARED'), status: 'returned', returnedReason: '私有备注' }], nextPage: null }))
  render(<MyWorkorders />)
  await screen.findByText('SHARED')
  expect(screen.queryByText(/私有备注|退回原因/)).toBeNull()
})
it('keeps existing records when another page fails and lets visitors retry it',async()=>{
 fetcher.mockResolvedValueOnce(response({orders:[order('ONE')],nextPage:1}))
  .mockResolvedValueOnce(response({error:'记录暂不可用'},503))
  .mockResolvedValueOnce(response({orders:[order('TWO')],nextPage:null}))
 render(<MyWorkorders/>);await screen.findByText('ONE')
 fireEvent.click(screen.getByRole('button',{name:'查看更早记录'}))
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

it('shows only the latest five initially, expands and collapses without losing loaded records',async()=>{
 fetcher.mockResolvedValue(response({orders:Array.from({length:8},(_,i)=>order(`ORDER-${i}`)),nextPage:null}))
 render(<MyWorkorders/>);await screen.findByText('ORDER-0')
 expect(screen.getAllByRole('listitem')).toHaveLength(5);expect(screen.queryByText('ORDER-5')).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'查看更早记录'}))
 expect(screen.getAllByRole('listitem')).toHaveLength(8)
 expect(screen.getByRole('region',{name:'按日期分组的提报记录'}).getAttribute('tabindex')).toBe('0')
 fireEvent.click(screen.getByRole('button',{name:'收起 · 最近5条'}))
 expect(screen.getAllByRole('listitem')).toHaveLength(5)
 fireEvent.click(screen.getByRole('button',{name:'查看更早记录'}))
 expect(screen.getByText('ORDER-7')).toBeTruthy();expect(fetcher).toHaveBeenCalledTimes(1)
})
it('groups by Shanghai calendar date and shows the submitted customer badge and local time',async()=>{
 fetcher.mockResolvedValue(response({orders:[{...order('LATE'),createdAt:'2026-11-08T16:05:00Z',customerName:'星河科技'}, {...order('EARLY'),createdAt:'2026-11-08T15:55:00Z',customerName:null}],nextPage:null}))
 render(<MyWorkorders/>);await screen.findByText('LATE')
 const nextDay=screen.getByRole('region',{name:'2026年11月9日'}),priorDay=screen.getByRole('region',{name:'2026年11月8日'})
 expect(within(nextDay).getByText('LATE')).toBeTruthy();expect(within(nextDay).getByText('00:05')).toBeTruthy()
 expect(within(nextDay).getByText('星河科技').getAttribute('title')).toBe('星河科技')
 expect(within(priorDay).getByText('EARLY')).toBeTruthy();expect(within(priorDay).getByText('23:55')).toBeTruthy()
 expect(within(priorDay).getByText('未填客户')).toBeTruthy()
})

it('expands beyond the actual height of five records even with many date headers',async()=>{
 fetcher.mockResolvedValue(response({orders:Array.from({length:8},(_,i)=>order(`HEIGHT-${i}`)),nextPage:null}))
 render(<MyWorkorders/>);await screen.findByText('HEIGHT-0')
 const region=screen.getByRole('region',{name:'按日期分组的提报记录'})
 vi.spyOn(region,'getBoundingClientRect').mockReturnValue({height:900} as DOMRect)
 fireEvent.click(screen.getByRole('button',{name:'查看更早记录'}))
 expect(parseFloat(region.style.maxHeight)).toBeGreaterThan(900)
 fireEvent.click(screen.getByRole('button',{name:'收起 · 最近5条'}))
 expect(region.style.maxHeight).toBe('')
})

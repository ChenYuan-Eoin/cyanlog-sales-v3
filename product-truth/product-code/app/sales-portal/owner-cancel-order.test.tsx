import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { OwnerCancelOrder } from './owner-cancel-order'
import type { ShipmentReceipt } from '@/lib/shipping/types'
const order:ShipmentReceipt = { orderNo:'SO-20261118-11223344', status:'waybill_created',waybill:'SF001', nextReviewAt:null,createdAt:'2026-11-18T08:00:00Z' }
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
it('allows a personal action to be abandoned locally, posts once on confirmation and waits for the server outcome',async()=>{
  const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({status:'cancelled'})}), completed=vi.fn()
  vi.stubGlobal('fetch',fetcher);render(<OwnerCancelOrder order={order} onCancelled={completed}/>)
  fireEvent.click(screen.getByRole('button',{name:'取消'}));fireEvent.click(screen.getByRole('button',{name:'保留寄件'}));expect(fetcher).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button',{name:'取消'}));fireEvent.click(screen.getByRole('button',{name:'确认取消'}))
  await waitFor(()=>expect(completed).toHaveBeenCalledOnce());expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/shipping/owner/orders/SO-20261118-11223344/cancel',{method:'POST',credentials:'same-origin',cache:'no-store'})
})
it('does not offer direct cancellation after pickup or while delivery of a prior cancellation is uncertain',()=>{
  const view=render(<OwnerCancelOrder order={{...order,status:'in_transit'}} onCancelled={vi.fn()}/>)
  expect(screen.queryByRole('button')).toBeNull();view.rerender(<OwnerCancelOrder order={{...order,cancellationState:'unknown'}} onCancelled={vi.fn()}/>)
  expect(screen.getByText(/结果待核实/)).toBeTruthy();expect(screen.queryByRole('button')).toBeNull()
})

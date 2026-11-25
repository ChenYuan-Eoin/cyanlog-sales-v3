import React from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ renderShippingEntry: vi.fn() }))
vi.mock('@/app/shipping/shipping-entry', () => ({ renderShippingEntry: m.renderShippingEntry }))
vi.mock('./portal', () => ({ AuthenticatedReceiptRoute: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
import Page from './page'
beforeEach(() => { m.renderShippingEntry.mockReset().mockResolvedValue(<div>登录后寄件</div>) })
it('uses the authenticated entry with a preference for the owner workflow', async () => {
  const element = await Page()
  expect(m.renderShippingEntry).toHaveBeenCalledExactlyOnceWith(true)
  expect(element.props.children.props.children).toBe('登录后寄件')
})

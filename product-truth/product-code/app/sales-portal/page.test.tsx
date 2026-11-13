import React from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ shippingPage: vi.fn() }))
vi.mock('@/app/shipping/page', () => ({ default: m.shippingPage }))
vi.mock('./portal', () => ({ AuthenticatedReceiptRoute: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
import Page from './page'
beforeEach(() => { m.shippingPage.mockReset().mockResolvedValue(<div>登录后寄件</div>) })
it('reuses the authenticated shipping route instead of loading public intake options', async () => {
  const element = await Page()
  expect(m.shippingPage).toHaveBeenCalledOnce()
  expect(element.props.children.props.children).toBe('登录后寄件')
})

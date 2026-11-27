import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { usePathname } from 'next/navigation'
import PendingAccessPage from '@/app/pending-access/page'
import { AppShell } from './AppShell'

vi.mock('next/navigation', () => ({ usePathname: vi.fn() }))
vi.mock('@/components/layout/Sidebar', () => ({ Sidebar: () => <nav aria-label="业务菜单" /> }))
vi.mock('./SessionActivity', () => ({ SessionActivity: () => <div data-testid="session-activity" /> }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('keeps the authenticated waiting page and personal information available without business navigation', async () => {
  vi.mocked(usePathname).mockReturnValue('/pending-access')
  const fetchProfile = vi.fn().mockResolvedValue(Response.json({
    user: { display_name: '待授权员工', title: '运营', employee_id: 'E1001' },
  }))
  vi.stubGlobal('fetch', fetchProfile)
  render(<AppShell><PendingAccessPage /></AppShell>)

  expect(screen.getByRole('heading', { name: '等待业务授权' })).toBeVisible()
  expect(screen.queryByRole('navigation', { name: '业务菜单' })).not.toBeInTheDocument()
  expect(screen.getByTestId('session-activity')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '检查权限' })).toBeVisible()
  expect(screen.getByRole('button', { name: '退出登录' })).toBeVisible()
  expect(fetchProfile).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: '个人信息' }))
  expect(await screen.findByText('待授权员工 · 运营 · E1001')).toBeVisible()
  expect(fetchProfile).toHaveBeenCalledExactlyOnceWith('/api/profile', expect.objectContaining({ cache: 'no-store' }))
})

it('lets narrow shipping pages scroll while keeping the viewport-height layout', () => {
  vi.mocked(usePathname).mockReturnValue('/shipping')
  render(<AppShell><div>工作台</div></AppShell>)
  expect(screen.getByRole('navigation', { name: '业务菜单' })).toBeInTheDocument()
  expect(screen.getByRole('main')).toHaveClass('h-dvh', 'overflow-hidden', 'max-[899px]:overflow-y-auto')
})

it('keeps the sales portal viewport scroll behavior', () => {
  vi.mocked(usePathname).mockReturnValue('/sales-portal')
  render(<AppShell><div>寄件记录</div></AppShell>)
  expect(screen.getByRole('main')).toHaveClass('h-dvh', 'overflow-hidden')
  expect(screen.getByRole('main')).not.toHaveClass('max-[899px]:overflow-y-auto')
})

'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useCallback, useEffect } from 'react'
import { PanelLeftCloseIcon, PanelLeftOpenIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { BrandMark } from '@/components/branding/BrandMark'
import { useBranding } from '@/components/branding/BrandingProvider'
import { logoutClientSession } from '@/lib/session-client'
import {
  HomeIcon,
  QuoteIcon,
  ContractIcon,
  TenderIcon,
  KnowledgeIcon,
  ScheduleIcon,
  SettingsIcon,
  LogoutIcon,
  MenuIcon,
  UserIcon,
} from '@/components/icons'

const navItems = [
  { name: '工作台', href: '/', icon: HomeIcon },
  { name: '报价中心', href: '/quotes', icon: QuoteIcon },
  { name: '合同审核', href: '/contracts', icon: ContractIcon },
  { name: '标书中心', href: '/tenders', icon: TenderIcon },
  { name: '知识库', href: '/knowledge', icon: KnowledgeIcon },
  { name: '日程', href: '/schedule', icon: ScheduleIcon },
  { name: '配置中心', href: '/configs', icon: SettingsIcon },
]

interface SidebarProps {
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
}

export function Sidebar({ collapsed, onCollapsedChange }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)
  const branding = useBranding()

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  const handleNavClick = useCallback(() => {
    setMobileOpen(false)
  }, [])

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  // Prevent body scroll when mobile sidebar is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileOpen])

  return (
    <>
      {/* Mobile hamburger button - z-index lower than sidebar but higher than overlay */}
      <button
        className="fixed top-3 left-3 z-[45] p-2 bg-slate-900 text-white rounded-md lg:hidden shadow-lg"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label="Toggle menu"
      >
        <MenuIcon size={22} />
      </button>

      {/* Overlay for mobile - only when sidebar is explicitly open */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden touch-none"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar - responsive width for mobile/tablet/desktop */}
      <aside
        className={cn(
          'fixed left-0 top-0 z-50 flex h-screen flex-col bg-slate-900 text-white',
          'will-change-transform transition-[width,transform] duration-200',
          // Responsive width: full on mobile, w-56 on md, w-64 on lg
          'w-full sm:w-72 md:w-56',
          collapsed ? 'lg:w-16' : 'lg:w-64',
          // Transition only on mobile, desktop is always visible
          'lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className={cn('flex items-center gap-3 p-6', collapsed && 'lg:justify-center lg:px-3')}>
          <BrandMark size={36} variant="symbol" surface="dark" />
          <div className={cn('min-w-0', collapsed && 'lg:hidden')}>
            <div className="truncate text-sm font-semibold text-white">{branding.brandName}</div>
            <p className="truncate text-xs text-slate-300">{branding.productSubtitle || branding.brandName}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onCollapsedChange(!collapsed)}
          className="mx-3 hidden h-9 items-center justify-center gap-2 rounded-md border border-slate-700 text-xs text-slate-300 transition hover:bg-slate-800 hover:text-white lg:flex"
          aria-label={collapsed ? '展开全局导航' : '收起全局导航'}
          title={collapsed ? '展开全局导航' : '收起全局导航'}
        >
          {collapsed ? <PanelLeftOpenIcon className="size-4" /> : <><PanelLeftCloseIcon className="size-4" /><span>收起导航</span></>}
        </button>
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={handleNavClick}
                title={collapsed ? item.name : undefined}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors',
                  collapsed && 'lg:justify-center lg:px-0',
                  isActive(item.href)
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                )}
              >
                <Icon size={18} className="opacity-80" />
                <span className={cn(collapsed && 'lg:hidden')}>{item.name}</span>
              </Link>
            )
          })}
        </nav>
        <div className="mt-auto px-3 pb-6">
          {/* 个人信息入口 */}
          <Link
            href="/profile"
            onClick={handleNavClick}
            title={collapsed ? '个人信息' : undefined}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors mb-1',
              collapsed && 'lg:justify-center lg:px-0',
              isActive('/profile')
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            )}
          >
            <UserIcon size={18} className="opacity-80" />
            <span className={cn(collapsed && 'lg:hidden')}>个人信息</span>
          </Link>
          <button
            type="button"
            onClick={async () => {
              await logoutClientSession()
              setMobileOpen(false)
              router.replace('/login')
            }}
            title={collapsed ? '退出登录' : undefined}
            className={cn('flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm text-slate-400 transition-colors hover:bg-slate-800 hover:text-white', collapsed && 'lg:justify-center lg:px-0')}
          >
            <LogoutIcon size={18} className="opacity-80" />
            <span className={cn(collapsed && 'lg:hidden')}>退出登录</span>
          </button>
        </div>
      </aside>
    </>
  )
}

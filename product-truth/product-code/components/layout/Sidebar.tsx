'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
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

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)
  const branding = useBranding()

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        className="fixed top-4 left-4 z-50 p-2 bg-slate-900 text-white rounded-md lg:hidden"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label="Toggle menu"
      >
        <MenuIcon size={24} />
      </button>

      {/* Overlay for mobile */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed left-0 top-0 z-40 flex h-screen w-64 flex-col bg-slate-900 text-white transition-transform duration-300',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        <div className="flex items-center gap-3 p-6">
          <BrandMark size={36} variant="symbol" surface="dark" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-white">{branding.brandName}</div>
            <p className="truncate text-xs text-slate-300">{branding.productSubtitle || branding.brandName}</p>
          </div>
        </div>
        <nav className="px-3 py-4">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors',
                  isActive(item.href)
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                )}
              >
                <Icon size={18} className="opacity-80" />
                <span>{item.name}</span>
              </Link>
            )
          })}
        </nav>
        <div className="mt-auto px-3 pb-6">
          {/* 个人信息入口 */}
          <Link
            href="/profile"
            onClick={() => setMobileOpen(false)}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors mb-1',
              isActive('/profile')
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            )}
          >
            <UserIcon size={18} className="opacity-80" />
            <span>个人信息</span>
          </Link>
          <button
            type="button"
            onClick={async () => {
              await logoutClientSession()
              setMobileOpen(false)
              router.replace('/login')
            }}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
          >
            <LogoutIcon size={18} className="opacity-80" />
            <span>退出登录</span>
          </button>
        </div>
      </aside>
    </>
  )
}

'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useCallback, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { Package } from 'lucide-react'
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

type NavigationAccess = { shipping: boolean; config: boolean }
const shippingNavigationCache = new Map<string, { access: NavigationAccess; expiresAt: number }>()
const shippingNavigationInflight = new Map<string, Promise<NavigationAccess>>()

function loadShippingNavigation(token: string): Promise<NavigationAccess> {
  const cached = shippingNavigationCache.get(token)
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.access)
  const inflight = shippingNavigationInflight.get(token)
  if (inflight) return inflight
  const headers: Record<string, string> = token === 'anonymous' ? {} : { Authorization: `Bearer ${token}` }
  const request = Promise.all([
    fetch('/api/shipping/settings', { cache: 'no-store', headers }),
    fetch('/api/auth/me', { cache: 'no-store', headers }),
  ])
    .then(async ([shipping, profile]) => {
      const body = profile.ok ? await profile.json() : null
      const roles = Array.isArray(body?.user?.roles) ? body.user.roles : []
      const baselineOnly = roles.length === 1 && roles[0]?.code === 'FXIAOKE_BASELINE'
      const access = { shipping: shipping.ok || (profile.ok && roles.length > 0 && body?.user?.authMethod === 'fxiaoke'),
        config: profile.ok && roles.length > 0 && !baselineOnly }
      shippingNavigationCache.set(token, {
        access,
        expiresAt: Date.now() + (access.shipping ? 60_000 : 15_000),
      })
      return access
    })
    .catch(() => {
      const access = { shipping: false, config: false }
      shippingNavigationCache.set(token, { access, expiresAt: Date.now() + 15_000 })
      return access
    })
    .finally(() => {
      if (shippingNavigationInflight.get(token) === request) shippingNavigationInflight.delete(token)
    })
  shippingNavigationInflight.set(token, request)
  return request
}

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)
  const branding = useBranding()
  const [navigationAccess, setNavigationAccess] = useState<NavigationAccess>({ shipping: false, config: false })
  useEffect(() => {
    let live = true
    const token = localStorage.getItem('token') || 'anonymous'
    void loadShippingNavigation(token).then((access) => {
      if (live) setNavigationAccess(access)
    })
    return () => { live = false }
  }, [])
  const visibleNavItems = (navigationAccess.shipping ? [...navItems.slice(0, 2), { name: '自助收寄', href: '/shipping', icon: Package }, ...navItems.slice(2)] : navItems)
    .filter(item => navigationAccess.config || item.href !== '/configs')

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
        className="fixed top-3 left-3 z-[45] p-2 bg-slate-900 text-white rounded-md xl:hidden shadow-lg"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label="打开主导航"
        aria-controls="app-sidebar"
        aria-expanded={mobileOpen}
      >
        <MenuIcon size={22} />
      </button>

      {/* Overlay for mobile - only when sidebar is explicitly open */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 xl:hidden touch-none"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar - responsive width for mobile/tablet/desktop */}
      <aside
        id="app-sidebar"
        className={cn(
          'fixed left-0 top-0 z-50 flex h-screen flex-col bg-slate-900 text-white',
          'will-change-transform',
          'w-[min(20rem,calc(100vw-2rem))] sm:w-80 xl:w-64',
          // Transition only on mobile, desktop is always visible
          'xl:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
        style={{
          transition: 'transform 300ms ease-out',
        }}
      >
        <div className="space-y-1 px-4 pb-4 pt-5">
          <BrandMark size={36} variant="full" surface="dark" className="max-w-full" />
          <p className="truncate px-4 text-xs text-slate-300">{branding.productSubtitle || branding.brandName}</p>
        </div>
        <nav className="px-3 py-4 flex-1 overflow-y-auto">
          {visibleNavItems.map((item) => {
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={false}
                onClick={handleNavClick}
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
            prefetch={false}
            onClick={handleNavClick}
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
              const token = localStorage.getItem('token') || 'anonymous'
              shippingNavigationCache.delete(token)
              shippingNavigationInflight.delete(token)
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

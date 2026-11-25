'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useCallback, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { Package } from 'lucide-react'
import { BrandMark } from '@/components/branding/BrandMark'
import { useBranding } from '@/components/branding/BrandingProvider'
import { loadTendersListForCache } from '@/lib/core-page-warmup'
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
  { name: '自助收寄', href: '/shipping', icon: Package },
  { name: '寄件设置', href: '/shipping/settings', icon: SettingsIcon },
  { name: '合同审核', href: '/contracts', icon: ContractIcon },
  { name: '标书中心', href: '/tenders', icon: TenderIcon },
  { name: '知识库', href: '/knowledge', icon: KnowledgeIcon },
  { name: '日程', href: '/schedule', icon: ScheduleIcon },
  { name: '配置中心', href: '/configs', icon: SettingsIcon },
]

const configNavigationCache = new Map<string, { access: boolean; expiresAt: number }>()
const configNavigationInflight = new Map<string, Promise<boolean>>()

function loadConfigNavigation(token: string | null, refreshSignal?: AbortSignal): Promise<boolean> {
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined
  const readProfile = () => fetch(refreshSignal ? '/api/auth/me?fresh=1' : '/api/auth/me', {
    cache: 'no-store', headers, signal: refreshSignal,
  })
    .then(async response => {
      const body = response.ok ? await response.json() : null
      const roles = Array.isArray(body?.user?.roles) ? body.user.roles : []
      const baselineOnly = roles.length === 1 && roles[0]?.code === 'FXIAOKE_BASELINE'
      return !baselineOnly && body?.user?.canManageOrg === true
    })
    .catch(() => false)
  if (!token) return readProfile()
  if (refreshSignal) {
    configNavigationCache.delete(token)
  } else {
    const cached = configNavigationCache.get(token)
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.access)
    const inflight = configNavigationInflight.get(token)
    if (inflight) return inflight
  }
  const request = readProfile()
    .then(access => {
      if (!refreshSignal?.aborted && configNavigationInflight.get(token) === request) {
        configNavigationCache.set(token, { access, expiresAt: Date.now() + (access ? 60_000 : 15_000) })
      }
      return access
    })
    .finally(() => {
      if (configNavigationInflight.get(token) === request) configNavigationInflight.delete(token)
    })
  configNavigationInflight.set(token, request)
  return request
}

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)
  const branding = useBranding()
  const [configAccess, setConfigAccess] = useState(false)
  const [shippingPaths, setShippingPaths] = useState<string[]>([])
  const shippingRequest = useRef<AbortController | null>(null)
  const signingOut = useRef(false)
  useEffect(() => {
    let live = true
    let profileGeneration = 0
    let configFocusRequest: AbortController | null = null

    function refreshConfig(fresh = false) {
      if (signingOut.current) return
      configFocusRequest?.abort()
      configFocusRequest = fresh ? new AbortController() : null
      const token = localStorage.getItem('token')
      const generation = ++profileGeneration
      void loadConfigNavigation(token, configFocusRequest?.signal).then(access => {
        if (live && !signingOut.current && generation === profileGeneration && localStorage.getItem('token') === token) {
          setConfigAccess(access)
        }
      })
    }

    function refreshShipping() {
      if (signingOut.current) return
      shippingRequest.current?.abort()
      const controller = new AbortController()
      shippingRequest.current = controller
      const token = localStorage.getItem('token')
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined
      void fetch('/api/navigation', { cache: 'no-store', headers, signal: controller.signal })
        .then(async response => {
          const body = response.ok ? await response.json() : null
          if (!controller.signal.aborted) setShippingPaths(Array.isArray(body?.paths) ? body.paths : [])
        })
        .catch(() => {
          if (!controller.signal.aborted) setShippingPaths([])
        })
    }

    function refreshSession(event: StorageEvent) {
      if (event.key !== 'token' && event.key !== null) return
      setConfigAccess(false)
      setShippingPaths([])
      refreshConfig()
      refreshShipping()
    }

    function refreshOnFocus() {
      refreshConfig(true)
      refreshShipping()
    }

    refreshConfig()
    refreshShipping()
    window.addEventListener('focus', refreshOnFocus)
    window.addEventListener('storage', refreshSession)
    return () => {
      live = false
      configFocusRequest?.abort()
      shippingRequest.current?.abort()
      window.removeEventListener('focus', refreshOnFocus)
      window.removeEventListener('storage', refreshSession)
    }
  }, [])
  const visibleNavItems = navItems.filter(item => {
    if (item.href === '/configs') return configAccess
    if (item.href === '/shipping' || item.href === '/shipping/settings') return shippingPaths.includes(item.href)
    return true
  })

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    if (href === '/shipping' && pathname === '/shipping/settings') return false
    return pathname.startsWith(href)
  }

  function prepareNavigation(href: string) {
    if (isActive(href) || !['/contracts', '/quotes', '/configs', '/tenders', '/knowledge', '/schedule'].includes(href)) return
    router.prefetch(href)
    if (href === '/tenders') {
      const token = localStorage.getItem('token')
      if (token) void loadTendersListForCache(token).catch(() => {
        // The opened page retries through its normal list loader.
      })
    }
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
                onMouseEnter={() => prepareNavigation(item.href)}
                onFocus={() => prepareNavigation(item.href)}
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
              signingOut.current = true
              shippingRequest.current?.abort()
              setShippingPaths([])
              setConfigAccess(false)
              const token = localStorage.getItem('token')
              if (token) {
                configNavigationCache.delete(token)
                configNavigationInflight.delete(token)
              }
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

'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Sidebar } from '@/components/layout/Sidebar'
import { cn } from '@/lib/utils'

const PUBLIC_LAYOUT_PATHS = ['/login', '/register']

function usesPublicLayout(pathname: string) {
  return PUBLIC_LAYOUT_PATHS.some((path) => pathname === path || pathname.startsWith(path + '/'))
}

function usesImmersiveReviewLayout(pathname: string) {
  return /^\/contracts\/[^/]+\/(review|compare)\/?$/.test(pathname)
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const showSidebar = !usesPublicLayout(pathname)
  const immersiveReview = usesImmersiveReviewLayout(pathname)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(immersiveReview)

  useEffect(() => {
    if (!immersiveReview) {
      setSidebarCollapsed(false)
      return
    }
    const persisted = window.sessionStorage.getItem('ones-review-sidebar-collapsed')
    setSidebarCollapsed(persisted === null ? true : persisted === 'true')
  }, [immersiveReview])

  const handleSidebarCollapsedChange = (collapsed: boolean) => {
    setSidebarCollapsed(collapsed)
    if (immersiveReview) window.sessionStorage.setItem('ones-review-sidebar-collapsed', String(collapsed))
  }

  return (
    <>
      {showSidebar ? <Sidebar collapsed={sidebarCollapsed} onCollapsedChange={handleSidebarCollapsedChange} /> : null}
      {/*
        pt-14: mobile hamburger button space (smaller)
        pt-0 md:pt-14: tablet still needs hamburger space
        px-4 sm:px-6: mobile padding, slightly more on sm
        lg:pt-0 lg:px-0: desktop no padding
        lg:ml-64: desktop sidebar offset
      */}
      <main className={cn(
        'min-h-screen bg-background transition-[margin] duration-200',
        'pt-14 pb-4 px-4',
        'md:pt-16 md:pb-6 md:px-6',
        'lg:pt-0 lg:pb-0 lg:px-0',
        showSidebar && (sidebarCollapsed ? 'lg:ml-16' : 'lg:ml-64')
      )}>
        {children}
      </main>
    </>
  )
}

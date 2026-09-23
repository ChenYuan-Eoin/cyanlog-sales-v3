'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { Sidebar } from '@/components/layout/Sidebar'
import { cn } from '@/lib/utils'

const PUBLIC_LAYOUT_PATHS = ['/login', '/register', '/sales-portal']

function usesPublicLayout(pathname: string) {
  return PUBLIC_LAYOUT_PATHS.some((path) => pathname === path || pathname.startsWith(path + '/'))
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const showSidebar = !usesPublicLayout(pathname)

  return (
    <div data-slot="app-root" className="isolate min-h-screen">
      {showSidebar ? <Sidebar /> : null}
      <main className={cn(
        'min-h-screen bg-background',
        pathname === '/shipping' && 'h-dvh overflow-hidden',
        showSidebar
          ? 'pt-14 pb-4 px-4 md:pt-16 md:pb-6 md:px-6 xl:pt-0 xl:pb-0 xl:px-0'
          : 'p-0',
        showSidebar && 'xl:ml-64'
      )}>
        {children}
      </main>
    </div>
  )
}

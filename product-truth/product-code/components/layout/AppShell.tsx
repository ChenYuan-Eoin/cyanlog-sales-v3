'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { Sidebar } from '@/components/layout/Sidebar'
import { cn } from '@/lib/utils'
import { SessionActivity } from './SessionActivity'

const PUBLIC_LAYOUT_PATHS = ['/login', '/register']

function usesPublicLayout(pathname: string) {
  return PUBLIC_LAYOUT_PATHS.some((path) => pathname === path || pathname.startsWith(path + '/'))
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const publicLayout = usesPublicLayout(pathname)
  const showSidebar = !publicLayout && pathname !== '/pending-access'

  return (
    <div data-slot="app-root" className="isolate min-h-screen">
      {!publicLayout && pathname !== '/accept-invitation' && !pathname.startsWith('/accept-invitation/') ? <SessionActivity /> : null}
      {showSidebar ? <Sidebar /> : null}
      <main className={cn(
        'min-h-screen bg-background',
        (pathname === '/shipping' || pathname === '/sales-portal') && 'h-dvh overflow-hidden',
        // Below the workbench breakpoint, the shipping panes expand and the shell scrolls.
        pathname === '/shipping' && 'max-[899px]:overflow-y-auto',
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

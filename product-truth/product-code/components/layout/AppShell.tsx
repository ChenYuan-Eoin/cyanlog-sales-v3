'use client'

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { Sidebar } from '@/components/layout/Sidebar'
import { cn } from '@/lib/utils'

const PUBLIC_LAYOUT_PATHS = ['/login', '/register']

function usesPublicLayout(pathname: string) {
  return PUBLIC_LAYOUT_PATHS.some((path) => pathname === path || pathname.startsWith(path + '/'))
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const showSidebar = !usesPublicLayout(pathname)

  return (
    <>
      {showSidebar ? <Sidebar /> : null}
      <main className={cn(
        'min-h-screen bg-background',
        showSidebar
          ? 'pt-14 pb-4 px-4 md:pt-16 md:pb-6 md:px-6 lg:pt-0 lg:pb-0 lg:px-0'
          : 'p-0',
        showSidebar && 'lg:ml-64'
      )}>
        {children}
      </main>
    </>
  )
}

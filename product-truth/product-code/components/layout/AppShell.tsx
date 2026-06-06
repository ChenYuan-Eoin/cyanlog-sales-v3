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
      <main className={cn('min-h-screen bg-background', showSidebar && 'ml-64')}>
        {children}
      </main>
    </>
  )
}

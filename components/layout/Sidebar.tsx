'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const navItems = [
  { name: '工作台', href: '/', icon: '□' },
  { name: '报价中心', href: '/quotes', icon: '¥' },
  { name: '合同审核', href: '/contracts', icon: '📄' },
  { name: '配置中心', href: '/configs', icon: '⚙' },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="fixed left-0 top-0 h-screen w-64 bg-slate-900 text-white">
      <div className="p-6">
        <h1 className="text-xl font-bold">Cyanlog Sales</h1>
        <p className="text-xs text-slate-400 mt-1">智能销售支撑平台</p>
      </div>
      <nav className="px-3 py-4">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors',
              pathname === item.href
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            )}
          >
            <span className="text-lg">{item.icon}</span>
            <span>{item.name}</span>
          </Link>
        ))}
      </nav>
    </aside>
  )
}

'use client'

import Link from 'next/link'
import type { Module } from '@/lib/business-map/data'

const accentStyles: Record<Module['accentColor'], { ring: string; bg: string; text: string }> = {
  blue: { ring: 'ring-blue-200', bg: 'bg-blue-50', text: 'text-blue-700' },
  green: { ring: 'ring-green-200', bg: 'bg-green-50', text: 'text-green-700' },
  purple: { ring: 'ring-purple-200', bg: 'bg-purple-50', text: 'text-purple-700' },
  orange: { ring: 'ring-orange-200', bg: 'bg-orange-50', text: 'text-orange-700' },
  rose: { ring: 'ring-rose-200', bg: 'bg-rose-50', text: 'text-rose-700' },
  slate: { ring: 'ring-slate-200', bg: 'bg-slate-50', text: 'text-slate-700' },
}

export function ModuleCard({ module }: { module: Module }) {
  const accent = accentStyles[module.accentColor]
  const isPhase2 = module.phase === 'phase2'

  return (
    <Link
      href={module.href}
      className={`
        block rounded-lg border bg-white p-5 transition-all
        hover:shadow-md hover:-translate-y-0.5
        ${accent.ring} hover:ring-2
        ${isPhase2 ? 'opacity-75' : ''}
      `}
      aria-label={`跳转到 ${module.name}`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className={`text-3xl ${accent.bg} rounded-md w-12 h-12 flex items-center justify-center`}>
          {module.icon}
        </div>
        {isPhase2 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
            Phase 2
          </span>
        )}
      </div>
      <h3 className="font-semibold text-slate-900 mb-1">{module.name}</h3>
      <p className="text-sm text-slate-600 leading-relaxed">{module.description}</p>
    </Link>
  )
}

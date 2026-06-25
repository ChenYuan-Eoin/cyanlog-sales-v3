'use client'

import { Loader2Icon } from 'lucide-react'

export default function LoadingPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-4">
        <Loader2Icon className="h-8 w-8 animate-spin text-blue-600" />
        <p className="text-sm text-slate-600">加载中...</p>
      </div>
    </div>
  )
}

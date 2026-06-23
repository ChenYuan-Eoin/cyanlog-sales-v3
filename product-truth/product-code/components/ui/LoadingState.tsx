'use client'

import { Loader2Icon } from 'lucide-react'

interface LoadingStateProps {
  message?: string
  className?: string
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-8 w-8',
}

export function LoadingState({
  message = '加载中...',
  className = '',
  size = 'md',
}: LoadingStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-12 ${className}`}>
      <Loader2Icon className={`${sizeClasses[size]} animate-spin text-slate-400`} />
      {message && (
        <p className="mt-3 text-sm text-slate-500">{message}</p>
      )}
    </div>
  )
}

// 页面级loading（全屏居中）
export function PageLoading({ message = '加载中...' }: Omit<LoadingStateProps, 'className' | 'size'>) {
  return (
    <div className="flex h-[calc(100vh-200px)] items-center justify-center">
      <LoadingState message={message} size="lg" />
    </div>
  )
}

// 卡片级loading（紧凑）
export function CardLoading({ message }: Omit<LoadingStateProps, 'className' | 'size'>) {
  return (
    <div className="flex items-center justify-center py-8">
      <Loader2Icon className="h-5 w-5 animate-spin text-slate-400 mr-2" />
      {message && <span className="text-sm text-slate-500">{message}</span>}
    </div>
  )
}

import { FileQuestionIcon, SearchIcon, FolderOpenIcon, type LucideIcon } from 'lucide-react'
import { Button } from './button'

interface EmptyStateProps {
  title?: string
  description?: string
  icon?: LucideIcon
  action?: {
    label: string
    onClick: () => void
  }
  className?: string
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: {
    wrapper: 'py-8',
    icon: 'h-8 w-8',
    title: 'text-sm',
    desc: 'text-xs',
  },
  md: {
    wrapper: 'py-12',
    icon: 'h-12 w-12',
    title: 'text-base',
    desc: 'text-sm',
  },
  lg: {
    wrapper: 'py-16',
    icon: 'h-16 w-16',
    title: 'text-lg',
    desc: 'text-base',
  },
}

export function EmptyState({
  title = '暂无数据',
  description,
  icon: Icon = FolderOpenIcon,
  action,
  className = '',
  size = 'md',
}: EmptyStateProps) {
  const sizes = sizeClasses[size]

  return (
    <div className={`flex flex-col items-center justify-center text-center ${sizes.wrapper} ${className}`}>
      <div className="rounded-full bg-slate-100 p-3 mb-3">
        <Icon className={`${sizes.icon} text-slate-400`} />
      </div>
      <h3 className={`${sizes.title} font-medium text-slate-900 mb-1`}>{title}</h3>
      {description && (
        <p className={`${sizes.desc} text-slate-500 max-w-xs mb-4`}>{description}</p>
      )}
      {action && (
        <Button size={size === 'sm' ? 'sm' : 'default'} onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  )
}

// 搜索为空状态
export function EmptySearchState({
  keyword,
  onClear,
  className = '',
}: {
  keyword?: string
  onClear?: () => void
  className?: string
}) {
  return (
    <EmptyState
      title={keyword ? `未找到"${keyword}"相关结果` : '暂无搜索结果'}
      description="请尝试调整搜索关键词或筛选条件"
      icon={SearchIcon}
      action={onClear ? { label: '清除搜索', onClick: onClear } : undefined}
      className={className}
    />
  )
}

// 页面级空状态（居中，带背景）
export function PageEmptyState(props: Omit<EmptyStateProps, 'size'>) {
  return (
    <div className="flex h-[calc(100vh-300px)] items-center justify-center">
      <EmptyState {...props} size="lg" />
    </div>
  )
}

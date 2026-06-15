// components/ui/skeleton.tsx - 骨架屏组件
import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-slate-200", className)}
      {...props}
    />
  )
}

// 表格骨架屏
export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {/* 表头骨架 */}
      <div className="flex gap-4 pb-3 border-b">
        <Skeleton className="h-4 w-[25%]" />
        <Skeleton className="h-4 w-[25%]" />
        <Skeleton className="h-4 w-[25%]" />
        <Skeleton className="h-4 w-[25%]" />
      </div>
      {/* 行骨架 */}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 py-3 items-center">
          <div className="w-[25%] flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-full" />
            <div className="space-y-2 flex-1">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-2 w-1/2" />
            </div>
          </div>
          <Skeleton className="h-3 w-[20%]" />
          <Skeleton className="h-3 w-[20%]" />
          <Skeleton className="h-3 w-[15%]" />
        </div>
      ))}
    </div>
  )
}

// 卡片骨架屏
export function CardSkeleton() {
  return (
    <div className="rounded-xl border p-6 space-y-4">
      <div className="flex items-center gap-4">
        <Skeleton className="h-12 w-12 rounded-lg" />
        <div className="space-y-2 flex-1">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <Skeleton className="h-20 w-full" />
    </div>
  )
}

// 表单骨架屏
export function FormSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <div className="space-y-6">
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
      <Skeleton className="h-10 w-32" />
    </div>
  )
}

// 树形骨架屏
export function TreeSkeleton({ nodes = 8 }: { nodes?: number }) {
  return (
    <div className="space-y-1 p-2">
      {Array.from({ length: nodes }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-2 py-2"
          style={{ paddingLeft: `${(i % 3) * 20 + 12}px` }}
        >
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-8 ml-auto" />
        </div>
      ))}
    </div>
  )
}

// 统计卡片骨架屏
export function StatsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 rounded-xl border p-4">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      ))}
    </div>
  )
}

export { Skeleton }

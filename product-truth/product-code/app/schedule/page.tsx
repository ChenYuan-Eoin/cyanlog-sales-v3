// F018 日程管理 - 日程中心（WP11：时间线/日历/看板/列表 + 子任务折叠 + 关键路径）
// 路径：/schedule

import Link from 'next/link'
import { ScheduleClient } from './ScheduleClient'
import { Button } from '@/components/ui/button'

export const dynamic = 'force-dynamic'

export default function SchedulePage() {
  return (
    <div className="mx-auto max-w-[1400px] p-4 lg:p-6">
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-slate-900 mb-1">日程中心</h1>
          <p className="text-sm text-slate-500">时间线 · 日历 · 看板 · 列表，子任务折叠与关键路径</p>
        </div>
        <Link href="/schedule/new">
          <Button>+ 新建日程</Button>
        </Link>
      </div>
      <ScheduleClient />
    </div>
  )
}

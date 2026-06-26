// F018 日程管理 - 列表页
// 路径：/schedule

import Link from 'next/link'
import { ScheduleClient } from './ScheduleClient'
import { Button } from '@/components/ui/button'

export const dynamic = 'force-static'

export default function SchedulePage() {
  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-slate-900 mb-1">日程管理</h1>
          <p className="text-sm text-slate-500">管理任务、会议、跟进、提醒</p>
        </div>
        <Link href="/schedule/new">
          <Button>+ 新建日程</Button>
        </Link>
      </div>

      <ScheduleClient />
    </div>
  )
}

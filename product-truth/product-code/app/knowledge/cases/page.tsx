// F015 案例库列表页
// 路径：/knowledge/cases

import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase'
import { OUTCOME_LABEL, OUTCOME_COLOR, type CaseRecord } from '@/lib/case-library/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export const dynamic = 'force-dynamic'

export default async function CaseLibraryPage() {
  // 默认按创建时间倒序
  const { data: records } = await supabaseAdmin
    .from('case_library')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)

  const cases = (records as CaseRecord[] | null) || []

  // 统计
  const successCount = cases.filter((c) => c.outcome === 'SUCCESS').length
  const failureCount = cases.filter((c) => c.outcome === 'FAILURE').length

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      {/* 页头 */}
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-slate-900 mb-1">案例库</h1>
          <p className="text-sm text-slate-500">
            积累成功与失败案例，为报价、合同、投标提供实战参考
          </p>
        </div>
        <Link href="/knowledge/cases/new">
          <Button>+ 新建案例</Button>
        </Link>
      </div>

      {/* 统计卡 */}
      {cases.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          <div className="rounded-lg border bg-white p-4">
            <div className="text-xs text-slate-500 uppercase tracking-wide">总案例数</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{cases.length}</div>
          </div>
          <div className="rounded-lg border bg-white p-4">
            <div className="text-xs text-emerald-700 uppercase tracking-wide">成功案例</div>
            <div className="text-2xl font-bold text-emerald-700 mt-1">{successCount}</div>
          </div>
          <div className="rounded-lg border bg-white p-4">
            <div className="text-xs text-rose-700 uppercase tracking-wide">失败案例</div>
            <div className="text-2xl font-bold text-rose-700 mt-1">{failureCount}</div>
          </div>
        </div>
      )}

      {/* 列表 */}
      {cases.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <div className="text-4xl mb-4">📚</div>
            <p className="text-slate-700 font-medium mb-2">还没有案例</p>
            <p className="text-sm text-slate-500 mb-4">
              添加第一份成功或失败案例，为团队积累实战知识
            </p>
            <Link href="/knowledge/cases/new">
              <Button>+ 新建第一份案例</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cases.map((c) => (
            <Link
              key={c.id}
              href={`/knowledge/cases/${c.id}`}
              className="rounded-lg border bg-white p-5 hover:shadow-md hover:-translate-y-0.5 transition-all"
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <h3 className="font-semibold text-slate-900 line-clamp-2">{c.title}</h3>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
                    OUTCOME_COLOR[c.outcome as keyof typeof OUTCOME_COLOR]
                  }`}
                >
                  {OUTCOME_LABEL[c.outcome as keyof typeof OUTCOME_LABEL]}
                </span>
              </div>

              <div className="flex flex-wrap gap-2 text-xs text-slate-600 mb-3">
                <span className="px-2 py-0.5 rounded bg-slate-100">{c.industry}</span>
                <span className="px-2 py-0.5 rounded bg-slate-100">{c.product}</span>
                {c.amount && (
                  <span className="px-2 py-0.5 rounded bg-slate-100">
                    ¥{c.amount.toLocaleString('zh-CN')}
                  </span>
                )}
                {c.duration_months && (
                  <span className="px-2 py-0.5 rounded bg-slate-100">
                    {c.duration_months} 月
                  </span>
                )}
              </div>

              {c.challenge && (
                <p className="text-xs text-slate-600 line-clamp-2 mb-3">
                  <span className="text-slate-400">挑战：</span>
                  {c.challenge}
                </p>
              )}

              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>查看 {c.view_count} 次</span>
                <span>
                  {c.created_at ? new Date(c.created_at).toLocaleDateString('zh-CN') : ''}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

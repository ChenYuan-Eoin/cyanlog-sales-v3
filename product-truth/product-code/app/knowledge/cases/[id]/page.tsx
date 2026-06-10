// F015 案例详情页
// 路径：/knowledge/cases/[id]

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase'
import { resolveRouteParams } from '@/lib/route-params'
import {
  OUTCOME_LABEL,
  OUTCOME_COLOR,
  DIFFICULTY_LABEL,
  type CaseRecord,
} from '@/lib/case-library/types'

interface PageProps {
  params: Promise<{ id: string }> | { id: string }
}

export default async function CaseDetailPage({ params }: PageProps) {
  const { id } = await resolveRouteParams(params)
  const { data, error } = await supabaseAdmin
    .from('case_library')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) {
    notFound()
  }

  const c = data as CaseRecord

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      <Link
        href="/knowledge/cases"
        className="text-sm text-slate-500 hover:text-slate-700 mb-4 inline-block"
      >
        ← 返回案例库
      </Link>

      {/* 页头 */}
      <header className="mb-6">
        <div className="flex items-start justify-between gap-4 mb-3">
          <h1 className="text-2xl lg:text-3xl font-bold text-slate-900">{c.title}</h1>
          <span
            className={`text-sm px-3 py-1 rounded-full flex-shrink-0 ${
              OUTCOME_COLOR[c.outcome as keyof typeof OUTCOME_COLOR]
            }`}
          >
            {OUTCOME_LABEL[c.outcome as keyof typeof OUTCOME_LABEL]}
          </span>
        </div>

        <div className="flex flex-wrap gap-2 text-sm">
          <Tag>{c.industry}</Tag>
          <Tag>{c.product}</Tag>
          <Tag>{DIFFICULTY_LABEL[c.difficulty]}</Tag>
          {c.amount && <Tag>¥{c.amount.toLocaleString('zh-CN')}</Tag>}
          {c.duration_months && <Tag>{c.duration_months} 月</Tag>}
          {c.tags?.map((t) => <Tag key={t}>#{t}</Tag>)}
        </div>
      </header>

      {/* 基础信息 */}
      <section className="mb-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-3">基础信息</h2>
        <div className="rounded-lg border bg-white p-5">
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3">
            <Field label="客户" value={c.customer_name} />
            <Field label="行业" value={c.industry} />
            <Field label="产品" value={c.product} />
            <Field label="难度" value={DIFFICULTY_LABEL[c.difficulty]} />
            <Field label="结果" value={OUTCOME_LABEL[c.outcome]} />
            <Field
              label="项目金额"
              value={c.amount ? `¥${c.amount.toLocaleString('zh-CN')}` : '未填'}
            />
          </dl>
        </div>
      </section>

      {/* 详情描述 */}
      {(c.background || c.challenge || c.solution || c.success_factors || c.lessons_learned) && (
        <section className="mb-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-3">详情描述</h2>
          <div className="rounded-lg border bg-white p-5 space-y-5">
            {c.background && <Detail label="背景" content={c.background} />}
            {c.challenge && <Detail label="挑战" content={c.challenge} />}
            {c.solution && <Detail label="解决方案" content={c.solution} />}
            {c.success_factors && (
              <Detail
                label={c.outcome === 'SUCCESS' ? '关键成功因素' : '经验教训'}
                content={c.success_factors}
              />
            )}
            {c.lessons_learned && <Detail label="结果 / 反思" content={c.lessons_learned} />}
          </div>
        </section>
      )}

      {/* 底部元数据 */}
      <footer className="mt-8 pt-4 border-t flex items-center justify-between text-xs text-slate-500">
        <div>
          创建于 {c.created_at ? new Date(c.created_at).toLocaleString('zh-CN') : '—'}
          {' · '}
          更新于 {c.updated_at ? new Date(c.updated_at).toLocaleString('zh-CN') : '—'}
        </div>
        <div>查看 {c.view_count} 次</div>
      </footer>
    </div>
  )
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs px-2.5 py-1 rounded-md bg-slate-100 text-slate-700">{children}</span>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">
        {label}
      </dt>
      <dd className="text-sm text-slate-900">{value}</dd>
    </div>
  )
}

function Detail({ label, content }: { label: string; content: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-900 mb-2">{label}</h3>
      <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{content}</p>
    </div>
  )
}

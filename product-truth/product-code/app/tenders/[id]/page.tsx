// REQ:F014
// 标书详情页 - 展示 OCR 解析的结构化结果

import { notFound } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase'
import { resolveRouteParams } from '@/lib/route-params'
import type { TenderKeyInfo } from '@/lib/ocr/tender-parser'
import TenderWorkflow from '@/components/tender/TenderWorkflow'

interface PageProps {
  params: Promise<{ id: string }> | { id: string }
}

export default async function TenderDetailPage({ params }: PageProps) {
  const { id } = await resolveRouteParams(params)
  const { data: ocrResult, error } = await supabaseAdmin
    .from('ocr_results')
    .select('id, original_file, extracted_text, key_info, confidence, status, created_at')
    .eq('id', id)
    .single()

  if (error || !ocrResult) {
    notFound()
  }

  const keyInfo = (ocrResult.key_info || {}) as TenderKeyInfo
  const scores = keyInfo.scores || []
  const techReqs = keyInfo.technicalRequirements || []
  const commercial = keyInfo.commercialTerms || []
  const timeline = keyInfo.timeline || []
  const confidence = ocrResult.confidence ?? 0

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      {/* 页头 */}
      <header className="mb-6">
        <div className="flex items-baseline justify-between gap-4 mb-2">
          <h1 className="text-2xl lg:text-3xl font-bold text-slate-900">
            {keyInfo.tenderName || ocrResult.original_file}
          </h1>
          <ConfidenceBadge value={confidence} />
        </div>
        <div className="text-sm text-slate-500">
          来源文件：<code className="font-mono">{ocrResult.original_file}</code>
        </div>
      </header>

      {/* 基础信息 */}
      <section className="mb-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-3">基础信息</h2>
        <div className="rounded-lg border bg-white p-5">
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
            <Field label="招标编号" value={keyInfo.tenderNo} />
            <Field label="项目名称" value={keyInfo.tenderName} />
            <Field label="预算金额" value={keyInfo.budget} />
            <Field label="截止日期" value={keyInfo.deadline} />
            <Field label="采购人/招标人" value={keyInfo.publisher} />
            <Field label="联系方式" value={keyInfo.contact} />
          </dl>
        </div>
      </section>

      {/* 评分标准 */}
      {scores.length > 0 && (
        <section className="mb-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-3">
            评分标准
            <span className="text-sm font-normal text-slate-500 ml-2">（{scores.length} 项）</span>
          </h2>
          <div className="rounded-lg border bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-slate-700">评分项</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-700">权重</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-700">最高分</th>
                </tr>
              </thead>
              <tbody>
                {scores.map((s, idx) => (
                  <tr key={idx} className="border-t border-slate-100">
                    <td className="px-4 py-3 text-slate-900">{s.item}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-mono bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
                        {s.weight}%
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-700">{s.maxScore}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 技术要求 */}
      {techReqs.length > 0 && (
        <section className="mb-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-3">
            技术要求
            <span className="text-sm font-normal text-slate-500 ml-2">（{techReqs.length} 条）</span>
          </h2>
          <div className="rounded-lg border bg-white p-5">
            <ul className="space-y-2">
              {techReqs.map((req, idx) => (
                <li key={idx} className="flex items-start gap-2 text-sm text-slate-700">
                  <span className="text-slate-400 mt-0.5">›</span>
                  <span>{req}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* 商务条款 */}
      {commercial.length > 0 && (
        <section className="mb-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-3">
            商务条款
            <span className="text-sm font-normal text-slate-500 ml-2">（{commercial.length} 项）</span>
          </h2>
          <div className="rounded-lg border bg-white p-5 space-y-2">
            {commercial.map((term, idx) => (
              <div key={idx} className="text-sm text-slate-700">
                {term}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 时间节点 */}
      {timeline.length > 0 && (
        <section className="mb-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-3">
            时间节点
            <span className="text-sm font-normal text-slate-500 ml-2">（{timeline.length} 个）</span>
          </h2>
          <div className="rounded-lg border bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-slate-700">事件</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-700">日期</th>
                </tr>
              </thead>
              <tbody>
                {timeline.map((t, idx) => (
                  <tr key={idx} className="border-t border-slate-100">
                    <td className="px-4 py-3 text-slate-900">{t.event}</td>
                    <td className="px-4 py-3 font-mono text-slate-700">{t.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 无关键信息提示 */}
      {scores.length === 0 && techReqs.length === 0 && commercial.length === 0 && timeline.length === 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
          ⚠️ 未从文档中识别出评分标准、技术要求、商务条款、时间节点等结构化信息。
          可能是文档格式特殊或 OCR 文本质量不足。
        </div>
      )}

      <footer className="mt-8 pt-4 border-t text-xs text-slate-500">
        解析时间：
        {ocrResult.created_at ? new Date(ocrResult.created_at).toLocaleString('zh-CN') : '未知'}
        · 信心度 {confidence}%
      </footer>

      {/* 工作流引擎 */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">标书生成工作流</h2>
        <TenderWorkflow tenderId={id} />
      </section>
    </div>
  )
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">
        {label}
      </dt>
      <dd className="text-sm text-slate-900">
        {value ? (
          value
        ) : (
          <span className="text-slate-400">未识别</span>
        )}
      </dd>
    </div>
  )
}

function ConfidenceBadge({ value }: { value: number }) {
  let color = 'bg-slate-100 text-slate-700'
  let label = '低'
  if (value >= 80) {
    color = 'bg-emerald-100 text-emerald-700'
    label = '高'
  } else if (value >= 50) {
    color = 'bg-blue-100 text-blue-700'
    label = '中'
  }
  return (
    <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${color}`}>
      信心度 {value}% · {label}
    </span>
  )
}

// REQ:F014
// 标书详情页 - 展示 OCR 解析的结构化结果

import { notFound } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase'
import { resolveRouteParams } from '@/lib/route-params'
import type { TenderKeyInfo } from '@/lib/ocr/tender-parser'

interface PageProps {
  params: Promise<{ id: string }>
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
  const aiRuntime = keyInfo.aiRuntime || null

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

      <RuntimeEvidencePanel runtime={aiRuntime} />

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
          未从文档中识别出评分标准、技术要求、商务条款、时间节点等结构化信息。
          可能是文档格式特殊或 OCR 文本质量不足。
        </div>
      )}

      <footer className="mt-8 pt-4 border-t text-xs text-slate-500">
        解析时间：
        {ocrResult.created_at ? new Date(ocrResult.created_at).toLocaleString('zh-CN') : '未知'}
        · 信心度 {confidence}%
      </footer>
    </div>
  )
}

function RuntimeEvidencePanel({ runtime }: { runtime: TenderKeyInfo['aiRuntime'] | null }) {
  if (!runtime) {
    return (
      <section className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
        <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-amber-900">AI 解析证据缺失</h2>
            <p className="mt-1 text-xs text-amber-800">
              当前记录没有云模型调用证据，只能按确定性解析结果人工复核。
            </p>
          </div>
          <span className="mt-2 w-fit rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900 md:mt-0">
            未验证
          </span>
        </div>
      </section>
    )
  }

  const totalChunks = runtime.chunk_count ?? 0
  const analyzedChunks = runtime.analyzed_chunk_count ?? 0
  const selectedChunks = runtime.selected_chunk_count ?? (totalChunks || analyzedChunks)
  const displayTotalChunks = totalChunks || selectedChunks
  const characterCoverage = formatCoverage(runtime.character_coverage_ratio ?? runtime.coverage_ratio, runtime.analyzed_text_length, runtime.text_length)
  const chunkCoverage = formatCoverage(runtime.chunk_coverage_ratio, analyzedChunks, displayTotalChunks)
  const chunks = [analyzedChunks, selectedChunks, displayTotalChunks]
  const chars = [
    runtime.analyzed_text_length ?? 0,
    runtime.selected_text_length ?? 0,
    runtime.text_length ?? 0,
  ]
  const statusClass = runtime.degraded
    ? 'border-amber-200 bg-amber-50 text-amber-900'
    : 'border-emerald-200 bg-emerald-50 text-emerald-900'
  const statusLabel = runtime.degraded ? '部分解析' : '完整解析'
  const invocationId = runtime.model_invocation_id

  return (
    <section className="mb-6 rounded-lg border bg-white">
      <div className="flex flex-col gap-3 border-b px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">AI 解析证据</h2>
          <p className="mt-1 text-sm text-slate-500">
            云模型、分块覆盖率和调用记录用于判断长文本解析是否可信。
          </p>
        </div>
        <span className={`w-fit rounded-full border px-2.5 py-1 text-xs font-medium ${statusClass}`}>
          {statusLabel}
        </span>
      </div>

      <div className="grid gap-0 divide-y md:grid-cols-4 md:divide-x md:divide-y-0">
        <RuntimeMetric label="Provider" value={runtime.provider || 'unknown'} />
        <RuntimeMetric label="Model" value={runtime.model || 'unknown'} />
        <RuntimeMetric label="Transport" value={formatTransport(runtime.transport)} />
        <RuntimeMetric label="字符覆盖" value={characterCoverage} />
      </div>

      <div className="grid gap-3 border-t px-5 py-4 text-sm text-slate-600 md:grid-cols-4">
        <div>
          <span className="text-xs text-slate-500">分块</span>
          <div className="mt-1 font-mono text-slate-900">
            {chunks[0]} / {chunks[1]} / {chunks[2]}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">成功 / 已选 / 总计</div>
        </div>
        <div>
          <span className="text-xs text-slate-500">正文字符</span>
          <div className="mt-1 font-mono text-slate-900">
            {formatNumber(chars[0])} / {formatNumber(chars[1])} / {formatNumber(chars[2])}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">成功 / 已选 / 总计 · chunk {chunkCoverage}</div>
        </div>
        <div>
          <span className="text-xs text-slate-500">耗时</span>
          <div className="mt-1 font-mono text-slate-900">
            {formatDuration(runtime.processing_ms)}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">并发 {runtime.concurrency ?? 0}</div>
        </div>
        <div>
          <span className="text-xs text-slate-500">调用 ID</span>
          <div className="mt-1 font-mono text-slate-900">
            {invocationId ? invocationId.slice(0, 8) : '未记录'}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">{invocationId || '未写入 model_invocations'}</div>
        </div>
        <div className="md:col-span-4">
          <span className="text-xs text-slate-500">异常</span>
          <div className="mt-1 text-slate-900">
            {runtime.attempt_errors?.length ? `${runtime.attempt_errors.length} 条` : '无'}
          </div>
          {runtime.attempt_errors?.length ? (
            <div className="mt-0.5 line-clamp-1 text-xs text-amber-700">{runtime.attempt_errors[0]}</div>
          ) : (
            <div className="mt-0.5 text-xs text-slate-500">未记录模型调用错误</div>
          )}
        </div>
      </div>
    </section>
  )
}

function RuntimeMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-5 py-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-slate-900" title={value}>
        {value}
      </div>
    </div>
  )
}

function computedCoverage(analyzedChunks: number, totalChunks: number) {
  if (!totalChunks) return null
  return analyzedChunks / totalChunks
}

function formatCoverage(value: unknown, analyzedChunks = 0, totalChunks = 0) {
  const fallback = computedCoverage(analyzedChunks, totalChunks)
  const source = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  if (typeof source !== 'number' || !Number.isFinite(source)) return '未知'
  const normalized = source > 1 ? source : source * 100
  return `${Math.max(0, Math.min(100, Math.round(normalized)))}%`
}

function formatTransport(value: unknown) {
  if (typeof value !== 'string' || !value) return 'unknown'
  const map: Record<string, string> = {
    openai_compatible_http: 'HTTP',
    manual_fallback: 'Fallback',
    lm_studio_cli: 'LM Studio CLI',
    builtin_rule_engine: 'Rule Engine',
  }
  return map[value] || value
}

function formatNumber(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0'
  return Intl.NumberFormat('zh-CN').format(Math.round(value))
}

function formatDuration(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '未知'
  if (value < 1000) return `${Math.round(value)}ms`
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}s`
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

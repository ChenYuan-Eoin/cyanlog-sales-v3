'use client'

// REQ: F047
// PURPOSE: 报价审核核验面板——自动逐项展示审核 Checklist 结果
import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface ReviewCheck {
  code: string
  label: string
  level: 'block' | 'warn' | 'pass'
  ok: boolean
  message?: string
  line?: number
}

interface ReviewResult {
  status: 'PASS' | 'WARN' | 'BLOCK'
  checks: ReviewCheck[]
  blocked: ReviewCheck[]
  warnings: ReviewCheck[]
}

interface AiSummaryOutput {
  summary: { summary: string; risks: string[]; suggestions: string[] } | null
  reason?: string
}

const statusMeta: Record<ReviewResult['status'], { label: string; variant: 'default' | 'secondary' | 'destructive'; color: string }> = {
  PASS: { label: '审核通过', variant: 'default', color: 'text-emerald-600' },
  WARN: { label: '有提醒项', variant: 'secondary', color: 'text-amber-600' },
  BLOCK: { label: '暂缓审批', variant: 'destructive', color: 'text-red-600' },
}

export default function ReviewPanel({ quoteId }: { quoteId: string }) {
  const [result, setResult] = useState<ReviewResult | null>(null)
  const [aiSummary, setAiSummary] = useState<AiSummaryOutput | null>(null)
  const [showAi, setShowAi] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetch(`/api/quotes/${quoteId}/review?ai=1`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
    })
      .then(async (res) => {
        const json = await res.json()
        if (!alive) return
        if (!res.ok || !json.success) {
          setError(json.error?.message || '核验失败')
          return
        }
        setResult(json.data as ReviewResult)
        if (json.aiSummary) setAiSummary(json.aiSummary as AiSummaryOutput)
      })
      .catch(() => alive && setError('核验服务不可用'))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [quoteId])

  if (loading) {
    return (
      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">审核核验</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-slate-500">核验中...</p></CardContent>
      </Card>
    )
  }

  if (error || !result) {
    return (
      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">审核核验</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-red-600">{error || '暂无核验结果'}</p></CardContent>
      </Card>
    )
  }

  const meta = statusMeta[result.status]
  return (
    <Card className="mb-6">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">审核核验（自动化）</CardTitle>
        <Badge variant={meta.variant}>{meta.label}</Badge>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {result.status === 'BLOCK' && (
          <p className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            不满足审核要求，提交审批已被暂缓；请修正后重新提交。
          </p>
        )}
        <div className="grid gap-1">
          {result.checks.map((check, i) => (
            <div key={`${check.code}-${i}`} className="flex items-start gap-2 text-sm">
              <span className={check.ok ? 'text-emerald-600' : check.level === 'block' ? 'text-red-600' : 'text-amber-600'}>
                {check.ok ? '✅' : check.level === 'block' ? '❌' : '⚠️'}
              </span>
              <span className="flex-1">
                <span className="text-slate-700">{check.label}</span>
                {check.message && <span className="ml-2 text-slate-500">{check.message}</span>}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-3 border-t pt-3">
          <button type="button" className="text-sm text-slate-600 hover:text-slate-900" onClick={() => setShowAi((v) => !v)}>
            🤖 AI 审核意见 {showAi ? '收起' : '展开'}
          </button>
          {showAi && (
            <div className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-sm">
              {aiSummary?.summary ? (
                <div className="space-y-2">
                  <p className="text-slate-800">{aiSummary.summary.summary}</p>
                  {aiSummary.summary.risks.length > 0 && (
                    <ul className="list-disc pl-4 text-slate-600">
                      {aiSummary.summary.risks.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  )}
                  {aiSummary.summary.suggestions.length > 0 && (
                    <ul className="list-disc pl-4 text-slate-600">
                      {aiSummary.summary.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                  )}
                </div>
              ) : (
                <p className="text-slate-500">{aiSummary?.reason || 'AI 审核助手暂不可用'}</p>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

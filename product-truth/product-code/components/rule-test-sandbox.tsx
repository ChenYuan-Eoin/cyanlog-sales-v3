// F009 规则测试沙箱组件
// 路径：嵌入在 configs/page.tsx 中
// 功能：粘贴合同文本 → 立即显示规则匹配结果

'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

interface Risk {
  level: 'red' | 'yellow' | 'green'
  title: string
  description: string
  suggestion: string
  ruleId?: string
}

interface AnalysisResults {
  risks: Risk[]
  summary: string
  appliedRules: number
  matchedRules: number
}

interface Props {
  onClose?: () => void
}

const RISK_BADGE = {
  red: { label: '🔴 红灯', className: 'bg-rose-100 text-rose-800 border-rose-200' },
  yellow: { label: '🟡 黄灯', className: 'bg-amber-100 text-amber-800 border-amber-200' },
  green: { label: '🟢 绿灯', className: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
}

export function RuleTestSandbox({ onClose }: Props) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<AnalysisResults | null>(null)
  const [error, setError] = useState('')

  async function handleTest() {
    if (text.length < 10) {
      setError('请粘贴至少 10 个字符的合同文本')
      return
    }
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/rules/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ text }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error || `测试失败 (${res.status})`)
        return
      }
      const data = await res.json()
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-lg border bg-white p-5 space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <h3 className="font-semibold text-slate-900">🧪 规则测试沙箱</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            粘贴合同文本，立即查看所有启用规则的匹配结果
          </p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl"
            aria-label="关闭"
          >
            ×
          </button>
        )}
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        placeholder="粘贴合同文本片段，例如：&#10;本合同自2024年1月1日起生效，付款账期为120天，违约金为每日0.05%..."
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-mono leading-relaxed"
      />

      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">
          {text.length} 字符
          {text.length > 50000 && <span className="text-rose-600 ml-2">超过 50000 字符上限</span>}
        </span>
        <Button onClick={handleTest} disabled={loading || text.length < 10}>
          {loading ? '运行中...' : '运行测试'}
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-3 pt-2 border-t">
          {/* 摘要 */}
          <div className="flex items-center gap-4 text-sm">
            <div>
              <span className="text-slate-500">应用规则：</span>
              <span className="font-medium text-slate-900">{result.appliedRules}</span>
            </div>
            <div>
              <span className="text-slate-500">匹配命中：</span>
              <span className="font-medium text-slate-900">{result.matchedRules}</span>
            </div>
            <div className="ml-auto text-slate-600 italic text-xs">{result.summary}</div>
          </div>

          {/* 风险结果 */}
          {result.risks.length === 0 ? (
            <div className="rounded-md bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800">
              ✓ 未匹配到任何风险规则
            </div>
          ) : (
            <div className="space-y-2">
              {result.risks.map((risk, idx) => {
                const badge = RISK_BADGE[risk.level]
                return (
                  <div
                    key={idx}
                    className={`rounded-md border p-3 text-sm ${badge.className}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium">{badge.label}</span>
                      <span className="font-medium">{risk.title}</span>
                      {risk.ruleId && (
                        <span className="text-xs opacity-60 font-mono">#{risk.ruleId.slice(0, 8)}</span>
                      )}
                    </div>
                    <p className="text-xs leading-relaxed">{risk.description}</p>
                    {risk.suggestion && (
                      <p className="text-xs mt-1.5 italic">
                        💡 建议：{risk.suggestion}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { LoadingState } from '@/components/ui/LoadingState'
import { PlayIcon, FileTextIcon, AlertTriangleIcon, CheckCircleIcon, XCircleIcon } from 'lucide-react'
import Link from 'next/link'

interface SimulationResult {
  ruleId: string
  ruleName: string
  matched: boolean
  level: 'A' | 'B' | 'C' | null
  action: string
  message: string
  counterparty?: string
}

export default function RuleSimulatorPage() {
  const [contractText, setContractText] = useState('')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<SimulationResult[]>([])
  const [summary, setSummary] = useState({
    total: 0,
    matched: 0,
    red: 0,
    yellow: 0,
    green: 0,
  })

  const runSimulation = async () => {
    if (!contractText.trim()) return
    setLoading(true)

    try {
      const res = await fetch('/api/rules/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: contractText }),
      })

      if (res.ok) {
        const data = await res.json()
        setResults(data.results || [])
        setSummary({
          total: data.summary?.total || 0,
          matched: data.summary?.matched || 0,
          red: data.summary?.red || 0,
          yellow: data.summary?.yellow || 0,
          green: data.summary?.green || 0,
        })
      }
    } catch (err) {
      console.error('Simulation failed:', err)
    } finally {
      setLoading(false)
    }
  }

  const levelColors = {
    A: 'border-green-200 bg-green-50',
    B: 'border-yellow-200 bg-yellow-50',
    C: 'border-red-200 bg-red-50',
    null: 'border-slate-200 bg-slate-50',
  }

  const levelIcons = {
    A: <CheckCircleIcon className="h-5 w-5 text-green-600" />,
    B: <AlertTriangleIcon className="h-5 w-5 text-yellow-600" />,
    C: <XCircleIcon className="h-5 w-5 text-red-600" />,
    null: <FileTextIcon className="h-5 w-5 text-slate-400" />,
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-6">
        <Link href="/configs?tab=rules" className="text-sm text-slate-500 hover:text-slate-900 mb-2 inline-block">
          ← 返回配置中心
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">规则模拟器</h1>
        <p className="text-slate-500 mt-1">输入合同文本，实时模拟所有规则的命中情况</p>
      </div>

      <div className="grid gap-6">
        {/* 输入区域 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">合同文本</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              value={contractText}
              onChange={(e) => setContractText(e.target.value)}
              placeholder="粘贴合同文本，例如：
付款条款：合同签订后30天内支付全款。
质保条款：质保期为合同签订后12个月。
违约金条款：每逾期一天，按合同总价万分之五支付违约金。"
              className="min-h-[200px]"
            />
            <div className="flex gap-3">
              <Button onClick={runSimulation} disabled={loading || !contractText.trim()}>
                {loading ? (
                  <>
                    <LoadingState size="sm" />
                    运行中...
                  </>
                ) : (
                  <>
                    <PlayIcon className="h-4 w-4 mr-1" />
                    运行模拟
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setContractText('')
                  setResults([])
                }}
              >
                清空
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* 统计摘要 */}
        {results.length > 0 && (
          <div className="grid grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-slate-900">{summary.total}</div>
                <div className="text-xs text-slate-500">总规则数</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-green-600">{summary.green}</div>
                <div className="text-xs text-slate-500">通过</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-yellow-600">{summary.yellow}</div>
                <div className="text-xs text-slate-500">偏离</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-red-600">{summary.red}</div>
                <div className="text-xs text-slate-500">红线</div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* 结果列表 */}
        {results.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">模拟结果</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {results.map((result, idx) => (
                <div
                  key={idx}
                  className={`p-4 rounded-lg border ${levelColors[result.level || 'null']}`}
                >
                  <div className="flex items-start gap-3">
                    {levelIcons[result.level || 'null']}
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{result.ruleName}</span>
                        <Badge variant="outline">
                          {result.level === 'A' && '🟢 通过'}
                          {result.level === 'B' && '🟡 偏离'}
                          {result.level === 'C' && '🔴 红线'}
                          {result.level === null && '⚪ 未命中'}
                        </Badge>
                      </div>
                      <p className="text-sm text-slate-600 mt-1">{result.message}</p>
                      {result.counterparty && (
                        <p className="text-sm text-slate-500 mt-1">
                          💡 建议: {result.counterparty}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

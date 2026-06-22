'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AlertTriangleIcon, CheckCircleIcon, ShieldCheckIcon, Loader2Icon } from 'lucide-react'
import { error as toastError } from '@/lib/toast'

interface RiskCard {
  id: string
  level: 'red' | 'yellow' | 'green'
  title: string
  description: string
  suggestion?: string
  ruleCode?: string
}

interface ReviewResult {
  risks: RiskCard[]
  summary: string
  appliedRules: number
  matchedRules: number
  greenCount: number
  yellowCount: number
  redCount: number
}

export default function RuleReviewPage() {
  const [contractText, setContractText] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ReviewResult | null>(null)
  const [activeFilter, setActiveFilter] = useState<'all' | 'red' | 'yellow' | 'green'>('all')

  const runReview = useCallback(async () => {
    if (!contractText.trim()) {
      toastError('请提供合同文本')
      return
    }

    setLoading(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/contracts/analyze', {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: contractText }),
      })

      if (res.ok) {
        const data = await res.json()
        setResult(data.data || null)
      } else {
        toastError('审核失败')
      }
    } catch (err) {
      console.error('Review error:', err)
      toastError('审核请求失败')
    } finally {
      setLoading(false)
    }
  }, [contractText])

  const filteredRisks = result?.risks?.filter((r) =>
    activeFilter === 'all' ? true : r.level === activeFilter
  ) || []

  const levelConfig = {
    red: { label: '红线', color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200', icon: <AlertTriangleIcon className="h-5 w-5" /> },
    yellow: { label: '偏离', color: 'text-yellow-700', bg: 'bg-yellow-50', border: 'border-yellow-200', icon: <AlertTriangleIcon className="h-5 w-5" /> },
    green: { label: '通过', color: 'text-green-700', bg: 'bg-green-50', border: 'border-green-200', icon: <CheckCircleIcon className="h-5 w-5" /> },
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">合同规则审核</h1>
        <p className="text-slate-500 mt-1">基于预置规则自动审核合同文本，识别风险点</p>
      </div>

      {/* 输入区域 */}
      {!result && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">合同文本</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              value={contractText}
              onChange={(e) => setContractText(e.target.value)}
              placeholder="粘贴合同文本，系统将根据预置规则进行审核...

例如：
付款条款：合同签订后30天内支付全款。
质保条款：质保期为合同签订后12个月。
违约金条款：每逾期一天，按合同总价万分之五支付违约金。"
              className="min-h-[250px]"
            />
            <Button
              onClick={runReview}
              disabled={loading || !contractText.trim()}
              className="w-full"
            >
              {loading ? (
                <>
                  <Loader2Icon className="h-4 w-4 animate-spin mr-2" />
                  审核中...
                </>
              ) : (
                <>
                  <ShieldCheckIcon className="h-4 w-4 mr-2" />
                  开始规则审核
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 结果区域 */}
      {result && (
        <div className="space-y-6">
          {/* 返回按钮 */}
          <Button variant="outline" onClick={() => setResult(null)}>
            ← 重新审核
          </Button>

          {/* 统计摘要 */}
          <div className="grid grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-slate-900">{result.appliedRules}</div>
                <div className="text-xs text-slate-500">检查规则</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-green-600">{result.greenCount}</div>
                <div className="text-xs text-slate-500">通过</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-yellow-600">{result.yellowCount}</div>
                <div className="text-xs text-slate-500">偏离</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-red-600">{result.redCount}</div>
                <div className="text-xs text-slate-500">红线</div>
              </CardContent>
            </Card>
          </div>

          {/* 总结 */}
          {result.summary && (
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-slate-600">{result.summary}</p>
              </CardContent>
            </Card>
          )}

          {/* 风险卡片筛选 */}
          <Tabs value={activeFilter} onValueChange={(v) => setActiveFilter(v as typeof activeFilter)}>
            <TabsList>
              <TabsTrigger value="all">全部 ({result.risks?.length || 0})</TabsTrigger>
              <TabsTrigger value="red" className="text-red-600">🔴 红线 ({result.redCount})</TabsTrigger>
              <TabsTrigger value="yellow" className="text-yellow-600">🟡 偏离 ({result.yellowCount})</TabsTrigger>
              <TabsTrigger value="green" className="text-green-600">🟢 通过 ({result.greenCount})</TabsTrigger>
            </TabsList>

            <TabsContent value={activeFilter} className="mt-4">
              <div className="space-y-3">
                {filteredRisks.length === 0 ? (
                  <div className="text-center py-8 text-slate-500">
                    该级别暂无结果
                  </div>
                ) : (
                  filteredRisks.map((risk) => {
                    const config = levelConfig[risk.level]
                    return (
                      <Card key={risk.id} className={`${config.bg} ${config.border}`}>
                        <CardContent className="p-4">
                          <div className="flex items-start gap-3">
                            {config.icon}
                            <div className="flex-1">
                              <div className="flex items-center justify-between">
                                <span className={`font-medium ${config.color}`}>{risk.title}</span>
                                <Badge variant="outline" className={config.color}>
                                  {config.label}
                                </Badge>
                              </div>
                              <p className="text-sm text-slate-600 mt-1">{risk.description}</p>
                              {risk.suggestion && (
                                <p className="text-sm text-slate-500 mt-2">
                                  💡 建议: {risk.suggestion}
                                </p>
                              )}
                              {risk.ruleCode && (
                                <p className="text-xs text-slate-400 mt-1">
                                  规则编码: {risk.ruleCode}
                                </p>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  )
}

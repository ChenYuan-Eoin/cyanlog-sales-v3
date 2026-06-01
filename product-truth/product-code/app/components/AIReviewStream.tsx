'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface Risk {
  level: 'red' | 'yellow' | 'green'
  title: string
  description: string
  suggestion: string
}

interface AIReviewResult {
  risks: Risk[]
  summary: string
}

export default function AIReviewStream({ contractId }: { contractId: string }) {
  const [isStreaming, setIsStreaming] = useState(false)
  const [result, setResult] = useState<AIReviewResult | null>(null)
  const [error, setError] = useState('')

  const startAIReview = useCallback(async () => {
    setIsStreaming(true)
    setResult(null)
    setError('')

    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/contracts/${contractId}/ai-review`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'AI review failed')
      }

      // Handle streaming response
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let fullText = ''

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value, { stream: true })
          fullText += chunk

          // Try to parse partial result
          try {
            // Extract JSON from the stream
            const jsonMatch = fullText.match(/\{[\s\S]*\}/)
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0])
              if (parsed.risks && parsed.summary) {
                setResult(parsed)
              }
            }
          } catch {
            // Ignore parse errors during streaming
          }
        }
      }

      // Final parse
      try {
        const jsonMatch = fullText.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const finalResult = JSON.parse(jsonMatch[0])
          setResult(finalResult)
        }
      } catch (e) {
        console.warn('Could not parse final result:', e)
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI review failed')
    } finally {
      setIsStreaming(false)
    }
  }, [contractId])

  const riskLevelMap = {
    red: { label: '红灯', className: 'bg-red-100 text-red-800 border-red-200' },
    yellow: { label: '黄灯', className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
    green: { label: '绿灯', className: 'bg-green-100 text-green-800 border-green-200' },
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between">
          <span>AI 智能审核（流式）</span>
          <Button
            onClick={startAIReview}
            disabled={isStreaming}
            size="sm"
          >
            {isStreaming ? '分析中...' : '开始 AI 审核'}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isStreaming && !result && (
          <div className="py-8 text-center">
            <div className="animate-pulse">
              <p className="text-slate-500">AI 正在分析合同...</p>
            </div>
          </div>
        )}

        {error && (
          <div className="p-4 text-sm text-red-600 bg-red-50 rounded-lg">
            {error}
          </div>
        )}

        {result && (
          <div className="space-y-4">
            <div className="p-4 bg-slate-50 rounded-lg">
              <h4 className="font-medium mb-2">审核摘要</h4>
              <p className="text-sm text-slate-600">{result.summary}</p>
            </div>

            {result.risks.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-sm font-medium">
                  发现 {result.risks.length} 个问题
                </h4>
                {result.risks.map((risk, index) => (
                  <div
                    key={index}
                    className={`p-4 rounded-lg border ${riskLevelMap[risk.level]?.className || 'bg-slate-50'}`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="outline" className="text-xs">
                        {riskLevelMap[risk.level]?.label || risk.level}
                      </Badge>
                      <span className="font-medium">{risk.title}</span>
                    </div>
                    <p className="text-sm mb-2">{risk.description}</p>
                    <p className="text-sm text-slate-600">
                      <span className="font-medium">建议：</span>
                      {risk.suggestion}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

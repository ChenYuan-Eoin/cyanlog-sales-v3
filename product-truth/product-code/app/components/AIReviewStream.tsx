'use client'

import { useState, useCallback, useRef } from 'react'
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

/**
 * Streaming JSON Parser — 逐字符累积 + 括号计数
 * 原理：遇到 { 深度+1，遇到 } 深度-1，深度归零时尝试parse
 */
function tryParseStreamingJSON(text: string): {
  result: AIReviewResult | null
  parseable: boolean
} {
  let depth = 0
  let startIndex = -1

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '{') {
      if (depth === 0) startIndex = i
      depth++
    } else if (char === '}') {
      depth--
      if (depth === 0 && startIndex !== -1) {
        // 找到一个完整的JSON对象
        const jsonStr = text.slice(startIndex, i + 1)
        try {
          const parsed = JSON.parse(jsonStr)
          if (parsed.risks && parsed.summary) {
            return { result: parsed as AIReviewResult, parseable: true }
          }
        } catch {
          // 不是有效JSON，继续找下一个
        }
      }
    }
  }

  return { result: null, parseable: false }
}

/**
 * SSE断连重试配置
 * 指数退避，最多5次重试，30秒心跳
 */
const SSE_CONFIG = {
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  heartbeatIntervalMs: 30000,
}

function calculateBackoff(attempt: number): number {
  const delay = SSE_CONFIG.baseDelayMs * Math.pow(2, attempt)
  return Math.min(delay, SSE_CONFIG.maxDelayMs)
}

export default function AIReviewStream({ contractId }: { contractId: string }) {
  const [isStreaming, setIsStreaming] = useState(false)
  const [result, setResult] = useState<AIReviewResult | null>(null)
  const [error, setError] = useState('')
  const [retryCount, setRetryCount] = useState(0)
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed'>('idle')

  // 用ref保存累积文本，避免重渲染
  const accumulatedTextRef = useRef('')
  const abortControllerRef = useRef<AbortController | null>(null)

  const startAIReview = useCallback(async () => {
    setIsStreaming(true)
    setResult(null)
    setError('')
    setRetryCount(0)
    setConnectionStatus('connecting')
    accumulatedTextRef.current = ''

    let attempt = 0

    while (attempt <= SSE_CONFIG.maxRetries) {
      if (attempt > 0) {
        setConnectionStatus('reconnecting')
        setRetryCount(attempt)
        const backoff = calculateBackoff(attempt - 1)
        await new Promise((resolve) => setTimeout(resolve, backoff))
      }

      try {
        const token = localStorage.getItem('token')
        abortControllerRef.current = new AbortController()

        const response = await fetch(`/api/contracts/${contractId}/ai-review`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
          signal: abortControllerRef.current.signal,
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || `HTTP ${response.status}`)
        }

        setConnectionStatus('connected')

        // 处理流式响应
        const reader = response.body?.getReader()
        const decoder = new TextDecoder()

        if (!reader) {
          throw new Error('No response body')
        }

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value, { stream: true })
          accumulatedTextRef.current += chunk

          // 尝试解析累积的JSON
          const { result: parsed } = tryParseStreamingJSON(accumulatedTextRef.current)
          if (parsed) {
            setResult(parsed)
          }
        }

        // 最终解析
        const { result: finalResult } = tryParseStreamingJSON(accumulatedTextRef.current)
        if (finalResult) {
          setResult(finalResult)
        } else {
          console.warn('[AIReviewStream] Could not parse final result')
        }

        // 成功完成，跳出重试循环
        setConnectionStatus('idle')
        break

      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'AI review failed'

        // 如果是用户主动取消，不重试
        if (errorMsg.includes('abort') || errorMsg.includes('Abort')) {
          setConnectionStatus('idle')
          break
        }

        attempt++

        if (attempt > SSE_CONFIG.maxRetries) {
          setError(`连接失败（重试${SSE_CONFIG.maxRetries}次后放弃）: ${errorMsg}`)
          setConnectionStatus('failed')
        } else {
          console.warn(`[AIReviewStream] Attempt ${attempt} failed, retrying...`)
        }
      }
    }

    setIsStreaming(false)
  }, [contractId])

  const cancelReview = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    setIsStreaming(false)
    setConnectionStatus('idle')
  }, [])

  const riskLevelMap = {
    red: { label: '红灯', className: 'bg-red-100 text-red-800 border-red-200' },
    yellow: { label: '黄灯', className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
    green: { label: '绿灯', className: 'bg-green-100 text-green-800 border-green-200' },
  }

  const statusMap = {
    idle: '',
    connecting: '连接中...',
    connected: 'AI分析中...',
    reconnecting: `重连中（第${retryCount}次）...`,
    failed: '连接失败',
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between">
          <span>AI 智能审核（流式）</span>
          <div className="flex items-center gap-2">
            {connectionStatus !== 'idle' && connectionStatus !== 'failed' && (
              <span className="text-xs text-slate-400">{statusMap[connectionStatus]}</span>
            )}
            {isStreaming ? (
              <Button onClick={cancelReview} size="sm" variant="outline">
                取消
              </Button>
            ) : (
              <Button onClick={startAIReview} disabled={isStreaming} size="sm">
                开始 AI 审核
              </Button>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isStreaming && !result && (
          <div className="py-8 text-center">
            <div className="animate-pulse">
              <p className="text-slate-500">
                {retryCount > 0 ? `AI分析中（已重试${retryCount}次）...` : 'AI 正在分析合同...'}
              </p>
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

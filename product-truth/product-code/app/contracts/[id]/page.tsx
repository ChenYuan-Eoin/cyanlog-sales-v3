// REQ:F005
// PURPOSE: Contract detail page - display contract info and AI review results

'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'
import type { Contract } from '@/types'

const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  PENDING: { label: '待审核', variant: 'secondary' },
  PARSING: { label: '解析中', variant: 'default' },
  ANALYZING: { label: '审核中', variant: 'default' },
  COMPLETED: { label: '审核完成', variant: 'outline' },
  FAILED: { label: '审核失败', variant: 'destructive' },
}

const riskLevelMap: Record<string, { label: string; className: string }> = {
  red: { label: '红灯', className: 'bg-red-100 text-red-800 border-red-200' },
  yellow: { label: '黄灯', className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  green: { label: '绿灯', className: 'bg-green-100 text-green-800 border-green-200' },
}

export default function ContractDetailPage() {
  const params = useParams()
  const [contract, setContract] = useState<Contract | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [analyzing, setAnalyzing] = useState(false)

  const contractId = params.id as string

  useEffect(() => {
    fetchContract()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractId])

  async function fetchContract() {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/contracts/${contractId}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })

      if (!res.ok) {
        if (res.status === 404) setError('合同不存在')
        else if (res.status === 401) setError('未登录或登录已过期')
        else setError('获取合同失败')
        return
      }

      const data = await res.json()
      setContract(data)
    } catch {
      setError('网络错误，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  async function handleAnalyze() {
    if (!contract) return
    setAnalyzing(true)

    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/contracts/${contractId}/analyze`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || '启动审核失败')
        setAnalyzing(false)
        return
      }

      // Refresh to get updated status
      await fetchContract()
    } catch {
      setError('网络错误，请稍后重试')
    } finally {
      setAnalyzing(false)
    }
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="text-slate-500">加载中...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-8">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-red-600 mb-4">{error}</p>
            <Link href="/contracts">
              <Button variant="outline">返回列表</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!contract) {
    return (
      <div className="p-8">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-slate-500 mb-4">合同不存在</p>
            <Link href="/contracts">
              <Button variant="outline">返回列表</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  const latestReview = contract.contract_reviews?.[0]
  const isAnalyzing = contract.status === 'PARSING' || contract.status === 'ANALYZING'
  const canAnalyze = contract.status === 'PENDING' || contract.status === 'FAILED'

  return (
    <div className="p-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="text-sm text-slate-500 mb-1">
            <Link href="/contracts" className="hover:underline">合同审核</Link>
            <span className="mx-2">/</span>
            <span>详情</span>
          </div>
          <h1 className="text-2xl font-bold">{contract.filename}</h1>
        </div>
        <Link href="/contracts">
          <Button variant="outline">返回列表</Button>
        </Link>
      </div>

      {/* Basic Info */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">基本信息</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-slate-500">状态：</span>
              <Badge variant={statusMap[contract.status]?.variant || 'default'}>
                {statusMap[contract.status]?.label || contract.status}
              </Badge>
            </div>
            <div>
              <span className="text-slate-500">大小：</span>
              <span>{(contract.size / 1024 / 1024).toFixed(2)} MB</span>
            </div>
            <div>
              <span className="text-slate-500">类型：</span>
              <span>{contract.mime_type}</span>
            </div>
            <div>
              <span className="text-slate-500">上传时间：</span>
              <span>{new Date(contract.created_at).toLocaleString('zh-CN')}</span>
            </div>
          </div>

          {canAnalyze && (
            <div className="mt-6 pt-4 border-t">
              <Button onClick={handleAnalyze} disabled={analyzing}>
                {analyzing ? '启动中...' : '开始AI审核'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Analyzing State */}
      {isAnalyzing && (
        <Card className="mb-6">
          <CardContent className="py-8 text-center">
            <div className="animate-pulse">
              <p className="text-slate-500">AI 正在审核合同中...</p>
              <p className="text-sm text-slate-400 mt-2">请稍候，这通常需要 5-10 秒</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Review Results */}
      {contract.status === 'COMPLETED' && latestReview?.results && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI 审核结果</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="p-4 bg-slate-50 rounded-lg mb-6">
              <p className="text-sm">{latestReview.results.summary}</p>
            </div>

            {latestReview.results.risks.length > 0 ? (
              <div className="space-y-4">
                <h4 className="text-sm font-medium text-slate-700">
                  发现问题 ({latestReview.results.risks.length})
                </h4>
                {latestReview.results.risks.map((risk, index) => (
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
            ) : (
              <div className="text-center py-8">
                <p className="text-green-600">✓ 未发现明显风险</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Failed State */}
      {contract.status === 'FAILED' && (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-red-600 mb-2">审核失败</p>
            <p className="text-sm text-slate-500">请稍后重试，或联系管理员</p>
            {canAnalyze && (
              <Button onClick={handleAnalyze} disabled={analyzing} className="mt-4">
                {analyzing ? '重试中...' : '重新审核'}
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

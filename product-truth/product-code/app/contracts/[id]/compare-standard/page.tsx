'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  AlertTriangleIcon,
  XCircleIcon,
  GitCompareIcon,
  DownloadIcon,
} from 'lucide-react'
import { error as toastError, handleError } from '@/lib/toast'

interface ContractTemplate {
  id: string
  name: string
  description: string
  category: string
}

interface ComparisonResult {
  contract_clause: string
  template_clause: string
  result: 'match' | 'minor' | 'major' | 'missing'
  deviation_point?: string
  deviation_direction?: string
}

export default function CompareStandardPage() {
  const params = useParams()
  const contractId = params.id as string

  const [templates, setTemplates] = useState<ContractTemplate[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<string>('')
  const [results, setResults] = useState<ComparisonResult[]>([])
  const [loading, setLoading] = useState(true)
  const [comparing, setComparing] = useState(false)

  const fetchTemplates = useCallback(async () => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/contracts/templates', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (res.ok) {
        const data = await res.json()
        setTemplates(data.data || [])
      }
    } catch (err) {
      handleError(err, '加载模板失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchTemplates()
  }, [fetchTemplates])

  const handleCompare = useCallback(async () => {
    if (!selectedTemplate) return
    setComparing(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/contracts/${contractId}/compare-standard`, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ template_id: selectedTemplate }),
      })
      if (res.ok) {
        const data = await res.json()
        setResults(data.data.results || [])
      }
    } catch {
      toastError('比对失败')
    } finally {
      setComparing(false)
    }
  }, [contractId, selectedTemplate])

  if (loading) {
    return (
      <div className="min-h-full bg-slate-50 flex items-center justify-center">
        <div className="text-slate-500">加载模板...</div>
      </div>
    )
  }

  return (
    <div className="min-h-full bg-slate-50">
      <div className="mx-auto max-w-[1400px] px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link href={`/contracts/${contractId}`}>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <ArrowLeftIcon className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-bold text-slate-900">标准合同对照</h1>
              <p className="text-sm text-slate-500">将合同与标准模板比对，标记偏离条款</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <select
              className="h-9 px-3 bg-white border border-slate-200 rounded-lg text-sm"
              value={selectedTemplate}
              onChange={(e) => setSelectedTemplate(e.target.value)}
            >
              <option value="">选择标准模板</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <Button
              onClick={handleCompare}
              disabled={!selectedTemplate || comparing}
            >
              <GitCompareIcon className="h-4 w-4 mr-1.5" />
              {comparing ? '比对中...' : '开始比对'}
            </Button>
            <Button variant="outline" size="sm">
              <DownloadIcon className="h-4 w-4 mr-1" />
              导出报告
            </Button>
          </div>
        </div>

        {/* 比对结果 */}
        {results.length > 0 && (
          <div className="space-y-4">
            {/* 汇总 */}
            <div className="grid grid-cols-4 gap-4 mb-6">
              <StatCard count={results.filter(r => r.result === 'match').length} label="完全匹配" color="green" />
              <StatCard count={results.filter(r => r.result === 'minor').length} label="轻微偏离" color="yellow" />
              <StatCard count={results.filter(r => r.result === 'major').length} label="重大偏离" color="red" />
              <StatCard count={results.filter(r => r.result === 'missing').length} label="缺失" color="slate" />
            </div>

            {/* 对照列表 */}
            <div className="space-y-3">
              {results.map((result, index) => (
                <ComparisonRow key={index} result={result} />
              ))}
            </div>
          </div>
        )}

        {results.length === 0 && !comparing && (
          <div className="text-center py-20 text-slate-500">
            <GitCompareIcon className="h-12 w-12 mx-auto text-slate-200 mb-4" />
            <p>选择模板后开始比对</p>
            <p className="text-sm text-slate-400 mt-1">系统将自动识别条款偏离程度</p>
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ count, label, color }: { count: number; label: string; color: string }) {
  const colorMap: Record<string, { bg: string; text: string; border: string }> = {
    green: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
    yellow: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
    red: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
    slate: { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200' },
  }
  const c = colorMap[color]
  return (
    <Card className={`${c.bg} ${c.border}`}>
      <CardContent className="p-4 text-center">
        <p className={`text-2xl font-bold ${c.text}`}>{count}</p>
        <p className="text-xs text-slate-500">{label}</p>
      </CardContent>
    </Card>
  )
}

function ComparisonRow({ result }: { result: ComparisonResult }) {
  const config = {
    match: { badge: 'bg-green-100 text-green-700 border-green-200', label: '匹配', icon: CheckCircleIcon },
    minor: { badge: 'bg-amber-100 text-amber-700 border-amber-200', label: '轻微偏离', icon: AlertTriangleIcon },
    major: { badge: 'bg-red-100 text-red-700 border-red-200', label: '重大偏离', icon: XCircleIcon },
    missing: { badge: 'bg-slate-100 text-slate-600 border-slate-200', label: '缺失', icon: XCircleIcon },
  }
  const c = config[result.result]

  return (
    <Card className="hover:shadow-sm transition">
      <CardContent className="p-4">
        <div className="grid grid-cols-3 gap-4 items-start">
          <div>
            <p className="text-xs font-medium text-slate-400 mb-1">合同条款</p>
            <p className="text-sm text-slate-900">{result.contract_clause || '（无）'}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-400 mb-1">标准条款</p>
            <p className="text-sm text-slate-900">{result.template_clause || '（无）'}</p>
          </div>
          <div className="text-right">
            <Badge variant="outline" className={`${c.badge} mb-2`}>
              <c.icon className="h-3 w-3 mr-1" />
              {c.label}
            </Badge>
            {result.deviation_point && (
              <p className="text-xs text-slate-500">{result.deviation_point}</p>
            )}
            {result.deviation_direction && (
              <p className="text-xs text-slate-400">{result.deviation_direction}</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

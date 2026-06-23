'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  CheckCircleIcon,
  AlertTriangleIcon,
  XCircleIcon,
  SkipForwardIcon,
  ChevronRightIcon,
  LoaderIcon,
} from 'lucide-react'
import { handleError, error } from '@/lib/toast'

interface Clause {
  id: string
  clause_number: string
  clause_title: string
  clause_text: string
  risk_level: string
  risk_category: string
  risk_description?: string
  suggestion?: string
  review_status?: 'pending' | 'passed' | 'attention' | 'must_fix' | 'skipped'
  review_notes?: string
}

interface ClauseReviewStats {
  total: number
  passed: number
  attention: number
  must_fix: number
  skipped: number
  pending: number
}

export default function ClauseReviewWorkshop({ contractId }: { contractId: string }) {
  const [clauses, setClauses] = useState<Clause[]>([])
  const [stats, setStats] = useState<ClauseReviewStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedClauseId, setSelectedClauseId] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const fetchClauses = useCallback(async () => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/contracts/${contractId}/clauses`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (res.ok) {
        const data = await res.json()
        setClauses(data.data?.clauses || [])
        setStats(data.data?.stats || null)
      }
    } catch (err) {
      handleError(err, '加载条款数据失败')
    } finally {
      setLoading(false)
    }
  }, [contractId])

  useEffect(() => {
    void fetchClauses()
  }, [fetchClauses])

  const updateStatus = useCallback(
    async (clauseId: string, status: Clause['review_status'], notes?: string) => {
      setUpdatingId(clauseId)
      try {
        const token = localStorage.getItem('token')
        const res = await fetch(`/api/contracts/${contractId}/clauses/${clauseId}`, {
          method: 'PATCH',
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ review_status: status, review_notes: notes }),
        })
        if (res.ok) {
          await fetchClauses()
        }
      } catch {
        error('更新失败')
      } finally {
        setUpdatingId(null)
      }
    },
    [contractId, fetchClauses]
  )

  const statusConfig = {
    passed: { label: '通过', color: 'bg-green-100 text-green-700 border-green-200', icon: CheckCircleIcon, dot: 'bg-green-500' },
    attention: { label: '需关注', color: 'bg-amber-100 text-amber-700 border-amber-200', icon: AlertTriangleIcon, dot: 'bg-amber-500' },
    must_fix: { label: '必须修改', color: 'bg-red-100 text-red-700 border-red-200', icon: XCircleIcon, dot: 'bg-red-500' },
    skipped: { label: '跳过', color: 'bg-slate-100 text-slate-600 border-slate-200', icon: SkipForwardIcon, dot: 'bg-slate-400' },
    pending: { label: '待审', color: 'bg-blue-50 text-blue-600 border-blue-200', icon: null, dot: 'bg-blue-400' },
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoaderIcon className="h-5 w-5 animate-spin text-slate-400" />
        <span className="text-sm text-slate-500 ml-2">加载条款...</span>
      </div>
    )
  }

  if (clauses.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500">
        <p className="text-sm">暂无条款数据</p>
        <p className="text-xs text-slate-400 mt-1">请先运行AI审核提取条款</p>
      </div>
    )
  }

  const selectedClause = clauses.find((c) => c.id === selectedClauseId)

  return (
    <div className="h-full flex flex-col">
      {/* 统计 */}
      {stats && (
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500">审核进度：</span>
            <span className="font-medium">{stats.total - stats.pending}/{stats.total}</span>
            <span className="w-px h-3 bg-slate-300 mx-1" />
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              {stats.passed}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              {stats.attention}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              {stats.must_fix}
            </span>
            {stats.must_fix > 0 && (
              <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-[10px]">
                {stats.must_fix}条必须修改
              </Badge>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* 条款列表 */}
        <div className="w-72 bg-white border-r border-slate-200 overflow-y-auto">
          <div className="p-2">
            {clauses.map((clause) => {
              const status = clause.review_status || 'pending'
              const config = statusConfig[status]
              const isSelected = selectedClauseId === clause.id
              return (
                <button
                  key={clause.id}
                  onClick={() => setSelectedClauseId(clause.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs mb-1 transition ${
                    isSelected ? 'bg-slate-100 ring-1 ring-slate-300' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${config.dot} shrink-0`} />
                    <span className="font-medium truncate flex-1">
                      {clause.clause_number || ''} {clause.clause_title || '未命名条款'}
                    </span>
                    <ChevronRightIcon className="h-3 w-3 text-slate-300 shrink-0" />
                  </div>
                  {clause.risk_level && (
                    <Badge variant="outline" className="text-[10px] mt-1 ml-4">
                      {clause.risk_level === 'critical' ? '🔴 严重' : clause.risk_level === 'high' ? '🟡 高' : clause.risk_level === 'medium' ? '🟢 中' : '⚪ 低'}
                    </Badge>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* 条款详情 */}
        <div className="flex-1 bg-slate-50 overflow-y-auto p-6">
          {selectedClause ? (
            <div className="max-w-3xl mx-auto space-y-6">
              {/* 标题 */}
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  {selectedClause.clause_number || ''} {selectedClause.clause_title || '未命名条款'}
                </h3>
                {selectedClause.risk_category && (
                  <p className="text-sm text-slate-500 mt-1">类别: {selectedClause.risk_category}</p>
                )}
              </div>

              {/* 原文 */}
              <div className="bg-white rounded-lg border border-slate-200 p-4">
                <h4 className="text-xs font-bold text-slate-400 uppercase mb-2">条款原文</h4>
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                  {selectedClause.clause_text}
                </p>
              </div>

              {/* 风险描述 */}
              {selectedClause.risk_description && (
                <div className="bg-amber-50 rounded-lg border border-amber-200 p-4">
                  <h4 className="text-xs font-bold text-amber-600 uppercase mb-2">风险说明</h4>
                  <p className="text-sm text-amber-800">{selectedClause.risk_description}</p>
                </div>
              )}

              {/* 修改建议 */}
              {selectedClause.suggestion && (
                <div className="bg-green-50 rounded-lg border border-green-200 p-4">
                  <h4 className="text-xs font-bold text-green-600 uppercase mb-2">修改建议</h4>
                  <p className="text-sm text-green-800">{selectedClause.suggestion}</p>
                </div>
              )}

              {/* 审核操作 */}
              <div className="bg-white rounded-lg border border-slate-200 p-4">
                <h4 className="text-xs font-bold text-slate-400 uppercase mb-3">审核结论</h4>
                <div className="flex flex-wrap gap-2">
                  {(['passed', 'attention', 'must_fix', 'skipped'] as const).map((status) => {
                    const config = statusConfig[status]
                    const isActive = selectedClause.review_status === status
                    return (
                      <Button
                        key={status}
                        size="sm"
                        variant={isActive ? 'default' : 'outline'}
                        className={isActive ? config.color : ''}
                        onClick={() => void updateStatus(selectedClause.id, status)}
                        disabled={updatingId === selectedClause.id}
                      >
                        {config.icon && <config.icon className="h-3.5 w-3.5 mr-1" />}
                        {config.label}
                      </Button>
                    )
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-slate-400">
              <p className="text-sm">从左侧选择一个条款进行审核</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

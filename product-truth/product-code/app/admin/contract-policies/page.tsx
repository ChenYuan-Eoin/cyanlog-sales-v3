'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import {
  ArrowLeftIcon,
  PlusIcon,
  ShieldCheckIcon,
  SearchIcon,
  ChevronRightIcon,
  PencilIcon,
  TrashIcon,
  GitBranchIcon,
} from 'lucide-react'
import { handleError } from '@/lib/toast'

interface AuditRule {
  id: string
  code: string
  name: string
  description?: string
  category: 'ratio' | 'amount' | 'duration' | 'enum' | 'text'
  level_a_threshold: number
  level_b_threshold: number
  level_c_threshold: number
  level_c_message?: string
  level_b_counterparty?: string
  priority: number
  is_active: boolean
  version: number
  created_at: string
}

export default function ContractPoliciesPage() {
  const [rules, setRules] = useState<AuditRule[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')

  const fetchRules = useCallback(async () => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/contract-policies/rules?is_active=true', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (res.ok) {
        const data = await res.json()
        setRules(data.data || [])
      }
    } catch (err) {
      handleError(err, '加载规则失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchRules()
  }, [fetchRules])

  const filteredRules = useMemo(() => {
    let filtered = rules
    if (categoryFilter !== 'all') {
      filtered = filtered.filter((r) => r.category === categoryFilter)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      filtered = filtered.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.code.toLowerCase().includes(q) ||
          r.description?.toLowerCase().includes(q)
      )
    }
    return filtered.sort((a, b) => (b.priority || 0) - (a.priority || 0))
  }, [rules, categoryFilter, searchQuery])

  const categoryColors: Record<string, { bg: string; text: string; label: string }> = {
    ratio: { bg: 'bg-indigo-50', text: 'text-indigo-600', label: '比例类 (%)' },
    amount: { bg: 'bg-emerald-50', text: 'text-emerald-600', label: '金额类 (CNY)' },
    duration: { bg: 'bg-amber-50', text: 'text-amber-600', label: '时限类 (Day)' },
    enum: { bg: 'bg-slate-50', text: 'text-slate-600', label: '枚举类' },
    text: { bg: 'bg-slate-50', text: 'text-slate-600', label: '文本类' },
  }

  return (
    <div className="min-h-full bg-slate-50">
      <div className="mx-auto max-w-[1480px] px-6 py-8 lg:px-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link href="/contracts">
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <ArrowLeftIcon className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">策略配置中心</h1>
              <p className="text-sm text-slate-500 mt-1">规则原子化 + 3 级阈值 + 版本管理</p>
            </div>
          </div>
          <Button>
            <PlusIcon className="h-4 w-4 mr-1.5" />
            新增审计规则
          </Button>
        </div>

        {/* 过滤器 */}
        <div className="flex items-center gap-4 mb-6">
          <div className="relative flex-1 max-w-sm">
            <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="搜索规则编码、名称..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex gap-1">
            {(['all', 'ratio', 'amount', 'duration', 'enum'] as const).map((cat) => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                  categoryFilter === cat
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                {cat === 'all' ? '全部' : categoryColors[cat]?.label || cat}
              </button>
            ))}
          </div>
        </div>

        {/* 规则列表 */}
        {loading ? (
          <div className="text-center py-12 text-slate-500">加载中...</div>
        ) : filteredRules.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <ShieldCheckIcon className="mx-auto h-12 w-12 text-slate-200 mb-4" />
              <p className="text-slate-500">暂无规则</p>
              <Button variant="outline" size="sm" className="mt-4">
                <PlusIcon className="h-4 w-4 mr-1" />
                创建第一条规则
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredRules.map((rule) => {
              const cat = categoryColors[rule.category] || categoryColors.text
              return (
                <Card key={rule.id} className="border-l-4 border-l-indigo-500 hover:shadow-md transition">
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2">
                          <span className="font-mono text-xs text-slate-400 font-bold">{rule.code}</span>
                          <h3 className="font-bold text-slate-900">{rule.name}</h3>
                          <Badge className={`text-[10px] ${cat.bg} ${cat.text} border-0`}>
                            {cat.label}
                          </Badge>
                          {!rule.is_active && (
                            <Badge variant="outline" className="text-[10px]">已停用</Badge>
                          )}
                        </div>
                        {rule.description && (
                          <p className="text-sm text-slate-500 mb-3">{rule.description}</p>
                        )}

                        {/* Level A/B/C 阈值可视化 */}
                        <div className="flex items-center gap-2 mt-3">
                          <LevelBadge level="A" threshold={rule.level_a_threshold} />
                          <ChevronRightIcon className="h-3 w-3 text-slate-300" />
                          <LevelBadge level="B" threshold={rule.level_b_threshold} />
                          <ChevronRightIcon className="h-3 w-3 text-slate-300" />
                          <LevelBadge level="C" threshold={rule.level_c_threshold} />
                        </div>

                        {rule.level_c_message && (
                          <p className="text-xs text-red-500 mt-2">{rule.level_c_message}</p>
                        )}
                        {rule.level_b_counterparty && (
                          <p className="text-xs text-amber-600 mt-1">
                            偏离时建议换取：{rule.level_b_counterparty}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2 ml-4">
                        <Link href={`/admin/contract-policies/rules/${rule.id}/versions`}>
                          <Button variant="ghost" size="sm" title="版本管理">
                            <GitBranchIcon className="h-4 w-4 text-slate-500" />
                          </Button>
                        </Link>
                        <Button variant="ghost" size="sm">
                          <PencilIcon className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm">
                          <TrashIcon className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// Level 阈值徽章
function LevelBadge({ level, threshold }: { level: 'A' | 'B' | 'C'; threshold: number }) {
  const configs = {
    A: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', label: 'Level A' },
    B: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', label: 'Level B' },
    C: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', label: 'Level C' },
  }
  const config = configs[level]
  return (
    <div className={`px-2 py-1 rounded text-[10px] font-bold border ${config.bg} ${config.text} ${config.border}`}>
      {config.label}: {threshold}
    </div>
  )
}

// REQ:F005 - 审核策略管理页面
// PURPOSE: 切换/管理强势/平衡/弱势 审核立场

'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ShieldIcon, ShieldOffIcon, EqualIcon, CheckIcon } from 'lucide-react'
import { error as toastError } from '@/lib/toast'

interface Strategy {
  id: string
  code: 'AGGRESSIVE' | 'BALANCED' | 'CONSERVATIVE'
  name: string
  description: string | null
  risk_threshold: number
  enabled_categories: string[]
  is_default: boolean
  org_id: string | null
}

const STRATEGY_META: Record<string, { icon: typeof ShieldIcon; color: string; bgColor: string; borderColor: string; desc: string }> = {
  AGGRESSIVE: {
    icon: ShieldIcon,
    color: 'text-red-600',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    desc: '最大程度保护己方利益。所有不利条款均标为高风险，零容忍态度。',
  },
  BALANCED: {
    icon: EqualIcon,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    desc: '甲乙双方权益平衡。识别明显不公平条款，保留协商空间。',
  },
  CONSERVATIVE: {
    icon: ShieldOffIcon,
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
    desc: '以促成合作为主。仅标记严重风险条款，对小风险保持宽容。',
  },
}

export default function ReviewStrategiesPage() {
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [loading, setLoading] = useState(true)
  const [activeCode, setActiveCode] = useState<string>('BALANCED')
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    void fetchStrategies()
  }, [])

  async function fetchStrategies() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/review-strategies')
      if (res.ok) {
        const data = await res.json()
        const list = data.data?.strategies || []
        setStrategies(list)
        const def = list.find((s: Strategy) => s.is_default)
        if (def) setActiveCode(def.code)
      }
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }

  async function handleSetDefault(code: string) {
    setSaving(code)
    try {
      const res = await fetch('/api/admin/review-strategies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          name: STRATEGY_META[code] ? STRATEGY_META[code].desc.split('。')[0] : code,
          is_default: true,
        }),
      })
      if (res.ok) {
        setActiveCode(code)
        await fetchStrategies()
      } else {
        const data = await res.json()
        toastError(data.error || '设置失败')
      }
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShieldIcon className="h-6 w-6" />
          审核策略管理
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          选择不同的审核立场。强势策略会标注更多风险，弱势策略只标记严重问题。
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {loading ? (
          <div className="col-span-3 text-center py-12 text-slate-500">加载中...</div>
        ) : (
          (['AGGRESSIVE', 'BALANCED', 'CONSERVATIVE'] as const).map(code => {
            const meta = STRATEGY_META[code]
            const strategy = strategies.find(s => s.code === code)
            const Icon = meta.icon
            const isActive = activeCode === code || strategy?.is_default
            return (
              <Card
                key={code}
                className={`cursor-pointer transition ${isActive ? `${meta.borderColor} border-2 ${meta.bgColor}` : 'hover:border-slate-300'}`}
                onClick={() => setActiveCode(code)}
              >
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <Icon className={`h-8 w-8 ${meta.color}`} />
                    {isActive && (
                      <Badge className="bg-green-500">
                        <CheckIcon className="h-3 w-3 mr-1" />
                        当前
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <CardTitle className="text-lg mb-2">
                    {strategy?.name || code}
                  </CardTitle>
                  <p className="text-sm text-slate-600 mb-3">
                    {strategy?.description || meta.desc}
                  </p>
                  <div className="text-xs text-slate-500 mb-3">
                    风险阈值：{strategy?.risk_threshold ?? 50} / 100
                    <br />
                    启用类别：{(strategy?.enabled_categories || []).length || '全部'}
                  </div>
                  {!isActive && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleSetDefault(code)
                      }}
                      disabled={saving === code}
                    >
                      {saving === code ? '设置中...' : '设为默认'}
                    </Button>
                  )}
                </CardContent>
              </Card>
            )
          })
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">策略说明</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-slate-600">
          <div>
            <strong>强势（AGGRESSIVE）：</strong>{STRATEGY_META.AGGRESSIVE.desc}
            <br />
            <span className="text-xs text-slate-500">适用场景：首次合作、对方法律强势、行业话语权弱</span>
          </div>
          <div>
            <strong>平衡（BALANCED）：</strong>{STRATEGY_META.BALANCED.desc}
            <br />
            <span className="text-xs text-slate-500">适用场景：常规合作、双方有合作基础</span>
          </div>
          <div>
            <strong>弱势（CONSERVATIVE）：</strong>{STRATEGY_META.CONSERVATIVE.desc}
            <br />
            <span className="text-xs text-slate-500">适用场景：战略客户、长期合作、对方处于优势</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

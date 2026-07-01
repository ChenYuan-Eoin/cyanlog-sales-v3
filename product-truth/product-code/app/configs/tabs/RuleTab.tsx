'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PlusIcon, PlayIcon, ChevronRightIcon, TrashIcon, GitBranchIcon } from 'lucide-react'
import type { ContractPolicyRule } from '@/types/rules'
import RuleDesigner from '../components/RuleDesigner'
import RuleTestSandbox from '../components/RuleTestSandbox'

interface RuleTabProps {
  rules: ContractPolicyRule[]
  focusRuleId?: string | null
  ruleMode?: string | null
  onSave: (rule: Partial<ContractPolicyRule>, id?: string) => void | Promise<void>
  onDelete: (id: string) => void
}

const categoryMap: Record<string, { label: string; className: string }> = {
  ratio: { label: '比例类', className: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  amount: { label: '金额类', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  duration: { label: '时限类', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  enum: { label: '枚举类', className: 'bg-slate-50 text-slate-700 border-slate-200' },
  text: { label: '条款语义', className: 'bg-sky-50 text-sky-700 border-sky-200' },
}

const engineMap: Record<string, string> = {
  structured: '结构化',
  semantic: '语义',
  hybrid: '混合',
}

function formatThreshold(rule: ContractPolicyRule) {
  const unit = rule.level_a_unit || rule.level_b_unit || rule.level_c_unit || ''
  return `A ${rule.level_a_operator} ${rule.level_a_threshold}${unit} / B ${rule.level_b_operator} ${rule.level_b_threshold}${unit} / C ${rule.level_c_operator} ${rule.level_c_threshold}${unit}`
}

export default function RuleTab({ rules, focusRuleId, ruleMode, onSave, onDelete }: RuleTabProps) {
  const [selectedRule, setSelectedRule] = useState<ContractPolicyRule | null>(null)
  const [activeTab, setActiveTab] = useState<'list' | 'design' | 'test'>('list')
  const [saving, setSaving] = useState(false)
  const handledFocusRef = useRef<string | null>(null)

  const sortedRules = useMemo(
    () => [...rules].sort((left, right) => (right.priority || 0) - (left.priority || 0)),
    [rules]
  )

  useEffect(() => {
    const focusKey = `${ruleMode || ''}:${focusRuleId || ''}:${rules.length}`
    if (handledFocusRef.current === focusKey) return

    if (ruleMode === 'new') {
      handledFocusRef.current = focusKey
      setSelectedRule(null)
      setActiveTab('design')
      return
    }

    if (focusRuleId) {
      const matchedRule = rules.find((rule) => rule.id === focusRuleId)
      if (matchedRule) {
        handledFocusRef.current = focusKey
        setSelectedRule(matchedRule)
        setActiveTab('design')
      }
    }
  }, [focusRuleId, ruleMode, rules])

  const handleNewRule = () => {
    setSelectedRule(null)
    setActiveTab('design')
  }

  const handleSelectRule = (rule: ContractPolicyRule) => {
    setSelectedRule(rule)
    setActiveTab('design')
  }

  const handleSaveRule = async (rule: Partial<ContractPolicyRule>) => {
    setSaving(true)
    try {
      await onSave(rule, selectedRule?.id)
      setActiveTab('list')
      setSelectedRule(null)
    } finally {
      setSaving(false)
    }
  }

  const renderRuleButton = (rule: ContractPolicyRule) => {
    const category = categoryMap[rule.category] || categoryMap.text
    const isSelected = selectedRule?.id === rule.id
    return (
      <div
        key={rule.id}
        className={`rounded-lg border bg-white transition ${
          isSelected ? 'border-indigo-400 ring-1 ring-indigo-100' : 'border-slate-200 hover:border-indigo-200'
        }`}
      >
        <button
          onClick={() => handleSelectRule(rule)}
          className="w-full text-left p-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] text-slate-400">{rule.code}</span>
                <span className="font-medium text-sm text-slate-900">{rule.name}</span>
                <Badge variant={rule.is_active ? 'default' : 'secondary'} className="text-[10px]">
                  {rule.is_active ? '生效' : '停用'}
                </Badge>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={`text-[10px] ${category.className}`}>
                  {category.label}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  {engineMap[rule.engine_type] || rule.engine_type}
                </Badge>
                <span className="text-[11px] text-slate-400">v{rule.version}</span>
              </div>
              <p className="mt-2 text-xs text-slate-500 line-clamp-2">
                {rule.description || formatThreshold(rule)}
              </p>
            </div>
            <ChevronRightIcon className="h-4 w-4 shrink-0 text-slate-300" />
          </div>
        </button>
        <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2">
          <span className="text-[11px] text-slate-400 truncate">{formatThreshold(rule)}</span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              title="版本管理"
              onClick={() => window.open(`/admin/contract-policies/rules/${rule.id}/versions`, '_self')}
            >
              <GitBranchIcon className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-red-600 hover:text-red-700"
              title="停用规则"
              onClick={() => onDelete(rule.id)}
            >
              <TrashIcon className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[360px_minmax(0,1fr)_300px]">
      <Card className="min-w-0">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">合同审核规则 ({rules.length})</CardTitle>
          <Button size="sm" onClick={handleNewRule}>
            <PlusIcon className="h-4 w-4 mr-1" />
            新建
          </Button>
        </CardHeader>
        <CardContent>
          {sortedRules.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-slate-500">暂无规则</p>
              <p className="mt-1 text-sm text-slate-400">创建后将进入 F006 SkillBundle 编译输入</p>
            </div>
          ) : (
            <div className="max-h-[720px] space-y-2 overflow-y-auto pr-1">
              {sortedRules.map(renderRuleButton)}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="min-w-0 space-y-4">
        {activeTab === 'test' ? (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">规则测试：{selectedRule?.name || '全部规则'}</CardTitle>
              <Button size="sm" variant="outline" onClick={() => setActiveTab('design')}>
                返回设计
              </Button>
            </CardHeader>
            <CardContent>
              <RuleTestSandbox ruleId={selectedRule?.id} />
            </CardContent>
          </Card>
        ) : activeTab === 'design' ? (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle className="min-w-0 truncate text-base">
                {selectedRule ? `编辑规则：${selectedRule.code} ${selectedRule.name}` : '新建合同审核规则'}
              </CardTitle>
              <Button size="sm" variant="outline" onClick={() => setActiveTab('test')}>
                <PlayIcon className="h-4 w-4 mr-1" />
                测试
              </Button>
            </CardHeader>
            <CardContent>
              <RuleDesigner
                initialRule={selectedRule || undefined}
                saving={saving}
                onSave={handleSaveRule}
                onTest={() => setActiveTab('test')}
              />
            </CardContent>
          </Card>
        ) : (
          <Card className="h-full">
            <CardContent className="grid min-h-[420px] place-items-center py-12 text-center">
              <div>
                <p className="text-slate-600">选择左侧规则查看详情，或新建付款比例、账期、条款语义规则。</p>
                <Button className="mt-4" onClick={handleNewRule}>
                  <PlusIcon className="h-4 w-4 mr-1" />
                  新建规则
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="text-base">运行摘要</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('list')}
              className={`rounded-lg border px-2 py-2 text-xs font-medium ${activeTab === 'list' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600'}`}
            >
              浏览
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('design')}
              className={`rounded-lg border px-2 py-2 text-xs font-medium ${activeTab === 'design' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600'}`}
            >
              设计
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('test')}
              className={`rounded-lg border px-2 py-2 text-xs font-medium ${activeTab === 'test' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600'}`}
            >
              测试
            </button>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-medium text-slate-500">规则资产</div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-lg font-semibold text-slate-900">{rules.length}</div>
                <div className="text-[11px] text-slate-500">总数</div>
              </div>
              <div>
                <div className="text-lg font-semibold text-slate-900">{rules.filter((rule) => rule.is_active).length}</div>
                <div className="text-[11px] text-slate-500">启用</div>
              </div>
              <div>
                <div className="text-lg font-semibold text-slate-900">{rules.filter((rule) => rule.engine_type === 'hybrid').length}</div>
                <div className="text-[11px] text-slate-500">混合</div>
              </div>
            </div>
          </div>

          {selectedRule ? (
            <div className="space-y-3">
              <div>
                <div className="text-xs font-medium text-slate-500">当前规则</div>
                <div className="mt-1 font-medium text-slate-900">{selectedRule.code} · {selectedRule.name}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{categoryMap[selectedRule.category]?.label || selectedRule.category}</Badge>
                <Badge variant="outline">{engineMap[selectedRule.engine_type] || selectedRule.engine_type}</Badge>
                <Badge variant={selectedRule.is_active ? 'default' : 'secondary'}>{selectedRule.is_active ? '生效' : '停用'}</Badge>
              </div>
              <div className="rounded-lg border border-slate-200 p-3 text-xs leading-5 text-slate-600">
                {formatThreshold(selectedRule)}
              </div>
              <Button className="w-full" variant="outline" onClick={() => setActiveTab('test')}>
                <PlayIcon className="h-4 w-4 mr-1" />
                测试当前规则
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-200 px-3 py-8 text-center text-sm text-slate-500">
              选择规则后显示 Skill 转译摘要
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

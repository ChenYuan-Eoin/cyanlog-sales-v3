'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PlusIcon, PlayIcon, ChevronRightIcon } from 'lucide-react'
import type { Rule } } from '@/types/rules'
import RuleDesigner from '../components/RuleDesigner'
import RuleTestSandbox from '../components/RuleTestSandbox'

interface RuleTabProps {
  rules: Rule[]
  onNew: () => void
  onEdit: (rule: Rule) => void
  onDelete: (id: string) => void
}

// 规则扩展类型（包含Level A/B/C配置）
interface RuleWithLevels extends Rule {
  level_a?: { threshold: number; unit: string; action: string }
  level_b?: { threshold: number; unit: string; action: string; counterparty?: string }
  level_c?: { threshold: number; unit: string; action: string; message?: string }
}

const riskLevelMap: Record<string, { label: string; className: string }> = {
  red: { label: '红灯', className: 'bg-red-100 text-red-800 border-red-200' },
  yellow: { label: '黄灯', className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  green: { label: '绿灯', className: 'bg-green-100 text-green-800 border-green-200' },
}

const ruleTypeMap: Record<string, string> = {
  structured: '结构化规则',
  semantic: '语义规则',
}

export default function RuleTab({ rules, onNew, onEdit, onDelete }: RuleTabProps) {
  const [selectedRule, setSelectedRule] = useState<Rule | null>(null)
  const [showDesigner, setShowDesigner] = useState(false)
  const [activeTab, setActiveTab] = useState<'list' | 'design' | 'test'>('list')

  const handleSelectRule = (rule: Rule) => {
    setSelectedRule(rule)
    setActiveTab('design')
  }

  const handleNewRule = () => {
    setSelectedRule(null)
    setShowDesigner(true)
    setActiveTab('design')
    onNew()
  }

  const handleSaveRule = (formData: unknown) => {
    console.log('Saving rule:', formData)
    // TODO: 调用API保存规则
    setShowDesigner(false)
    setActiveTab('list')
  }

  const handleTestRule = (formData: unknown) => {
    console.log('Testing rule:', formData)
    setActiveTab('test')
  }

  // 规则列表视图
  if (activeTab === 'list') {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左侧规则列表 */}
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">合同审核规则 ({rules.length})</CardTitle>
              <Button size="sm" onClick={handleNewRule}>
                <PlusIcon className="h-4 w-4 mr-1" />
                新建
              </Button>
            </CardHeader>
            <CardContent>
              {rules.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-slate-500">暂无规则</p>
                  <p className="text-sm text-slate-400 mt-1">点击上方按钮创建第一条规则</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {rules.map((rule) => (
                    <button
                      key={rule.id}
                      onClick={() => handleSelectRule(rule)}
                      className="w-full text-left p-3 rounded-lg border hover:border-blue-300 hover:bg-blue-50 transition group"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{rule.name}</span>
                          <Badge variant={rule.enabled ? 'default' : 'secondary'} className="text-xs">
                            {rule.enabled ? '启用' : '停用'}
                          </Badge>
                        </div>
                        <ChevronRightIcon className="h-4 w-4 text-slate-400 group-hover:text-blue-500" />
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge className={`text-xs ${riskLevelMap[rule.risk_level]?.className || ''}`}>
                          {riskLevelMap[rule.risk_level]?.label || rule.risk_level}
                        </Badge>
                        <span className="text-xs text-slate-400">{ruleTypeMap[rule.rule_type] || rule.rule_type}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 右侧空状态 */}
        <div className="lg:col-span-2">
          <Card className="h-full flex items-center justify-center">
            <div className="text-center py-12">
              <p className="text-slate-500">选择左侧规则查看详情</p>
              <p className="text-sm text-slate-400 mt-2">或创建新规则</p>
              <Button className="mt-4" onClick={handleNewRule}>
                <PlusIcon className="h-4 w-4 mr-1" />
                新建规则
              </Button>
            </div>
          </Card>
        </div>
      </div>
    )
  }

  // 规则设计视图
  if (activeTab === 'design') {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左侧规则列表 */}
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">规则列表</CardTitle>
              <Button size="sm" variant="outline" onClick={() => setActiveTab('list')}>
                返回
              </Button>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {rules.map((rule) => (
                  <button
                    key={rule.id}
                    onClick={() => handleSelectRule(rule)}
                    className={`w-full text-left p-3 rounded-lg border transition ${
                      selectedRule?.id === rule.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'hover:border-blue-300 hover:bg-blue-50'
                    }`}
                  >
                    <span className="font-medium text-sm">{rule.name}</span>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge className={`text-xs ${riskLevelMap[rule.risk_level]?.className || ''}`}>
                        {riskLevelMap[rule.risk_level]?.label || rule.risk_level}
                      </Badge>
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 右侧规则设计器 */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">
                {selectedRule ? `编辑规则: ${selectedRule.name}` : '新建规则'}
              </CardTitle>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={activeTab === 'test' ? 'default' : 'outline'}
                  onClick={() => setActiveTab('test')}
                >
                  <PlayIcon className="h-4 w-4 mr-1" />
                  测试
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <RuleDesigner
                initialRule={selectedRule || undefined}
                onSave={handleSaveRule}
                onTest={handleTestRule}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  // 规则测试视图
  if (activeTab === 'test') {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">规则列表</CardTitle>
              <Button size="sm" variant="outline" onClick={() => setActiveTab('design')}>
                返回设计
              </Button>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {rules.map((rule) => (
                  <button
                    key={rule.id}
                    onClick={() => handleSelectRule(rule)}
                    className={`w-full text-left p-3 rounded-lg border transition ${
                      selectedRule?.id === rule.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'hover:border-blue-300 hover:bg-blue-50'
                    }`}
                  >
                    <span className="font-medium text-sm">{rule.name}</span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">测试规则: {selectedRule?.name || '新规则'}</CardTitle>
            </CardHeader>
            <CardContent>
              <RuleTestSandbox ruleId={selectedRule?.id} />
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return null
}

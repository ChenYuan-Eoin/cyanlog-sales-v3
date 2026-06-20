'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/lib/toast'

// Level A/B/C 配置
interface RuleLevelConfig {
  operator: '>=' | '<=' | '=' | '>' | '<'
  threshold: number
  unit: 'percent' | 'amount' | 'day' | 'month'
  action: string
  message?: string
  counterparty?: string
}

// 规则设计表单
interface RuleDesignForm {
  code: string
  name: string
  description: string
  category: 'ratio' | 'amount' | 'duration' | 'enum' | 'text'
  levelA: RuleLevelConfig
  levelB: RuleLevelConfig
  levelC: RuleLevelConfig
}

const defaultLevel: RuleLevelConfig = {
  operator: '<=',
  threshold: 0,
  unit: 'day',
  action: 'auto_approve',
  message: '',
}

interface RuleDesignerProps {
  initialRule?: Partial<RuleDesignForm>
  onSave: (rule: RuleDesignForm) => void
  onTest: (rule: RuleDesignForm) => void
}

export default function RuleDesigner({ initialRule, onSave, onTest }: RuleDesignerProps) {
  const [form, setForm] = useState<RuleDesignForm>({
    code: initialRule?.code || '',
    name: initialRule?.name || '',
    description: initialRule?.description || '',
    category: initialRule?.category || 'duration',
    levelA: initialRule?.levelA || { ...defaultLevel, operator: '<=', threshold: 30, action: 'auto_approve' },
    levelB: initialRule?.levelB || { ...defaultLevel, operator: '>', threshold: 90, action: 'suggest_counterparty', counterparty: '' },
    levelC: initialRule?.levelC || { ...defaultLevel, operator: '>', threshold: 180, action: 'block', message: '' },
  })

  const updateLevel = (level: 'levelA' | 'levelB' | 'levelC', field: keyof RuleLevelConfig, value: unknown) => {
    setForm(prev => ({
      ...prev,
      [level]: { ...prev[level], [field]: value },
    }))
  }

  const handleTest = () => {
    if (!form.code || !form.name) {
      toast.error('请填写规则编码和名称')
      return
    }
    onTest(form)
  }

  const handleSave = () => {
    if (!form.code || !form.name) {
      toast.error('请填写规则编码和名称')
      return
    }
    onSave(form)
  }

  const levelColors = {
    levelA: 'border-green-200 bg-green-50',
    levelB: 'border-yellow-200 bg-yellow-50',
    levelC: 'border-red-200 bg-red-50',
  }

  const levelLabels = {
    levelA: '🟢 Level A (通过)',
    levelB: '🟡 Level B (偏离)',
    levelC: '🔴 Level C (红线)',
  }

  return (
    <div className="space-y-6">
      {/* 基础信息 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">基础信息</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>规则编码</Label>
              <Input
                value={form.code}
                onChange={e => setForm(prev => ({ ...prev, code: e.target.value }))}
                placeholder="RULE-01"
              />
            </div>
            <div className="space-y-2">
              <Label>规则名称</Label>
              <Input
                value={form.name}
                onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="付款账期检查"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>规则描述</Label>
            <Input
              value={form.description}
              onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
              placeholder="检查合同付款账期是否合理"
            />
          </div>
          <div className="space-y-2">
            <Label>规则分类</Label>
            <Select
              value={form.category}
              onValueChange={(v: RuleDesignForm['category']) => setForm(prev => ({ ...prev, category: v }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ratio">比例类 (如违约金比例)</SelectItem>
                <SelectItem value="amount">金额类 (如合同金额)</SelectItem>
                <SelectItem value="duration">时长类 (如账期、质保期)</SelectItem>
                <SelectItem value="enum">枚举类 (如争议解决方式)</SelectItem>
                <SelectItem value="text">文本类 (语义检查)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Level A/B/C 配置 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Level A/B/C 阈值配置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {(['levelA', 'levelB', 'levelC'] as const).map((level) => (
            <div key={level} className={`p-4 rounded-lg border ${levelColors[level]}`}>
              <div className="flex items-center justify-between mb-3">
                <span className="font-medium">{levelLabels[level]}</span>
                <Badge variant="outline">
                  {form[level].action === 'auto_approve' && '自动通过'}
                  {form[level].action === 'suggest_counterparty' && '建议对价'}
                  {form[level].action === 'block' && '阻断'}
                  {form[level].action === 'require_approval' && '需要审批'}
                </Badge>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <Label className="text-xs">运算符</Label>
                  <Select
                    value={form[level].operator}
                    onValueChange={(v: RuleLevelConfig['operator']) => updateLevel(level, 'operator', v)}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="<=">≤ (小于等于)</SelectItem>
                      <SelectItem value=">=">≥ (大于等于)</SelectItem>
                      <SelectItem value="<">&lt; (小于)</SelectItem>
                      <SelectItem value=">">&gt; (大于)</SelectItem>
                      <SelectItem value="=">= (等于)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">阈值</Label>
                  <Input
                    type="number"
                    value={form[level].threshold}
                    onChange={e => updateLevel(level, 'threshold', parseFloat(e.target.value))}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">单位</Label>
                  <Select
                    value={form[level].unit}
                    onValueChange={(v: RuleLevelConfig['unit']) => updateLevel(level, 'unit', v)}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="day">天</SelectItem>
                      <SelectItem value="month">月</SelectItem>
                      <SelectItem value="percent">%</SelectItem>
                      <SelectItem value="amount">元</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">动作</Label>
                  <Select
                    value={form[level].action}
                    onValueChange={(v: string) => updateLevel(level, 'action', v)}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto_approve">自动通过</SelectItem>
                      <SelectItem value="suggest_counterparty">建议对价</SelectItem>
                      <SelectItem value="block">阻断</SelectItem>
                      <SelectItem value="require_approval">需要审批</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {/* Level B 特有：对价建议 */}
              {level === 'levelB' && (
                <div className="mt-3">
                  <Label className="text-xs">对价建议文案</Label>
                  <Input
                    value={form[level].counterparty || ''}
                    onChange={e => updateLevel(level, 'counterparty', e.target.value)}
                    placeholder="如：建议缩短账期或增加预付款"
                    className="mt-1"
                  />
                </div>
              )}
              {/* Level C 特有：阻断提示 */}
              {level === 'levelC' && (
                <div className="mt-3">
                  <Label className="text-xs">阻断提示文案</Label>
                  <Input
                    value={form[level].message || ''}
                    onChange={e => updateLevel(level, 'message', e.target.value)}
                    placeholder="如：账期超过180天，需财务总监审批"
                    className="mt-1"
                  />
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* 操作按钮 */}
      <div className="flex gap-3">
        <Button variant="outline" onClick={handleTest}>
          测试规则
        </Button>
        <Button onClick={handleSave}>
          保存规则
        </Button>
      </div>
    </div>
  )
}

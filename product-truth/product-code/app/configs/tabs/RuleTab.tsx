'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { Rule } from '@/types/rules'

interface RuleTabProps {
  rules: Rule[]
  onNew: () => void
  onEdit: (rule: Rule) => void
  onDelete: (id: string) => void
}

export default function RuleTab({ rules, onNew, onEdit, onDelete }: RuleTabProps) {
  const riskLevelMap: Record<string, { label: string; className: string }> = {
    red: { label: '红灯', className: 'bg-red-100 text-red-800 border-red-200' },
    yellow: { label: '黄灯', className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
    green: { label: '绿灯', className: 'bg-green-100 text-green-800 border-green-200' },
  }

  const ruleTypeMap: Record<string, string> = {
    structured: '结构化规则',
    semantic: '语义规则',
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>合同审核规则</CardTitle>
        <Button onClick={onNew}>+ 新建规则</Button>
      </CardHeader>
      <CardContent>
        {rules.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-slate-500">暂无规则</p>
            <p className="text-sm text-slate-400 mt-2">点击上方按钮创建第一条规则</p>
          </div>
        ) : (
          <div className="space-y-4">
            {rules.map((rule) => (
              <div key={rule.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium">{rule.name}</span>
                    <Badge variant={rule.enabled ? 'default' : 'secondary'}>
                      {rule.enabled ? '启用' : '停用'}
                    </Badge>
                    <Badge className={riskLevelMap[rule.risk_level]?.className || ''}>
                      {riskLevelMap[rule.risk_level]?.label || rule.risk_level}
                    </Badge>
                  </div>
                  <p className="text-sm text-slate-500">{rule.description || '无描述'}</p>
                  <div className="text-xs text-slate-400 mt-1">{ruleTypeMap[rule.rule_type] || rule.rule_type}</div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => onEdit(rule)}>编辑</Button>
                  <Button variant="outline" size="sm" onClick={() => onDelete(rule.id)}>删除</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
